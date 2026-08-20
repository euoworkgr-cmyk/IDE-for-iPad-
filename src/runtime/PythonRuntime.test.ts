import { describe, expect, it, vi } from "vitest";
import { PythonRuntime, type PythonExecutionHooks } from "./PythonRuntime";
import {
  createStdinResponder,
  readStdinLine,
  type PythonWorkerExecuteRequest,
  type PythonWorkerResponse
} from "./pythonWorkerProtocol";

/**
 * A stand-in for the Worker. Messages the runtime posts are recorded, and the
 * test drives the reply side by hand, so the message protocol is exercised
 * without loading Pyodide.
 */
class FakeWorker implements Pick<Worker, "postMessage" | "terminate"> {
  readonly posted: PythonWorkerExecuteRequest[] = [];
  terminated = 0;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  postMessage(message: PythonWorkerExecuteRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated += 1;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  get listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }

  emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }

  reply(message: PythonWorkerResponse): void {
    this.emit("message", { data: message });
  }

  get executionId(): string {
    return this.posted.at(-1)!.executionId;
  }
}

function makeRuntime(options: { stdin?: SharedArrayBuffer | null } = {}) {
  const worker = new FakeWorker();
  const runtime = new PythonRuntime(
    () => worker as unknown as Worker,
    () => "https://altitude.test/pyodide/",
    () => (options.stdin === undefined ? null : options.stdin)
  );
  return { runtime, worker };
}

function collectingHooks(overrides: Partial<PythonExecutionHooks> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const statuses: string[] = [];
  const hooks: PythonExecutionHooks = {
    onStdout: (chunk) => stdout.push(chunk),
    onStderr: (chunk) => stderr.push(chunk),
    onStatus: (status) => statuses.push(status),
    readInput: () => "",
    ...overrides
  };
  return { hooks, stdout, stderr, statuses };
}

describe("PythonRuntime over a Worker", () => {
  it("posts the entry file, the project and the Pyodide index URL", async () => {
    const { runtime, worker } = makeRuntime();
    const { hooks } = collectingHooks();

    const run = runtime.execute(
      {
        entryPath: "main.py",
        files: [
          { path: "main.py", content: "print(1)" },
          { path: "utils/math.py", content: "" }
        ]
      },
      hooks
    );
    worker.reply({ type: "complete", executionId: worker.executionId });

    await expect(run).resolves.toEqual({ ok: true });
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({
      type: "execute",
      entryPath: "main.py",
      indexURL: "https://altitude.test/pyodide/",
      files: [
        { path: "main.py", content: "print(1)" },
        { path: "utils/math.py", content: "" }
      ]
    });
  });

  it("relays output and status, and ignores messages from another run", async () => {
    const { runtime, worker } = makeRuntime();
    const { hooks, stdout, stderr, statuses } = collectingHooks();

    const run = runtime.execute({ entryPath: "main.py", files: [] }, hooks);
    const executionId = worker.executionId;
    worker.reply({ type: "status", executionId, status: "loading" });
    worker.reply({ type: "status", executionId, status: "running" });
    worker.reply({ type: "stdout", executionId, chunk: "hello" });
    worker.reply({ type: "stderr", executionId, chunk: "oops" });
    worker.reply({ type: "stdout", executionId: "stale", chunk: "ignored" });
    worker.reply({ type: "complete", executionId });

    await expect(run).resolves.toEqual({ ok: true });
    expect(stdout).toEqual(["hello"]);
    expect(stderr).toEqual(["oops"]);
    expect(statuses).toEqual(["loading", "running"]);
  });

  it("reports a failure from the Worker without discarding the Worker", async () => {
    const { runtime, worker } = makeRuntime();
    const { hooks } = collectingHooks();

    const run = runtime.execute({ entryPath: "main.py", files: [] }, hooks);
    worker.reply({
      type: "failure",
      executionId: worker.executionId,
      error: "Traceback: boom"
    });

    await expect(run).resolves.toEqual({ ok: false, error: "Traceback: boom" });
    // Pyodide costs megabytes to load; an ordinary Python exception must not
    // throw the loaded runtime away.
    expect(worker.terminated).toBe(0);
    expect(worker.listenerCount).toBe(0);
  });

  it("discards the Worker when it fails to start", async () => {
    const { runtime, worker } = makeRuntime();
    const { hooks } = collectingHooks();

    const run = runtime.execute({ entryPath: "main.py", files: [] }, hooks);
    worker.emit("error", {
      message: "Worker failed",
      preventDefault: () => undefined
    });

    await expect(run).resolves.toEqual({ ok: false, error: "Worker failed" });
    expect(worker.terminated).toBe(1);
  });

  it("keeps one Worker across runs rather than reloading Pyodide", async () => {
    const factory = vi.fn();
    const worker = new FakeWorker();
    factory.mockReturnValue(worker as unknown as Worker);
    const runtime = new PythonRuntime(
      factory as unknown as () => Worker,
      () => "https://altitude.test/pyodide/",
      () => null
    );
    const { hooks } = collectingHooks();

    for (let index = 0; index < 3; index += 1) {
      const run = runtime.execute({ entryPath: "main.py", files: [] }, hooks);
      worker.reply({ type: "complete", executionId: worker.executionId });
      await run;
    }

    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.posted).toHaveLength(3);
  });

  it("refuses a second run while one is in flight", async () => {
    const { runtime, worker } = makeRuntime();
    const { hooks } = collectingHooks();

    const first = runtime.execute({ entryPath: "main.py", files: [] }, hooks);
    await expect(
      runtime.execute({ entryPath: "main.py", files: [] }, hooks)
    ).resolves.toEqual({
      ok: false,
      error: "Another Python run is already in progress."
    });

    worker.reply({ type: "complete", executionId: worker.executionId });
    await expect(first).resolves.toEqual({ ok: true });
  });

  it("answers a stdin request through the shared channel", async () => {
    const stdin = new SharedArrayBuffer(3 * 4 + 1024);
    const { runtime, worker } = makeRuntime({ stdin });
    const readInput = vi.fn(() => "Ada");
    const { hooks } = collectingHooks({ readInput });

    const run = runtime.execute({ entryPath: "main.py", files: [] }, hooks);
    expect(worker.posted[0]?.stdin).toBe(stdin);

    // Stand in for the Worker: readStdinLine blocks until the runtime's
    // message handler has written the answer, which it does synchronously.
    const line = readStdinLine(stdin, (continuation) => {
      worker.reply({
        type: "stdin-request",
        executionId: worker.executionId,
        continuation
      });
    });
    expect(line).toBe("Ada");
    expect(readInput).toHaveBeenCalledTimes(1);

    worker.reply({ type: "complete", executionId: worker.executionId });
    await expect(run).resolves.toEqual({ ok: true });
  });

  it("releases a blocked Worker with an empty line when the prompt throws", async () => {
    const stdin = new SharedArrayBuffer(3 * 4 + 1024);
    const { runtime, worker } = makeRuntime({ stdin });
    const { hooks } = collectingHooks({
      readInput: () => {
        throw new Error("prompt unavailable");
      }
    });

    const run = runtime.execute({ entryPath: "main.py", files: [] }, hooks);
    const line = readStdinLine(stdin, (continuation) => {
      worker.reply({
        type: "stdin-request",
        executionId: worker.executionId,
        continuation
      });
    });

    expect(line).toBe("");
    worker.reply({ type: "complete", executionId: worker.executionId });
    await expect(run).resolves.toEqual({ ok: true });
  });

  it("does not build a stdin channel when SharedArrayBuffer is unavailable", async () => {
    const { runtime, worker } = makeRuntime({ stdin: null });
    const { hooks } = collectingHooks();

    const run = runtime.execute({ entryPath: "main.py", files: [] }, hooks);
    expect(worker.posted[0]?.stdin).toBeNull();
    worker.reply({ type: "complete", executionId: worker.executionId });
    await run;
  });
});

describe("stdin responder", () => {
  it("is what the runtime uses to unblock the Worker", () => {
    const buffer = new SharedArrayBuffer(3 * 4 + 8);
    const responder = createStdinResponder(buffer);
    const value = readStdinLine(buffer, (continuation) => {
      responder.respond(continuation ? null : "a longer answer", continuation);
    });
    expect(value).toBe("a longer answer");
  });
});
