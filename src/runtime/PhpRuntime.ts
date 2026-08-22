import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../settings/appSettings";
import { normalizeProjectPath } from "./projectPaths";
import {
  createExecutionId,
  formatRuntimeError,
  formatTimeout,
  resolveTimeoutMs,
  type ExecutionTimeoutSource
} from "./workerExecution";
import { describeRuntimeStartFailure } from "./runtimeStartFailure";

/**
 * PHP follows SQL's shape — one Worker per run, terminate to stop — with one
 * difference that its size forces. Loading a 12.5 MiB wasm build takes seconds
 * on a cold cache, which any sensible run time limit would cut short, so the
 * limit does not start until PHP reports that it is running the user's code.
 * Loading gets its own, much longer budget instead, and that budget exists only
 * so a wasm that never arrives cannot hang the Run button forever.
 */
export const PHP_STARTUP_TIMEOUT_MS = 120_000;

export type PhpRuntimeStatus = "loading" | "running";

export interface PhpExecutionHooks {
  onStatus: (status: PhpRuntimeStatus) => void;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}

export interface PhpProjectFile {
  path: string;
  content: string;
}

export interface PhpExecutionRequest {
  entryPath: string;
  /**
   * Every file in the project, not just the entry. PHP's `include` and
   * `require` of a sibling file is ordinary usage rather than an advanced
   * feature, so the whole project is mounted — the same choice Python makes.
   */
  files: readonly PhpProjectFile[];
}

export interface PhpExecutionResult {
  ok: boolean;
  error?: string;
  /** The run ended because the user asked it to, not because it finished. */
  stopped?: boolean;
  /** PHP's own exit code, when the run got far enough to have one. */
  exitCode?: number;
}

export interface PhpExecutor {
  execute(request: PhpExecutionRequest, hooks: PhpExecutionHooks): Promise<PhpExecutionResult>;
  /** Stops the run in flight, if there is one. Safe to call when there is not. */
  stop(): void;
}

export interface PhpWorkerRequest {
  type: "execute";
  executionId: string;
  entryPath: string;
  files: readonly PhpProjectFile[];
  /** Absolute URL of the copied Emscripten module — see `resolvePhpModuleURL`. */
  moduleUrl: string;
}

export type PhpWorkerResponse =
  | { type: "stdout" | "stderr"; executionId: string; chunk: string }
  | { type: "status"; executionId: string; status: PhpRuntimeStatus }
  | { type: "complete"; executionId: string; exitCode: number }
  | { type: "failure"; executionId: string; error: string };

type WorkerFactory = () => Worker;

function createPhpWorker(): Worker {
  return new Worker(new URL("./phpWorker.ts", import.meta.url), {
    type: "module",
    name: "altitude-php-runtime"
  });
}

/**
 * The PHP build is copied into `public/php/` by `scripts/copy-php-assets.mjs`
 * and loaded from there rather than bundled, so that only one of the package's
 * dozen PHP versions ships. As with Pyodide, a Worker cannot derive the URL —
 * its own script lives in the built asset directory — so the main thread
 * resolves it and posts it across.
 */
export function resolvePhpModuleURL(): string {
  const base = typeof document !== "undefined" ? document.baseURI : globalThis.location?.href;
  return new URL("php/php8.3-web.mjs", base ?? "/").href;
}

function isWorkerResponse(value: unknown): value is PhpWorkerResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PhpWorkerResponse>;
  if (typeof candidate.executionId !== "string" || typeof candidate.type !== "string") {
    return false;
  }
  if (candidate.type === "stdout" || candidate.type === "stderr") {
    return typeof candidate.chunk === "string";
  }
  if (candidate.type === "failure") {
    return typeof candidate.error === "string";
  }
  if (candidate.type === "status") {
    return candidate.status === "loading" || candidate.status === "running";
  }
  return candidate.type === "complete" && typeof candidate.exitCode === "number";
}

/** The same defensive validation every execution path gets, plus PHP's own extensions. */
function validateEntryPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  if (!/\.(php|phtml)$/i.test(normalized)) {
    throw new Error(`PHP execution supports .php and .phtml files only: ${normalized}`);
  }
  return normalized;
}

export class PhpRuntime implements PhpExecutor {
  private stopActiveRun: (() => void) | undefined;

  constructor(
    private readonly workerFactory: WorkerFactory = createPhpWorker,
    private readonly timeout: ExecutionTimeoutSource = DEFAULT_EXECUTION_TIMEOUT_MS,
    private readonly moduleUrlFactory: () => string = resolvePhpModuleURL,
    private readonly startupTimeoutMs: number = PHP_STARTUP_TIMEOUT_MS
  ) {}

  /**
   * PHP executes synchronously inside its wasm module, so — as with SQL and
   * JavaScript — terminating the Worker is the only thing that can reach a
   * runaway script, and it is enough.
   */
  stop(): void {
    this.stopActiveRun?.();
  }

  async execute(
    request: PhpExecutionRequest,
    hooks: PhpExecutionHooks
  ): Promise<PhpExecutionResult> {
    let entryPath: string;
    let moduleUrl: string;
    try {
      entryPath = validateEntryPath(request.entryPath);
      moduleUrl = this.moduleUrlFactory();
    } catch (error) {
      return { ok: false, error: formatRuntimeError(error) };
    }

    let worker: Worker;
    try {
      worker = this.workerFactory();
    } catch (error) {
      return { ok: false, error: describeRuntimeStartFailure("PHP", error) };
    }

    hooks.onStatus("loading");
    const executionId = createExecutionId("php");

    return new Promise<PhpExecutionResult>((resolve) => {
      let settled = false;
      let timeoutId: ReturnType<typeof globalThis.setTimeout>;

      const finish = (result: PhpExecutionResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timeoutId);
        this.stopActiveRun = undefined;
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
        resolve(result);
      };

      // Two budgets, one timer. The first covers loading the interpreter and
      // exists only to bound a wasm that never arrives; the second is the
      // user's own limit and covers their code.
      timeoutId = globalThis.setTimeout(() => {
        finish({
          ok: false,
          error: `PHP did not finish loading within ${formatTimeout(this.startupTimeoutMs)}.`
        });
      }, this.startupTimeoutMs);

      const startExecutionTimer = (): void => {
        globalThis.clearTimeout(timeoutId);
        const timeoutMs = resolveTimeoutMs(this.timeout);
        timeoutId = globalThis.setTimeout(() => {
          finish({
            ok: false,
            error: `Execution stopped: it exceeded the ${formatTimeout(timeoutMs)} run time limit. Change the limit in Settings.`
          });
        }, timeoutMs);
      };

      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (!isWorkerResponse(event.data) || event.data.executionId !== executionId) {
          return;
        }
        if (event.data.type === "stdout") {
          hooks.onStdout(event.data.chunk);
        } else if (event.data.type === "status") {
          if (event.data.status === "running") {
            startExecutionTimer();
          }
          hooks.onStatus(event.data.status);
        } else if (event.data.type === "stderr") {
          hooks.onStderr(event.data.chunk);
        } else if (event.data.type === "failure") {
          finish({ ok: false, error: event.data.error });
        } else if (event.data.type === "complete") {
          // A non-zero exit code is how `exit(1)` and a fatal error both end.
          // The Worker reports the diagnostics; this only decides the verdict.
          finish({ ok: event.data.exitCode === 0, exitCode: event.data.exitCode });
        }
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        finish({ ok: false, error: event.message || "PHP Worker failed to start." });
      };
      worker.onmessageerror = () => {
        finish({ ok: false, error: "PHP Worker returned an unreadable message." });
      };

      this.stopActiveRun = () => finish({ ok: false, stopped: true });

      const message: PhpWorkerRequest = {
        type: "execute",
        executionId,
        entryPath,
        files: request.files,
        moduleUrl
      };
      try {
        worker.postMessage(message);
      } catch (error) {
        finish({ ok: false, error: formatRuntimeError(error) });
      }
    });
  }
}
