# Altitude — working notes for Claude

Offline-first code editor for iPad. PWA: Vite + TypeScript + CodeMirror 6 +
Pyodide + IndexedDB. Execution — not editing — is the product.

**👉 [`TASKS.md`](TASKS.md) is the current working list — start there.** It
holds the agreed tasks **L1–L8** in the order they should be done, with status
for each. If you are here to build something, that file says what.

**Read [`PROJECT DIRECTION.md`](PROJECT%20DIRECTION.md) for the why.** It holds
the mission, the language-execution roadmap, the M1–M6 milestones, and the
standing architectural constraints. (Note the filename contains a space, not an
underscore.) `TASKS.md` is the short-term plan; this is the long-term one.

## Working model

Development happens in **this git repository**. Claude does both the planning
and the implementation, split across chats:

- **Architecture / planning chats** — scope work, review designs, decide
  trade-offs, review incoming diffs. No code changes.
- **Implementation chats** — work directly on the repo: branch, change code,
  run the checks, commit, push.

Either kind of chat should say which mode it is operating in if there is any
ambiguity. A planning chat that finds itself editing source has drifted.

Historical note: earlier work used a different split, where Claude acted only
as architect and a separate tool implemented changes in Google Drive. **That
workflow is retired.** Google Drive is no longer used for development, and
files should never be treated as living anywhere but this repository.

## Standing constraints

These apply to every feature. `PROJECT DIRECTION.md` is authoritative; the
load-bearing ones are:

- **Offline-first is hard.** Zero CDN, zero runtime network dependency.
  Everything ships in the bundle or does not ship.
- **`ProjectRepository` (`src/storage/database.ts`) is the only interface to
  project storage.** Nothing outside it touches `indexedDB` directly — that
  seam gets swapped for a native storage bridge later.
- **IndexedDB writes go through `SaveCoordinator`** (promise-chained). No
  unguarded concurrent writes.
- **New execution paths need defensive path validation**, matching
  `normalizeProjectPath` in `PythonRuntime.ts`.
- **Code execution belongs in a Web Worker**, not the main thread. See
  `JavaScriptRuntime.ts` for the pattern. (Python predates this and still
  runs on the main thread — a known, documented gap.)
- **Push back on scope creep.** Spikes get time-boxed and measured before
  commitment; see the C# report for why.

## Verification discipline

Do not report a feature as working on the strength of it having been written.

```bash
npm run check   # TypeScript (tsc -b)
npm test        # Vitest
npm run build   # production build + PWA precache
```

Verify from a **clean clone**, not just a working directory — a stale local
state has already hidden a broken build once (see below).

**No feature claim is "done" until verified on real iPad Safari hardware.**
Headless Chromium and simulators are necessary but not sufficient. WebKit is
where the surprises live — worker termination, Service Worker cache behavior,
and memory limits all differ. When iPad verification has not happened, say so
plainly and leave the phase open.

Report bundle-size and Workbox precache deltas for anything that adds weight.

## Repository gotchas

- **`public/pyodide/` is generated and gitignored.** It is copied from
  `node_modules/pyodide` by `scripts/copy-pyodide-assets.mjs` via
  `postinstall`, `pretest`, and `build`. It was once committed and the files
  arrived truncated at 768 KiB, which silently broke Python execution and the
  test suite. Do not commit these assets. If Python fails to start, run
  `npm run prepare:pyodide`.
- **`reports/`** is the project's written record — implementation reports and
  spike findings, including failures. Add a report for substantial work;
  do not rewrite past reports, they are history.
- Documentation is **English only**. Earlier reports were translated from
  Russian; keep new prose in English.

## Layout

```text
src/
  autocomplete/   completion providers
  components/     application UI (App.ts)
  editor/         CodeMirror adapter, theme, language adapters
  filesystem/     file import and ZIP export
  projects/       platform-independent project/file models
  runtime/        Python (Pyodide) and JavaScript (Worker) execution
  snippets/       snippet engine and storage
  storage/        IndexedDB, recovery journal, save coordinator
```
