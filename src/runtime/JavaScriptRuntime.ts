import { normalizeProjectPath } from "./PythonRuntime";

export const JAVASCRIPT_EXECUTION_TIMEOUT_MS = 5_000;

export type JavaScriptRuntimeStatus = "running";

export interface JavaScriptExecutionHooks {
  onStatus: (status: JavaScriptRuntimeStatus) => void;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}

export interface JavaScriptExecutionRequest {
  entryPath: string;
  source: string;
}

export interface JavaScriptExecutionResult {
  ok: boolean;
  error?: string;
}

export interface JavaScriptExecutor {
  execute(
    request: JavaScriptExecutionRequest,
    hooks: JavaScriptExecutionHooks
  ): Promise<JavaScriptExecutionResult>;
}

export interface JavaScriptWorkerRequest {
  type: "execute";
  executionId: string;
  entryPath: string;
  source: string;
}

export type JavaScriptWorkerResponse =
  | { type: "stdout" | "stderr"; executionId: string; chunk: string }
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
  return candidate.type === "complete";
}

function validateEntryPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  if (!/\.m?js$/i.test(normalized)) {
    throw new Error(`JavaScript execution supports .js and .mjs files only: ${normalized}`);
  }
  return normalized;
}

export class JavaScriptRuntime implements JavaScriptExecutor {
  constructor(
    private readonly workerFactory: WorkerFactory = createJavaScriptWorker,
    private readonly timeoutMs = JAVASCRIPT_EXECUTION_TIMEOUT_MS
  ) {}

  async execute(
    request: JavaScriptExecutionRequest,
    hooks: JavaScriptExecutionHooks
  ): Promise<JavaScriptExecutionResult> {
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
      return { ok: false, error: formatRuntimeError(error) };
    }

    hooks.onStatus("running");
    const executionId = createExecutionId();

    return new Promise<JavaScriptExecutionResult>((resolve) => {
      let settled = false;
      const finish = (result: JavaScriptExecutionResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timeoutId);
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

      const timeoutId = globalThis.setTimeout(() => {
        finish({
          ok: false,
          error: `JavaScript execution timed out after ${this.timeoutMs} ms.`
        });
      }, this.timeoutMs);

      const message: JavaScriptWorkerRequest = {
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
