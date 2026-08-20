/**
 * Everything about turning a `.sql` file into console text, kept free of both
 * the DOM and the SQLite wasm module so it can be tested without either. The
 * Worker supplies the one thing only SQLite can answer — whether a candidate
 * string is a complete statement — as a function.
 */

/** The value types `db.exec` hands back in `rowMode: "array"`. */
export type SqlCellValue =
  | string
  | number
  | bigint
  | null
  | Uint8Array
  | Int8Array
  | ArrayBuffer;

export interface SqlStatement {
  /** The statement text, trimmed, without a trailing semicolon removed. */
  sql: string;
  /** 1-based line in the source file where the statement starts. */
  line: number;
}

/**
 * A console is not a spreadsheet: a `SELECT *` over a large table would push
 * everything else out of view and cost more to render than to run. Rows past
 * this many are counted rather than printed.
 */
export const MAX_PRINTED_ROWS = 200;

/** Wider cells are truncated so one long value cannot skew the whole table. */
export const MAX_COLUMN_WIDTH = 60;

/**
 * Splits a script into statements the way the `sqlite3` shell does: cut at a
 * semicolon, then ask SQLite whether what came before is actually a complete
 * statement. Delegating that question is what makes semicolons inside string
 * literals, inside comments, and inside a `CREATE TRIGGER ... BEGIN ... END;`
 * body come out right without this file re-implementing SQL lexing.
 *
 * Trailing text after the last semicolon is returned as a statement when it
 * holds anything at all. A final statement without its semicolon is valid and
 * runs; genuinely truncated input is left for SQLite to reject, because its
 * error message is better than any this could invent.
 */
export function splitSqlStatements(
  source: string,
  isComplete: (candidate: string) => boolean
): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let start = 0;
  let line = 1;
  let lineAtStart = 1;

  const push = (endExclusive: number): void => {
    const text = source.slice(start, endExclusive);
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      statements.push({ sql: trimmed, line: lineAtStart + leadingBlankLines(text) });
    }
    start = endExclusive;
    lineAtStart = line;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n") {
      line += 1;
      continue;
    }
    if (character === ";" && isComplete(source.slice(start, index + 1))) {
      push(index + 1);
    }
  }
  push(source.length);

  return statements;
}

function leadingBlankLines(text: string): number {
  const upToFirstToken = text.length - text.trimStart().length;
  let newlines = 0;
  for (let index = 0; index < upToFirstToken; index += 1) {
    if (text[index] === "\n") {
      newlines += 1;
    }
  }
  return newlines;
}

/** How a value prints in a result table. NULL is spelled, never blank. */
export function formatSqlValue(value: SqlCellValue | undefined): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `<BLOB ${value.byteLength} byte${value.byteLength === 1 ? "" : "s"}>`;
}

function truncateCell(text: string): string {
  const singleLine = text.replaceAll("\n", "\\n").replaceAll("\r", "");
  return singleLine.length > MAX_COLUMN_WIDTH
    ? `${singleLine.slice(0, MAX_COLUMN_WIDTH - 1)}…`
    : singleLine;
}

/** `n row`/`n rows`, with thousands separated so a big count stays readable. */
export function formatRowCount(count: number): string {
  return `${count.toLocaleString("en-US")} row${count === 1 ? "" : "s"}`;
}

/**
 * Renders a result set as an aligned text table. Column widths come from the
 * content, which is why this takes every row it will print at once rather than
 * streaming: a streamed table cannot align.
 */
export function formatResultTable(
  columns: readonly string[],
  rows: readonly (readonly SqlCellValue[])[],
  totalRows = rows.length
): string {
  if (columns.length === 0) {
    return "";
  }

  const header = columns.map((column) => truncateCell(column));
  const body = rows.map((row) => columns.map((_, index) => truncateCell(formatSqlValue(row[index]))));
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...body.map((row) => row[index]?.length ?? 0))
  );

  const renderRow = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ").trimEnd();

  const lines = [
    renderRow(header),
    widths.map((width) => "-".repeat(width)).join("-+-")
  ];
  for (const row of body) {
    lines.push(renderRow(row));
  }

  const hidden = totalRows - rows.length;
  lines.push(
    hidden > 0
      ? `${formatRowCount(totalRows)} (${rows.length.toLocaleString("en-US")} shown)`
      : formatRowCount(totalRows)
  );

  return `${lines.join("\n")}\n`;
}

/**
 * The line printed for a statement that returned no rows. `changes` is only
 * meaningful after an INSERT, UPDATE or DELETE — SQLite leaves it at whatever
 * the last such statement set, so the caller decides when to pass it.
 */
export function formatStatementSummary(changes: number | undefined): string {
  if (changes === undefined) {
    return "OK\n";
  }
  return `OK — ${formatRowCount(changes)} changed\n`;
}

/** The heading printed above each statement's output. */
export function formatStatementHeading(
  index: number,
  statement: SqlStatement,
  total: number
): string {
  const position = total > 1 ? ` ${index + 1}/${total}` : "";
  return `-- statement${position} (line ${statement.line})\n`;
}

/**
 * SQLite's JavaScript binding prefixes its messages with the symbolic result
 * code and the numeric one — "SQLITE_ERROR: sqlite3 result code 1: no such
 * table: t". Neither helps someone reading a query they just wrote, and both
 * push the part that does off the line.
 */
export function cleanSqliteMessage(message: string): string {
  return message.replace(/^SQLITE_[A-Z_]+:\s*sqlite3 result code \d+:\s*/, "").trim();
}

/**
 * Prefixes a SQLite error with where it happened. SQLite's own message says
 * what is wrong but never which statement of a multi-statement file it was.
 */
export function formatStatementError(statement: SqlStatement, message: string): string {
  return `Error at line ${statement.line}: ${cleanSqliteMessage(message)}`;
}
