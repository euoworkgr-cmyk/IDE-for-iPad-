import { describe, expect, it, vi } from "vitest";
import {
  JavaScriptRuntime,
  type JavaScriptExecutionHooks,
  type JavaScriptWorkerRequest,
  type JavaScriptWorkerResponse
} from "./JavaScriptRuntime";

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  posted: JavaScriptWorkerRequest[] = [];
  terminated = false;
  onPost: ((message: JavaScriptWorkerRequest) => void) | undefined;

  postMessage(value: unknown): void {
    const message = value as JavaScriptWorkerRequest;
    this.posted.push(message);
    this.onPost?.(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: JavaScriptWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

function hooks(stdout: string[] = [], stderr: string[] = []): JavaScriptExecutionHooks {
  return {
    onStatus: () => undefined,
    onStdout: (chunk) => stdout.push(chunk),
    onStderr: (chunk) => stderr.push(chunk)
  };
}

function runtimeWith(
  worker: FakeWorker,
  timeout: number | (() => number) = 5_000
): JavaScriptRuntime {
  return new JavaScriptRuntime(() => worker as unknown as Worker, timeout);
}

describe("JavaScriptRuntime", () => {
  it("uses Python's defensive path normalization before starting a Worker", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => {
      worker.emit({ type: "complete", executionId: request.executionId });
    };

    const result = await runtimeWith(worker).execute(
      { entryPath: "scripts\\nested//main.js", source: "console.log('ok')" },
      hooks()
    );

    expect(result).toEqual({ ok: true });
    expect(worker.posted[0]?.entryPath).toBe("scripts/nested/main.js");
  });

  it.each(["../secret.js", "/absolute.js", "src/./main.js", "main.cjs"])(
    "rejects invalid or unsupported entry path %s without creating a Worker",
    async (entryPath) => {
      const workerFactory = vi.fn(() => new FakeWorker() as unknown as Worker);
      const runtime = new JavaScriptRuntime(workerFactory);

      const result = await runtime.execute({ entryPath, source: "" }, hooks());

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
      expect(workerFactory).not.toHaveBeenCalled();
    }
  );

  it.each(["../secret.ts", "/absolute.ts", "main.cts", "main.js"])(
    "rejects invalid or unsupported TypeScript entry path %s without creating a Worker",
    async (entryPath) => {
      const workerFactory = vi.fn(() => new FakeWorker() as unknown as Worker);
      const runtime = new JavaScriptRuntime(workerFactory);

      const result = await runtime.execute(
        { entryPath, source: "", language: "typescript" },
        hooks()
      );

      expect(result.ok).toBe(false);
      expect(workerFactory).not.toHaveBeenCalled();
    }
  );

  it("sends the language to the Worker so one path serves both", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => {
      worker.emit({ type: "complete", executionId: request.executionId });
    };

    await runtimeWith(worker).execute(
      { entryPath: "src/main.ts", source: "const n: number = 1;", language: "typescript" },
      hooks()
    );

    expect(worker.posted[0]?.language).toBe("typescript");
    expect(worker.posted[0]?.entryPath).toBe("src/main.ts");
  });

  it("defaults an untagged request to JavaScript", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => {
      worker.emit({ type: "complete", executionId: request.executionId });
    };

    await runtimeWith(worker).execute({ entryPath: "main.js", source: "" }, hooks());

    expect(worker.posted[0]?.language).toBe("javascript");
  });

  it("forwards Worker status changes, so a compile step is visible", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => {
      worker.emit({ type: "status", executionId: request.executionId, status: "running" });
      worker.emit({ type: "complete", executionId: request.executionId });
    };
    const statuses: string[] = [];

    await runtimeWith(worker).execute(
      { entryPath: "main.ts", source: "", language: "typescript" },
      { ...hooks(), onStatus: (status) => statuses.push(status) }
    );

    expect(statuses).toEqual(["compiling", "running"]);
  });

  it("forwards stdout and stderr through the execution hooks", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => {
      worker.emit({ type: "stdout", executionId: request.executionId, chunk: "hello 42\n" });
      worker.emit({ type: "stderr", executionId: request.executionId, chunk: "warning\n" });
      worker.emit({ type: "complete", executionId: request.executionId });
    };
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await runtimeWith(worker).execute(
      { entryPath: "main.mjs", source: "console.log('hello', 42)" },
      hooks(stdout, stderr)
    );

    expect(result).toEqual({ ok: true });
    expect(stdout).toEqual(["hello 42\n"]);
    expect(stderr).toEqual(["warning\n"]);
    expect(worker.terminated).toBe(true);
  });

  it("returns uncaught Worker failures and terminates the Worker", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => {
      worker.emit({
        type: "failure",
        executionId: request.executionId,
        error: "Error: boom"
      });
    };

    const result = await runtimeWith(worker).execute(
      { entryPath: "main.js", source: "throw new Error('boom')" },
      hooks()
    );

    expect(result).toEqual({ ok: false, error: "Error: boom" });
    expect(worker.terminated).toBe(true);
  });

  it("terminates a non-responsive Worker at the configured limit", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const execution = runtimeWith(worker, 2_000).execute(
        { entryPath: "main.js", source: "while (true) {}" },
        hooks()
      );

      await vi.advanceTimersByTimeAsync(2_000);

      const result = await execution;
      expect(result.ok).toBe(false);
      expect(result.error).toContain("2 seconds");
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a limit supplied as a function on every run, not once at construction", async () => {
    vi.useFakeTimers();
    try {
      let limitMs = 1_000;
      const worker = new FakeWorker();
      const runtime = runtimeWith(worker, () => limitMs);

      const first = runtime.execute({ entryPath: "main.js", source: "" }, hooks());
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await first).error).toContain("1 second");

      limitMs = 30_000;
      const second = runtime.execute({ entryPath: "main.js", source: "" }, hooks());
      await vi.advanceTimersByTimeAsync(1_000);
      // The old limit has passed and the run is still alive.
      let settled = false;
      void second.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(29_000);
      expect((await second).error).toContain("30 seconds");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the default limit when the supplied value is unusable", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const execution = runtimeWith(worker, () => Number.NaN).execute(
        { entryPath: "main.js", source: "" },
        hooks()
      );

      await vi.advanceTimersByTimeAsync(5_000);

      expect((await execution).error).toContain("5 seconds");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores messages that do not match the current execution", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => {
      worker.emit({ type: "stdout", executionId: "spoofed", chunk: "ignored\n" });
      worker.emit({ type: "complete", executionId: request.executionId });
    };
    const stdout: string[] = [];

    await runtimeWith(worker).execute(
      { entryPath: "main.js", source: "" },
      hooks(stdout)
    );

    expect(stdout).toEqual([]);
  });
});

describe("stopping a JavaScript run (L7)", () => {
  it("does nothing when no run is in flight", () => {
    const worker = new FakeWorker();
    expect(() => runtimeWith(worker).stop()).not.toThrow();
    expect(worker.terminated).toBe(false);
  });

  it("terminates the Worker and reports the run as stopped", async () => {
    const worker = new FakeWorker();
    const runtime = runtimeWith(worker);

    // Nothing answers, exactly as a runaway loop does not.
    const run = runtime.execute(
      { entryPath: "main.js", source: "while (true) {}" },
      hooks()
    );
    runtime.stop();

    await expect(run).resolves.toEqual({ ok: false, stopped: true });
    expect(worker.terminated).toBe(true);
  });

  it("does not report a finished run as stopped afterwards", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => {
      worker.emit({ type: "complete", executionId: request.executionId });
    };
    const runtime = runtimeWith(worker);

    await expect(
      runtime.execute({ entryPath: "main.js", source: "1" }, hooks())
    ).resolves.toEqual({ ok: true });

    // A stop pressed after the run ended must not reach into the next one.
    expect(() => runtime.stop()).not.toThrow();
  });

  it("keeps the timeout message when the limit fires rather than the user", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const run = runtimeWith(worker, 1_000).execute(
        { entryPath: "main.js", source: "while (true) {}" },
        hooks()
      );
      vi.advanceTimersByTime(1_000);

      const result = await run;
      expect(result.stopped).toBeUndefined();
      expect(result.error).toContain("run time limit");
    } finally {
      vi.useRealTimers();
    }
  });
});

