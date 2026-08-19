import { describe, expect, it, vi } from "vitest";
import { createFile, createProject } from "../projects/models";
import {
  mapProjectFiles,
  normalizeProjectPath,
  type PythonExecutionHooks,
  type PythonExecutor
} from "./PythonRuntime";
import { canRunPython, runActivePython } from "./runPython";

function hooks(stdout: string[], stderr: string[]): PythonExecutionHooks {
  return {
    onStatus: () => undefined,
    onStdout: (chunk) => stdout.push(chunk),
    onStderr: (chunk) => stderr.push(chunk),
    readInput: () => "Ada"
  };
}

describe("Python project mapping", () => {
  it("normalizes relative paths and maps nested files into the virtual project root", () => {
    expect(normalizeProjectPath("utils\\math.py")).toBe("utils/math.py");
    expect(
      mapProjectFiles([
        { path: "main.py", content: "from utils.math import add" },
        { path: "utils/math.py", content: "def add(a, b): return a + b" }
      ])
    ).toEqual([
      {
        relativePath: "main.py",
        virtualPath: "/home/pyodide/altitude-project/main.py",
        content: "from utils.math import add"
      },
      {
        relativePath: "utils/math.py",
        virtualPath: "/home/pyodide/altitude-project/utils/math.py",
        content: "def add(a, b): return a + b"
      }
    ]);
  });

  it("rejects paths that can escape the virtual project", () => {
    expect(() => normalizeProjectPath("../secret.py")).toThrow("Invalid project-relative path");
    expect(() => normalizeProjectPath("/absolute.py")).toThrow("Invalid project-relative path");
  });
});

describe("runActivePython", () => {
  it("does not execute unsupported languages", async () => {
    // Constructed explicitly rather than relying on the default seed file:
    // the seed is Python now, and this test is about a language that cannot run.
    const project = createProject("C# project");
    const csharpFile = createFile("Program.cs", "class Program {}");
    project.files = [csharpFile];
    project.activeFileId = csharpFile.id;
    const execute = vi.fn();
    const runtime: PythonExecutor = { execute };

    await expect(
      runActivePython(runtime, project, csharpFile, vi.fn(), hooks([], []))
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("seeds new projects with a runnable Python file", async () => {
    // Guards the first-run experience: a brand new project must open on a file
    // where Run actually does something.
    const project = createProject("Fresh project");
    const seed = project.files[0]!;

    expect(seed.path).toBe("main.py");
    expect(seed.language).toBe("python");
    expect(canRunPython(seed)).toBe(true);
  });

  it("flushes current editor state and passes the active Python file plus all project files", async () => {
    const project = createProject("Python project");
    const activeFile = createFile("main.py", "print('current')");
    const helper = createFile("utils/math.py", "def add(a, b): return a + b");
    project.files = [activeFile, helper];
    project.activeFileId = activeFile.id;
    const order: string[] = [];
    const runtime: PythonExecutor = {
      execute: async (request, output) => {
        order.push("execute");
        expect(request.entryPath).toBe("main.py");
        expect(request.files).toEqual([
          { path: "main.py", content: "print('current')" },
          { path: "utils/math.py", content: "def add(a, b): return a + b" }
        ]);
        output.onStdout("hello\n");
        output.onStderr("warning\n");
        return { ok: true };
      }
    };
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await runActivePython(
      runtime,
      project,
      activeFile,
      async () => {
        order.push("flush");
      },
      hooks(stdout, stderr)
    );

    expect(order).toEqual(["flush", "execute"]);
    expect(stdout).toEqual(["hello\n"]);
    expect(stderr).toEqual(["warning\n"]);
    expect(result.outcome).toBe("success");
  });

  it("returns an error outcome from the runtime", async () => {
    const project = createProject("Python project");
    const activeFile = createFile("main.py", "1 / 0");
    project.files = [activeFile];
    project.activeFileId = activeFile.id;
    const runtime: PythonExecutor = {
      execute: async () => ({ ok: false, error: "ZeroDivisionError: division by zero" })
    };

    const result = await runActivePython(runtime, project, activeFile, async () => undefined, hooks([], []));
    expect(result).toEqual({
      outcome: "error",
      result: { ok: false, error: "ZeroDivisionError: division by zero" }
    });
  });
});
