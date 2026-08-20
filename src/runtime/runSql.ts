import type { ProjectFile } from "../projects/models";
import type { SqlExecutionHooks, SqlExecutionResult, SqlExecutor } from "./SqlRuntime";

export type SqlRunOutcome = "success" | "error" | "stopped" | "unsupported";

export function canRunSql(file: ProjectFile | undefined): boolean {
  return file?.language === "sql" && /\.sql$/i.test(file.path);
}

function sqlRunOutcome(result: SqlExecutionResult): SqlRunOutcome {
  if (result.stopped) {
    return "stopped";
  }
  return result.ok ? "success" : "error";
}

/**
 * SQL runs the open file and nothing else. Unlike Python, no other project
 * file is mounted anywhere the statement can reach — the database starts empty
 * and lives only for this run, so there is nothing for an `ATTACH` to find.
 */
export async function runActiveSql(
  runtime: SqlExecutor,
  activeFile: ProjectFile,
  beforeRun: () => Promise<void>,
  hooks: SqlExecutionHooks
): Promise<{ outcome: SqlRunOutcome; result?: SqlExecutionResult }> {
  if (!canRunSql(activeFile)) {
    return { outcome: "unsupported" };
  }

  await beforeRun();
  const result = await runtime.execute(
    { entryPath: activeFile.path, source: activeFile.content },
    hooks
  );
  return { outcome: sqlRunOutcome(result), result };
}
