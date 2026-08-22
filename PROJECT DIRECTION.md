# Altitude — Project Direction

Last updated: 2026-08-21 (HTML and CSS closed all three columns, verified on
real iPad Safari; column C redefined for markup as rendering)

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
- **C — Code execution / compilation, where applicable.** What "execution"
  means is per-language, and two of the twelve do not compile anything.
  **HTML and CSS's column C is rendering** (revised 2026-08-21): a page has no
  interpreter and no exit status, but a preview is exactly the thing Altitude
  promises — write something on an iPad and then see it do what you wrote. It
  is delivered as a sandboxed offline render of the project's own files; see
  `reports/HTML and CSS - preview as column C.md`. This supersedes the earlier
  position that C did not apply to markup, which answered "is there an
  interpreter?" when the question is "can you see what you wrote?". SQL's
  equivalent of "execution" is running a query against a local database
  engine, not compiling — worth keeping distinct when that work is scoped.

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
| HTML | ✅ Done (`@codemirror/lang-html`) | ✅ Done (`htmlCompletionSource`, plus CSS and JavaScript completion inside `<style>` and `<script>`) | ✅ Done — rendering, not execution: a sandboxed offline preview with project stylesheets and scripts inlined, live until closed, **+16.63 KiB precache**. **Verified on real iPad Safari 2026-08-21** |
| CSS | ✅ Done (`@codemirror/lang-css`) | ✅ Done (`cssCompletionSource` — properties, values, at-rules) | ✅ Done — previewed through the page that links it, or a generated page of ordinary elements when nothing does. **Verified on real iPad Safari 2026-08-21** |
| C# | ✅ Done (`@replit/codemirror-lang-csharp`) | ✅ Done (keywords + `Console.*`) | ✅ Done — Roslyn on the .NET WebAssembly runtime in a Web Worker, one per run, compiler diagnostics with line and column, Stop-able. **+11.50 MiB precache (+41.2%)**, inside the 15 MB budget with 3.50 MiB to spare. **Verified on real iPad Safari 2026-08-20** |
| C++ | 🟡 Registered but falls back to plain text — no real mode | ⬜ Not started | 🔬 Researched, deferred to native shell — see below |
| C | 🟡 Registered but falls back to plain text — no real mode | ⬜ Not started | 🔬 Cheap option identified (TCC, ~100 KB), unscheduled |
| Go | ⬜ Not started — no `LanguageId` entry yet | ⬜ Not started | 🔬 Research, now costed — see below |
| Java | ✅ Done (`@codemirror/lang-java`), verified on iPad | ✅ Done (keywords, `java.lang`/`java.util` types, `System.out.*`), verified on iPad | 🔬 Researched, **not scheduled** — CheerpJ is the only path; see below |
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
real iPad Safari the same day (PR #22, merged into `main`). **C# followed the
same day** — Roslyn on the .NET WebAssembly runtime in a dedicated Web Worker,
built by CI since the deploy pipeline has no .NET, at +11.50 MiB precache
(+41.2%) and inside the maintainer's 15 MB budget — verified on real iPad
Safari 2026-08-20 (PR #29, merged into `main`). Of the twelve target
languages, **seven now run**; C++, C, Go, and Java do not. **Java gained
columns A and B on 2026-08-20 with no execution behind them**, verified on
real iPad Safari the same day (PR #31, merged into `main`) — which is the
sequencing its recommendation below argues for: the editor mode and
completions cost an afternoon, while the runtime is a project. That makes
Java the only language with A and B but no C — the state C# occupied until
execution landed — and its Run button is disabled and says so.
Column C's per-language detail — the C++/C# spikes, the Rust/Go research, and
the Java recommendation — lives in the **Language execution roadmap** section
below and in `reports/`; this table summarizes rather than replaces it.

**HTML and CSS closed columns B and C on 2026-08-21** and were verified on real
iPad Safari the same day (PR #33, merged into `main`). That makes **nine of the
twelve target languages complete on all three columns** — Python, JavaScript,
TypeScript, SQL, PHP, C#, HTML and CSS, with Java the one language holding A
and B without a C. Only C, C++ and Go remain short of the editor columns. Their column C is a preview rather than an interpreter — see the
revised definition above — and it is the only runtime that is not a Web Worker,
for the only reason the standing constraint admits: a Worker has no DOM, and a
document has to be rendered by a browsing context. The isolation argument is
kept by other means — a frame sandboxed *without* `allow-same-origin`, so the
previewed page runs on an opaque origin with no reach into Altitude's storage
or DOM, and is destroyed when the preview closes.

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

## Remote compilation — a scoped exception (agreed 2026-08-20)

Offline-first is Altitude's identity, not a preference, and the default answer
to "can we call a server for this" stays no. But five languages in the
long-term target — **C, C++, C#, Go, Rust** — carry a compiler whose *local*
in-browser toolchain is heavy enough that shipping it to every user, in the
base app, fails the offline-first constraint in a different way: it makes the
whole app worse in order to make one language possible. The C++ spike
measured this at ~103 MiB for the full LLVM route against a 13.66 MiB app at
the time; C#'s spike measured ~29 MB for Roslyn. Waiting on the native Swift
shell for all five is the clean answer, but the shell is not close, and these
are important, widely-used languages the roadmap should not simply leave dark
for years.

**The exception: where a language's local toolchain has been measured and
found too large to ship, that language's compile-and-run may go through a
remote build service instead of not shipping at all.** This is deliberately
narrow — it is not a change to how Python, JavaScript, TypeScript, SQL or PHP
work, and it is not a general escape hatch from offline-first. It exists only
for the specific set of languages whose local cost has already been measured
and rejected.

**Per-language status against this exception, stated honestly rather than
applied uniformly:**

- **C++** is the clearest candidate — a completed spike with a measured,
  rejected local cost (see the language execution roadmap below) and nothing
  else pending.
- **C# no longer qualifies, and has now shipped locally** (updated
  2026-08-20). It was listed here as the most likely of the five to use this
  exception. Spike v2 measured a local path at 11.49 MiB inside the
  maintainer's budget, and it was built and verified on real iPad Safari the
  same day — a working local runtime, not a remote one. A language leaves
  this exception the moment a local path is measured, accepted, and shipped;
  that is the exception working as intended, not a loophole closing.
- **Rust**'s only credible local option (Rubrc) ships the same LLVM weight as
  C++ and supports neither external crates nor proc macros — a strong
  candidate too.
- **Go is the exception to the exception.** Its own research measured a local
  path at **≈14.96 MiB gzipped** — smaller than SQL's precache addition, and
  well inside what PHP alone cost. Go should still be tried **locally first**;
  remote is a fallback if that number does not hold up once actually
  integrated, not the default for Go from day one.
- **C (alone)** doesn't need this — TCC is ~100 KB locally. This exception is
  about C bundled with C++'s full toolchain, not plain C by itself.

**What "remote compilation" must look like here, so it does not quietly become
the easy answer everywhere:**

1. **Same client interface, swappable backend.** The C++ spike already named
   this shape (its rejected option 5's stub, kept only as a pattern). A
   runtime built this way can have its remote backend replaced by a local one
   later — behind the native shell, or behind a smaller local toolchain if one
   turns up — without touching call sites.
2. **Never silent.** A language running this way must say so in the UI before
   the user hits Run — a clearly different, visibly-network-dependent state,
   never indistinguishable from Python or JavaScript's fully-local Run.
3. **Fails loudly offline, not softly.** With no connection, Run for that
   language reports "this language needs a connection to run" — it does not
   hang, retry silently, or pretend to work.
4. **Does not touch the offline core.** Python, JavaScript, TypeScript, SQL and
   PHP stay fully local, always. This exception cannot be allowed to creep
   toward them because a server is easier than a spike.
5. **Requires a real build service, not yet designed.** This is new
   infrastructure Altitude does not have today — hosting, an API, a security
   model for arbitrary user code reaching a server Altitude runs. None of that
   exists yet; this section records the *decision* to allow it, not a plan to
   build it. That plan is a task of its own when one of these languages is
   actually scheduled.

This does not relax the standing constraint below for any language *not* named
here, and it does not make remote compilation the default posture for a
language whose local cost has not already been measured and rejected.

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
| C / C++ | **Spike done — deferred to the native shell** | In-browser LLVM/Clang measures **103 MiB compressed**, 7.5× Altitude's entire app; the incremental clang-repl variant is additionally blocked by an open Safari `dlopen` bug. A native ARM Clang emitting WASM, executed by WKWebView, wins on size, compile speed and run speed — and is proven on the App Store by a-Shell. Full findings in `reports/C++ execution on iPad - research spike.md`. Next step is a narrower spike: how small can native Clang + a WASI sysroot be via On-Demand Resources? **Also now a candidate for the remote-compilation exception** (agreed 2026-08-20, see above) as a way to ship this sooner than the native shell — the local cost here is exactly the kind this exception was written for. |
| C (alone) | Cheap option, unscheduled | If plain C is ever wanted without C++, TCC compiles to WASM at ~100 KB — comfortably inside the current bundle. Noted so it is not forgotten. **Confirmed the better option 2026-08-20:** incoming research proposed `wasm-clang` (binji) as the "lightest" C route, but it measures **57.55 MiB raw / ≈18.6 MiB gzipped** — 2.06× Altitude's entire precache — it compiles C++ rather than only C, and its author calls it alpha demoware. TCC is roughly 600× smaller for the same slot. See `reports/C, C++ and C# on iPad - research review.md` §1. |
| C# | **Done, verified on real iPad Safari 2026-08-20** | Spike v1's ~29 MB and `TypeLoadException` are superseded. **Spike v2 (2026-08-20) measured 11.49 MiB across 42 files and ran real C# with LINQ in Chromium** — warm compile 18 ms, runtime boot 267 ms. Three changes got it there: dropping Blazor for the non-Blazor `wasmbrowser` host (Altitude's UI is CodeMirror, it needs .NET only as an engine), `SatelliteResourceLanguages=en` (13 locales of Roslyn diagnostics were 6.36 MiB on their own, and alone moved the verdict from 'maybe' to 'yes'), and using the already-shipped runtime assemblies as Roslyn's `MetadataReference`s instead of a second reference pack — which is also the likeliest explanation for v1's `TypeLoadException`. **Now integrated:** Roslyn in a Web Worker, one per run, with compiler diagnostics carrying line and column, at **+11.50 MiB precache (+41.2%)** — inside the maintainer's 15 MB budget with 3.50 MiB to spare, a limit the CI workflow now enforces. Built by CI (`.github/workflows/build-csharp-runtime.yml`) from `runtime-csharp/`, because the deploy pipeline has Node and no .NET. Both integration traps from the spike are closed: `dll` was added to the Workbox glob (38 of the 42 assets are `.dll`, and Workbox silently skips what it misses), and the build-pipeline question was decided. **Confirmed working on real iPad Safari** by the maintainer 2026-08-20. See `reports/C# execution - Roslyn spike v2.md` and `reports/C# execution - Roslyn in a Worker.md`. |
| Rust, Go | **Research — a path exists, and Go is now costed** | "No known path" is no longer accurate. Both have one option of the right shape — the compiler itself compiled to WASM — and everything else (remote build hosts, iSH, UTM, TinyGo Playground, GopherJS, wasm-pack) is either inadmissible here or not a compiler host at all. **Go is the stronger candidate, reversing the obvious guess:** its toolchain carries no LLVM, and a browser-targeting `compile` + `link` plus a `fmt` hello-world's standard library measures **≈14.96 MiB gzipped** — one-seventh the C++/LLVM route's 103 MiB. Rust's only credible option, Rubrc, necessarily ships the same LLVM and supports neither external crates nor proc macros. Still research, not backlog. Full findings and measurements in `reports/Rust and Go execution on iPad - research review.md`. **The remote-compilation exception (agreed 2026-08-20, see above) applies asymmetrically here: Rust's local cost is LLVM-sized and a strong candidate for it; Go's ≈14.96 MiB local path is small enough that it should be tried locally first, with remote only as a fallback.** |

## Java — recommendation (researched 2026-08-20, not scheduled)

Java is in the long-term target and is the heaviest thing in it. The research
is recorded here so the decision does not have to be re-derived, and so nobody
starts it by accident.

**There is one credible path: CheerpJ.** It is a JVM and OpenJDK distribution
compiled to WebAssembly, running fully client-side with no server component,
and it currently supports Java 8, 11 and 17. Everything else is a dead end for
this project: TeaVM and JWebAssembly are ahead-of-time compilers that need a
JVM to do the compiling, DoppioJVM is abandoned, and anything that compiles on
a build server violates the offline-first constraint outright. (Java is not on
the remote-compilation exception list above — CheerpJ already gives it a fully
local path, so there is nothing here for that exception to solve.)

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

**Columns A and B landed 2026-08-20, and the estimate held.** `.java` files
get the CodeMirror Java mode plus hand-written completions (keywords,
`java.lang` and `java.util` types, `System.out.*` members) and seven snippets.
The measured cost is **+43.55 KiB precache (+0.11%)** — a rounding error next
to what the runtime would be, which is exactly the point of decoupling them.
**Verified on real iPad Safari the same day** (PR #31, merged into `main`).
**Nothing in this recommendation changes**: the spike order stays
self-hosting, then size, then a real device, and Java stays unscheduled. The
one thing that did change is that a `.java` file is now pleasant to write in
while none of those questions have been answered.


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
  bundle or doesn't ship — **except the scoped remote-compilation exception**
  for C, C++, C#, Go and Rust (see the language coverage section above),
  which applies only where a language's local toolchain has already been
  measured and found too large to ship.
- IndexedDB writes go through promise-chained serialization
  (`SaveCoordinator`) — no unguarded concurrent writes.
- Any new code-execution path needs defensive path/input validation
  matching the pattern in `PythonRuntime.ts`'s `normalizeProjectPath`.
- No feature claim is "done" until verified on real iPad Safari hardware —
  headless Chromium/simulator testing is necessary but not sufficient.
- **A candidate runtime is screened on the memory ceiling it *declares*, not
  just the memory it uses** (added 2026-08-20). iPadOS kills tabs through
  jetsam far more aggressively than desktop Safari — reported in a 316–522 MB
  "highwater" band — and iOS Safari rejects a `WebAssembly.Memory` with a
  2048 MB *maximum* while accepting the same instance at 256 MB. A runtime
  that reserves generously can therefore die on device while barely using
  anything. Prefer an explicit, conservative maximum and a loud "toolchain
  too large for this device" failure over a silent tab reload. Related: the
  per-run-Worker pattern already used by JavaScript, SQL and PHP returns the
  whole linear-memory allocation to the OS and avoids the heap fragmentation
  that is a likelier proximate cause of a jetsam kill than any one large
  allocation — a second, independent reason for a design L7 adopted for
  cancellation. Python's Worker is the deliberate exception, kept alive
  because Pyodide's boot cost would otherwise land on every run. See
  `reports/C, C++ and C# on iPad - research review.md` §3–4.

---

# Release roadmap

Everything above describes *what* Altitude is. This section describes the arc
from today's state to a shipped product.

> **For what is being worked on right now, see [`TASKS.md`](TASKS.md)** — the
> agreed tasks L1–L8, then the post-L8 work, and now the **release preparation
> list R1–R8**, which is this section's M3 and M4 open items turned into tasks
> in the order they should be done. That file is the current plan; this section
> is the long-range one.

**Language work has stopped for the release (agreed 2026-08-22).** Nine of the
twelve target languages satisfy all three A/B/C columns, which the maintainer
judged enough to ship on; C, C++ and Go stay on the roadmap for after M5a.
Everything between here and the release is M3 and M4.

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

**Settings.** ✅ **Done** (R1, 2026-08-22) for everything this item named,
though not as a settings *screen*: the L4 dialog gained the other three
settings rather than being replaced by a screen, and they went into the L4
store as predicted. **Appearance** is System, Light or Dark — the whole app,
including the editor and its syntax colours, is themed through custom
properties, and System follows `prefers-color-scheme` live. **Editor text
size** is 11–24 px, default 15, which is what the theme previously hard-coded.
**Indent width** is 2, 4 or 8 spaces, and fixed a real defect on the way past:
`tabSize` was 4 and the status bar said "Spaces: 4", but `indentUnit` was never
configured, so Tab and every language mode's auto-indent inserted CodeMirror's
default of two. See `reports/R1 - settings that fit the device.md`.

**Failure handling.** ✅ **Done** (R2, 2026-08-22). All five paths now have a
detection path and a message that says what to do.

The decision this milestone left open — what to do when storage is unusable —
was taken by the maintainer: **the app opens anyway and says so.**
`ProjectRepository` falls back to an in-memory store rather than throwing, so
editing, running every language and export all work and nothing is kept, with a
banner that cannot be dismissed saying exactly that. A session that keeps
nothing is worth more than a session that will not start, provided the user is
told. The fallback lives inside `ProjectRepository`, which stays the only
interface to project storage.

Classification is symptom-based rather than browser-mode-based: "Private
Browsing" cannot be detected reliably across Safari versions, but a write that
did not happen can be observed, and that is what the user is told. Stored
records are validated on read, so one corrupt record no longer makes every good
project unreachable. Eviction detection is best-effort and stays quiet rather
than risk a false alarm, because its own marker is often cleared in the same
sweep.

**Verified on real iPad Safari 2026-08-22, which found a real gap in the
premise.** A genuine Private Browsing tab raised no warning at all: current
Safari keeps IndexedDB fully working within a private session — confirmed
against WebKit's own tracking-prevention documentation — and only discards it,
unannounced, when the tab closes. Nothing throws, so the error-triggered
session-only mode above has nothing to react to, and `EvictionWatch` cannot
catch it after the fact either, since its own marker is wiped in the same
private session. A proactive quota-based heuristic was prototyped and
confirmed viable against the maintainer's own device — but deliberately not
shipped: Private Browsing is a choice the user already made, not a failure to
recover from, and the maintainer chose documenting it over detecting it. The
Settings dialog and README both carry a permanent, unconditional note instead.
See `reports/R2 - storage failures that explain themselves.md`, including its
addendum. For a general audience this is the difference between "I lost
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
- C# is no longer blocked — spike v2 cleared it for the PWA at 11.49 MiB (see
  the roadmap table above), so it is not an M6 item. Rust and Go stay research, not backlog — but **Go now
  looks like a better fit for this milestone than C++ does.** It needs no
  sysroot, has no external linker, cross-compiles as a first-class operation,
  and its unit of compilation is already the package rather than the file. The
  one iOS obstacle it shares with C++ — a compiler driver that wants to spawn
  subprocesses — has the same known answer. See
  `reports/Rust and Go execution on iPad - research review.md` §5.
- **Remote compilation as a general-purpose fallback stays rejected** — it was
  proposed once by outside research on 2026-08-20 as something that "costs
  almost nothing now," with no scoping to which languages or why, and that
  version was rejected: an unscoped remote-build option is exactly how
  offline-first erodes one convenient exception at a time. **Superseded the
  same day** by a deliberately narrow version: see "Remote compilation — a
  scoped exception" earlier in this document. The difference is scope, not the
  underlying risk — the new exception applies only to the five languages whose
  local cost has already been measured and rejected (C, C++, C#, Go, Rust),
  requires the UI to disclose it, and fails loudly rather than silently
  offline. It still does not apply to lazily-fetched toolchain packs for any
  language, and it still does not touch Python, JavaScript, TypeScript, SQL or
  PHP. See `reports/C, C++ and C# on iPad - research review.md` §5 for the
  original rejection this refines.

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
