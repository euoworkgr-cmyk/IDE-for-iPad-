import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../settings/appSettings";
import { normalizeProjectPath } from "./projectPaths";

/**
 * Kept as the fallback for callers that do not supply a limit. The user-facing
 * value lives in settings (L4) and is read per run, not per runtime instance,
 * so changing it takes effect on the next run without a reload.
 */
export const JAVASCRIPT_EXECUTION_TIMEOUT_MS = DEFAULT_EXECUTION_TIMEOUT_MS;

/**
 * TypeScript runs on this same path: it is stripped to JavaScript inside the
 * Worker and executed there. There is no second execution path.
 */
export type ScriptLanguage = "javascript" | "typescript";

export type JavaScriptRuntimeStatus = "running" | "compiling";

/** A fixed limit, or a function read once per run so settings changes apply. */
export type ExecutionTimeoutSource = number | (() => number);

export interface JavaScriptExecutionHooks {
  onStatus: (status: JavaScriptRuntimeStatus) => void;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}

export interface JavaScriptExecutionRequest {
  entryPath: string;
  source: string;
  language?: ScriptLanguage;
}

export interface JavaScriptExecutionResult {
  ok: boolean;
  error?: string;
  /** The run ended because the user asked it to, not because it finished. */
  stopped?: boolean;
}

export interface JavaScriptExecutor {
  execute(
    request: JavaScriptExecutionRequest,
    hooks: JavaScriptExecutionHooks
  ): Promise<JavaScriptExecutionResult>;
  /** Stops the run in flight, if there is one. Safe to call when there is not. */
  stop(): void;
}

export interface JavaScriptWorkerRequest {
  type: "execute";
  executionId: string;
  entryPath: string;
  source: string;
  language: ScriptLanguage;
}

export type JavaScriptWorkerResponse =
  | { type: "stdout" | "stderr"; executionId: string; chunk: string }
  | { type: "status"; executionId: string; status: JavaScriptRuntimeStatus }
  | { type: "complete"; executionId: string }
  | { type: "failure"; executionId: string; error: string };

type WorkerFactory = () => Worker;

function createJavaScriptWorker(): Worker {
  return new Worker(new URL("./javascriptWorker.ts", import.meta.url), {
    type: "module",
    name: "altitude-javascript-runtime"
  });
}

function createExecutionId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-cryptographic correlation identifier.
  }
  return `js-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function formatTimeout(milliseconds: number): string {
  const seconds = milliseconds / 1_000;
  const rendered = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return `${rendered} second${rendered === "1" ? "" : "s"}`;
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function isWorkerResponse(value: unknown): value is JavaScriptWorkerResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<JavaScriptWorkerResponse>;
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
    return candidate.status === "running" || candidate.status === "compiling";
  }
  return candidate.type === "complete";
}

function validateEntryPath(path: string, language: ScriptLanguage): string {
  const normalized = normalizeProjectPath(path);
  const pattern = language === "typescript" ? /\.m?ts$/i : /\.m?js$/i;
  if (!pattern.test(normalized)) {
    const supported = language === "typescript" ? ".ts and .mts" : ".js and .mjs";
    throw new Error(
      `${language === "typescript" ? "TypeScript" : "JavaScript"} execution supports ${supported} files only: ${normalized}`
    );
  }
  return normalized;
}

export class JavaScriptRuntime implements JavaScriptExecutor {
  private stopActiveRun: (() => void) | undefined;

  constructor(
    private readonly workerFactory: WorkerFactory = createJavaScriptWorker,
    private readonly timeout: ExecutionTimeoutSource = JAVASCRIPT_EXECUTION_TIMEOUT_MS
  ) {}

  /**
   * Stops the run in flight (L7). There is no interrupt tier here, and none is
   * needed: a JavaScript run owns its Worker outright, so terminating costs
   * nothing beyond starting a fresh one on the next Run.
   */
  stop(): void {
    this.stopActiveRun?.();
  }

  /**
   * Resolved once per run, so a caller that passes a function gets the limit
   * the user has configured now rather than the one in force when the runtime
   * was constructed. The user-facing bounds are enforced by the settings layer;
   * this only refuses a value that would disable the limit altogether.
   */
  private resolveTimeoutMs(): number {
    const raw = typeof this.timeout === "function" ? this.timeout() : this.timeout;
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0
      ? raw
      : DEFAULT_EXECUTION_TIMEOUT_MS;
  }

  async execute(
    request: JavaScriptExecutionRequest,
    hooks: JavaScriptExecutionHooks
  ): Promise<JavaScriptExecutionResult> {
    const language: ScriptLanguage = request.language ?? "javascript";
    let entryPath: string;
    try {
      entryPath = validateEntryPath(request.entryPath, language);
    } catch (error) {
      return { ok: false, error: formatRuntimeError(error) };
    }

    let worker: Worker;
    try {
      worker = this.workerFactory();
    } catch (error) {
      return { ok: false, error: formatRuntimeError(error) };
    }

    const timeoutMs = this.resolveTimeoutMs();
    hooks.onStatus(language === "typescript" ? "compiling" : "running");
    const executionId = createExecutionId();

    return new Promise<JavaScriptExecutionResult>((resolve) => {
      let settled = false;
      const finish = (result: JavaScriptExecutionResult): void => {
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
        finish({ ok: false, error: event.message || "JavaScript Worker failed to start." });
      };
      worker.onmessageerror = () => {
        finish({ ok: false, error: "JavaScript Worker returned an unreadable message." });
      };

      this.stopActiveRun = () => finish({ ok: false, stopped: true });

      const timeoutId = globalThis.setTimeout(() => {
        finish({
          ok: false,
          error: `Execution stopped: it exceeded the ${formatTimeout(timeoutMs)} run time limit. Change the limit in Settings.`
        });
      }, timeoutMs);

      const message: JavaScriptWorkerRequest = {
        type: "execute",
        executionId,
        entryPath,
        source: request.source,
        language
      };
      try {
        worker.postMessage(message);
      } catch (error) {
        finish({ ok: false, error: formatRuntimeError(error) });
      }
    });
  }
}
