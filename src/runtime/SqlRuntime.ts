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
 * SQL runs on its own Worker rather than sharing the JavaScript one. TypeScript
 * shares that path because stripping types leaves JavaScript; SQL does not,
 * because it is a different engine — an 865 KiB wasm build of SQLite — and
 * folding it into the JavaScript Worker would make every `console.log` run pay
 * to have SQLite in its chunk graph. What is shared is the shape: one Worker
 * per run, the same settings-driven time limit, and a Stop that terminates.
 */
export type SqlRuntimeStatus = "loading" | "running";

export interface SqlExecutionHooks {
  onStatus: (status: SqlRuntimeStatus) => void;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}

export interface SqlExecutionRequest {
  entryPath: string;
  source: string;
}

export interface SqlExecutionResult {
  ok: boolean;
  error?: string;
  /** The run ended because the user asked it to, not because it finished. */
  stopped?: boolean;
}

export interface SqlExecutor {
  execute(
    request: SqlExecutionRequest,
    hooks: SqlExecutionHooks
  ): Promise<SqlExecutionResult>;
  /** Stops the run in flight, if there is one. Safe to call when there is not. */
  stop(): void;
}

export interface SqlWorkerRequest {
  type: "execute";
  executionId: string;
  entryPath: string;
  source: string;
}

export type SqlWorkerResponse =
  | { type: "stdout" | "stderr"; executionId: string; chunk: string }
  | { type: "status"; executionId: string; status: SqlRuntimeStatus }
  | { type: "complete"; executionId: string }
  | { type: "failure"; executionId: string; error: string };

type WorkerFactory = () => Worker;

function createSqlWorker(): Worker {
  return new Worker(new URL("./sqlWorker.ts", import.meta.url), {
    type: "module",
    name: "altitude-sql-runtime"
  });
}

function isWorkerResponse(value: unknown): value is SqlWorkerResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SqlWorkerResponse>;
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
  return candidate.type === "complete";
}

/** The same defensive validation every execution path gets, plus `.sql` only. */
function validateEntryPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  if (!/\.sql$/i.test(normalized)) {
    throw new Error(`SQL execution supports .sql files only: ${normalized}`);
  }
  return normalized;
}

export class SqlRuntime implements SqlExecutor {
  private stopActiveRun: (() => void) | undefined;

  constructor(
    private readonly workerFactory: WorkerFactory = createSqlWorker,
    private readonly timeout: ExecutionTimeoutSource = DEFAULT_EXECUTION_TIMEOUT_MS
  ) {}

  /**
   * A SQL run owns its Worker, and SQLite executes a statement synchronously
   * inside it, so there is nothing an interrupt tier could reach that
   * termination does not. This matches JavaScript, not Python.
   */
  stop(): void {
    this.stopActiveRun?.();
  }

  async execute(
    request: SqlExecutionRequest,
    hooks: SqlExecutionHooks
  ): Promise<SqlExecutionResult> {
    let entryPath: string;
    try {
      entryPath = validateEntryPath(request.entryPath);
    } catch (error) {
      return { ok: false, error: formatRuntimeError(error) };
    }

    let worker: Worker;
    try {
      worker = this.workerFactory();
    } catch (error) {
      return { ok: false, error: describeRuntimeStartFailure("SQLite", error) };
    }

    const timeoutMs = resolveTimeoutMs(this.timeout);
    hooks.onStatus("loading");
    const executionId = createExecutionId("sql");

    return new Promise<SqlExecutionResult>((resolve) => {
      let settled = false;
      const finish = (result: SqlExecutionResult): void => {
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

      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (!isWorkerResponse(event.data) || event.data.executionId !== executionId) {
          return;
        }
        if (event.data.type === "stdout") {
          hooks.onStdout(event.data.chunk);
        } else if (event.data.type === "status") {
          hooks.onStatus(event.data.status);
        } else if (event.data.type === "stderr") {
          hooks.onStderr(event.data.chunk);
        } else if (event.data.type === "failure") {
          finish({ ok: false, error: event.data.error });
        } else {
          finish({ ok: true });
        }
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        finish({ ok: false, error: event.message || "SQL Worker failed to start." });
      };
      worker.onmessageerror = () => {
        finish({ ok: false, error: "SQL Worker returned an unreadable message." });
      };

      this.stopActiveRun = () => finish({ ok: false, stopped: true });

      const timeoutId = globalThis.setTimeout(() => {
        finish({
          ok: false,
          error: `Execution stopped: it exceeded the ${formatTimeout(timeoutMs)} run time limit. Change the limit in Settings.`
        });
      }, timeoutMs);

      const message: SqlWorkerRequest = {
        type: "execute",
        executionId,
        entryPath,
        source: request.source
      };
      try {
        worker.postMessage(message);
      } catch (error) {
        finish({ ok: false, error: formatRuntimeError(error) });
      }
    });
  }
}
