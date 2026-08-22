import type { SqlWorkerRequest, SqlWorkerResponse } from "./SqlRuntime";
import {
  formatResultTable,
  formatStatementError,
  formatStatementHeading,
  formatStatementSummary,
  splitSqlStatements,
  MAX_PRINTED_ROWS,
  type SqlCellValue,
  type SqlStatement
} from "./sqlOutput";
import { describeRuntimeStartFailure } from "./runtimeStartFailure";

interface SqlWorkerScope {
  postMessage(message: SqlWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
}

const workerScope = globalThis as unknown as SqlWorkerScope;
const send = workerScope.postMessage.bind(workerScope);
let executionStarted = false;

/** Statements after which `sqlite3_changes()` is worth reporting. */
const CHANGE_REPORTING = /^\s*(insert|update|delete|replace)\b/i;

function isExecutionRequest(value: unknown): value is SqlWorkerRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SqlWorkerRequest>;
  return (
    candidate.type === "execute" &&
    typeof candidate.executionId === "string" &&
    typeof candidate.entryPath === "string" &&
    typeof candidate.source === "string"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}

async function execute(request: SqlWorkerRequest): Promise<void> {
  const { executionId } = request;
  const stdout = (chunk: string): void => send({ type: "stdout", executionId, chunk });
  const fail = (error: string): void => send({ type: "failure", executionId, error });

  // Every storage-backed VFS is turned off before SQLite bootstraps. Altitude
  // runs each query against a fresh in-memory database, so OPFS would only add
  // a second worker, a second copy of the data, and — since the app never
  // reaches the proxy script that VFS wants — an error on every run.
  // Storage stays behind ProjectRepository; this keeps SQLite out of it.
  (globalThis as unknown as { sqlite3ApiConfig?: unknown }).sqlite3ApiConfig = {
    disable: {
      vfs: {
        opfs: true,
        "opfs-vfs": true,
        "opfs-wl": true,
        "opfs-sahpool": true,
        kvvfs: true
      }
    }
  };

  // The wasm module is imported dynamically so that nothing else in the app
  // pays for it: a JavaScript or Python run never loads this chunk, and this
  // Worker only exists while a .sql file is running.
  let sqlite3;
  try {
    const { default: sqlite3InitModule } = await import("@sqlite.org/sqlite-wasm");
    sqlite3 = await sqlite3InitModule();
  } catch (error) {
    fail(describeRuntimeStartFailure("SQLite", error));
    return;
  }

  send({ type: "status", executionId, status: "running" });

  /**
   * Every run gets an empty in-memory database. That is the whole persistence
   * model for now, and it is deliberate: it matches what Run already means for
   * every other language — a fresh process, nothing carried over — and it adds
   * no storage seam outside `ProjectRepository`. Persisting a database between
   * runs is a separate, larger decision.
   */
  const database = new sqlite3.oo1.DB(":memory:", "c");

  let statements: SqlStatement[];
  try {
    statements = splitSqlStatements(
      request.source,
      (candidate) => sqlite3.capi.sqlite3_complete(candidate) === 1
    );
  } catch (error) {
    database.close();
    fail(errorMessage(error));
    return;
  }

  if (statements.length === 0) {
    stdout("No statements to run.\n");
    database.close();
    send({ type: "complete", executionId });
    return;
  }

  for (const [index, statement] of statements.entries()) {
    const columnNames: string[] = [];
    const rows: SqlCellValue[][] = [];
    let totalRows = 0;

    try {
      database.exec({
        sql: statement.sql,
        rowMode: "array",
        columnNames,
        callback: (row: SqlCellValue[]) => {
          totalRows += 1;
          if (rows.length < MAX_PRINTED_ROWS) {
            rows.push([...row]);
          }
        }
      });
    } catch (error) {
      database.close();
      fail(formatStatementError(statement, errorMessage(error)));
      return;
    }

    stdout(formatStatementHeading(index, statement, statements.length));
    if (columnNames.length > 0) {
      stdout(formatResultTable(columnNames, rows, totalRows));
    } else {
      const changes = CHANGE_REPORTING.test(statement.sql)
        ? Number(database.changes(false, false))
        : undefined;
      stdout(formatStatementSummary(changes));
    }
    if (index < statements.length - 1) {
      stdout("\n");
    }
  }

  database.close();
  send({ type: "complete", executionId });
}

workerScope.addEventListener("message", (event) => {
  if (executionStarted || !isExecutionRequest(event.data)) {
    return;
  }
  executionStarted = true;
  void execute(event.data);
});
