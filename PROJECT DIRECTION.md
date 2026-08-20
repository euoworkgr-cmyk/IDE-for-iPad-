# Altitude — Project Direction

Last updated: 2026-08-20

## Mission

Altitude is an offline-first code editor for anyone who wants to write and
actually *run* code on an iPad. Not just an editor with syntax highlighting —
execution is the differentiator. Editing without running is a solved problem
on iPad already; local execution across languages is not.

**The long-term language target (agreed 2026-08-19):** Python, C++, C, Java,
C#, JavaScript, SQL, Go, TypeScript, PHP, HTML, and CSS — chosen as being
among the most widely used languages/technologies in practice. For each,
Altitude aims to eventually provide:

- **A — Language support in the editor.** Real syntax highlighting via a
  CodeMirror language mode, not a plain-text fallback.
- **B — Syntax autocomplete.** Keyword and builtin completion at minimum.
- **C — Code execution / compilation, where applicable.** HTML and CSS are
  markup/styling, not executable programs, so C does not apply to them by
  design — A and B are the whole target for those two. SQL's equivalent of
  "execution" is running a query against a local database engine, not
  compiling — worth keeping distinct when that work is scoped.

This is the long-range ambition, not a committed schedule. It supersedes the
old three-language framing below with a wider one; `TASKS.md`'s L1–L8 list
remains the actual short-term plan, and adding a language to the matrix here
does not by itself create a task there.

## Language coverage target (A/B/C)

Status as verified in the codebase and reports on 2026-08-20 — not assumed.

| Language | A — Editor mode | B — Autocomplete | C — Execution |
|---|---|---|---|
| Python | ✅ Done (`@codemirror/lang-python`) | ✅ Done (builtins, keywords, local names) | ✅ Done — Pyodide in a Web Worker, Stop-able, verified on iPad |
| JavaScript | ✅ Done (`@codemirror/lang-javascript`) | ✅ Done (keywords, snippets, Worker globals) | ✅ Done — Web Worker, timeout and Stop both verified on iPad |
| TypeScript | ✅ Done (shares the JS mode, `typescript: true`) | ✅ Done (JS completions plus TS keywords) | ✅ Done (sucrase transpile → JS Worker path, verified on iPad) |
| HTML | ✅ Done (`@codemirror/lang-html`) | ⬜ Not started | — Not applicable (markup) |
| CSS | ✅ Done (`@codemirror/lang-css`) | ⬜ Not started | — Not applicable (styling) |
| C# | ✅ Done (`@replit/codemirror-lang-csharp`) | ✅ Done (keywords + `Console.*`) | 🔴 Blocked — Roslyn/WASM spike v1 failed, see below |
| C++ | 🟡 Registered but falls back to plain text — no real mode | ⬜ Not started | 🔬 Researched, deferred to native shell — see below |
| C | 🟡 Registered but falls back to plain text — no real mode | ⬜ Not started | 🔬 Cheap option identified (TCC, ~100 KB), unscheduled |
| Go | ⬜ Not started — no `LanguageId` entry yet | ⬜ Not started | 🔬 Research, now costed — see below |
| Java | ⬜ Not started — no `LanguageId` entry yet | ⬜ Not started | 🔬 Researched, **not scheduled** — CheerpJ is the only path; see below |
| SQL | ✅ Done (`@codemirror/lang-sql`, SQLite dialect) | ✅ Done (dialect keywords + SQLite builtin functions) | ✅ Done — SQLite compiled to WebAssembly in a Web Worker, fresh in-memory database per run, Stop-able, verified on iPad |
| PHP | ✅ Done (`@codemirror/lang-php`) | ✅ Done (keywords, builtins, magic constants) | ✅ Done — PHP 8.3 compiled to WebAssembly in a Web Worker, whole project mounted, Stop-able, verified on iPad |

**Python, JavaScript, TypeScript, SQL, and PHP now satisfy all three columns.**
The first three closed with L2 (autocomplete for all three, replacing the
C#-only dispatch in `src/autocomplete/completionProvider.ts`), L6 (Python
off the main thread), and L7 (Stop for every language) — all verified on
real iPad Safari 2026-08-19/20. SQL closed all three at once on 2026-08-20
and was verified on real iPad Safari the same day (PR #20, merged into
`main`). PHP followed on 2026-08-20 — editor mode, autocomplete and
execution together, including a 12.56 MiB WebAssembly interpreter, the
largest single addition to the app to date — and was likewise verified on
real iPad Safari the same day (PR #22, merged into `main`). C# keeps A and B
but stays blocked on C. Of the twelve target languages, **six now run**;
C++, C, Go, Java and C# do not, and Java's path is now researched and costed
below.
Column C's per-language detail — the C++/C# spikes, the Rust/Go research, and
the Java recommendation — lives in the **Language execution roadmap** section
below and in `reports/`; this table summarizes rather than replaces it.

Bringing a new language up to column A means adding it to `LanguageId`
(`src/projects/models.ts`), wiring a CodeMirror language package into
`loadLanguageExtension` (`src/editor/languages.ts`), and giving it a label.
Column B means adding a branch to `completionProvider.ts`, which has dispatched
per language since L2 — reuse the language package's own completion sources
where it has them, as Python, JavaScript and SQL do — PHP's had to be written
by hand, because `@codemirror/lang-php` exports none. Column C
follows the pattern in `src/runtime/`: a dedicated runtime module, Worker-based
per the standing constraints, with the defensive path validation
`PythonRuntime.ts`'s `normalizeProjectPath` establishes.

## Target audience

General — not just the maintainer. This means robustness, predictable
behavior, and graceful degradation matter as much as raw feature count.
Rough edges that are tolerable in a personal tool are not acceptable here.

## Working model

Development happens in the project's **git repository**. Claude does both the
planning and the implementation, split across chats:

- **Architecture / planning chats** — scope work, review designs, weigh
  trade-offs, review diffs. No code changes.
- **Implementation chats** — work directly on the repo: branch, change code,
  run the checks, commit, push.

The split is about focus, not capability. A planning chat that starts editing
source has drifted, and an implementation chat that starts redesigning scope
should hand the question back.

**Retired workflow:** earlier phases used Claude strictly as architect while a
separate tool implemented changes in Google Drive. That is no longer how this
project works. Google Drive is not used for development; the repository is the
single source of truth for every file.

Day-to-day working rules for a chat picking up this project live in
`CLAUDE.md`, which Claude Code loads automatically. This document stays the
authority on direction and constraints.

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
| Python | **Done** | Pyodide, in a dedicated Web Worker since L6 (2026-08-19), Stop-able since L7 (2026-08-20). Both verified on real iPad Safari. |
| JavaScript | **Done** | Worker-based sandbox, console redirect, configurable `terminate()` timeout, and a Stop button (L7). Runs natively in WKWebView's JS engine — no added runtime. Verified on real iPad Safari, including Worker termination on an infinite loop. The console-formatting defects noted in the original Phase 1 report were fixed separately — see `reports/Console formatter correctness fix.md`. |
| SQL | **Done** | `@sqlite.org/sqlite-wasm` 3.53.0 (the official build) in a dedicated Web Worker, one per run, with the same settings-driven time limit and terminate-based Stop as JavaScript — the shared parts now live in `src/runtime/workerExecution.ts`. **Each run gets a fresh in-memory database**: persistence would mean a storage seam outside `ProjectRepository`, which is a decision of its own, so every storage-backed VFS is switched off explicitly. Statements are split by SQLite's own `sqlite3_complete()`. **+1,075.62 KiB precache (+7.56%)**, 864.75 KiB of it the engine. **Verified on real iPad Safari 2026-08-20.** Full findings in `reports/SQL execution - SQLite in the browser.md`. |
| PHP | **Done** | `php-wasm` 0.1.0 (seanmorris), PHP 8.3.11, in a dedicated Web Worker, one per run. Chosen over `@php-wasm/web` on measured size: **12.56 MiB vs 18.31 MiB** for the same PHP version. Only one of the package's twelve PHP versions ships, because `scripts/copy-php-assets.mjs` copies one build into `public/php/` — the Pyodide pattern. The whole project is mounted so `require` of a sibling works, and the entry runs as a real file so `__FILE__` and parse-error filenames are the user's own. **+13,320.15 KiB precache (+87.1%)** — by far the largest addition to date, ~3.2 MiB gzipped over the wire, and it forced `maximumFileSizeToCacheInBytes` from 11 to 16 MiB. **Verified on real iPad Safari 2026-08-20.** Full findings in `reports/PHP execution - php-wasm in a Worker.md`. |
| TypeScript | **Done** | Transpile-then-run on the Phase 1 Worker path, as specified — no separate execution path. The required bundle-size spike was done first: sucrase chosen over the `typescript` package and the wasm transpilers, costing **+203.58 KiB precache (+1.46%)**. See `reports/TypeScript execution - transpiler spike.md`. **Verified on real iPad Safari 2026-08-19**, which also closes the `worker.format: "es"` question for JavaScript. |
| C / C++ | **Spike done — deferred to the native shell** | In-browser LLVM/Clang measures **103 MiB compressed**, 7.5× Altitude's entire app; the incremental clang-repl variant is additionally blocked by an open Safari `dlopen` bug. A native ARM Clang emitting WASM, executed by WKWebView, wins on size, compile speed and run speed — and is proven on the App Store by a-Shell. Full findings in `reports/C++ execution on iPad - research spike.md`. Next step is a narrower spike: how small can native Clang + a WASI sysroot be via On-Demand Resources? |
| C (alone) | Cheap option, unscheduled | If plain C is ever wanted without C++, TCC compiles to WASM at ~100 KB — comfortably inside the current bundle. Noted so it is not forgotten. |
| C# | Blocked, spike v1 failed | Roslyn-to-WASM added ~29MB and threw `TypeLoadException` before reaching Safari. Full findings in `reports/C# Roslyn WASM spike.md`. A v2 spike should start from that report's own recommendations (Web Worker isolation, trimmed reference assemblies) — do not resurrect the v1 approach unchanged. |
| Rust, Go | **Research — a path exists, and Go is now costed** | "No known path" is no longer accurate. Both have one option of the right shape — the compiler itself compiled to WASM — and everything else (remote build hosts, iSH, UTM, TinyGo Playground, GopherJS, wasm-pack) is either inadmissible here or not a compiler host at all. **Go is the stronger candidate, reversing the obvious guess:** its toolchain carries no LLVM, and a browser-targeting `compile` + `link` plus a `fmt` hello-world's standard library measures **≈14.96 MiB gzipped** — one-seventh the C++/LLVM route's 103 MiB. Rust's only credible option, Rubrc, necessarily ships the same LLVM and supports neither external crates nor proc macros. Still research, not backlog. Full findings and measurements in `reports/Rust and Go execution on iPad - research review.md`. |

## Java — recommendation (researched 2026-08-20, not scheduled)

Java is in the long-term target and is the heaviest thing in it. The research
is recorded here so the decision does not have to be re-derived, and so nobody
starts it by accident.

**There is one credible path: CheerpJ.** It is a JVM and OpenJDK distribution
compiled to WebAssembly, running fully client-side with no server component,
and it currently supports Java 8, 11 and 17. Everything else is a dead end for
this project: TeaVM and JWebAssembly are ahead-of-time compilers that need a
JVM to do the compiling, DoppioJVM is abandoned, and anything that compiles on
a build server violates the offline-first constraint outright.

**The insight that makes an IDE possible at all:** `javac` is itself written in
Java, so it runs *under* CheerpJ. Compiling and running both happen in the
browser — this is what their JavaFiddle playground does, and its source is
public. Without that, Java would be an editor-only language here.

**The three catches, in the order they would bite:**

1. **Size.** A JVM plus `javac` plus the class library is heavier than
   everything Altitude currently ships put together. For scale: PHP nearly
   doubled the precache at 12.56 MiB, and a full OpenJDK is not in that class.
   **This is the blocking question, and it must be measured before any code is
   written** — the same time-boxed spike discipline that produced the sucrase
   and LLVM numbers.
2. **Self-hosting.** CheerpJ normally loads its runtime from the vendor's CDN.
   Altitude's zero-CDN rule means it has to be self-hosted, so the spike must
   confirm that self-hosting is permitted and establish exactly which files
   that involves. **A version that can only be loaded from a CDN cannot ship
   here at all** — this question outranks the size one, because a "no" ends it.
3. **iPad memory.** A JVM is the most memory-hungry runtime under discussion,
   and Mobile Safari kills memory-hungry tabs without warning and without a
   diagnostic. The C++ spike's lesson applies verbatim: **desktop Safari is not
   evidence.** Any Java spike has to reach a real device early, not at the end.

**Licensing:** CheerpJ is commercial software, free for open-source projects,
personal projects, and one-person companies. That covers Altitude as it stands,
but it is a dependency on someone else's licence terms rather than on a
permissive licence, which is a different kind of risk from every other runtime
here. Worth a conscious decision, not an assumption — particularly against the
M5b plan to ship on the App Store.

**Recommendation: not now.** Java should stay unscheduled until at least M4,
and when it is picked up it should start as a **measurement-only spike** in
this order — self-hosting permitted? then total size? then a real iPad? — with
each answer allowed to end the effort. Editor support (column A) via
`@codemirror/lang-java` is cheap and independent, and can land any time without
implying that execution is close behind. That is the honest sequencing: Java's
editor mode is an afternoon; Java execution is a project.


## Closed gap: Python off the main thread

Python used to run on the main thread, so an infinite loop froze the UI with
no clean way to interrupt it short of reload. **This is closed as of L6/L7,
2026-08-19/20:** Pyodide now runs in its own Web Worker, `input()` is carried
over a `SharedArrayBuffer` the Worker blocks on with `Atomics.wait`, and a run
can be stopped at any point — first with an interpreter-level interrupt that
keeps Pyodide loaded, then Worker termination if that cannot reach the code.
See `reports/L6 - Python runs off the main thread.md` and
`reports/L7 - stop button for every language.md`.

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

# Release roadmap

Everything above describes *what* Altitude is. This section describes the arc
from today's state to a shipped product.

> **For what is being worked on right now, see [`TASKS.md`](TASKS.md)** — the
> agreed tasks L1–L8, in order, with status. This section is the long-range
> plan; that file is the current one.

**Naming:** "Phase 1 / Phase 2" already mean the JavaScript and TypeScript
execution tasks and are referenced throughout `reports/`. The broader arc is
therefore numbered as **milestones (M1–M6)** to avoid renumbering history.

**Release target:** staged. **M4 ships the PWA publicly**; **M5 ships the
native App Store app.** The PWA is a real release, not a rehearsal — it is how
the product reaches users while the native shell is built.

## M1 — Execution foundation complete

*The three supported languages all execute correctly and safely.*

**✅ Done, 2026-08-20.** All three items closed:

- **Phase 1 (JavaScript)** — ✅ done. Worker sandbox, console redirect, and
  `terminate()` timeout, verified on real iPad Safari (worker termination
  included) alongside the L7 Stop-button work.
- **Phase 2 (TypeScript)** — ✅ done. Spike done first, then
  transpile-then-run on the Phase 1 Worker path. Verified on real iPad Safari
  2026-08-19; the ES-module Worker change was confirmed on device, which also
  closed that risk for Phase 1's JavaScript path.
- **Python → Worker retrofit** — ✅ done (L6, 2026-08-19). Pyodide runs in its
  own Web Worker; `input()` is carried over a `SharedArrayBuffer` the Worker
  blocks on with `Atomics.wait`, which needed the app served cross-origin
  isolated (below). Verified on real iPad Safari 2026-08-20.

**Exit met:** all three languages run in Workers and have been verified on
real iPad hardware. (Interruptibility — the other half of the original exit
line — is M2's Stop button, also done; see below.)

### The Python retrofit's decision, and how it was resolved

Moving Python into a Worker broke `input()`: it was implemented with
`window.prompt`, which does not exist in a Worker, and Python's `input()` is
synchronous — the Worker had to block until the main thread supplied a line.
Two options were weighed:

1. **`SharedArrayBuffer` + `Atomics.wait`.** Requires **cross-origin
   isolation** (`Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp`) — a hosting requirement, not
   just a code change.
2. **Synchronous `XMLHttpRequest` brokered through a Service Worker.** Avoids
   the headers, but relies on deprecated synchronous XHR and entangles
   execution with the Service Worker that already handles offline caching.

**Option 1 was chosen**, decided by the maintainer on 2026-08-19. The deciding
argument: cross-origin isolation is not a cost paid solely for Python's
`input()` — the same two headers are the entry ticket for any WASM-hosted
compiler with threads (Rubrc requires them outright), where option 2 would
have bought `input()` and nothing else, on a deprecated API. See
`reports/Rust and Go execution on iPad - research review.md` §4.

**Implemented and shipped.** `public/_headers` serves both headers on
Cloudflare Pages; `vite.config.ts` serves the same two on the dev and preview
servers. Verified on real iPad Safari: `crossOriginIsolated` is true,
`Atomics.wait` behaves as specified in a Worker, and Pyodide loads in a module
Worker within WebKit's memory limits. Served without the headers, Python still
runs off the main thread and `input()` degrades to an empty line with a
console note — the freeze fix does not depend on hosting. Full detail in
`reports/L6 - Python runs off the main thread.md`.

## M2 — Run experience hardened

*Execution stops being a demo and becomes dependable.*

**✅ Done, 2026-08-20.** M2 was blocked on M1 until Python moved into a Worker
(2026-08-19); with that dependency discharged, the Stop button landed the next
day and closed M2's exit criterion.

- **Stop button and cancellation** for every language — ✅ **done**, verified
  on real iPad Safari 2026-08-20 (L7). One control: the Run button becomes
  Stop while anything is running, for Python, JavaScript and TypeScript alike.
  Python stops in two tiers — SIGINT through Pyodide's interrupt buffer first,
  which raises `KeyboardInterrupt` and leaves the interpreter loaded, then
  Worker termination for code the eval loop cannot reach. JavaScript
  terminates its Worker outright, which costs nothing there. See
  `reports/L7 - stop button for every language.md`.
- **Configurable timeouts** — ✅ **done**, verified on real iPad Safari
  2026-08-19. The decision went to
  the minimal persistence: `src/settings/` holds a small key/value settings
  layer over `ProjectRepository`, and a Settings dialog exposes a 1–120 second
  run time limit, default 5. M3's settings *screen* was not pulled forward. The
  limit is read per run, so a change applies without a reload. It still covers
  JavaScript and TypeScript only — Python's first run has to load the
  interpreter, which would trip any sensible limit — but Python is no longer
  uninterruptible: the Stop button above ends a Python run at any point, by a
  different mechanism than the timeout.
- **Console correctness** — ✅ **done.** `NaN`/`Infinity` rendered as `null`,
  repeated references were falsely marked `[Circular]`, and `Map`/`Set`
  rendered as `{}`. Fixed, with 14 regression tests. See
  `reports/Console formatter correctness fix.md`. Python's output path was not
  touched by that fix and has still not been audited to the same standard —
  nothing in L6/L7/L8 touched it either, so this caveat still stands.
- **Diagnostics UX** — ✅ **done**, verified on real iPad Safari 2026-08-19
  (L3). Errors and tracebacks are first-class output rather than raw stderr: a
  failure renders as its own labelled block led by the exception, with frames
  as secondary rows, and Altitude's own frames hidden. See
  `reports/L3 - errors that look like errors.md`. It also uncovered that
  JavaScriptCore's `error.stack` carries no message, so a JavaScript error on
  Safari had been reaching the console with nothing saying what went wrong —
  fixed and confirmed on device.

**Exit met:** a user can always stop what they started, and output is
trustworthy.

## M3 — Product completeness for a general audience

*The largest and least glamorous milestone. Most release risk lives here.*

**Onboarding and empty states.** ✅ **Done** (L8, 2026-08-20, verified on real
iPad Safari). The seed project is a runnable `main.py` with a welcome comment,
not a `Program.cs` that Run could not execute — a first-time user can press
Run and get output immediately. Of the three empty screens this item
originally listed, two turned out to be unreachable by construction: a project
is always seeded and the last one cannot be deleted, so "no projects yet"
cannot occur; the Run console stays `hidden` until the first run, so there is
no blank console to explain, and the maintainer confirmed it should stay that
way. The third — an empty project, reached by deleting the last file — is now
a real, explained state: the file list says so, the editor shows a short
explanation naming the runnable extensions with a **Create a file** button,
and Run is disabled with a reason. The bug behind it is also gone: deleting
the last file used to invent `Untitled.cs`, the one language Altitude cannot
run; nothing is invented now, and the new-file prompt no longer defaults to
C# either. See `reports/L8 - first-run and empty states.md`.

**Project switching discoverability.** ✅ **Done.** Reported as "creating a new
project makes the previous one disappear, with no way to switch back".
**Investigated: this was not data loss.** Projects persisted correctly, the
`<select>` in the header listed all of them, switching restored content, and
everything survived a reload.

What was real is that the control did not *read* as a project switcher — a bare
`<select>` showing the current project name looks like a title rather than a
list. Two things made it worse: every new project used to be seeded with an
identical `Program.cs`, so a new project looked exactly like the old one with a
different name, reinforcing "my project was replaced" rather than "I am now
somewhere else." (That seed was fixed separately, for L8.)

Built for L1: the `<select>` is replaced by a button that shows the project
count on its face, opening a project list with per-row file counts and edit
times. Rename and delete moved onto the rows, which also fixed their being
hidden entirely below 520 px. See `reports/L1 - project switcher.md`.

**Verified on real iPad Safari, 2026-08-19.** No trace of the original
`<select>` behaviour was underneath the report — moot now, since the `<select>`
is gone. One real WebKit-only defect turned up on device and was fixed: the
project list clipped its own focus ring to a stray arc, because WebKit matches
`:focus-visible` on the focus the dialog moves to the open project, where
Chromium does not, and the list's scroll container clipped the ring drawn
outside the row. Fixed by drawing it inside the button instead.

**Settings.** There is no settings *screen* — there is now a single-setting
dialog holding the execution timeout, and the persistence layer behind it
(`src/settings/`), built for L4. Still missing: editor font size (critical on
iPad — the current size is a guess), light/dark/system theme, and tab/indent
width. These can be added to the existing store rather than needing a new one.

**Failure handling.** These paths exist in the code but have never been
deliberately tested, and each one currently fails silently or cryptically:
IndexedDB quota exceeded mid-save; Safari Private Browsing, where storage is
restricted; Safari evicting Website Data and taking every project with it; a
corrupt or half-written project record; Pyodide failing to load. Each needs a
detection path, a human-readable message, and where possible a recovery — not
a blank screen. For a general audience this is the difference between "I lost
my work" and "the app told me what happened".

**Accessibility.** VoiceOver labels and sensible focus order across the
explorer, editor, and console; Dynamic Type so text respects the system size;
contrast checked against WCAG AA. Also genuinely useful to sighted users:
today the app assumes a fixed text size on a device where users routinely
change it.

**iPad-native UX.** The device-specific behaviours a general audience will
assume work: Magic Keyboard shortcuts beyond the current Cmd+Enter (save, new
file, switch file, close console); Split View and Stage Manager, where the
window can be an arbitrary width the current layout has never been tested at;
rotation mid-edit; external displays; and the software keyboard covering the
editor, which is the classic iPad web-app failure.

**Autocomplete coverage.** ✅ **Done** (L2, verified on real iPad Safari
2026-08-19). Was C#-only, which was backwards: C# is the one language that
**cannot** execute, while Python, JavaScript and TypeScript all can. Python
now reuses `@codemirror/lang-python`'s own `globalCompletion` and
`localCompletionSource`; JavaScript and TypeScript combine
`@codemirror/lang-javascript`'s `localCompletionSource` with a hand-written
keyword/snippet/global list scoped to what the execution Worker actually
exposes. See `reports/L2 - autocomplete for the languages that run.md`.

**Performance and memory budget under WebKit.** Measured on device, not
assumed. How large a file can the editor open before typing lags? How many
files before the explorer slows? What happens when Pyodide's ~13 MiB plus a
large project exceeds what iPad Safari will hold — does it degrade or crash?
WebKit kills tabs under memory pressure, and a code editor that loses work
that way is unusable.

**Exit:** someone who is not the maintainer can use Altitude without guidance
and without hitting a dead end.

## M4 — Release readiness

*Distribution-independent. Everything here is required for **both** the PWA
and the native app, so none of it is wasted whichever ships first.*

- **Update/versioning UX** — Service Worker updates must be legible, not
  silent. Needed for the native app too: the WKWebView content updates the
  same way.
- **Data safety** — export, backup, and an honest warning about Safari
  clearing Website Data.
- **Documentation and a privacy statement** — the App Store *requires* a
  privacy policy, so this is not PWA-only work.
- **A written release checklist** — the quality bar, agreed before shipping
  rather than negotiated during.

**Exit:** the product is finished. What remains is packaging.

---

M5 is deliberately split. The two paths share everything above and differ only
in distribution. **They are not alternatives — M5a does not prevent or
diminish M5b.**

## M5a — PWA release *(no Mac required)*

- Add to Home Screen onboarding, so users get the full-screen, own-icon,
  offline experience rather than a browser tab.
- Announce it. Deployment already exists (see **Deployment** below).

**Requires:** nothing not already in hand.

**Exit:** publicly installable and usable by strangers.

## M5b — Native Swift shell and App Store *(Mac required)*

- WKWebView shell wrapping the existing web app, reused nearly entirely.
- Native storage bridge swapped in **behind `ProjectRepository`** — precisely
  the seam that has been protected from day one.
- Files.app and iCloud integration.
- StoreKit, if there is a business model by then.
- App Store submission.

**Requires:** a Mac (Xcode is macOS-only), an Apple Developer Program
membership (~$99/year), and App Review.

**What native genuinely adds** — beyond distribution:

- **Storage durability.** The strongest argument. Safari can evict Website
  Data and take every project with it; the README already warns users about
  this. Native storage is not subject to the same eviction. For a general
  audience, "the browser deleted your work" is a product-ending failure.
- Files.app and iCloud integration.
- App Store discoverability and a real payment path.

**Execution stays in the web layer** — see the architecture end-state above,
now backed by measurement: the same workload runs in 4.3 s under WKWebView's
JIT versus 22.6 s in wasm3 and 78.3 s in WAMR.

**Exit:** shipped on the App Store.

### Why the split exists

M5b depends on hardware that is not guaranteed. Making it the *only* definition
of release would mean the project cannot ship at all until a Mac appears —
gating years of work on a birthday present.

M5a costs almost nothing on top of M4, needs no Mac, no developer account and
no review, and the hosting is already running. It is not a rehearsal or a
lesser release: it is the same product, distributed differently, and it puts
Altitude in real users' hands while M5b waits on hardware. Real users are also
the only honest source of the feedback M3 is guessing at.

If a Mac never arrives, Altitude still shipped. If one does, M5b is packaging
work on a product that is already finished and already has users.

## M6 — C++ and beyond

Gated on M5 by the C++ spike's conclusion.

- Narrow follow-up spike: native ARM Clang plus a WASI sysroot, delivered via
  **On-Demand Resources** so the base app stays small.
- Then the work C++ needs regardless of compiler: a link step, multi-file
  translation units, compiler-diagnostics UX, and compile-time progress and
  cancellation. Multi-file breaks the "single file only" simplification both
  current runtimes rely on, so this pulls in a real project/build model.
- C# stays blocked. Rust and Go stay research, not backlog — but **Go now
  looks like a better fit for this milestone than C++ does.** It needs no
  sysroot, has no external linker, cross-compiles as a first-class operation,
  and its unit of compilation is already the package rather than the file. The
  one iOS obstacle it shares with C++ — a compiler driver that wants to spawn
  subprocesses — has the same known answer. See
  `reports/Rust and Go execution on iPad - research review.md` §5.

## Deployment

Altitude is hosted on **Cloudflare Pages**.

Two properties of that host matter to the roadmap and should not be forgotten:

- **Custom headers are supported** via a `_headers` file in the build output.
  This is what made M1's `SharedArrayBuffer` route viable, and `public/_headers`
  now ships `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` on
  every response — see the Python retrofit section above.
- **Git integration builds on push.** Connecting the repository to Cloudflare
  Pages means a push to the production branch triggers `npm run build` in
  Cloudflare's build container and deploys the result. Pull requests get their
  own preview URLs.

**Recommendation: switch from Direct Upload to Git integration.** Building
locally and uploading `dist/` by hand requires a computer capable of running
the build, which is exactly what is not always available. With Git
integration, a push is the deploy — which works from an iPad, and means the
deployed site always matches a known commit rather than whatever was last
uploaded from someone's machine. `dist/` is already gitignored and should stay
that way; Cloudflare builds it.

## Sequencing rules

- **M1 → M2 → M3 → M4 in order.** Each depends on the last; M2's Stop button
  was impossible before M1's Python retrofit, which is why M2 stayed blocked
  until 2026-08-19. Both are done now.
- **M3 is the one to resist cutting.** It is unglamorous and it is where a
  general-audience product is won or lost.
- **M5a and M5b are independent of each other**, and both depend only on M4.
  Ship M5a when M4 lands; M5b whenever a Mac exists. Neither blocks the other.
- **Nothing advances a milestone on Chromium evidence alone.** The Safari
  `dlopen` bug found during the C++ spike is exactly the failure mode this rule
  exists to catch.

---

# Archived: JS and TypeScript execution planning (M1 Phase 1/2)

**This section is history, kept for the scoping detail it recorded — not a
current task.** Both phases finished and were verified on real iPad Safari;
see M1 above, `TASKS.md`'s L5, and `reports/Phase 1 JavaScript execution.md` /
`reports/TypeScript execution - transpiler spike.md`. For what is being worked
on now, see `TASKS.md`.

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
