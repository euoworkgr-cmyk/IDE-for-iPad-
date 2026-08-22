import { loadPyodide, type PyodideAPI } from "pyodide";
import { VIRTUAL_PROJECT_ROOT, mapProjectFiles, normalizeProjectPath } from "./projectPaths";
import {
  clearInterrupt,
  configureLineStdin,
  isPythonWorkerRequest,
  readStdinLine,
  type PythonRuntimeStatus,
  type PythonWorkerExecuteRequest,
  type PythonWorkerResponse
} from "./pythonWorkerProtocol";
import { describeRuntimeStartFailure } from "./runtimeStartFailure";

interface PythonWorkerScope {
  postMessage(message: PythonWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
}

const workerScope = globalThis as unknown as PythonWorkerScope;
const send = workerScope.postMessage.bind(workerScope);

const NO_STDIN_NOTICE =
  "[input() is unavailable: this page is not cross-origin isolated, so the " +
  "Worker cannot wait for a line. Empty input was used.]\n";

let pyodidePromise: Promise<PyodideAPI> | undefined;
let running = false;

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

async function loadRuntime(
  indexURL: string,
  status: (status: PythonRuntimeStatus) => void
): Promise<PyodideAPI> {
  if (!pyodidePromise) {
    status("loading");
    pyodidePromise = loadPyodide({
      indexURL,
      packageBaseUrl: indexURL,
      cdnUrl: indexURL,
      stdout: () => undefined,
      stderr: () => undefined
    }).catch((error: unknown) => {
      pyodidePromise = undefined;
      throw error;
    });
  }
  const pyodide = await pyodidePromise;
  status("ready");
  return pyodide;
}

function resetProjectDirectory(pyodide: PyodideAPI): void {
  const remove = (path: string): void => {
    const stat = pyodide.FS.stat(path);
    if (pyodide.FS.isDir(stat.mode)) {
      for (const name of pyodide.FS.readdir(path)) {
        if (name !== "." && name !== "..") {
          remove(`${path}/${name}`);
        }
      }
      pyodide.FS.rmdir(path);
    } else {
      pyodide.FS.unlink(path);
    }
  };

  try {
    remove(VIRTUAL_PROJECT_ROOT);
  } catch {
    // The project directory does not exist on the first run.
  }
  pyodide.FS.mkdirTree(VIRTUAL_PROJECT_ROOT);
}

async function execute(request: PythonWorkerExecuteRequest): Promise<void> {
  const { executionId } = request;
  const status = (value: PythonRuntimeStatus): void => {
    send({ type: "status", executionId, status: value });
  };

  let pyodide: Awaited<ReturnType<typeof loadRuntime>>;
  try {
    pyodide = await loadRuntime(request.indexURL, status);
  } catch (error) {
    // Separated from the run's own catch below so a Pyodide that never loaded
    // is not reported as though the user's program had raised it.
    send({ type: "failure", executionId, error: describeRuntimeStartFailure("Python", error) });
    return;
  }

  try {

    // L7: a leftover signal would interrupt this run the instant it started,
    // so the buffer is cleared before it is armed.
    if (request.interrupt) {
      clearInterrupt(request.interrupt);
      pyodide.setInterruptBuffer(new Uint8Array(request.interrupt));
    }

    status("running");

    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    pyodide.setStdout({
      write: (buffer) => {
        send({
          type: "stdout",
          executionId,
          chunk: stdoutDecoder.decode(buffer, { stream: true })
        });
        return buffer.length;
      }
    });
    pyodide.setStderr({
      write: (buffer) => {
        send({
          type: "stderr",
          executionId,
          chunk: stderrDecoder.decode(buffer, { stream: true })
        });
        return buffer.length;
      }
    });

    const stdin = request.stdin;
    let noticeSent = false;
    configureLineStdin(pyodide, () => {
      if (!stdin) {
        if (!noticeSent) {
          noticeSent = true;
          send({ type: "stderr", executionId, chunk: NO_STDIN_NOTICE });
        }
        return "";
      }
      return readStdinLine(stdin, (continuation) => {
        send({ type: "stdin-request", executionId, continuation });
      });
    });

    // Path validation happens here, on the execution path itself, rather than
    // trusting whatever the main thread posted across.
    const files = mapProjectFiles(request.files);
    const entryPath = normalizeProjectPath(request.entryPath);
    if (!files.some((file) => file.relativePath === entryPath)) {
      throw new Error(`Python entry file is not part of the project: ${entryPath}`);
    }

    resetProjectDirectory(pyodide);
    for (const file of files) {
      const separator = file.virtualPath.lastIndexOf("/");
      pyodide.FS.mkdirTree(file.virtualPath.slice(0, separator));
      pyodide.FS.writeFile(file.virtualPath, file.content, { encoding: "utf8" });
    }
    pyodide.FS.chdir(VIRTUAL_PROJECT_ROOT);

    pyodide.globals.set(
      "__altitude_source",
      files.find((file) => file.relativePath === entryPath)!.content
    );
    pyodide.globals.set("__altitude_filename", entryPath);
    pyodide.globals.set("__altitude_project_root", VIRTUAL_PROJECT_ROOT);
    try {
      await pyodide.runPythonAsync(`
import builtins as __altitude_builtins
import importlib as __altitude_importlib
import os as __altitude_os
import sys as __altitude_sys

__altitude_importlib.invalidate_caches()
for __altitude_name, __altitude_module in list(__altitude_sys.modules.items()):
    __altitude_module_file = getattr(__altitude_module, "__file__", None)
    if __altitude_module_file and __altitude_os.path.abspath(__altitude_module_file).startswith(__altitude_project_root + "/"):
        del __altitude_sys.modules[__altitude_name]

__altitude_run_globals = {
    "__name__": "__main__",
    "__file__": __altitude_filename,
    "__package__": None,
    "__builtins__": __altitude_builtins,
}
__altitude_stopped = False
try:
    exec(compile(__altitude_source, __altitude_filename, "exec"), __altitude_run_globals, __altitude_run_globals)
except KeyboardInterrupt:
    # The Stop button (L7). Catching it here rather than letting it propagate
    # keeps it out of Pyodide's event loop, which would otherwise report it a
    # second time as an uncaught Worker error and race this run's own result.
    __altitude_stopped = True
`);
      if (pyodide.globals.get("__altitude_stopped") === true) {
        send({ type: "stopped", executionId });
        return;
      }
    } finally {
      pyodide.globals.delete("__altitude_source");
      pyodide.globals.delete("__altitude_filename");
      pyodide.globals.delete("__altitude_project_root");
      pyodide.globals.delete("__altitude_stopped");
    }
    send({ type: "complete", executionId });
  } catch (error) {
    send({ type: "failure", executionId, error: formatRuntimeError(error) });
  }
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isPythonWorkerRequest(request)) {
    return;
  }
  if (running) {
    send({
      type: "failure",
      executionId: request.executionId,
      error: "Another Python run is already in progress."
    });
    return;
  }
  running = true;
  void execute(request).finally(() => {
    running = false;
  });
});
