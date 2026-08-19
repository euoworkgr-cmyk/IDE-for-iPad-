# Altitude Code

An offline-first code editor for iPad that actually **runs** your code.

Editing with syntax highlighting is already a solved problem on iPad. Local
execution across languages is not — that is Altitude's differentiator. The
first version ships as a PWA: projects and files live in the browser, and the
entire interface plus every language runtime is precached by a Service Worker
so the app works with no network at all.

See [`PROJECT DIRECTION.md`](PROJECT%20DIRECTION.md) for the mission, the
architecture end-state, and the language roadmap, and [`CLAUDE.md`](CLAUDE.md)
for the day-to-day working rules and repository gotchas.

## Language support

Editing support and execution support are separate things. A language having
a CodeMirror mode does **not** mean it can run.

| Language | Editing | Execution |
|---|---|---|
| Python | ✅ Highlighting | ✅ **Runs** — Pyodide, tested |
| JavaScript | ✅ Highlighting | ✅ **Runs** — `.js` / `.mjs`, Web Worker sandbox, verified on iPad Safari |
| TypeScript | ✅ Highlighting | ✅ **Runs** — `.ts` / `.mts`, transpile-then-run on the JavaScript Worker, verified on iPad Safari |
| C# | ✅ Highlighting + basic completions | ❌ Blocked — see [the Roslyn spike report](reports/C%23%20Roslyn%20WASM%20spike.md) |
| C / C++ | ⚠️ Opens as text, no highlighting | 🔬 Researched, deferred to native shell — see [the C++ spike report](reports/C%2B%2B%20execution%20on%20iPad%20-%20research%20spike.md) |
| HTML, CSS, JSON | ✅ Highlighting | — Not applicable (markup/styling/data, not executable) |
| Go | ⬜ Not started | 🔬 Research, costed — see [the Rust/Go research review](reports/Rust%20and%20Go%20execution%20on%20iPad%20-%20research%20review.md) |
| Java, SQL, PHP | ⬜ Not started | ⬜ Not researched |
| Plain text | ✅ | — |

Go, Java, SQL, and PHP are on Altitude's long-term language target alongside
the languages above, but none of the four has editor, autocomplete, or
execution support yet — they are listed here so the gap is visible, not
because anything ships for them today. See the full A/B/C matrix in
[`PROJECT DIRECTION.md`](PROJECT%20DIRECTION.md) for the complete long-term
target (12 languages) and per-language status.

### How execution works

- **Python** runs on [Pyodide](https://pyodide.org/), fully local. Project
  files are mapped into a virtual filesystem, so local imports and
  `open("data/config.json")` work. `input()` is supported via a browser
  prompt. Each run gets a fresh globals dictionary, so runs are isolated.
  *Known gap: Pyodide currently runs on the main thread, so an infinite loop
  freezes the UI.*
- **JavaScript** runs inside a dedicated Web Worker — never on the main
  thread. `console.log` / `console.error`, uncaught exceptions, and unhandled
  promise rejections are routed to the Run console. The run time limit is
  user-configurable (Settings, default 5 seconds) and terminates the Worker,
  so runaway loops cannot lock up the editor. Single file only: no cross-file
  imports, no npm resolution, and no Node.js APIs (`fs`, `process`, `require`
  are all undefined by design).
- **TypeScript** runs on the same Worker as JavaScript: types are stripped by
  [sucrase](https://github.com/alangpierce/sucrase) inside the Worker, then
  the result executes exactly like a `.js` file — there is no second
  execution path. Sucrase does no type checking, so a type error does not
  block a run; only a syntax error does. Type stripping only, so
  `namespace`/`module` blocks are not compiled and fail at runtime, and
  `.tsx` / `.cts` are not supported. See
  [the transpiler spike report](reports/TypeScript%20execution%20-%20transpiler%20spike.md)
  for the bundle-size measurement behind picking sucrase.

## Stack

- **Vite + TypeScript, no UI framework** — small runtime, plain DOM, and
  minimal architectural coupling for a future native shell.
- **CodeMirror 6** — modular, lighter than Monaco, and built for
  browser/touch input. Monaco does not officially support mobile browsers.
- **Pyodide** — local Python execution, shipped from the bundle with no CDN.
- **IndexedDB** — the primary long-term project store.
- **localStorage recovery journal** — an optional synchronous safety copy. If
  `localStorage` is unavailable the editor keeps working on IndexedDB alone
  and reports `Reduced recovery` status.
- **vite-plugin-pwa / Workbox** — precaches every production asset plus an
  offline navigation fallback.
- **fflate** — local ZIP export, no CDN and no network requests.

Every npm dependency is compiled into the production bundle. There are no
runtime dependencies on a CDN or any API.

## Features

- **Projects:** create, select, rename, and delete.
- **Files:** create, rename, delete, and nested paths such as `src/App.cs`.
- **Import** files from Files.app via the system picker (up to 5 MiB, text
  only, never overwrites — conflicts become `main (1).py`).
- **Editor:** line numbers, indentation, Tab, undo/redo, search, and
  auto-closing brackets and quotes.
- **Snippets:** built-in Python and C# snippets plus user-defined ones, with
  placeholder navigation and a strict Tab priority order. Stored globally in
  their own IndexedDB database and fully available offline.
- **Autocomplete:** simple C# completions for keywords and `Console.*`.
  Accepted with Tab; Enter always inserts a newline.
- **Run console:** stdout, stderr, and tracebacks for Python and JavaScript.
- **Autosave** to IndexedDB after 350 ms, with a forced flush when the app is
  hidden or closed.
- **Crash recovery** of unwritten changes from the recovery journal.
- Restores the last open project and file.
- **ZIP export** preserving the normal file structure.
- Responsive explorer for both landscape and portrait.
- Full production precache so the app starts with no network.

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`. Development mode is for development —
offline behavior must be verified against a production build.

> `npm install` runs `postinstall`, which copies the Pyodide runtime assets
> from `node_modules/pyodide` into `public/pyodide/`. Those assets are
> generated output and are **not** committed to the repository. If Python
> execution ever fails to start, regenerate them with
> `npm run prepare:pyodide`.

## Production build

```bash
npm test
npm run build
npm run preview
```

The finished static site lands in `dist/`. It can be hosted on any HTTPS
static host with no separate backend.

## Deployment

Altitude is hosted on **Cloudflare Pages**.

### Build settings

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(leave empty)* |
| Node version | pinned to 22 by `.node-version` |

Cloudflare runs `npm ci` before the build command. `npm ci` triggers the
`postinstall` hook, which copies the Pyodide runtime assets out of
`node_modules/pyodide` into `public/pyodide/` — this is why those assets are
gitignored and do not need to be committed.

Verified from a clean clone: `npm ci` then `npm run build` produces a 17 MB
`dist/` containing `index.html`, `sw.js`, `manifest.webmanifest`, and the full
9,596,462-byte `pyodide.asm.wasm`.

### Git integration

With the repository connected, a push to `main` builds and deploys
automatically, and pull requests get their own preview URLs. `dist/` stays
gitignored — Cloudflare builds it. **Do not commit `dist/`.**

Note that a Cloudflare Pages project created for **Direct Upload cannot be
converted** to Git integration. Switching requires creating a new Pages project
connected to Git and moving any custom domain across.

### Custom headers

Cloudflare Pages supports custom response headers via a `_headers` file placed
in `public/` (Vite copies it into `dist/`). Nothing needs headers today, but
this is the mechanism that makes `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` available — required if Python execution ever
moves to a Worker using `SharedArrayBuffer`. See the M1 risk note in
`PROJECT DIRECTION.md`.

## Checks

```bash
npm run check   # TypeScript, tsc -b
npm test        # Vitest
npm run build   # production build
```

The test suite covers project save/restore in IndexedDB, recovery of
concurrent unwritten edits across multiple files, Python `input()` line-mode
behavior against a real Pyodide instance, the JavaScript Worker runtime
including its timeout and termination path, console output formatting, file
import, the snippet engine, and smart Tab.

## Installing on iPad

Service Workers require **HTTPS** in Safari. An address like
`http://192.168.x.x:4173` is fine for looking at the interface, but it does
not guarantee the offline cache installs.

1. Host the contents of `dist/` at an HTTPS address, or serve it over the
   local network via HTTPS with a certificate the iPad trusts.
2. Open the address once in Safari while online.
3. Wait for the `Offline cached` indicator in the top bar.
4. In Safari choose **Share → Add to Home Screen**.
5. Launch Altitude from the home screen, create a file, and wait for the
   `Saved` status.
6. Enable airplane mode and reopen the app.

Do not clear Website Data for the app's address: Safari deletes IndexedDB
along with it. A regular `Export ZIP` remains an independent backup.

## Architecture

```text
src/
  autocomplete/   completion providers
  components/     application UI
  editor/         CodeMirror adapter, theme, and language adapters
  filesystem/     file import and ZIP export
  projects/       platform-independent project and file models
  runtime/        Python (Pyodide) and JavaScript (Web Worker) execution
  snippets/       snippet engine and storage
  storage/        IndexedDB, recovery journal, save coordinator
public/
  icons/          local PWA assets
  pyodide/        Pyodide runtime assets (generated, gitignored)
scripts/          build-time asset copying
reports/          implementation and spike reports
```

`Project`, `ProjectFile`, language detection, and export logic have no UI
framework dependency. This keeps the models and editor adapters reusable in a
future native shell without turning the current MVP into a desktop IDE ahead
of time.

**Architectural constraint:** `ProjectRepository` (in
`src/storage/database.ts`) is the sole interface to project storage — nothing
outside it should touch `indexedDB` directly. That seam is what gets swapped
for a native storage bridge later.

## Reports

Implementation and spike reports live in [`reports/`](reports/):

- [Patch 1 — Python execution](reports/Patch%201%20-%20Python%20execution.md)
- [Patch 2 — File import](reports/Patch%202%20-%20File%20import.md)
- [Patch 3 — Python stdin hotfix](reports/Patch%203%20-%20Python%20stdin%20hotfix.md)
- [Patch 4 — Snippets and smart Tab](reports/Patch%204%20-%20Snippets%20and%20smart%20Tab.md)
- [Phase 1 — JavaScript execution](reports/Phase%201%20JavaScript%20execution.md)
- [C# Roslyn WASM spike (failed)](reports/C%23%20Roslyn%20WASM%20spike.md)
