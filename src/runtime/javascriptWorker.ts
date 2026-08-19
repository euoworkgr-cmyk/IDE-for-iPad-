import type {
  JavaScriptWorkerRequest,
  JavaScriptWorkerResponse
} from "./JavaScriptRuntime";
import {
  formatJavaScriptConsoleArguments,
  formatJavaScriptError
} from "./javascriptOutput";

interface JavaScriptWorkerScope {
  postMessage(message: JavaScriptWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "unhandledrejection",
    listener: (event: PromiseRejectionEvent) => void
  ): void;
}

type AsyncFunctionConstructor = new (body: string) => () => Promise<unknown>;

const workerScope = globalThis as unknown as JavaScriptWorkerScope;
const send = workerScope.postMessage.bind(workerScope);
let executionStarted = false;

function isExecutionRequest(value: unknown): value is JavaScriptWorkerRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<JavaScriptWorkerRequest>;
  return (
    candidate.type === "execute" &&
    typeof candidate.executionId === "string" &&
    typeof candidate.entryPath === "string" &&
    typeof candidate.source === "string" &&
    (candidate.language === "javascript" || candidate.language === "typescript")
  );
}

function sourceUrl(entryPath: string): string {
  return encodeURIComponent(entryPath).replaceAll("%2F", "/");
}

/**
 * TypeScript is stripped to JavaScript here, inside the Worker, and then run by
 * the code below — the same code that runs a .js file. Two consequences are
 * deliberate: the transpiler never loads for a plain JavaScript run because the
 * import is dynamic, and type stripping is off the main thread, so a large file
 * cannot block the interface.
 */
async function toJavaScript(request: JavaScriptWorkerRequest): Promise<string> {
  if (request.language !== "typescript") {
    return request.source;
  }
  // The runtime already reported "compiling" before this Worker was created, so
  // only the transition out of it is reported here.
  const { transpileTypeScript } = await import("./typescriptTranspile");
  const code = transpileTypeScript(request.source, request.entryPath);
  send({ type: "status", executionId: request.executionId, status: "running" });
  return code;
}

async function execute(request: JavaScriptWorkerRequest): Promise<void> {
  let finished = false;
  const respond = (response: JavaScriptWorkerResponse): void => {
    send(response);
  };
  const failWith = (message: string): void => {
    if (finished) {
      return;
    }
    finished = true;
    respond({ type: "failure", executionId: request.executionId, error: message });
  };
  const fail = (error: unknown): void => {
    failWith(formatJavaScriptError(error));
  };

  console.log = (...values: unknown[]) => {
    respond({
      type: "stdout",
      executionId: request.executionId,
      chunk: formatJavaScriptConsoleArguments(values)
    });
  };
  console.error = (...values: unknown[]) => {
    respond({
      type: "stderr",
      executionId: request.executionId,
      chunk: formatJavaScriptConsoleArguments(values)
    });
  };

  workerScope.addEventListener("error", (event) => {
    event.preventDefault();
    fail(event.error ?? event.message);
  });
  workerScope.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    fail(event.reason);
  });

  let source: string;
  try {
    source = await toJavaScript(request);
  } catch (error) {
    // A compile error is the user's code, not a crash in Altitude, so report
    // the message alone — the stack would only name this Worker's internals.
    failWith(error instanceof Error ? `${error.message}` : String(error));
    return;
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async () => undefined)
      .constructor as AsyncFunctionConstructor;
    const run = new AsyncFunction(
      `${source}\n//# sourceURL=${sourceUrl(request.entryPath)}`
    );
    await run();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    if (!finished) {
      finished = true;
      respond({ type: "complete", executionId: request.executionId });
    }
  } catch (error) {
    fail(error);
  }
}

workerScope.addEventListener("message", (event) => {
  if (executionStarted || !isExecutionRequest(event.data)) {
    return;
  }
  executionStarted = true;
  void execute(event.data);
});
