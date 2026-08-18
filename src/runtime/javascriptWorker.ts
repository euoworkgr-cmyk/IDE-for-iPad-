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
    typeof candidate.source === "string"
  );
}

function sourceUrl(entryPath: string): string {
  return encodeURIComponent(entryPath).replaceAll("%2F", "/");
}

async function execute(request: JavaScriptWorkerRequest): Promise<void> {
  let finished = false;
  const respond = (response: JavaScriptWorkerResponse): void => {
    send(response);
  };
  const fail = (error: unknown): void => {
    if (finished) {
      return;
    }
    finished = true;
    respond({
      type: "failure",
      executionId: request.executionId,
      error: formatJavaScriptError(error)
    });
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

  try {
    const AsyncFunction = Object.getPrototypeOf(async () => undefined)
      .constructor as AsyncFunctionConstructor;
    const run = new AsyncFunction(
      `${request.source}\n//# sourceURL=${sourceUrl(request.entryPath)}`
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
