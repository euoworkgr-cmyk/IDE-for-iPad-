import type { PyodideAPI } from "pyodide";
import type { ProjectFile } from "../projects/models";

export const VIRTUAL_PROJECT_ROOT = "/home/pyodide/altitude-project";

export type PythonRuntimeStatus = "loading" | "ready" | "running";

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

export interface VirtualProjectFile {
  relativePath: string;
  virtualPath: string;
  content: string;
}

type StdinController = Pick<PyodideAPI, "setStdin">;

export function configureLineStdin(
  pyodide: StdinController,
  readInput: () => string | null
): void {
  pyodide.setStdin({
    stdin: () => readInput() ?? "",
    isatty: false
  });
}

export function normalizeProjectPath(path: string): string {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    normalized.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid project-relative path: ${path}`);
  }
  return segments.join("/");
}

export function mapProjectFiles(
  files: readonly Pick<ProjectFile, "path" | "content">[]
): VirtualProjectFile[] {
  const seen = new Set<string>();
  return files.map((file) => {
    const relativePath = normalizeProjectPath(file.path);
    if (seen.has(relativePath)) {
      throw new Error(`Duplicate project path: ${relativePath}`);
    }
    seen.add(relativePath);
    return {
      relativePath,
      virtualPath: `${VIRTUAL_PROJECT_ROOT}/${relativePath}`,
      content: file.content
    };
  });
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

export class PythonRuntime implements PythonExecutor {
  private pyodidePromise: Promise<PyodideAPI> | undefined;

  async execute(request: PythonExecutionRequest, hooks: PythonExecutionHooks): Promise<PythonExecutionResult> {
    try {
      const pyodide = await this.load(hooks);
      hooks.onStatus("running");
      this.configureStreams(pyodide, hooks);

      const files = mapProjectFiles(request.files);
      const entryPath = normalizeProjectPath(request.entryPath);
      if (!files.some((file) => file.relativePath === entryPath)) {
        throw new Error(`Python entry file is not part of the project: ${entryPath}`);
      }

      this.resetProjectDirectory(pyodide);
      for (const file of files) {
        const separator = file.virtualPath.lastIndexOf("/");
        pyodide.FS.mkdirTree(file.virtualPath.slice(0, separator));
        pyodide.FS.writeFile(file.virtualPath, file.content, { encoding: "utf8" });
      }
      pyodide.FS.chdir(VIRTUAL_PROJECT_ROOT);

      pyodide.globals.set("__altitude_source", files.find((file) => file.relativePath === entryPath)!.content);
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
exec(compile(__altitude_source, __altitude_filename, "exec"), __altitude_run_globals, __altitude_run_globals)
`);
      } finally {
        pyodide.globals.delete("__altitude_source");
        pyodide.globals.delete("__altitude_filename");
        pyodide.globals.delete("__altitude_project_root");
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatRuntimeError(error) };
    }
  }

  private async load(hooks: PythonExecutionHooks): Promise<PyodideAPI> {
    if (!this.pyodidePromise) {
      hooks.onStatus("loading");
      this.pyodidePromise = import("pyodide")
        .then(({ loadPyodide }) => {
          const indexURL = new URL("pyodide/", document.baseURI).href;
          return loadPyodide({
            indexURL,
            packageBaseUrl: indexURL,
            cdnUrl: indexURL,
            stdout: () => undefined,
            stderr: () => undefined,
            stdin: () => hooks.readInput() ?? ""
          });
        })
        .catch((error: unknown) => {
          this.pyodidePromise = undefined;
          throw error;
        });
    }
    const pyodide = await this.pyodidePromise;
    hooks.onStatus("ready");
    return pyodide;
  }

  private configureStreams(pyodide: PyodideAPI, hooks: PythonExecutionHooks): void {
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    pyodide.setStdout({
      write: (buffer) => {
        hooks.onStdout(stdoutDecoder.decode(buffer, { stream: true }));
        return buffer.length;
      }
    });
    pyodide.setStderr({
      write: (buffer) => {
        hooks.onStderr(stderrDecoder.decode(buffer, { stream: true }));
        return buffer.length;
      }
    });
    configureLineStdin(pyodide, hooks.readInput);
  }

  private resetProjectDirectory(pyodide: PyodideAPI): void {
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
}
