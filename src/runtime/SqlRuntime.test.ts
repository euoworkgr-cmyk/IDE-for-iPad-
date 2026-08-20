import { describe, expect, it, vi } from "vitest";
import {
  SqlRuntime,
  type SqlExecutionHooks,
  type SqlRuntimeStatus,
  type SqlWorkerRequest,
  type SqlWorkerResponse
} from "./SqlRuntime";
import { canRunSql, runActiveSql } from "./runSql";
import { createFile } from "../projects/models";

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  posted: SqlWorkerRequest[] = [];
  terminated = false;
  onPost: ((message: SqlWorkerRequest) => void) | undefined;

  postMessage(value: unknown): void {
    const message = value as SqlWorkerRequest;
    this.posted.push(message);
    this.onPost?.(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: SqlWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

function hooks(
  stdout: string[] = [],
  stderr: string[] = [],
  statuses: SqlRuntimeStatus[] = []
): SqlExecutionHooks {
  return {
    onStatus: (status) => statuses.push(status),
    onStdout: (chunk) => stdout.push(chunk),
    onStderr: (chunk) => stderr.push(chunk)
  };
}

function runtimeWith(worker: FakeWorker, timeout: number | (() => number) = 5_000): SqlRuntime {
  return new SqlRuntime(() => worker as unknown as Worker, timeout);
}

describe("SqlRuntime", () => {
  it("normalizes the entry path before starting a Worker", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => worker.emit({ type: "complete", executionId: request.executionId });

    const result = await runtimeWith(worker).execute(
      { entryPath: "queries\\nested//report.sql", source: "SELECT 1;" },
      hooks()
    );

    expect(result).toEqual({ ok: true });
    expect(worker.posted[0]?.entryPath).toBe("queries/nested/report.sql");
  });

  it("refuses a path that could climb out of the project", async () => {
    const worker = new FakeWorker();

    const result = await runtimeWith(worker).execute(
      { entryPath: "../secrets.sql", source: "SELECT 1;" },
      hooks()
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid project-relative path");
    expect(worker.posted).toHaveLength(0);
  });

  it("refuses a file that is not .sql", async () => {
    const worker = new FakeWorker();

    const result = await runtimeWith(worker).execute(
      { entryPath: "report.sqlite", source: "SELECT 1;" },
      hooks()
    );

    expect(result.error).toBe("SQL execution supports .sql files only: report.sqlite");
    expect(worker.posted).toHaveLength(0);
  });

  it("reports loading before the Worker says it is running", async () => {
    const worker = new FakeWorker();
    const statuses: SqlRuntimeStatus[] = [];
    worker.onPost = (request) => {
      worker.emit({ type: "status", executionId: request.executionId, status: "running" });
      worker.emit({ type: "stdout", executionId: request.executionId, chunk: "1 row\n" });
      worker.emit({ type: "complete", executionId: request.executionId });
    };

    const stdout: string[] = [];
    await runtimeWith(worker).execute(
      { entryPath: "q.sql", source: "SELECT 1;" },
      hooks(stdout, [], statuses)
    );

    expect(statuses).toEqual(["loading", "running"]);
    expect(stdout).toEqual(["1 row\n"]);
  });

  it("ignores messages from a different execution", async () => {
    const worker = new FakeWorker();
    const stdout: string[] = [];
    worker.onPost = (request) => {
      worker.emit({ type: "stdout", executionId: "someone-else", chunk: "leaked\n" });
      worker.emit({ type: "stdout", executionId: request.executionId, chunk: "mine\n" });
      worker.emit({ type: "complete", executionId: request.executionId });
    };

    await runtimeWith(worker).execute({ entryPath: "q.sql", source: "SELECT 1;" }, hooks(stdout));

    expect(stdout).toEqual(["mine\n"]);
  });

  it("passes a Worker failure through as the run's error", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) =>
      worker.emit({
        type: "failure",
        executionId: request.executionId,
        error: "Error at line 2: no such table: people"
      });

    const result = await runtimeWith(worker).execute(
      { entryPath: "q.sql", source: "SELECT * FROM people;" },
      hooks()
    );

    expect(result).toEqual({ ok: false, error: "Error at line 2: no such table: people" });
    expect(worker.terminated).toBe(true);
  });

  it("stops the run in flight by terminating the Worker", async () => {
    const worker = new FakeWorker();
    const runtime = runtimeWith(worker);
    worker.onPost = () => runtime.stop();

    const result = await runtime.execute(
      { entryPath: "q.sql", source: "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT * FROM c;" },
      hooks()
    );

    expect(result).toEqual({ ok: false, stopped: true });
    expect(worker.terminated).toBe(true);
  });

  it("stops a run that overruns the configured limit, reading the limit per run", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      let limit = 5_000;
      const runtime = runtimeWith(worker, () => limit);
      limit = 2_000;

      const pending = runtime.execute({ entryPath: "q.sql", source: "SELECT 1;" }, hooks());
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.error).toContain("2 seconds");
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when stop is pressed with no run in flight", () => {
    expect(() => runtimeWith(new FakeWorker()).stop()).not.toThrow();
  });
});

describe("runActiveSql", () => {
  it("recognizes a .sql file and nothing else", () => {
    expect(canRunSql(createFile("report.sql", "SELECT 1;"))).toBe(true);
    expect(canRunSql(createFile("report.SQL", "SELECT 1;"))).toBe(true);
    expect(canRunSql(createFile("main.py", "print(1)"))).toBe(false);
    expect(canRunSql(undefined)).toBe(false);
  });

  it("flushes pending edits before the statements are sent", async () => {
    const worker = new FakeWorker();
    worker.onPost = (request) => worker.emit({ type: "complete", executionId: request.executionId });
    const order: string[] = [];

    const outcome = await runActiveSql(
      runtimeWith(worker),
      createFile("report.sql", "SELECT 1;"),
      async () => {
        order.push("saved");
      },
      hooks()
    );

    expect(order).toEqual(["saved"]);
    expect(outcome.outcome).toBe("success");
    expect(worker.posted[0]?.source).toBe("SELECT 1;");
  });

  it("reports an unsupported file without touching the runtime", async () => {
    const worker = new FakeWorker();

    const outcome = await runActiveSql(
      runtimeWith(worker),
      createFile("main.py", "print(1)"),
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

    const outcome = await runActiveSql(
      runtime,
      createFile("report.sql", "SELECT 1;"),
      async () => undefined,
      hooks()
    );

    expect(outcome.outcome).toBe("stopped");
  });
});
