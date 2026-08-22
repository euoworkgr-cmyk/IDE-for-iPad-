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

| Language | Editing | Autocomplete | Execution |
|---|---|---|---|
| Python | ✅ Highlighting | ✅ Builtins, keywords, local names | ✅ **Runs** — Pyodide in a Web Worker, Stop button, verified on iPad Safari |
| JavaScript | ✅ Highlighting | ✅ Keywords, snippets, Worker globals | ✅ **Runs** — `.js` / `.mjs`, Web Worker sandbox, Stop button, verified on iPad Safari |
| TypeScript | ✅ Highlighting | ✅ JS completions plus TS keywords | ✅ **Runs** — `.ts` / `.mts`, transpile-then-run on the JavaScript Worker, verified on iPad Safari |
| SQL | ✅ Highlighting (SQLite dialect) | ✅ Dialect keywords + SQLite builtins | ✅ **Runs** — `.sql`, SQLite compiled to WebAssembly in a Web Worker, fresh in-memory database per run, Stop button, verified on iPad Safari |
| PHP | ✅ Highlighting | ✅ Keywords, builtins, magic constants | ✅ **Runs** — `.php` / `.phtml`, PHP 8.3 compiled to WebAssembly in a Web Worker, whole project mounted, Stop button, verified on iPad Safari |
| C# | ✅ Highlighting | ✅ Keywords + `Console.*` | ✅ **Runs** — `.cs`, Roslyn on the .NET WebAssembly runtime in a Web Worker, compiler diagnostics with line and column, Stop button, verified on iPad Safari; see [the execution report](reports/C%23%20execution%20-%20Roslyn%20in%20a%20Worker.md) |
| C / C++ | ⚠️ Opens as text, no highlighting | ⬜ Not started | 🔬 Researched, deferred to native shell — see [the C++ spike report](reports/C%2B%2B%20execution%20on%20iPad%20-%20research%20spike.md) |
| HTML | ✅ Highlighting | ✅ Tags and attributes, plus CSS/JS completion inside `<style>` and `<script>` | ✅ **Previews** — `.html` / `.htm`, rendered offline in a sandboxed frame with the project's stylesheets and scripts inlined, verified on iPad Safari |
| CSS | ✅ Highlighting | ✅ Properties, values, at-rules | ✅ **Previews** — `.css`, rendered through the page that links it or a generated page of ordinary elements, verified on iPad Safari |
| JSON | ✅ Highlighting | ⬜ Not started | — Not applicable (data, not executable) |
| Go | ⬜ Not started | ⬜ Not started | 🔬 Research, costed — see [the Rust/Go research review](reports/Rust%20and%20Go%20execution%20on%20iPad%20-%20research%20review.md) |
| Java | ✅ Highlighting | ✅ Keywords, standard types, `System.out.*` | 🔬 Researched, not scheduled — CheerpJ is the only path; see [`PROJECT DIRECTION.md`](PROJECT%20DIRECTION.md) |
| Plain text | ✅ | — | — |

**HTML and CSS closed all three columns on 2026-08-21**, verified on real iPad
Safari the same day. Their column C is *rendering*, not execution: a page has
no interpreter, and a preview is the thing that lets you see what you wrote.
See [the preview report](reports/HTML%20and%20CSS%20-%20preview%20as%20column%20C.md).
**Nine of the twelve target languages are now complete on all three columns.**

Seven of them run code end to end, all three columns done and verified on real
iPad Safari: Python, JavaScript, TypeScript, SQL, PHP, and **C#** — Roslyn on
the .NET WebAssembly runtime, confirmed working on device 2026-08-20. **Java can be written but not run**:
it has highlighting and autocomplete, while its execution path (CheerpJ) is
costed and deliberately unscheduled, since its runtime would be the heaviest
thing Altitude ships by a wide margin. Editing support and execution support
are decoupled on purpose — the editor mode cost an afternoon; the runtime is
a project. Go remains research only. See the full A/B/C matrix in
[`PROJECT DIRECTION.md`](PROJECT%20DIRECTION.md) for the complete long-term
target (12 languages) and per-language status.

### How execution works

- **Python** runs on [Pyodide](https://pyodide.org/) inside a dedicated Web
  Worker, fully local. Project files are mapped into a virtual filesystem, so
  local imports and `open("data/config.json")` work. Each run gets a fresh
  globals dictionary, so runs are isolated, and an infinite loop no longer
  freezes the interface. `input()` is still a browser prompt: the Worker
  blocks on a `SharedArrayBuffer` with `Atomics.wait` while the main thread
  collects the line, which is why the app is served cross-origin isolated
  (`public/_headers`). Without those headers Python still runs off the main
  thread and `input()` degrades to an empty line with a note in the console.
  A run can be stopped at any point: the Run button becomes Stop, which raises
  `KeyboardInterrupt` inside the interpreter — keeping it loaded, so the next
  run starts instantly — and terminates the Worker if the code is blocked
  somewhere that signal cannot reach.
- **JavaScript** runs inside a dedicated Web Worker — never on the main
  thread. `console.log` / `console.error`, uncaught exceptions, and unhandled
  promise rejections are routed to the Run console. The run time limit is
  user-configurable (Settings, default 5 seconds) and terminates the Worker,
  so runaway loops cannot lock up the editor; the same Stop button ends a run
  before the limit does. Single file only: no cross-file
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
- **SQL** runs against [SQLite compiled to WebAssembly](https://sqlite.org/wasm)
  in its own dedicated Web Worker — not shared with JavaScript, since it is a
  different engine entirely. Each run gets a fresh **in-memory** database, so
  nothing persists between runs; every OPFS-backed storage VFS is disabled
  explicitly, keeping persistent storage exclusively behind
  `ProjectRepository`. A `.sql` file's statements are split by asking SQLite's
  own `sqlite3_complete()` where one ends, so semicolons inside strings,
  comments, and trigger bodies do not split incorrectly. Results print as
  aligned tables, capped at 200 rows and 60 characters per cell. See
  [the SQL execution report](reports/SQL%20execution%20-%20SQLite%20in%20the%20browser.md).
- **PHP** runs on [PHP 8.3 compiled to WebAssembly](https://github.com/seanmorris/php-wasm)
  in its own dedicated Web Worker. The whole project is mounted into the
  interpreter's virtual filesystem — not just the open file — so `require` and
  `include` of a sibling file work, and the entry runs as a real file so
  `__FILE__` and parse-error filenames name what was actually written. Only
  one PHP version ships (of the twelve the package provides): a build script
  copies a single interpreter into `public/php/`, the same pattern
  `copy-pyodide-assets.mjs` already established for Pyodide. Nothing persists
  between runs. Because a 12+ MiB interpreter takes longer to load than any
  sensible run time limit, the configured limit only starts once PHP begins
  running the user's code — loading itself has its own generous budget. See
  [the PHP execution report](reports/PHP%20execution%20-%20php-wasm%20in%20a%20Worker.md).

- **HTML and CSS** are **previewed** rather than executed. Altitude builds one
  self-contained document — every project-relative `<link rel="stylesheet">`
  and `<script src>` inlined from the project's own files — and renders it in
  an iframe sandboxed *without* `allow-same-origin`, so the page runs on an
  opaque origin and cannot reach the app's storage or DOM. Nothing is fetched:
  an external URL is dropped, and the console says so instead of leaving a page
  mysteriously unstyled. References are resolved the way a browser would and
  then validated, so `../../` cannot walk out of the project. `console.log`,
  uncaught errors, and unhandled rejections from the page are routed to the Run
  console. `defer` and `async` scripts are moved to the end of `<body>`, where
  the parser would have run them, since those attributes only mean something on
  a script that is fetched. Pressing Run on a `.css` file previews the page that
  links it — or a generated page of ordinary elements when nothing does. A
  preview is live until you close it (Run becomes **Close**, and the pane has a
  **Reload**), because unlike a script a page is not finished when it has
  loaded; the run time limit therefore does not apply to it. One thing to know:
  the frame shares the main thread, so an endless loop *inside a previewed page*
  will lock the tab — Worker-backed runtimes do not have that problem. See
  [the preview report](reports/HTML%20and%20CSS%20-%20preview%20as%20column%20C.md).

## Stack

- **Vite + TypeScript, no UI framework** — small runtime, plain DOM, and
  minimal architectural coupling for a future native shell.
- **CodeMirror 6** — modular, lighter than Monaco, and built for
  browser/touch input. Monaco does not officially support mobile browsers.
- **Pyodide** — local Python execution, shipped from the bundle with no CDN,
  running in a dedicated Web Worker.
- **@sqlite.org/sqlite-wasm** — the official SQLite build, running in a
  dedicated Web Worker against a fresh in-memory database per run.
- **php-wasm** — PHP 8.3 compiled to WebAssembly, running in a dedicated Web
  Worker; only one of its bundled PHP versions ships, copied by a build script.
- **Roslyn on the .NET WebAssembly runtime** — C# compiled and executed in a
  dedicated Web Worker, with no Blazor: the editor is CodeMirror, so .NET is
  only ever an engine. Unlike the other runtimes it is not an npm package, so
  it is built from `runtime-csharp/` by a GitHub Actions workflow and fetched
  at build time by `scripts/copy-dotnet-assets.mjs`.
- **IndexedDB** — the primary long-term project store.
- **localStorage recovery journal** — an optional synchronous safety copy. If
  `localStorage` is unavailable the editor keeps working on IndexedDB alone
  and reports `Reduced recovery` status.
- **vite-plugin-pwa / Workbox** — precaches every production asset plus an
  offline navigation fallback.
- **fflate** — local export (single file or ZIP), no CDN and no network
  requests.

Every npm dependency is compiled into the production bundle. There are no
runtime dependencies on a CDN or any API.

## Features

- **Projects:** create, select, rename, and delete.
- **Files:** create, rename, delete, and nested paths such as `src/helpers.py`.
  New files have no default name or extension, so nothing nudges you toward a
  language that cannot run.
- **Import** files from Files.app via the system picker (up to 5 MiB, text
  only, never overwrites — conflicts become `main (1).py`).
- **Editor:** line numbers, configurable indentation, Tab, undo/redo, search,
  and auto-closing brackets and quotes. Light and dark palettes, including the
  syntax colours.
- **Snippets:** built-in Python, C#, and Java snippets plus user-defined ones
  for any language, with placeholder navigation and a strict Tab priority
  order. Stored globally in their own IndexedDB database and fully available
  offline.
- **Autocomplete:** builtins, keywords, and local names for Python,
  JavaScript, and TypeScript; dialect keywords and SQLite builtin functions
  for SQL; keywords, builtins, and magic constants for PHP; keyword and
  `Console.*` completions for C# — every language that runs — plus keywords,
  standard types, and `System.out.*` for Java, which does not.
  Accepted with Tab; Enter always inserts a newline.
- **Run console:** stdout, stderr, and formatted tracebacks/stack traces for
  Python, JavaScript, TypeScript, SQL, and PHP. Can be hidden and shown again
  without losing its content.
- **Stop button:** the Run button becomes Stop while anything is running, for
  every runnable language. Python stops in two tiers — an interpreter
  interrupt first, which keeps Pyodide loaded, then Worker termination if the
  code cannot be reached that way. SQL and PHP stop by Worker termination,
  same as JavaScript.
- **Settings:** appearance (System, Light or Dark — System follows the iPad
  live, with no reload), editor text size (11–24 px), indent width (2, 4 or 8
  spaces, which is what Tab and auto-indent insert), and a run time limit
  (1–120 seconds, default 5) for JavaScript, TypeScript, SQL, and PHP. All
  persisted across restarts. For PHP the limit covers only the user's code, not
  interpreter load time. Appearance and text size apply as you change them, so
  you can see the result before keeping it; Cancel puts them back.
- **Empty states:** an empty project explains itself and offers to create a
  file, rather than silently seeding an unrunnable placeholder.
- **Autosave** to IndexedDB after 350 ms, with a forced flush when the app is
  hidden or closed.
- **Crash recovery** of unwritten changes from the recovery journal.
- **Honest about storage.** When the browser will not let Altitude store
  anything — Private Browsing, or website data blocked — it opens anyway, in a
  session that keeps nothing, and says so in a banner that cannot be dismissed.
  A full device, a write that fails, a record it cannot read, and website data
  the browser has cleared each get their own message with a way out. A
  corrupt record is skipped rather than allowed to stop the app.
- Restores the last open project and file.
- **Export** as a choice: the open file on its own (saved as itself, no
  archive), or the whole project as a ZIP preserving the normal file
  structure.
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

> `npm install` runs `postinstall`, which copies both the Pyodide runtime
> assets from `node_modules/pyodide` into `public/pyodide/` and a single PHP
> build from `node_modules/php-wasm` into `public/php/`. Both are generated
> output and are **not** committed to the repository. If Python execution
> ever fails to start, regenerate its assets with `npm run prepare:pyodide`;
> for PHP, `npm run prepare:php`. `npm run prepare:runtimes` does both.

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
`node_modules/pyodide` into `public/pyodide/` and a single PHP build out of
`node_modules/php-wasm` into `public/php/` — this is why those assets are
gitignored and do not need to be committed.

Verified from a clean clone: `npm ci` then `npm run build` succeeds and
produces a `dist/` containing `index.html`, `sw.js`, `manifest.webmanifest`,
the Pyodide runtime, and the PHP interpreter (currently ~28.6 MB precached in
total — PHP alone is roughly 13 MB of that, by far the largest single addition
to date).

### Git integration

With the repository connected, a push to `main` builds and deploys
automatically, and pull requests get their own preview URLs. `dist/` stays
gitignored — Cloudflare builds it. **Do not commit `dist/`.**

Note that a Cloudflare Pages project created for **Direct Upload cannot be
converted** to Git integration. Switching requires creating a new Pages project
connected to Git and moving any custom domain across.

### Custom headers

`public/_headers` (copied into `dist/` by Vite) ships every response with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

This makes the app **cross-origin isolated**, which is what exposes
`SharedArrayBuffer` — the mechanism the Python Worker uses to block on
`input()` while the main thread supplies a line (see **How execution works**
above). `vite.config.ts` sets the same two headers on the dev and preview
servers, so a local check matches production. `require-corp` breaks
cross-origin subresources, which costs nothing here: Altitude has none, by the
zero-CDN rule. Served without these headers, Python still runs off the main
thread; only `input()` degrades to an empty line with a note in the console.

## Checks

```bash
npm run check   # TypeScript, tsc -b
npm test        # Vitest
npm run build   # production build
```

The test suite covers project save/restore in IndexedDB, recovery of
concurrent unwritten edits across multiple files, Python `input()` line-mode
behavior against a real Pyodide instance, the shared-memory stdin channel the
Python Worker blocks on, every runtime's Stop path (Pyodide's interrupt buffer
and Worker termination for Python, JavaScript, SQL, and PHP), the JavaScript
and PHP Worker runtimes including their timeout and termination paths, SQL
statement splitting and result formatting, console output formatting, file
import, project export (single file and archive), the snippet engine, and
smart Tab.

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
along with it. A regular whole-project export remains an independent backup.

**Private Browsing is not supported.** Safari keeps IndexedDB working normally
inside a private tab, so nothing about using Altitude there looks broken — but
the data never reaches disk and is discarded the moment the tab closes. There
is no reliable way for the app to detect this, so it is a documented
limitation rather than a warning the app can raise for you: use an ordinary
tab, or better, follow the steps above and launch Altitude from the Home
Screen.

## Architecture

```text
src/
  autocomplete/   completion providers
  components/     application UI
  editor/         CodeMirror adapter, theme, and language adapters
  filesystem/     file import and export (single file and ZIP)
  projects/       platform-independent project and file models
  runtime/        Python (Pyodide), JavaScript/TypeScript, SQL (SQLite wasm),
                  and PHP (php-wasm) execution — each in its own Web Worker,
                  all Stop-able
  settings/       app settings model and persistence
  snippets/       snippet engine and storage
  storage/        IndexedDB, recovery journal, save coordinator
public/
  icons/          local PWA assets
  pyodide/        Pyodide runtime assets (generated, gitignored)
  php/            PHP interpreter, one version (generated, gitignored)
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

Implementation and spike reports live in [`reports/`](reports/). Past reports
are not rewritten as the codebase moves on — they are history — so consult
`TASKS.md` and this file for current status, not a report's own "done" claim.

**The L1–L8 task list** (agreed 2026-08-19, all done):

- [L1 — project switcher](reports/L1%20-%20project%20switcher.md)
- [L2 — autocomplete for the languages that run](reports/L2%20-%20autocomplete%20for%20the%20languages%20that%20run.md)
- [L3 — errors that look like errors](reports/L3%20-%20errors%20that%20look%20like%20errors.md)
- [L4 and L5 — run time limit and TypeScript execution](reports/L4%20and%20L5%20-%20run%20time%20limit%20and%20TypeScript%20execution.md)
- [L6 — Python runs off the main thread](reports/L6%20-%20Python%20runs%20off%20the%20main%20thread.md)
- [L7 — stop button for every language](reports/L7%20-%20stop%20button%20for%20every%20language.md)
- [L8 — first-run and empty states](reports/L8%20-%20first-run%20and%20empty%20states.md)
- [Export — one file or the whole project](reports/Export%20-%20one%20file%20or%20the%20whole%20project.md)
- [WebKit emulation addendum — L1, L4, L5](reports/WebKit%20emulation%20addendum%20-%20L1%2C%20L4%2C%20L5.md)

**Earlier execution work:**

- [Patch 1 — Python execution](reports/Patch%201%20-%20Python%20execution.md)
- [Patch 2 — File import](reports/Patch%202%20-%20File%20import.md)
- [Patch 3 — Python stdin hotfix](reports/Patch%203%20-%20Python%20stdin%20hotfix.md)
- [Patch 4 — Snippets and smart Tab](reports/Patch%204%20-%20Snippets%20and%20smart%20Tab.md)
- [Phase 1 — JavaScript execution](reports/Phase%201%20JavaScript%20execution.md)
- [TypeScript execution — transpiler spike](reports/TypeScript%20execution%20-%20transpiler%20spike.md)
- [Console formatter correctness fix](reports/Console%20formatter%20correctness%20fix.md)
- [SQL execution — SQLite in the browser](reports/SQL%20execution%20-%20SQLite%20in%20the%20browser.md)
- [PHP execution — php-wasm in a Worker](reports/PHP%20execution%20-%20php-wasm%20in%20a%20Worker.md)

**Spikes for languages not yet running:**

- [C# Roslyn WASM spike (failed)](reports/C%23%20Roslyn%20WASM%20spike.md)
- [C++ execution on iPad — research spike](reports/C%2B%2B%20execution%20on%20iPad%20-%20research%20spike.md)
- [Rust and Go execution on iPad — research review](reports/Rust%20and%20Go%20execution%20on%20iPad%20-%20research%20review.md)

Java's research is not a standalone report — it is recorded as a
recommendation directly in [`PROJECT DIRECTION.md`](PROJECT%20DIRECTION.md),
under **Language execution roadmap**.
