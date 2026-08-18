# Altitude — Project Direction

Last updated: 2026-08-17

## Mission

Altitude is an offline-first code editor for anyone who wants to write and
actually *run* code on an iPad. Not just an editor with syntax highlighting —
execution is the differentiator. Editing without running is a solved problem
on iPad already; local execution across languages is not.

## Target audience

General — not just the maintainer. This means robustness, predictable
behavior, and graceful degradation matter as much as raw feature count.
Rough edges that are tolerable in a personal tool are not acceptable here.

## Architecture end-state

Native Swift shell (file storage, Files/iCloud integration, StoreKit, App
Store distribution) wrapping the existing web-based editor (CodeMirror +
TypeScript app logic) inside a WKWebView. The web codebase is not a
stepping-stone to be discarded — it is reused almost entirely.

**Important, non-obvious point:** going native does not by itself solve code
execution. iOS forbids third-party apps from generating/running native
machine code at runtime (no arbitrary JIT). WKWebView's JS engine is a
special case — it gets JIT because it's Apple's own browser engine, not
because the app has JIT rights. A WASM runtime executing *inside* the
WebView (as Pyodide does today) can be JIT-accelerated for free; a WASM
runtime linked directly into native Swift code would likely be
interpreter-only and slower. **Conclusion: code execution stays inside the
embedded web layer even after the native shell exists.** Native is for
storage, distribution, and OS integration — not an execution shortcut.

Consequence for current work: keep `ProjectRepository` (in
`src/storage/database.ts`) as the sole interface to project storage. Nothing
outside it should touch `indexedDB` directly. This is the seam that gets
swapped for a native storage bridge later — cheap to preserve now, expensive
to retrofit later.

## Language execution roadmap

Execution, not editing, is the hard part. Editing support (CodeMirror
language modes) is comparatively cheap and mostly a syntax-highlighting/
completion concern; it does not imply execution is close behind.

| Language | Status | Notes |
|---|---|---|
| Python | **Done** | Pyodide, working, tested |
| JavaScript | **Next (Phase 1)** | Runs natively in WKWebView's JS engine — no added runtime. Needs a Worker-based sandbox, not main-thread eval. |
| TypeScript | **Next (Phase 2)** | Transpile-then-run on top of the JS execution path. Needs a bundle-size spike before commit (see below) — do not repeat the C# mistake of adding megabytes before measuring. |
| C / C++ | Spike required | WASM-targeting toolchains exist but are heavy/immature. Time-boxed spike with hard numbers before any commitment, same discipline as the C# spike. |
| C# | Blocked, spike v1 failed | Roslyn-to-WASM added ~29MB and threw `TypeLoadException` before reaching Safari. Full findings in `reports/C# Roslyn WASM spike.md`. A v2 spike should start from that report's own recommendations (Web Worker isolation, trimmed reference assemblies) — do not resurrect the v1 approach unchanged. |
| Rust, Go | No known path yet | No mature, ready path to compile+run these client-side in a browser/WASM sandbox today. Not on a timeline. Treat as research, not backlog, until a path is identified. |

## Known pre-existing gap (not in scope for JS/TS work)

Python execution runs on the main thread (`PythonRuntime.ts` — no Worker
usage). An infinite loop in user Python code can freeze the UI with no clean
way to interrupt it short of reload. This should eventually be retrofitted
to a Worker for consistency with how JS execution is being built now — but
that's separate work, not bundled into the JS/TS task, to avoid scope creep
on either change.

## Standing architectural constraints (apply to every feature)

- Offline-first is a hard constraint, not a nice-to-have.
- Zero CDN / zero runtime network dependency. Everything ships in the
  bundle or doesn't ship.
- IndexedDB writes go through promise-chained serialization
  (`SaveCoordinator`) — no unguarded concurrent writes.
- Any new code-execution path needs defensive path/input validation
  matching the pattern in `PythonRuntime.ts`'s `normalizeProjectPath`.
- No feature claim is "done" until verified on real iPad Safari hardware —
  headless Chromium/simulator testing is necessary but not sufficient.

---

# Immediate task: JS and TypeScript execution

## Phase 1 — JavaScript execution

**Scope:**
- Run the active `.js`/`.mjs` file, single-file only. No cross-file
  `import` resolution in this phase.
- Execution happens in a **dedicated Web Worker**, not the main thread —
  this is the one place to get isolation right from the start (see the
  Python main-thread gap above; don't repeat it).
- `console.log` / `console.error` (and uncaught errors) redirect to
  Altitude's existing Run console panel, mirroring the Python stdout/stderr
  UX already in place.
- Hard execution timeout with `worker.terminate()` to kill runaway loops.
  **This needs explicit verification on real iPad Safari** — worker
  termination behavior under WebKit is the one part of this that could
  differ from Chromium and hasn't been confirmed.
- No Node.js API polyfills (`fs`, `process`, `require`, etc.). This is
  sandboxed browser JS only — attempting Node compatibility is out of
  scope and a scope-creep risk.

**Non-goals for Phase 1:** cross-file imports, npm-style module resolution,
Node API surface, TypeScript.

## Phase 2 — TypeScript execution

**Scope:**
- Transpile-then-execute: strip types / downlevel syntax, then hand the
  resulting JS to the same Worker execution path built in Phase 1. Do not
  build a separate execution path for TS.
- **Before writing any integration code:** spike the transpiler dependency
  in isolation and report actual bundle size impact on the production
  build and Workbox precache total — the same measurement discipline as
  the Roslyn spike. If a full `typescript` package pull is too heavy,
  evaluate lighter transpile-only alternatives before deciding.
- No type-checking is required for execution — transpilation only. Full
  type-checking (if ever wanted) is a separate, later feature, not part of
  "make TS run."

**Non-goals for Phase 2:** type-checking/diagnostics, `.d.ts` resolution,
anything beyond making the code run.

## Definition of done for this task

Not done until: automated tests pass, production build size / precache
delta reported, and **manual verification on real iPad Safari** — including
the Worker-termination-on-infinite-loop case specifically — before either
phase is considered closed.
