import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../settings/appSettings";
import { normalizeProjectPath } from "./projectPaths";
import {
  createExecutionId,
  formatRuntimeError,
  formatTimeout,
  resolveTimeoutMs,
  type ExecutionTimeoutSource
} from "./workerExecution";

/**
 * C# follows PHP's shape — one Worker per run, terminate to stop, and a
 * separate startup budget — because it has PHP's problem: the .NET runtime and
 * Roslyn are 11.62 MiB, and loading that on a cold cache takes longer than any
 * sensible run time limit. The user's limit does not start until the engine
 * reports that it is compiling.
 *
 * What C# adds over every runtime before it is a **compile phase**. Python,
 * JavaScript, SQL and PHP each fail one way; C# fails two ways — it can fail
 * to compile, with several diagnostics at once, before a line of it runs.
 * That is why the result carries `diagnostics` rather than only `error`.
 */
export const CSHARP_STARTUP_TIMEOUT_MS = 120_000;

export type CSharpRuntimeStatus = "loading" | "compiling" | "running";

export interface CSharpDiagnostic {
  /** Roslyn's own code, e.g. `CS0029`. */
  id: string;
  severity: "error" | "warning";
  message: string;
  /** One-based, as editors and humans count. */
  line: number;
  column: number;
}

export interface CSharpExecutionHooks {
  onStatus: (status: CSharpRuntimeStatus) => void;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}

export interface CSharpExecutionRequest {
  entryPath: string;
  source: string;
}

export interface CSharpExecutionResult {
  ok: boolean;
  error?: string;
  /** The run ended because the user asked it to, not because it finished. */
  stopped?: boolean;
  /** Compiler output. Present on success too — warnings are worth showing. */
  diagnostics?: readonly CSharpDiagnostic[];
  /** The program's own exit code, when it got far enough to have one. */
  exitCode?: number;
}

export interface CSharpExecutor {
  execute(
    request: CSharpExecutionRequest,
    hooks: CSharpExecutionHooks
  ): Promise<CSharpExecutionResult>;
  /** Stops the run in flight, if there is one. Safe to call when there is not. */
  stop(): void;
}

export interface CSharpWorkerRequest {
  type: "execute";
  executionId: string;
  entryPath: string;
  source: string;
  /** Absolute URL of the downloaded .NET runtime — see `resolveDotnetBaseURL`. */
  runtimeBaseUrl: string;
}

export type CSharpWorkerResponse =
  | { type: "stdout" | "stderr"; executionId: string; chunk: string }
  | { type: "status"; executionId: string; status: CSharpRuntimeStatus }
  | {
      type: "complete";
      executionId: string;
      diagnostics: readonly CSharpDiagnostic[];
      exitCode: number | null;
      runtimeError: string | null;
    }
  | { type: "failure"; executionId: string; error: string };

type WorkerFactory = () => Worker;

function createCSharpWorker(): Worker {
  return new Worker(new URL("./csharpWorker.ts", import.meta.url), {
    type: "module",
    name: "altitude-csharp-runtime"
  });
}

/**
 * The .NET runtime is downloaded into `public/dotnet/` by
 * `scripts/copy-dotnet-assets.mjs` and loaded from there rather than bundled.
 * As with Pyodide and PHP, a Worker cannot derive the URL — its own script
 * lives in the built asset directory — so the main thread resolves it.
 */
export function resolveDotnetBaseURL(): string {
  const base = typeof document !== "undefined" ? document.baseURI : globalThis.location?.href;
  return new URL("dotnet/", base ?? "/").href;
}

function isDiagnostic(value: unknown): value is CSharpDiagnostic {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CSharpDiagnostic>;
  return (
    typeof candidate.id === "string" &&
    (candidate.severity === "error" || candidate.severity === "warning") &&
    typeof candidate.message === "string" &&
    typeof candidate.line === "number" &&
    typeof candidate.column === "number"
  );
}

function isWorkerResponse(value: unknown): value is CSharpWorkerResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CSharpWorkerResponse>;
  if (typeof candidate.executionId !== "string" || typeof candidate.type !== "string") {
    return false;
  }
  if (candidate.type === "stdout" || candidate.type === "stderr") {
    return typeof (candidate as { chunk?: unknown }).chunk === "string";
  }
  if (candidate.type === "failure") {
    return typeof (candidate as { error?: unknown }).error === "string";
  }
  if (candidate.type === "status") {
    const { status } = candidate as { status?: unknown };
    return status === "loading" || status === "compiling" || status === "running";
  }
  if (candidate.type === "complete") {
    const complete = candidate as {
      diagnostics?: unknown;
      exitCode?: unknown;
      runtimeError?: unknown;
    };
    return (
      Array.isArray(complete.diagnostics) &&
      complete.diagnostics.every(isDiagnostic) &&
      (complete.exitCode === null || typeof complete.exitCode === "number") &&
      (complete.runtimeError === null || typeof complete.runtimeError === "string")
    );
  }
  return false;
}

/** The same defensive validation every execution path gets, plus C#'s extension. */
function validateEntryPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  if (!/\.cs$/i.test(normalized)) {
    throw new Error(`C# execution supports .cs files only: ${normalized}`);
  }
  return normalized;
}

export class CSharpRuntime implements CSharpExecutor {
  private stopActiveRun: (() => void) | undefined;

  constructor(
    private readonly workerFactory: WorkerFactory = createCSharpWorker,
    private readonly timeout: ExecutionTimeoutSource = DEFAULT_EXECUTION_TIMEOUT_MS,
    private readonly runtimeBaseUrlFactory: () => string = resolveDotnetBaseURL,
    private readonly startupTimeoutMs: number = CSHARP_STARTUP_TIMEOUT_MS
  ) {}

  /**
   * The user's code runs synchronously inside the .NET runtime, so — as with
   * SQL, PHP and JavaScript — terminating the Worker is the only thing that
   * can reach a runaway program, and it is enough. Terminating also returns
   * the whole WebAssembly heap to the OS, which matters more here than
   * anywhere else: this is the largest runtime Altitude ships.
   */
  stop(): void {
    this.stopActiveRun?.();
  }

  async execute(
    request: CSharpExecutionRequest,
    hooks: CSharpExecutionHooks
  ): Promise<CSharpExecutionResult> {
    let entryPath: string;
    let runtimeBaseUrl: string;
    try {
      entryPath = validateEntryPath(request.entryPath);
      runtimeBaseUrl = this.runtimeBaseUrlFactory();
    } catch (error) {
      return { ok: false, error: formatRuntimeError(error) };
    }

    let worker: Worker;
    try {
      worker = this.workerFactory();
    } catch (error) {
      return { ok: false, error: formatRuntimeError(error) };
    }

    hooks.onStatus("loading");
    const executionId = createExecutionId("csharp");

    return new Promise<CSharpExecutionResult>((resolve) => {
      let settled = false;
      let timeoutId: ReturnType<typeof globalThis.setTimeout>;

      const finish = (result: CSharpExecutionResult): void => {
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

      // Two budgets, one timer. The first bounds a runtime that never arrives;
      // the second is the user's own limit and covers compiling and running.
      timeoutId = globalThis.setTimeout(() => {
        finish({
          ok: false,
          error: `The C# runtime did not finish loading within ${formatTimeout(this.startupTimeoutMs)}.`
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
        const message = event.data;
        if (message.type === "stdout") {
          hooks.onStdout(message.chunk);
        } else if (message.type === "stderr") {
          hooks.onStderr(message.chunk);
        } else if (message.type === "status") {
          // Compiling is the first thing that happens with the user's code in
          // hand, so their limit starts there rather than at "running".
          if (message.status === "compiling") {
            startExecutionTimer();
          }
          hooks.onStatus(message.status);
        } else if (message.type === "failure") {
          finish({ ok: false, error: message.error });
        } else if (message.type === "complete") {
          const failedToCompile = message.diagnostics.some(
            (diagnostic: CSharpDiagnostic) => diagnostic.severity === "error"
          );
          finish({
            ok: !failedToCompile && message.runtimeError === null && message.exitCode === 0,
            error: message.runtimeError ?? undefined,
            diagnostics: message.diagnostics,
            exitCode: message.exitCode ?? undefined
          });
        }
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        finish({ ok: false, error: event.message || "C# Worker failed to start." });
      };
      worker.onmessageerror = () => {
        finish({ ok: false, error: "C# Worker returned an unreadable message." });
      };

      this.stopActiveRun = () => finish({ ok: false, stopped: true });

      const message: CSharpWorkerRequest = {
        type: "execute",
        executionId,
        entryPath,
        source: request.source,
        runtimeBaseUrl
      };
      try {
        worker.postMessage(message);
      } catch (error) {
        finish({ ok: false, error: formatRuntimeError(error) });
      }
    });
  }
}
