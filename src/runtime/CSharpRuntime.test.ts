import { describe, expect, it, vi } from "vitest";
import {
  CSharpRuntime,
  type CSharpExecutionHooks,
  type CSharpRuntimeStatus,
  type CSharpWorkerRequest,
  type CSharpWorkerResponse
} from "./CSharpRuntime";
import { canRunCSharp, runActiveCSharp } from "./runCSharp";
import { createFile, createProject } from "../projects/models";
import type { Project } from "../projects/models";

/** Matches the helper the PHP and SQL suites use. */
function projectWith(...files: { path: string; content: string }[]): Project {
  const project = createProject("Test");
  project.files = files.map((file) => createFile(file.path, file.content));
  project.activeFileId = project.files[0]?.id ?? project.activeFileId;
  return project;
}

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  posted: CSharpWorkerRequest[] = [];
  terminated = false;
  onPost: ((message: CSharpWorkerRequest) => void) | undefined;

  postMessage(value: unknown): void {
    const message = value as CSharpWorkerRequest;
    this.posted.push(message);
    this.onPost?.(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: CSharpWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

function hooks(
  stdout: string[] = [],
  stderr: string[] = [],
  statuses: CSharpRuntimeStatus[] = []
): CSharpExecutionHooks {
  return {
    onStatus: (status) => statuses.push(status),
    onStdout: (chunk) => stdout.push(chunk),
    onStderr: (chunk) => stderr.push(chunk)
  };
}

function runtimeWith(worker: FakeWorker, timeout: number | (() => number) = 5_000): CSharpRuntime {
  return new CSharpRuntime(
    () => worker as unknown as Worker,
    timeout,
    () => "https://example.test/dotnet/"
  );
}

/** A run that compiled cleanly and exited zero. */
function succeed(worker: FakeWorker): void {
  worker.onPost = (request) =>
    worker.emit({
      type: "complete",
      executionId: request.executionId,
      diagnostics: [],
      exitCode: 0,
      runtimeError: null
    });
}

describe("CSharpRuntime", () => {
  it("normalizes the entry path before starting a Worker", async () => {
    const worker = new FakeWorker();
    succeed(worker);

    const result = await runtimeWith(worker).execute(
      { entryPath: "src\\nested//Program.cs", source: "class P { static void Main() {} }" },
      hooks()
    );

    expect(result.ok).toBe(true);
    expect(worker.posted[0]?.entryPath).toBe("src/nested/Program.cs");
  });

  it("refuses a path that could climb out of the project", async () => {
    const worker = new FakeWorker();

    const result = await runtimeWith(worker).execute(
      { entryPath: "../secrets.cs", source: "" },
      hooks()
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid project-relative path");
    expect(worker.posted).toHaveLength(0);
  });

  it("refuses a file that is not C#", async () => {
    const worker = new FakeWorker();

    const result = await runtimeWith(worker).execute(
      { entryPath: "Program.txt", source: "" },
      hooks()
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("supports .cs files only");
    expect(worker.posted).toHaveLength(0);
  });

  it("reports compile errors as a failure carrying diagnostics", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) =>
      worker.emit({
        type: "complete",
        executionId: request.executionId,
        diagnostics: [
          { id: "CS0029", severity: "error", message: "Cannot convert", line: 3, column: 7 }
        ],
        exitCode: null,
        runtimeError: null
      });

    const result = await runtimeWith(worker).execute(
      { entryPath: "Program.cs", source: "bad" },
      hooks()
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics?.[0]?.id).toBe("CS0029");
  });

  it("keeps warnings without turning a clean run into a failure", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) =>
      worker.emit({
        type: "complete",
        executionId: request.executionId,
        diagnostics: [
          { id: "CS0219", severity: "warning", message: "Unused", line: 1, column: 1 }
        ],
        exitCode: 0,
        runtimeError: null
      });

    const result = await runtimeWith(worker).execute(
      { entryPath: "Program.cs", source: "ok" },
      hooks()
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats a non-zero exit code as a failure", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) =>
      worker.emit({
        type: "complete",
        executionId: request.executionId,
        diagnostics: [],
        exitCode: 3,
        runtimeError: null
      });

    const result = await runtimeWith(worker).execute(
      { entryPath: "Program.cs", source: "ok" },
      hooks()
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it("streams stdout and stderr through the hooks", async () => {
    const worker = new FakeWorker();
    const stdout: string[] = [];
    const stderr: string[] = [];
    worker.onPost = (request) => {
      worker.emit({ type: "stdout", executionId: request.executionId, chunk: "out" });
      worker.emit({ type: "stderr", executionId: request.executionId, chunk: "err" });
      worker.emit({
        type: "complete",
        executionId: request.executionId,
        diagnostics: [],
        exitCode: 0,
        runtimeError: null
      });
    };

    await runtimeWith(worker).execute(
      { entryPath: "Program.cs", source: "ok" },
      hooks(stdout, stderr)
    );

    expect(stdout).toEqual(["out"]);
    expect(stderr).toEqual(["err"]);
  });

  it("ignores messages from a different execution", async () => {
    const worker = new FakeWorker();
    const stdout: string[] = [];
    worker.onPost = (request) => {
      worker.emit({ type: "stdout", executionId: "someone-else", chunk: "leaked" });
      worker.emit({
        type: "complete",
        executionId: request.executionId,
        diagnostics: [],
        exitCode: 0,
        runtimeError: null
      });
    };

    await runtimeWith(worker).execute({ entryPath: "Program.cs", source: "ok" }, hooks(stdout));

    expect(stdout).toEqual([]);
  });

  it("reports the three status transitions in order", async () => {
    const worker = new FakeWorker();
    const statuses: CSharpRuntimeStatus[] = [];
    worker.onPost = (request) => {
      worker.emit({ type: "status", executionId: request.executionId, status: "compiling" });
      worker.emit({ type: "status", executionId: request.executionId, status: "running" });
      worker.emit({
        type: "complete",
        executionId: request.executionId,
        diagnostics: [],
        exitCode: 0,
        runtimeError: null
      });
    };

    await runtimeWith(worker).execute(
      { entryPath: "Program.cs", source: "ok" },
      hooks([], [], statuses)
    );

    expect(statuses).toEqual(["loading", "compiling", "running"]);
  });

  it("terminates the Worker when the user stops the run", async () => {
    const worker = new FakeWorker();
    const runtime = runtimeWith(worker);
    worker.onPost = () => runtime.stop();

    const result = await runtime.execute({ entryPath: "Program.cs", source: "ok" }, hooks());

    expect(result).toEqual({ ok: false, stopped: true });
    expect(worker.terminated).toBe(true);
  });

  it("does not start the run time limit until compiling begins", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      // Loading is allowed to take longer than the user's limit, because the
      // limit is meant to bound their code and not an 11.62 MiB download.
      const pending = runtimeWith(worker, 1_000).execute(
        { entryPath: "Program.cs", source: "ok" },
        hooks()
      );
      await vi.advanceTimersByTimeAsync(5_000);

      const executionId = worker.posted[0]?.executionId ?? "";
      worker.emit({ type: "status", executionId, status: "compiling" });
      await vi.advanceTimersByTimeAsync(1_500);

      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.error).toContain("run time limit");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up if the runtime never finishes loading", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const pending = new CSharpRuntime(
        () => worker as unknown as Worker,
        5_000,
        () => "https://example.test/dotnet/",
        2_000
      ).execute({ entryPath: "Program.cs", source: "ok" }, hooks());

      await vi.advanceTimersByTimeAsync(2_500);

      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.error).toContain("did not finish loading");
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("canRunCSharp", () => {
  it("accepts a .cs file", () => {
    expect(canRunCSharp(createFile("Program.cs", "class P {}"))).toBe(true);
  });

  it("rejects a file whose language is not C#", () => {
    expect(canRunCSharp(createFile("notes.txt", ""))).toBe(false);
  });

  it("rejects undefined", () => {
    expect(canRunCSharp(undefined)).toBe(false);
  });
});

describe("runActiveCSharp", () => {
  it("passes only the active file's source, not the whole project", async () => {
    const project = projectWith(
      { path: "Program.cs", content: "class P { static void Main() {} }" },
      { path: "Other.cs", content: "class O {}" }
    );
    const file = project.files[0]!;
    const executed: { entryPath: string; source: string }[] = [];

    const outcome = await runActiveCSharp(
      {
        execute: async (request) => {
          executed.push(request);
          return { ok: true, exitCode: 0 };
        },
        stop: () => {}
      },
      project,
      file,
      async () => {},
      hooks()
    );

    expect(outcome.outcome).toBe("success");
    expect(executed).toEqual([{ entryPath: "Program.cs", source: file.content }]);
  });

  it("reports an unsupported file without running anything", async () => {
    const project = projectWith({ path: "notes.txt", content: "" });
    const file = project.files[0]!;
    const execute = vi.fn();

    const outcome = await runActiveCSharp(
      { execute, stop: () => {} },
      project,
      file,
      async () => {},
      hooks()
    );

    expect(outcome.outcome).toBe("unsupported");
    expect(execute).not.toHaveBeenCalled();
  });
});
