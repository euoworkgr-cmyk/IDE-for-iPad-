import type { ProjectFile } from "../projects/models";
import {
  createStdinChannel,
  createStdinResponder,
  isPythonWorkerResponse,
  type PythonRuntimeStatus,
  type PythonWorkerExecuteRequest,
  type PythonWorkerResponse
} from "./pythonWorkerProtocol";

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
}

export interface PythonExecutor {
  execute(request: PythonExecutionRequest, hooks: PythonExecutionHooks): Promise<PythonExecutionResult>;
}

type WorkerFactory = () => Worker;

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
 */
export class PythonRuntime implements PythonExecutor {
  private worker: Worker | undefined;
  private busy = false;

  constructor(
    private readonly workerFactory: WorkerFactory = createPythonWorker,
    private readonly indexURLFactory: () => string = resolvePyodideIndexURL,
    private readonly stdinChannelFactory: () => SharedArrayBuffer | null = createStdinChannel
  ) {}

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
      return { ok: false, error: formatRuntimeError(error) };
    }

    const stdin = this.stdinChannelFactory();
    const responder = stdin ? createStdinResponder(stdin) : undefined;
    const executionId = createExecutionId();
    this.busy = true;

    return new Promise<PythonExecutionResult>((resolve) => {
      let settled = false;
      const finish = (result: PythonExecutionResult, discard = false): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.busy = false;
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

      const message: PythonWorkerExecuteRequest = {
        type: "execute",
        executionId,
        indexURL,
        entryPath: request.entryPath,
        files: request.files.map((file) => ({ path: file.path, content: file.content })),
        stdin
      };
      try {
        worker.postMessage(message);
      } catch (error) {
        finish({ ok: false, error: formatRuntimeError(error) }, true);
      }
    });
  }
}
