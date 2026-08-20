import type { PhpWorkerRequest, PhpWorkerResponse } from "./PhpRuntime";
import { mapProjectFiles, type VirtualProjectFile } from "./projectPaths";

/**
 * Where the project is mounted inside PHP's Emscripten filesystem. It is not
 * the Pyodide root — that one lives under `/home/pyodide` because Pyodide puts
 * it there — but it is validated by the same `normalizeProjectPath`, so no
 * project path can climb out of it.
 */
const PHP_PROJECT_ROOT = "/altitude";

interface PhpWorkerScope {
  postMessage(message: PhpWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
}

/** The shape of `php-wasm`'s output events: one decoded chunk per flush. */
interface PhpOutputEvent extends Event {
  detail?: readonly string[];
}

const workerScope = globalThis as unknown as PhpWorkerScope;
const send = workerScope.postMessage.bind(workerScope);
let executionStarted = false;

function isExecutionRequest(value: unknown): value is PhpWorkerRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PhpWorkerRequest>;
  return (
    candidate.type === "execute" &&
    typeof candidate.executionId === "string" &&
    typeof candidate.entryPath === "string" &&
    typeof candidate.moduleUrl === "string" &&
    Array.isArray(candidate.files)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}

/** Emscripten's FS has no mkdir -p, so each level is created in turn. */
async function makeDirectoryTree(
  php: { mkdir: (path: string) => Promise<void> },
  path: string
): Promise<void> {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    try {
      await php.mkdir(current);
    } catch {
      // Already there. Emscripten throws EEXIST rather than returning a code,
      // and there is nothing to do about a directory that exists.
    }
  }
}

async function execute(request: PhpWorkerRequest): Promise<void> {
  const { executionId } = request;
  const stdout = (chunk: string): void => send({ type: "stdout", executionId, chunk });
  const stderr = (chunk: string): void => send({ type: "stderr", executionId, chunk });
  const fail = (error: string): void => send({ type: "failure", executionId, error });

  let files: VirtualProjectFile[];
  let entry: VirtualProjectFile | undefined;
  try {
    files = mapProjectFiles(request.files, PHP_PROJECT_ROOT);
    entry = files.find((file) => file.relativePath === request.entryPath);
  } catch (error) {
    fail(errorMessage(error));
    return;
  }

  if (!entry) {
    fail(`${request.entryPath} is not part of this project.`);
    return;
  }

  let php: import("php-wasm/PhpBase").PhpBase;
  try {
    // The PHP build carries Emscripten's HTML5 library, which initializes
    // `var specialHTMLTargets = [0, document, window]` unguarded — a
    // ReferenceError in a Worker, where neither identifier exists, and it
    // fires before any PHP code runs. Declaring them makes the *identifiers*
    // resolve while leaving `typeof document` as "undefined", so every guard
    // inside the module still takes its Worker branch. Nothing else lives in
    // this Worker, so the two globals reach nothing but the interpreter.
    declareAbsentBrowserGlobals();

    const { PhpBase } = await import("php-wasm/PhpBase");
    // The interpreter is loaded from `public/php/` by URL rather than bundled.
    // `@vite-ignore` is required: the URL is only known at run time, and
    // letting the bundler analyse it would pull in every PHP version shipped
    // by the package. See `scripts/copy-php-assets.mjs`.
    const binaryLoader = import(/* @vite-ignore */ request.moduleUrl);
    php = new PhpBase(binaryLoader, {
      // No IndexedDB-backed filesystem. Persistent storage belongs to
      // `ProjectRepository`, and a run starting from the project's own files —
      // never from what a previous run left behind — is what Run means here.
      autoTransaction: false
    });

    php.addEventListener("output", (event) => {
      const chunk = (event as PhpOutputEvent).detail?.join("") ?? "";
      if (chunk) {
        stdout(chunk);
      }
    });
    php.addEventListener("error", (event) => {
      const chunk = (event as PhpOutputEvent).detail?.join("") ?? "";
      if (chunk) {
        stderr(chunk);
      }
    });

    await php.binary;
  } catch (error) {
    fail(`PHP failed to start: ${errorMessage(error)}`);
    return;
  }

  send({ type: "status", executionId, status: "running" });

  let exitCode: number;
  try {
    await makeDirectoryTree(php, PHP_PROJECT_ROOT);
    for (const file of files) {
      const directory = file.virtualPath.slice(0, file.virtualPath.lastIndexOf("/"));
      if (directory !== PHP_PROJECT_ROOT) {
        await makeDirectoryTree(php, directory);
      }
      await php.writeFile(file.virtualPath, file.content);
    }

    // The entry runs as a real file rather than as a source string, so
    // `__FILE__`, `__DIR__`, a relative `require`, and — most visibly — the
    // filename in a parse error all say what the user actually wrote.
    exitCode = await php.run(
      `<?php chdir(${quote(PHP_PROJECT_ROOT)}); require ${quote(entry.virtualPath)};`
    );
  } catch (error) {
    fail(errorMessage(error));
    return;
  }

  // Output flushes a line at a time, so anything a script printed without a
  // trailing newline is still buffered at this point.
  php.flush();
  send({ type: "complete", executionId, exitCode: Number(exitCode) || 0 });
}

function declareAbsentBrowserGlobals(): void {
  const scope = globalThis as Record<string, unknown>;
  if (!("document" in scope)) {
    scope.document = undefined;
  }
  if (!("window" in scope)) {
    scope.window = undefined;
  }
}

/** A PHP single-quoted string literal, for paths this file controls. */
function quote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

workerScope.addEventListener("message", (event) => {
  if (executionStarted || !isExecutionRequest(event.data)) {
    return;
  }
  executionStarted = true;
  void execute(event.data);
});
