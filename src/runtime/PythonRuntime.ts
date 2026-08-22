import type { ProjectFile } from "../projects/models";
import {
  clearInterrupt,
  createInterruptBuffer,
  createStdinChannel,
  createStdinResponder,
  isPythonWorkerResponse,
  requestInterrupt,
  type PythonRuntimeStatus,
  type PythonWorkerExecuteRequest,
  type PythonWorkerResponse
} from "./pythonWorkerProtocol";
import { describeRuntimeStartFailure } from "./runtimeStartFailure";

export type { PythonRuntimeStatus } from "./pythonWorkerProtocol";

export interface PythonExecutionHooks {
  onStatus: (status: PythonRuntimeStatus) => void;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  readInput: () => string | null;
}

export interface PythonExecutionRequest {
  entryPath: string;
  files: readonly Pick<ProjectFile, "path" | "content">[];
}

export interface PythonExecutionResult {
  ok: boolean;
  error?: string;
  /** The run ended because the user asked it to, not because it finished. */
  stopped?: boolean;
}

export interface PythonExecutor {
  execute(request: PythonExecutionRequest, hooks: PythonExecutionHooks): Promise<PythonExecutionResult>;
  /** Stops the run in flight, if there is one. Safe to call when there is not. */
  stop(): void;
}

/**
 * How long a graceful interrupt is given before the Worker is terminated
 * outright. Pyodide notices the signal within a few bytecode instructions, so
 * this only has to cover a slow device — anything still running after it is
 * blocked somewhere the eval loop cannot reach, and only termination will do.
 */
export const PYTHON_INTERRUPT_GRACE_MS = 500;

type WorkerFactory = () => Worker;

interface ActiveRun {
  executionId: string;
  interrupt: SharedArrayBuffer | null;
  stopRequested: boolean;
  graceTimer: ReturnType<typeof setTimeout> | undefined;
  hardStop: () => void;
}

function createPythonWorker(): Worker {
  return new Worker(new URL("./pythonWorker.ts", import.meta.url), {
    type: "module",
    name: "altitude-python-runtime"
  });
}

/**
 * Pyodide loads its own assets relative to this URL. A Worker cannot derive it
 * — its own script lives in the built asset directory — so the main thread
 * resolves it and posts it across.
 */
function resolvePyodideIndexURL(): string {
  const base = typeof document !== "undefined" ? document.baseURI : globalThis.location?.href;
  return new URL("pyodide/", base ?? "/").href;
}

function createExecutionId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-cryptographic correlation identifier.
  }
  return `py-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

/**
 * Runs Python in a Worker (L6).
 *
 * The Worker is kept alive between runs, unlike the JavaScript one: loading
 * Pyodide costs megabytes of wasm, and a fresh Worker per run would pay that
 * every time. Isolation between runs comes from wiping the virtual project
 * directory and dropping the project's modules from `sys.modules` instead.
 *
 * `input()` still reaches `window.prompt`, but by way of the stdin channel:
 * the Worker blocks on a `SharedArrayBuffer` while this thread — free, which
 * is the point of the whole task — collects the line and writes it back.
 *
 * Stopping (L7) is two-tier. `stop()` first writes SIGINT into Pyodide's
 * interrupt buffer, which raises `KeyboardInterrupt` in the running code and
 * leaves the loaded runtime alive, so the next Run starts instantly. Code that
 * is blocked somewhere the eval loop cannot reach never sees that signal, so a
 * short grace period later the Worker is terminated outright. The guarantee is
 * that the run stops; the interrupt is only how it stops cheaply when it can.
 */
export class PythonRuntime implements PythonExecutor {
  private worker: Worker | undefined;
  private busy = false;
  private activeRun: ActiveRun | undefined;

  constructor(
    private readonly workerFactory: WorkerFactory = createPythonWorker,
    private readonly indexURLFactory: () => string = resolvePyodideIndexURL,
    private readonly stdinChannelFactory: () => SharedArrayBuffer | null = createStdinChannel,
    private readonly interruptBufferFactory: () => SharedArrayBuffer | null = createInterruptBuffer
  ) {}

  /**
   * Stops the run in flight. Tries the cheap interrupt first and keeps a hard
   * stop behind it, because "you can always stop what you started" cannot be
   * conditional on the code being interruptible.
   */
  stop(): void {
    const active = this.activeRun;
    if (!active || active.stopRequested) {
      return;
    }
    active.stopRequested = true;
    if (!active.interrupt) {
      active.hardStop();
      return;
    }
    requestInterrupt(active.interrupt);
    active.graceTimer = globalThis.setTimeout(active.hardStop, PYTHON_INTERRUPT_GRACE_MS);
  }

  /**
   * Discards the Worker, so the next run starts a fresh one. Used when a run
   * fails in a way that leaves the Worker's state untrustworthy.
   */
  private discardWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = this.workerFactory();
    }
    return this.worker;
  }

  async execute(
    request: PythonExecutionRequest,
    hooks: PythonExecutionHooks
  ): Promise<PythonExecutionResult> {
    if (this.busy) {
      return { ok: false, error: "Another Python run is already in progress." };
    }

    let worker: Worker;
    let indexURL: string;
    try {
      worker = this.ensureWorker();
      indexURL = this.indexURLFactory();
    } catch (error) {
      this.discardWorker();
      return { ok: false, error: describeRuntimeStartFailure("Python", error) };
    }

    const stdin = this.stdinChannelFactory();
    const responder = stdin ? createStdinResponder(stdin) : undefined;
    const interrupt = this.interruptBufferFactory();
    if (interrupt) {
      // Clear here as well as in the Worker: a stop that landed after the last
      // run settled would otherwise still be armed when this one starts.
      clearInterrupt(interrupt);
    }
    const executionId = createExecutionId();
    this.busy = true;

    return new Promise<PythonExecutionResult>((resolve) => {
      let settled = false;
      const finish = (rawResult: PythonExecutionResult, discard = false): void => {
        if (settled) {
          return;
        }
        settled = true;
        // Once a stop has been asked for, every way this run can end is a stop
        // — the interrupt's KeyboardInterrupt, a Worker error raised on the way
        // down, a hard termination. Reporting one of them as a failure would
        // show the user an error they caused deliberately.
        const result =
          this.activeRun?.stopRequested && !rawResult.ok
            ? { ok: false, stopped: true }
            : rawResult;
        this.busy = false;
        if (this.activeRun?.executionId === executionId) {
          globalThis.clearTimeout(this.activeRun.graceTimer);
          this.activeRun = undefined;
        }
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("messageerror", onMessageError);
        worker.removeEventListener("error", onError);
        if (discard) {
          this.discardWorker();
        }
        resolve(result);
      };

      const onMessage = (event: MessageEvent<unknown>): void => {
        const message = event.data as PythonWorkerResponse;
        if (!isPythonWorkerResponse(message) || message.executionId !== executionId) {
          return;
        }
        if (message.type === "stdout") {
          hooks.onStdout(message.chunk);
        } else if (message.type === "stderr") {
          hooks.onStderr(message.chunk);
        } else if (message.type === "status") {
          hooks.onStatus(message.status);
        } else if (message.type === "stdin-request") {
          // The Worker is parked in Atomics.wait until this responds, so it
          // must not be allowed to throw its way past the write.
          let line: string | null = null;
          try {
            line = message.continuation ? null : hooks.readInput();
          } catch {
            line = null;
          }
          responder?.respond(line, message.continuation);
        } else if (message.type === "failure") {
          finish({ ok: false, error: message.error });
        } else if (message.type === "stopped") {
          finish({ ok: false, stopped: true });
        } else {
          finish({ ok: true });
        }
      };
      const onMessageError = (): void => {
        finish({ ok: false, error: "Python Worker returned an unreadable message." }, true);
      };
      const onError = (event: ErrorEvent): void => {
        event.preventDefault();
        finish(
          { ok: false, error: event.message || "Python Worker failed to start." },
          true
        );
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("messageerror", onMessageError);
      worker.addEventListener("error", onError);

      this.activeRun = {
        executionId,
        interrupt,
        stopRequested: false,
        graceTimer: undefined,
        // Terminating leaves no runtime to reuse, so the Worker goes with it
        // and the next Run reloads Pyodide. That is the price of a stop the
        // interrupt could not deliver.
        hardStop: () => finish({ ok: false, stopped: true }, true)
      };

      const message: PythonWorkerExecuteRequest = {
        type: "execute",
        executionId,
        indexURL,
        entryPath: request.entryPath,
        files: request.files.map((file) => ({ path: file.path, content: file.content })),
        stdin,
        interrupt
      };
      try {
        worker.postMessage(message);
      } catch (error) {
        finish({ ok: false, error: formatRuntimeError(error) }, true);
      }
    });
  }
}
