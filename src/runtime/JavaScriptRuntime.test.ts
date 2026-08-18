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

function runtimeWith(worker: FakeWorker, timeoutMs = 5_000): JavaScriptRuntime {
  return new JavaScriptRuntime(() => worker as unknown as Worker, timeoutMs);
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

  it("terminates a non-responsive Worker at the hard timeout", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const execution = runtimeWith(worker, 25).execute(
        { entryPath: "main.js", source: "while (true) {}" },
        hooks()
      );

      await vi.advanceTimersByTimeAsync(25);

      await expect(execution).resolves.toEqual({
        ok: false,
        error: "JavaScript execution timed out after 25 ms."
      });
      expect(worker.terminated).toBe(true);
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
