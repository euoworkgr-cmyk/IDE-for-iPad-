# L6 — Python runs off the main thread

**Date:** 2026-08-19 · **Milestone:** M1 · **Status:** built, awaiting the
maintainer's iPad check.

## What changed

Pyodide no longer runs on the thread that draws the interface. Python
execution moved into a dedicated Web Worker (`src/runtime/pythonWorker.ts`),
joining the JavaScript/TypeScript path that has been there since Phase 1. An
infinite Python loop now spins in the Worker while the editor, the file list,
the project switcher and the dialogs all stay usable.

`input()` survives the move. It is still `window.prompt` — there is no
`window` in a Worker, and Python's `input()` must *block* until a line
arrives — so the two sides talk over a `SharedArrayBuffer`: the Worker parks
in `Atomics.wait`, the main thread (free, which is the entire point of this
task) collects the line and writes it back.

## The decision

The maintainer chose **option 1** of the two set out in `TASKS.md`:
`SharedArrayBuffer` + `Atomics.wait`, paid for with cross-origin isolation
headers, rather than option 2's synchronous `XMLHttpRequest` brokered through
the Service Worker.

The deciding argument was the one added on 2026-08-19 from
`reports/Rust and Go execution on iPad - research review.md` §4: the two
headers are not a cost paid solely for Python's `input()`. They are the entry
ticket for every wasm-hosted compiler with threads — Rubrc, the only credible
rustc-in-browser, requires them outright. Option 2 would have bought `input()`
and nothing else, on a deprecated API, and would have entangled execution with
the Service Worker that already carries offline caching.

## How it is built

### The stdin channel (`src/runtime/pythonWorkerProtocol.ts`)

A `SharedArrayBuffer` holding three `Int32` control slots followed by a byte
region:

| slot | meaning |
|---|---|
| 0 | status — 0 = the Worker is waiting, 1 = a chunk is ready |
| 1 | length — bytes written into the data region for this chunk |
| 2 | more — 1 = the answer did not fit and another chunk follows |

The Worker zeroes the status slot, posts a `stdin-request`, and blocks in
`Atomics.wait`. The main thread's message handler calls the existing
`readInput` hook — unchanged, still `window.prompt` — encodes the answer,
writes it, stores 1 into the status slot and calls `Atomics.notify`.

Two details that are easy to get wrong and are covered by tests:

- **Chunking, not truncation.** An answer longer than the data region is sent
  in as many chunks as it takes, the Worker asking for each continuation. A
  multi-byte character can therefore be split across a chunk boundary, so the
  bytes are joined *before* they are decoded, never decoded per chunk. The
  Unicode test deliberately sizes the region to split a four-byte emoji.
- **The Worker must always be released.** A blocked `Atomics.wait` with no
  answer coming is a hung run that no reload-free path escapes, so a
  `readInput` that throws is caught on the main thread and answered with an
  empty line, exactly as Cancel already was.

The data region defaults to 64 KiB, which no `window.prompt` answer will
approach; the chunking exists so that the correctness does not depend on that
assumption.

### The headers

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

- **Production:** `public/_headers`, read by Cloudflare Pages, copied into
  `dist/` by Vite's public-directory handling. Confirmed present in the built
  output.
- **Dev and preview:** `server.headers` / `preview.headers` in
  `vite.config.ts`, so a local check matches production rather than silently
  losing `SharedArrayBuffer`.

`require-corp` breaks cross-origin subresources. Altitude has none — the
zero-CDN rule — so this costs nothing today, and it is the constraint that
keeps costing nothing as long as that rule holds.

### Graceful degradation

If the app is ever served without the headers, `SharedArrayBuffer` is not
exposed. Rather than failing to run, the runtime posts `stdin: null` and:

- Python **still runs in the Worker**, so the freeze fix is not conditional on
  hosting.
- `input()` returns an empty line and the console says why, once per run:
  *"input() is unavailable: this page is not cross-origin isolated, so the
  Worker cannot wait for a line. Empty input was used."*

Verified by serving `dist/` from a plain static server with no headers.

### One Worker, kept alive

The JavaScript runtime creates a Worker per run and terminates it at the end.
Python cannot: loading Pyodide costs megabytes of wasm, and paying that on
every Run would be a worse regression than the one being fixed. So the Python
Worker is created on first use and reused. Isolation between runs comes from
what already provided it on the main thread — wiping the virtual project
directory and dropping the project's own modules out of `sys.modules` — plus
a fresh globals dictionary. The Worker is discarded only when it fails to
start or returns an unreadable message; an ordinary Python traceback leaves
it loaded.

### Module layout

Splitting the file was forced by the Worker, not chosen for tidiness: what
the Worker needs had to stop living in a module that constructs a Worker.

- `src/runtime/projectPaths.ts` — `normalizeProjectPath`, `mapProjectFiles`,
  `VIRTUAL_PROJECT_ROOT`. Imported by both threads, by `errorReport.ts` and by
  `JavaScriptRuntime.ts`.
- `src/runtime/pythonWorkerProtocol.ts` — message types, the stdin channel,
  `configureLineStdin`.
- `src/runtime/pythonWorker.ts` — the Worker: loads Pyodide, writes the
  project into the virtual filesystem, runs the entry file, streams stdout and
  stderr back.
- `src/runtime/PythonRuntime.ts` — unchanged public surface. `PythonExecutor`,
  `PythonExecutionHooks` and `readInput: () => string | null` are exactly what
  they were, so `runPython.ts` and `App.ts` needed no change beyond copy.

Path validation happens **inside the Worker**, on the execution path itself,
rather than trusting whatever the main thread posted across — per the standing
constraint.

## Verification

```
npm run check   ✅
npm test        ✅ 17 files, 186 tests
npm run build   ✅
```

New tests: `pythonStdinChannel.test.ts` (8) covers the channel — capacity,
one line, cancel, Unicode split across a chunk boundary, a 5,000-character
answer through a 16-byte region, the continuation request sequence, and that a
new answer is never resumed from a stale remainder. `PythonRuntime.test.ts`
(10) drives the runtime against a fake Worker: the posted request, output and
status relay, stale-run messages ignored, a traceback not discarding the
Worker, a start failure discarding it, one Worker across three runs, the
in-flight guard, the stdin round trip, a throwing prompt, and the no-`SAB`
path.

**Headless Chromium** (Playwright against `vite preview`, 10 checks, all
passed):

- the page is cross-origin isolated and `SharedArrayBuffer` is exposed;
- Python runs and prints from the Worker;
- the next animation frame arrives in 0.6 ms *while* Python is inside
  `time.sleep(3)` — the main thread is genuinely free;
- `input()` returns the typed line, twice in a row, including `Grüße 🚀`;
- `while True: pass` leaves the interface responsive, and a dialog still
  opens while the loop spins.

**Not yet verified on iPad Safari.** WebKit is where the surprises live, and
this change leans on three things that are worth distrusting there: whether
Cloudflare Pages actually serves `_headers` to Mobile Safari such that
`crossOriginIsolated` is true, whether `Atomics.wait` in a Worker behaves as
specified, and whether Pyodide loads in a module Worker at all under WebKit's
memory limits. The task stays at 🟨 until that check happens.

## Size

Precache: **14,207.22 → 14,210.60 KiB (+3.38 KiB, +0.02%)**. Pyodide's ESM
wrapper moved out of the main bundle into a new 23.08 KiB `pythonWorker`
chunk; the wasm and stdlib assets it fetches were already precached and did
not move.

## What this does not do

Nothing stops a run that has already started. An infinite loop no longer
freezes the interface, but the Run button stays disabled until the page is
reloaded, and the Settings dialog now says exactly that instead of the old
"it still runs on the main thread" note. That is **L7**, which this task
exists to unblock: the Worker handle is right there, and stopping is
`terminate()` plus dropping the reference — the same move `JavaScriptRuntime`
already makes on timeout.
