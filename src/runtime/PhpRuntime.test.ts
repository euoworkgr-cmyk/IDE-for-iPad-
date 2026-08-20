import { describe, expect, it, vi } from "vitest";
import {
  PhpRuntime,
  type PhpExecutionHooks,
  type PhpRuntimeStatus,
  type PhpWorkerRequest,
  type PhpWorkerResponse
} from "./PhpRuntime";
import { canRunPhp, runActivePhp } from "./runPhp";
import { createFile, createProject, type Project } from "../projects/models";

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  posted: PhpWorkerRequest[] = [];
  terminated = false;
  onPost: ((message: PhpWorkerRequest) => void) | undefined;

  postMessage(value: unknown): void {
    const message = value as PhpWorkerRequest;
    this.posted.push(message);
    this.onPost?.(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: PhpWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

function hooks(
  stdout: string[] = [],
  stderr: string[] = [],
  statuses: PhpRuntimeStatus[] = []
): PhpExecutionHooks {
  return {
    onStatus: (status) => statuses.push(status),
    onStdout: (chunk) => stdout.push(chunk),
    onStderr: (chunk) => stderr.push(chunk)
  };
}

function runtimeWith(
  worker: FakeWorker,
  timeout: number | (() => number) = 5_000,
  startupTimeoutMs = 120_000
): PhpRuntime {
  return new PhpRuntime(
    () => worker as unknown as Worker,
    timeout,
    () => "https://example.test/php/php8.3-web.mjs",
    startupTimeoutMs
  );
}

function projectWith(...files: { path: string; content: string }[]): Project {
  const project = createProject("Test");
  project.files = files.map((file) => createFile(file.path, file.content));
  project.activeFileId = project.files[0]?.id ?? project.activeFileId;
  return project;
}

describe("PhpRuntime", () => {
  it("normalizes the entry path before starting a Worker", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) =>
      worker.emit({ type: "complete", executionId: request.executionId, exitCode: 0 });

    const result = await runtimeWith(worker).execute(
      { entryPath: "src\\nested//index.php", files: [{ path: "index.php", content: "" }] },
      hooks()
    );

    expect(result.ok).toBe(true);
    expect(worker.posted[0]?.entryPath).toBe("src/nested/index.php");
  });

  it("refuses a path that could climb out of the project", async () => {
    const worker = new FakeWorker();

    const result = await runtimeWith(worker).execute(
      { entryPath: "../escape.php", files: [] },
      hooks()
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid project-relative path");
    expect(worker.posted).toHaveLength(0);
  });

  it("refuses a file that is not PHP", async () => {
    const worker = new FakeWorker();

    const result = await runtimeWith(worker).execute(
      { entryPath: "index.php5", files: [] },
      hooks()
    );

    expect(result.error).toBe("PHP execution supports .php and .phtml files only: index.php5");
    expect(worker.posted).toHaveLength(0);
  });

  it("sends every project file, so require of a sibling can resolve", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) =>
      worker.emit({ type: "complete", executionId: request.executionId, exitCode: 0 });

    await runtimeWith(worker).execute(
      {
        entryPath: "index.php",
        files: [
          { path: "index.php", content: "<?php require 'helpers.php';" },
          { path: "helpers.php", content: "<?php function greet() {}" }
        ]
      },
      hooks()
    );

    expect(worker.posted[0]?.files.map((file) => file.path)).toEqual([
      "index.php",
      "helpers.php"
    ]);
  });

  it("reports loading before the Worker says it is running", async () => {
    const worker = new FakeWorker();
    const statuses: PhpRuntimeStatus[] = [];
    const stdout: string[] = [];
    worker.onPost = (request) => {
      worker.emit({ type: "status", executionId: request.executionId, status: "running" });
      worker.emit({ type: "stdout", executionId: request.executionId, chunk: "Hello\n" });
      worker.emit({ type: "complete", executionId: request.executionId, exitCode: 0 });
    };

    await runtimeWith(worker).execute(
      { entryPath: "index.php", files: [{ path: "index.php", content: "" }] },
      hooks(stdout, [], statuses)
    );

    expect(statuses).toEqual(["loading", "running"]);
    expect(stdout).toEqual(["Hello\n"]);
  });

  it("treats a non-zero exit code as a failed run", async () => {
    const worker = new FakeWorker();
    const stderr: string[] = [];
    worker.onPost = (request) => {
      worker.emit({
        type: "stderr",
        executionId: request.executionId,
        chunk: "PHP Fatal error: Uncaught Error\n"
      });
      worker.emit({ type: "complete", executionId: request.executionId, exitCode: 255 });
    };

    const result = await runtimeWith(worker).execute(
      { entryPath: "index.php", files: [{ path: "index.php", content: "" }] },
      hooks([], stderr)
    );

    expect(result).toEqual({ ok: false, exitCode: 255 });
    expect(stderr).toEqual(["PHP Fatal error: Uncaught Error\n"]);
  });

  it("ignores messages from a different execution", async () => {
    const worker = new FakeWorker();
    const stdout: string[] = [];
    worker.onPost = (request) => {
      worker.emit({ type: "stdout", executionId: "someone-else", chunk: "leaked\n" });
      worker.emit({ type: "stdout", executionId: request.executionId, chunk: "mine\n" });
      worker.emit({ type: "complete", executionId: request.executionId, exitCode: 0 });
    };

    await runtimeWith(worker).execute(
      { entryPath: "index.php", files: [{ path: "index.php", content: "" }] },
      hooks(stdout)
    );

    expect(stdout).toEqual(["mine\n"]);
  });

  it("stops the run in flight by terminating the Worker", async () => {
    const worker = new FakeWorker();
    const runtime = runtimeWith(worker);
    worker.onPost = () => runtime.stop();

    const result = await runtime.execute(
      { entryPath: "index.php", files: [{ path: "index.php", content: "<?php while (true);" }] },
      hooks()
    );

    expect(result).toEqual({ ok: false, stopped: true });
    expect(worker.terminated).toBe(true);
  });

  /**
   * The point of the two-phase timer: a 12.5 MiB wasm takes longer to load
   * than any run time limit a user would set, so the limit must not be
   * running while it loads.
   */
  it("does not apply the run time limit while PHP is still loading", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const runtime = runtimeWith(worker, 5_000, 120_000);

      const pending = runtime.execute(
        { entryPath: "index.php", files: [{ path: "index.php", content: "" }] },
        hooks()
      );
      // Well past the 5 second run limit, but still inside the load budget.
      await vi.advanceTimersByTimeAsync(30_000);

      const request = worker.posted[0];
      expect(request).toBeDefined();
      worker.emit({ type: "complete", executionId: request!.executionId, exitCode: 0 });

      expect((await pending).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the run time limit from the moment PHP starts running", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      let limit = 5_000;
      const runtime = runtimeWith(worker, () => limit);
      limit = 2_000;
      worker.onPost = (request) => {
        worker.emit({ type: "status", executionId: request.executionId, status: "running" });
      };

      const pending = runtime.execute(
        { entryPath: "index.php", files: [{ path: "index.php", content: "" }] },
        hooks()
      );
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.error).toContain("2 seconds");
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up if the interpreter never finishes loading", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const pending = runtimeWith(worker, 5_000, 60_000).execute(
        { entryPath: "index.php", files: [{ path: "index.php", content: "" }] },
        hooks()
      );
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.error).toContain("did not finish loading");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when stop is pressed with no run in flight", () => {
    expect(() => runtimeWith(new FakeWorker()).stop()).not.toThrow();
  });
});

describe("runActivePhp", () => {
  it("recognizes .php and .phtml and nothing else", () => {
    expect(canRunPhp(createFile("index.php", ""))).toBe(true);
    expect(canRunPhp(createFile("page.phtml", ""))).toBe(true);
    expect(canRunPhp(createFile("index.PHP", ""))).toBe(true);
    expect(canRunPhp(createFile("main.py", ""))).toBe(false);
    expect(canRunPhp(undefined)).toBe(false);
  });

  it("flushes pending edits before the project is sent", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) =>
      worker.emit({ type: "complete", executionId: request.executionId, exitCode: 0 });
    const order: string[] = [];

    const project = projectWith({ path: "index.php", content: "<?php echo 'hi';" });
    const outcome = await runActivePhp(
      runtimeWith(worker),
      project,
      project.files[0]!,
      async () => {
        order.push("saved");
      },
      hooks()
    );

    expect(order).toEqual(["saved"]);
    expect(outcome.outcome).toBe("success");
    expect(worker.posted[0]?.files[0]?.content).toBe("<?php echo 'hi';");
  });

  it("reports an unsupported file without touching the runtime", async () => {
    const worker = new FakeWorker();
    const project = projectWith({ path: "main.py", content: "print(1)" });

    const outcome = await runActivePhp(
      runtimeWith(worker),
      project,
      project.files[0]!,
      async () => undefined,
      hooks()
    );

    expect(outcome.outcome).toBe("unsupported");
    expect(worker.posted).toHaveLength(0);
  });

  it("reports a stopped run as stopped rather than as an error", async () => {
    const worker = new FakeWorker();
    const runtime = runtimeWith(worker);
    worker.onPost = () => runtime.stop();
    const project = projectWith({ path: "index.php", content: "<?php while (true);" });

    const outcome = await runActivePhp(
      runtime,
      project,
      project.files[0]!,
      async () => undefined,
      hooks()
    );

    expect(outcome.outcome).toBe("stopped");
  });

  it("reports a non-zero exit as an error, not a success", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) =>
      worker.emit({ type: "complete", executionId: request.executionId, exitCode: 1 });
    const project = projectWith({ path: "index.php", content: "<?php exit(1);" });

    const outcome = await runActivePhp(
      runtimeWith(worker),
      project,
      project.files[0]!,
      async () => undefined,
      hooks()
    );

    expect(outcome.outcome).toBe("error");
  });
});
