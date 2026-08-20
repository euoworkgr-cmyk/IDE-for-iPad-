import { describe, expect, it } from "vitest";
import {
  formatResultTable,
  formatRowCount,
  formatSqlValue,
  formatStatementError,
  formatStatementHeading,
  formatStatementSummary,
  cleanSqliteMessage,
  splitSqlStatements
} from "./sqlOutput";

/**
 * Stands in for `sqlite3_complete`. The real one is inside the wasm module and
 * is what the Worker passes; this one is deliberately naive — it only knows
 * that a statement ends at a semicolon outside a quoted string — which is
 * enough to prove the splitter delegates rather than deciding for itself.
 */
function fakeIsComplete(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed.endsWith(";")) {
    return false;
  }
  let quoted = false;
  for (const character of trimmed) {
    if (character === "'") {
      quoted = !quoted;
    }
  }
  return !quoted;
}

describe("splitSqlStatements", () => {
  it("splits on the semicolons SQLite accepts as statement ends", () => {
    const statements = splitSqlStatements(
      "CREATE TABLE t(a);\nINSERT INTO t VALUES (1);",
      fakeIsComplete
    );

    expect(statements.map((statement) => statement.sql)).toEqual([
      "CREATE TABLE t(a);",
      "INSERT INTO t VALUES (1);"
    ]);
  });

  it("keeps a semicolon the predicate rejects inside the statement", () => {
    const statements = splitSqlStatements("SELECT 'a;b' AS x;", fakeIsComplete);

    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toBe("SELECT 'a;b' AS x;");
  });

  it("returns trailing text without a semicolon as a final statement", () => {
    const statements = splitSqlStatements("SELECT 1;\nSELECT 2", fakeIsComplete);

    expect(statements.map((statement) => statement.sql)).toEqual(["SELECT 1;", "SELECT 2"]);
  });

  it("ignores blank space between and after statements", () => {
    expect(splitSqlStatements("\n\n  \n", fakeIsComplete)).toEqual([]);
    expect(splitSqlStatements("SELECT 1;\n\n  \n", fakeIsComplete)).toHaveLength(1);
  });

  it("reports the line each statement starts on, not the line it was cut at", () => {
    const statements = splitSqlStatements(
      "SELECT 1;\n\n\nSELECT\n  2;\nSELECT 3;",
      fakeIsComplete
    );

    expect(statements.map((statement) => statement.line)).toEqual([1, 4, 6]);
  });
});

describe("formatSqlValue", () => {
  it("spells NULL rather than printing a blank cell", () => {
    expect(formatSqlValue(null)).toBe("NULL");
    expect(formatSqlValue(undefined)).toBe("NULL");
  });

  it("keeps integers exact when SQLite hands back a bigint", () => {
    expect(formatSqlValue(9007199254740993n)).toBe("9007199254740993");
  });

  it("summarizes a blob by size instead of dumping bytes", () => {
    expect(formatSqlValue(new Uint8Array([1, 2, 3]))).toBe("<BLOB 3 bytes>");
    expect(formatSqlValue(new Uint8Array([1]))).toBe("<BLOB 1 byte>");
  });

  it("passes strings and numbers through", () => {
    expect(formatSqlValue("Ada")).toBe("Ada");
    expect(formatSqlValue(1.5)).toBe("1.5");
  });
});

describe("formatResultTable", () => {
  it("aligns columns to their widest value", () => {
    const table = formatResultTable(
      ["id", "name"],
      [
        [1, "Ada"],
        [2, "Grace"]
      ]
    );

    expect(table).toBe(
      ["id | name", "---+------", "1  | Ada", "2  | Grace", "2 rows"].join("\n") + "\n"
    );
  });

  it("says how many rows there were when it printed only some", () => {
    const table = formatResultTable(["n"], [[1], [2]], 4_812);

    expect(table.endsWith("4,812 rows (2 shown)\n")).toBe(true);
  });

  it("renders a missing cell as NULL rather than shifting the row", () => {
    const table = formatResultTable(["a", "b"], [[1]]);

    expect(table.split("\n")[2]).toBe("1 | NULL");
  });

  it("keeps a multi-line value on one row", () => {
    const table = formatResultTable(["note"], [["first\nsecond"]]);

    expect(table.split("\n")[2]).toBe("first\\nsecond");
  });

  it("returns nothing for a statement that produced no columns", () => {
    expect(formatResultTable([], [])).toBe("");
  });

  it("prints the header and a zero count for an empty result set", () => {
    expect(formatResultTable(["id"], [])).toBe(["id", "--", "0 rows"].join("\n") + "\n");
  });
});

describe("statement reporting", () => {
  it("counts rows with singular and plural forms", () => {
    expect(formatRowCount(1)).toBe("1 row");
    expect(formatRowCount(0)).toBe("0 rows");
    expect(formatRowCount(12_500)).toBe("12,500 rows");
  });

  it("reports changes only when the caller measured them", () => {
    expect(formatStatementSummary(undefined)).toBe("OK\n");
    expect(formatStatementSummary(2)).toBe("OK — 2 rows changed\n");
  });

  it("numbers statements only when there is more than one", () => {
    expect(formatStatementHeading(0, { sql: "SELECT 1;", line: 3 }, 1)).toBe(
      "-- statement (line 3)\n"
    );
    expect(formatStatementHeading(1, { sql: "SELECT 1;", line: 7 }, 3)).toBe(
      "-- statement 2/3 (line 7)\n"
    );
  });

  it("puts the failing line in front of SQLite's own message", () => {
    expect(formatStatementError({ sql: "SELECT", line: 4 }, "incomplete input")).toBe(
      "Error at line 4: incomplete input"
    );
  });

  it("drops the result-code preamble SQLite puts on its messages", () => {
    expect(
      cleanSqliteMessage("SQLITE_ERROR: sqlite3 result code 1: no such table: people")
    ).toBe("no such table: people");
    expect(cleanSqliteMessage("no such column: nope")).toBe("no such column: nope");
    expect(
      formatStatementError(
        { sql: "SELECT * FROM people;", line: 3 },
        "SQLITE_ERROR: sqlite3 result code 1: no such table: people"
      )
    ).toBe("Error at line 3: no such table: people");
  });
});
