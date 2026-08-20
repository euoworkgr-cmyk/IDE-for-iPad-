# SQL — editor mode, autocomplete, and execution

Date: 2026-08-20
Status: built, automated checks pass, **awaiting the maintainer's iPad check**

SQL was one of the twelve languages in the long-term target and the only one
whose column C means something different from the rest: there is nothing to
compile. What "Run" has to mean for a `.sql` file is *execute these statements
against a database engine and show what came back*. This is that work — A, B
and C for SQL in one change.

## What ships

- **A — editor mode.** `.sql` files get `@codemirror/lang-sql` configured to
  the **SQLite** dialect, which is the dialect the Run button actually runs.
- **B — autocomplete.** The language package's own keyword source, upper-cased,
  plus a hand-written list of the SQLite builtin functions a scratch database
  answers to (`count`, `strftime`, `json_extract`, …). The keyword list is not
  hand-written — `keywordCompletionSource(SQLite, true)` supplies it, so it
  tracks the dialect rather than drifting from it.
- **C — execution.** SQLite compiled to WebAssembly, in a dedicated Web Worker,
  against a fresh in-memory database per run. Statements are executed in order
  and each one's output is printed under a heading naming its line.

A run prints an aligned table for anything that returns rows, and `OK` — with
a change count after `INSERT`/`UPDATE`/`DELETE`/`REPLACE` — for anything that
does not:

```text
-- statement 3/3 (line 3)
name  | score
------+------
Ada   | 99.5
Grace | 97
Linus | NULL
3 rows
```

## The decisions worth recording

### The engine: `@sqlite.org/sqlite-wasm`, in-memory only

The official SQLite build, version 3.53.0. It is the only one of the three
candidates that is SQLite's own artifact rather than a third party's wrapping
of it, and it ships proper TypeScript types.

**Each run gets an empty database and drops it at the end.** This is the part
worth being explicit about, because the obvious alternative — persisting to
OPFS — was considered and rejected *for now*:

- It matches what Run already means everywhere else in Altitude. A Python or
  JavaScript run starts from nothing; a SQL run starting from nothing is the
  consistent behaviour, not a limitation invented to save work.
- **It adds no storage seam outside `ProjectRepository`.** The standing
  constraint is that nothing but the repository touches persistent storage,
  because that seam gets swapped for a native bridge later. An OPFS database
  would be a second, parallel store that the bridge would have to learn about.
  That is a real architectural decision and it deserves its own scoping, not a
  side effect of getting `SELECT` to work.
- The header question that usually decides this — `opfs` needs
  `SharedArrayBuffer` and therefore COOP/COEP, `opfs-sahpool` does not — is
  moot here twice over: Altitude has shipped both headers since L6, and an
  in-memory database needs neither VFS.

Every storage-backed VFS is switched off explicitly before SQLite bootstraps
(`sqlite3ApiConfig.disable.vfs`). Left on, the OPFS VFS spawns a second worker
and an async proxy on every run for storage nothing uses — and, with the proxy
script trimmed from the build (below), logged an error to the browser console
on every run. Turning them off is what makes the trimming safe.

### Its own Worker, not the JavaScript one

TypeScript shares the JavaScript execution path because stripping types leaves
JavaScript — that was L5's whole point, and it still holds. SQL does not: it is
a different engine, and folding an 865 KiB wasm build of SQLite into the
JavaScript Worker would put it in the chunk graph of every `console.log`.

What is shared is the *shape*, and now literally: `workerExecution.ts` was
extracted from `JavaScriptRuntime.ts` and holds the execution id, the per-run
resolution of the settings time limit, and the two message formatters. Both
runtimes use it, so the two cannot drift on details that are meant to be
identical. `SqlRuntime` is otherwise a sibling of `JavaScriptRuntime`: one
Worker per run, the same user-configurable run time limit, and a Stop that
terminates. Nothing new was invented for stopping — SQLite executes a statement
synchronously inside the Worker, so there is nothing an interrupt tier could
reach that termination does not. Termination is measured at **35 ms** on a
runaway recursive CTE.

### Statement splitting is SQLite's job, not ours

A `.sql` file is many statements, and printing per-statement output means
splitting them. Semicolons inside string literals, inside comments, and inside
a `CREATE TRIGGER ... BEGIN ... END;` body all make naive splitting wrong.

`splitSqlStatements` cuts at each semicolon and then asks
**`sqlite3_complete()`** — SQLite's own answer to "is this a whole statement
yet?", the same function the `sqlite3` shell uses — whether the text so far is
one. The predicate is a parameter rather than an import, so the splitter is
unit-tested without loading the wasm module at all, and correct in production
because SQLite decides.

Trailing text after the last semicolon is run as a final statement. A last
statement without its semicolon is legal; genuinely truncated input is left for
SQLite to reject, because its message is better than an invented one.

### Output limits, chosen because a console is not a spreadsheet

- **200 rows printed**, then a count: `5,000 rows (200 shown)`. A `SELECT *`
  over a big table would otherwise push everything else out of view and cost
  more to render than the query cost to run.
- **60 characters per cell**, truncated with an ellipsis, and newlines shown as
  `\n`, so one long value cannot skew a table or break its alignment.
- **`NULL` is spelled**, never printed as an empty cell, since an empty string
  and a NULL are different answers.
- **BLOBs are summarized** as `<BLOB 12 bytes>` rather than dumped.
- SQLite's `SQLITE_ERROR: sqlite3 result code 1:` preamble is stripped, and the
  failing line is put in front: `Error at line 3: no such table: people`.

## Size

Measured on the production build, precache totals as Workbox reports them:

| Build | Precache | Entries |
|---|---|---|
| Before | 14,219.21 KiB | 20 |
| After | **15,294.83 KiB** | 23 |
| Delta | **+1,075.62 KiB (+7.56%)** | +3 |

The bulk of it is `sqlite3.wasm` at 864.75 KiB (405.63 KiB gzipped) — the
engine itself, unavoidable if SQL is to run offline. The rest is the ES wrapper
(loaded only by the SQL Worker), the Worker chunk, and `@codemirror/lang-sql`.

**237 KiB of that was avoided.** `@sqlite.org/sqlite-wasm` reaches two entry
points Altitude never uses — the `Worker1` message API and the OPFS async proxy
— through `new URL(..., import.meta.url)`, which Vite resolves at transform
time, so both were emitted as assets and precached. A small build plugin
(`trimUnusedSqliteEntryPoints` in `vite.config.ts`) rewrites those two
references, and only those two, to inert URLs. **It fails the build if either
pattern stops matching**, so a package upgrade that changes the layout is a
loud error rather than a silent 237 KiB. It must be removed if SQL ever gains
OPFS persistence — the proxy is required for that VFS.

Note that it lives in `worker.plugins`, not `plugins`: a production Worker
bundle is a separate Rollup build with its own plugin list, and SQLite is only
ever imported from a Worker. Configured in the main list, it silently does
nothing.

Startup cost, measured in headless Chromium: a SQL run takes **~100 ms**
end to end including instantiating the wasm module in a brand-new Worker
(115 ms first run, 98–99 ms after, with the file cached). That is cheap enough
that the Worker is not kept alive between runs — unlike Python, where reloading
the interpreter each time would have been the worse regression.

## Verification

`npm run check`, `npm test` (244 tests, 20 files) and `npm run build` all pass.
New unit tests cover statement splitting, value and table formatting, the row
cap, the message cleanup, path validation, the timeout, Stop, and the
unsupported-file path.

**30 checks in headless Chromium**, against the production build served by
`vite preview`:

- A three-statement script runs: `CREATE` reports `OK`, `INSERT` reports
  `OK — 3 rows changed`, and the `SELECT` prints an aligned table with `NULL`
  spelled and a row count.
- `SELECT * FROM missing_table` fails the run, and the console reads
  `Error at line 3: no such table: missing_table` — the right line of a
  three-statement file, and no result-code preamble.
- A `CREATE TRIGGER ... BEGIN ... END;` body and a `'a; b'` string literal both
  survive splitting: three statements, not five.
- 5,000 rows print as `5,000 rows (200 shown)`.
- Stop ends a runaway recursive CTE in 35 ms, reads as *Stopped* rather than an
  error, and SQL runs again afterwards.
- JavaScript still runs, which is what checks the `workerExecution.ts`
  extraction did not disturb the existing path.
- Autocomplete opens on a `.sql` file and offers `SELECT`.
- A `.sql` file survives a reload.
- **No page-level console errors during any run** — the check that catches the
  OPFS initialization noise described above.

**Not yet verified on real iPad Safari.** Per the project rule, this is not
done until it is. The specific things worth watching there are WebKit's memory
behaviour with a ~865 KiB wasm module instantiated per run alongside Pyodide's
much larger one, and that Worker termination stops a query mid-flight as
reliably as it does for JavaScript.

## Deliberately not in scope

- **Persistence.** Covered above: a real decision about storage architecture,
  not a feature to bolt on here.
- **Exporting a `.db` file.** Follows from persistence, and additionally needs
  binary project files, which `ProjectFile.content: string` does not model.
- **An `EXPLAIN` panel.** Showing the bytecode program SQLite compiles a
  statement into would be a genuinely nice IDE feature, and it is a UI feature
  rather than an execution one. `EXPLAIN` already works today — it is a
  statement like any other, and prints its table.
- **Reading other project files.** A SQL run sees only the open file; there is
  nothing on any filesystem for `ATTACH` to find.
