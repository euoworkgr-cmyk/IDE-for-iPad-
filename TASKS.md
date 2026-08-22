# Active task list — L1 to L8

**This is the current working list.** It is the answer to "what are we doing
next?" Work the tasks **in order**, L1 first. When a task is finished, update
its status here in the same commit as the code.

`PROJECT DIRECTION.md` remains the authority on long-term direction and the
M1–M6 milestones. This file is the short-term plan: the specific tasks chosen
for this round of work, in the order they should be done.

Agreed: 2026-08-19.

## Status at a glance

| # | Task | Status |
|---|---|---|
| **L1** | A project switcher you can actually find | ✅ Done |
| **L2** | Autocomplete for the languages that actually run | ✅ Done |
| **L3** | Errors that look like errors | ✅ Done |
| **L4** | Adjustable run time limit | ✅ Done |
| **L5** | TypeScript execution | ✅ Done |
| **L6** | Python runs off the main thread | ✅ Done |
| **L7** | Stop button for every language | ✅ Done |
| **L8** | First-run welcome experience | ✅ Done |

### Status meanings

- ⬜ **Not started**
- 🟦 **In progress**
- 🟨 **Built — awaiting iPad** — code written, automated tests pass, but the
  real-device check has not happened. **This is not "done".**
- ✅ **Done** — built *and* verified on real iPad Safari.

The project rule is that nothing counts as finished until it is checked on a
real iPad. Most of these can be built without one; only the final check needs
the device. A task sitting at 🟨 is waiting on the maintainer, not on code.

---

## L1 — A project switcher you can actually find

**Status:** ✅ Done · Milestone M3 · No decision needed · iPad check: passed 2026-08-19

**What it means.** Make it obvious that you have more than one project and that
you can move between them.

**The problem.** Reported as "creating a new project makes the previous one
disappear." Investigated — **nothing is lost.** Projects persist, the `<select>`
in the header listed them all, switching restored content, and it survived a
reload; verified in Chromium at four widths down to Slide Over (320 px). The
real problem was that the control did not *look* like a switcher: it was a bare
`<select>` showing the current project name, so it read as a title. Nothing
signalled that other projects existed.

**What was built.** The `<select>` is gone. The header now holds a button that
states the project count on its face — "Sensor logger / **3 projects** ▾" — so
the question "are my other projects still there?" is answered without any
interaction. Tapping it opens a project list: each row shows the project name,
its file count and when it was last edited, with the open one marked by a dot,
an outline and the words "open now".

Rename and delete moved onto the rows. They were header buttons that the
stylesheet hid below 520 px, so **on a narrow iPad they were unreachable
entirely**; they now work at every width, and act on the row rather than on
whichever project happens to be open.

Full write-up in `reports/L1 - project switcher.md`.

**Verified on device (2026-08-19).** Checked on real iPad Safari at
`ide-for-ipad.pages.dev`: the switcher, the count, opening and switching all
work. One real WebKit-only defect turned up in the process and was fixed —
the project list clipped its own focus ring to a stray arc on the open
project's row, because the ring draws outside the button by default and the
list is a scroll container that clips anything drawn past a row's edge.
Chromium never showed it: WebKit matches `:focus-visible` on the focus this
dialog moves to the open project when it opens, Chromium does not, so there
was nothing to clip in Chromium's case. Fixed by drawing the ring inside the
button instead, guarded by an end-to-end check confirmed to fail against the
old outward ring. See `reports/L1 - project switcher.md` for the fix and
`PROJECT DIRECTION.md` for whether a real WebKit `<select>` difference was
ever underneath the original report — moot now that the `<select>` is gone.

**Done when.** A user can tell at a glance that they have several projects, and
can switch without knowing to tap a dropdown. Consider a project list view
rather than a `<select>`. *(All achieved and confirmed on device.)*

## L2 — Autocomplete for the languages that actually run

**Status:** ✅ Done · Milestone M3 · No decision needed · iPad check: passed 2026-08-19

**What it means.** Code suggestions should work for Python, JavaScript and
TypeScript.

**The problem.** `src/autocomplete/completionProvider.ts` offered **C# keywords
and `Console.*` only** — and C# is the one language Altitude cannot execute. So
the only language with completion support was the only one that does not run.

**Root cause.** `EditorAdapter.ts` wires the provider in with
`autocompletion({ override: [...] })`. `override` replaces CodeMirror's normal
language-data completion gathering entirely, so the rich completion sources
`@codemirror/lang-python` and `@codemirror/lang-javascript` already ship
(builtins, keywords, local-scope names) were installed but never consulted —
only the C#-only function ran, and it returned `null` for every other
language.

**What was built.** The provider now dispatches on the current language.
Python reuses the language package's own `globalCompletion` (builtins and
keywords) and `localCompletionSource` (locally-defined names) directly, merged
by hand since `override` also takes over the merging CodeMirror normally does
across multiple sources for one language. JavaScript and TypeScript combine
the package's `localCompletionSource` with a hand-written keyword/snippet/
global list — `@codemirror/lang-javascript` doesn't export its keyword list,
and the global list is scoped to what the execution Worker actually exposes
(`console`, `Math`, `JSON`, `Promise`, etc.) — no `document` or `window`, since
JS/TS code never runs in a DOM (see `javascriptWorker.ts`). TypeScript adds its
own keywords (`interface`, `type`, `enum`, ...) on top of the JavaScript set.
`console.` still completes to `log`/`error`, matching what the Worker actually
overrides. The C# path is unchanged and still only fires for `.cs` files.

Covered by `src/autocomplete/completionProvider.test.ts`.

**Bundle-size note.** Importing `@codemirror/lang-python` and
`@codemirror/lang-javascript` statically (needed to reuse their completion
sources) merges what were previously separate lazy chunks into the main
bundle — Vite reports `INEFFECTIVE_DYNAMIC_IMPORT` for both. Since the PWA
precaches every chunk regardless, the net effect on total precache size is
negligible: 14204.09 → 14207.22 KiB (+3.13 KiB). The cost is to
time-to-interactive on first load rather than to what ships.

**Verified on device (2026-08-19).** Confirmed working on real iPad Safari by
the maintainer.

**Done when.** Keyword and builtin completion works for Python, JavaScript and
TypeScript. Keeping the C# list is fine; it just must not be the only one.
*(Both achieved and confirmed on device.)*

## L3 — Errors that look like errors

**Status:** ✅ Done · Milestone M2 · No decision needed · iPad check: passed 2026-08-19

**What it means.** When code fails, it should be obvious at a glance.

**The problem.** A Python traceback and a successful `print` were styled almost
identically apart from colour, and a JavaScript stack arrived as one
undifferentiated block. Errors are the main output of a failed run and deserve
first-class presentation.

**What was built.** A failure now renders as a bordered, tinted block with an
**Error** badge — announced in a word, not only in colour — and the exception
set at full strength above the frames. The exception leads whichever runtime
produced it: Python prints it last, JavaScript first, and `errorReport.ts`
extracts it either way. Frames are rows carrying the location and, for Python,
the echoed source with its caret line still aligned. A long trace folds its
middle behind a control.

Altitude's own frames are hidden — a three-line Python error was rendering six
frames, half of them the Pyodide harness and this app's wrapper, and JavaScript
stacks were leaking the hashed Worker bundle path. They are flagged rather than
deleted, so a failure genuinely inside Altitude still shows something.

**A Safari defect found on the way.** `error.stack` in JavaScriptCore contains
no message at all — it starts at the first frame — so a JavaScript error on
iPad reached the console with nothing saying what went wrong. That predates
this task; L3 surfaced it. `formatJavaScriptError` now guarantees the message,
and the parser reads JSC's `name@url:line:col` form as well as V8's.

Full write-up in `reports/L3 - errors that look like errors.md`.

**Verified on device (2026-08-19).** Confirmed working on real iPad Safari by
the maintainer, including the JSC `error.stack` fix.

**Done when.** Failures are visually distinct from ordinary output, and a
multi-line traceback or stack is readable rather than a wall of text.
*(Both achieved and confirmed on device.)*

## L4 — Adjustable run time limit

**Status:** ✅ Done · Milestone M2 · Decision taken · iPad check: passed 2026-08-19

**What it means.** Right now JavaScript is force-stopped after exactly 5
seconds, always. That should be changeable.

**The problem.** `JAVASCRIPT_EXECUTION_TIMEOUT_MS = 5_000` is hard-coded at
`src/runtime/JavaScriptRuntime.ts:3`. Five seconds is arbitrary — too short for
a real computation, too long for a typo'd infinite loop.

**The decision — taken as recommended.** A minimal key/value settings store was
built here rather than pulling M3's settings screen forward. It lives in
`src/settings/`, and persists through `ProjectRepository.getSetting` /
`saveSetting` over the `settings` object store that already held the session —
so IndexedDB access stays behind the repository.

**What was built.** A Settings dialog behind the ⚙ button in the header. The
limit defaults to 5 seconds, accepts 1 to 120, persists across restarts, and is
read per run, so a change applies to the next run without a reload. Python is
deliberately not covered — it still runs on the main thread and cannot be
interrupted (L6), and the dialog says so.

**Verified on device (2026-08-19).** Checked on real iPad Safari at
`ide-for-ipad.pages.dev`: the limit is changeable, persists, and stops a
runaway run. `worker.terminate()` behaves on WebKit and the number field is
usable with the software keyboard.

**Done when.** The limit is user-changeable, persists across restarts, and has
a sensible default. *(All three confirmed on device.)*

## L5 — TypeScript execution

**Status:** ✅ Done · Milestone M1 / Phase 2 · No decision needed · iPad check: passed 2026-08-19

**What it means.** You can already *write* TypeScript in Altitude. This makes it
**run**.

**The approach**, as set out in `PROJECT DIRECTION.md`: strip the types, then
hand the resulting JavaScript to the Worker path that already exists from Phase
1. **Do not build a second execution path.**

**The spike was done first**, per the direction document, and is written up in
`reports/TypeScript execution - transpiler spike.md`. Measured, gzipped where
applicable: sucrase 46.0 KiB, `typescript` 5.9 995.7 KiB, esbuild-wasm 11.8 MiB
of wasm, `@swc/wasm-web` 22.2 MiB. **Sucrase was chosen.** Real cost to the
build: **+203.58 KiB precache (+1.46%)**, 13,989.09 → 14,192.67 KiB.

**What was built.** `.ts` and `.mts` files run. Types are stripped inside the
existing Worker and the result is executed by the same code that runs a `.js`
file — no second runtime, Worker, timeout or output formatter. `.tsx` and
`.cts` stay unrunnable, on the same reasoning that already excludes `.cjs`.
Known gap: sucrase drops `namespace` blocks rather than compiling them.

**Verified on device (2026-08-19).** Checked on real iPad Safari at
`ide-for-ipad.pages.dev`: a `.ts` file compiles and runs, and JavaScript still
runs, which is what confirms the `worker.format: "es"` build change is safe on
WebKit.

**Done when.** A `.ts` file runs, the size cost is reported, and no separate
execution path was created. *(All three achieved and confirmed on device.)*

## L6 — Python runs off the main thread

**Status:** ✅ Done · Milestone M1 · Decision taken · iPad check: passed 2026-08-19

**What it means.** Today, if your Python code loops forever, the whole app
freezes and the only escape is reloading the page — losing your place. Python
should run in the background like JavaScript already does.

**Why it matters most.** This is the keystone. It fixes the freeze, and it is
what makes **L7** possible at all.

**The decision — option 1, taken by the maintainer on 2026-08-19.**
`SharedArrayBuffer` + `Atomics.wait`, with the `COOP`/`COEP` headers that
requires, rather than the synchronous-`XMLHttpRequest` alternative. The
deciding argument was that the headers are not a cost paid only for Python's
`input()`: they are also what any wasm-hosted compiler needs — Rubrc requires
them outright — while option 2 would have bought `input()` and nothing else,
on a deprecated API. See
`reports/Rust and Go execution on iPad - research review.md` §4.

**What was built.** Pyodide runs in `src/runtime/pythonWorker.ts`, a dedicated
Web Worker. `input()` still reaches `window.prompt`, by way of a shared-memory
channel: the Worker blocks in `Atomics.wait` while the main thread — free,
which is the point — collects the line and writes it back, chunked so an
answer longer than the buffer stays correct rather than truncated. The two
headers ship in `public/_headers` for Cloudflare Pages and in `vite.config.ts`
for dev and preview, so a local check matches production.

Served without those headers, Python **still** runs off the main thread and
`input()` degrades to an empty line with a console note — the freeze fix does
not depend on hosting. Unlike the JavaScript Worker, the Python one is kept
alive between runs: reloading megabytes of wasm per Run would be a worse
regression than the one being fixed.

Full write-up in `reports/L6 - Python runs off the main thread.md`.

**Size.** Precache 14,207.22 → 14,210.60 KiB (+3.38 KiB, +0.02%).

**Verified in headless Chromium**, 10 checks: the page is cross-origin
isolated, Python runs and prints from the Worker, the next animation frame
arrives in 0.6 ms while Python sits inside `time.sleep(3)`, `input()` returns
the typed line twice including `Grüße 🚀`, and `while True: pass` leaves the
interface responsive with dialogs still opening.

**Verified on device (2026-08-19).** Confirmed on real iPad Safari by the
maintainer: Python execution and `input()` both work correctly through the
`SharedArrayBuffer` channel — the isolation headers are reaching Mobile
Safari, `Atomics.wait` behaves as specified, and Pyodide loads in a module
Worker within WebKit's memory limits.

**Done when.** Python runs in a Worker, `input()` still works, and an infinite
loop no longer freezes the interface. *(All three achieved and confirmed on
device.)*

## L7 — Stop button for every language

**Status:** ✅ Done · Milestone M2 (exit criterion) · No decision needed · iPad check: passed 2026-08-20

**What it means.** One button that reliably stops whatever is running.

**What was built.** The Run button becomes **Stop** while anything is running —
Python, JavaScript and TypeScript alike — and Cmd/Ctrl+Enter follows the same
control instead of being a Run shortcut that does nothing mid-run. A stopped
run prints `Process stopped.` and reads **Stopped**, never an error.

**Python stops in two tiers.** First SIGINT through Pyodide's interrupt buffer,
which raises `KeyboardInterrupt` from CPython's eval loop and **leaves the
interpreter loaded** — a stop that costs nothing, with the next run starting in
milliseconds. Then, 500 ms later if the run is still going, Worker termination,
because code blocked where the eval loop cannot reach never sees the signal.
The guarantee is that the run stops; the interrupt is only how it stops cheaply
when it can. Without cross-origin isolation there is no interrupt buffer and
Stop goes straight to termination — verified, it still works.

The `KeyboardInterrupt` is caught inside Python rather than left to propagate:
letting it escape put an uncaught error into Pyodide's event loop that raced
the run's own result, and had it won, a deliberate stop would have been shown
as a failure. Behind that, any non-ok ending of a run that was asked to stop is
reported as stopped.

**JavaScript stops by terminating its Worker**, and needs nothing more — it
already owns one per run. The run time limit keeps its own message; only a
user-pressed stop reports as stopped.

Full write-up in `reports/L7 - stop button for every language.md`.

**Size.** Precache 14,210.60 → 14,213.39 KiB (+2.79 KiB).

**Verified in headless Chromium**, 13 checks: the button switches to Stop, a
sleeping Python loop stops in 53 ms with the interpreter surviving (next run
63 ms, no reload), `while True: pass` stops in 67 ms, a JavaScript loop stops
in 14 ms, and every language runs again afterwards. The hard-stop tier was
forced separately by serving without the isolation headers — 5 further checks,
including the console showing *Loading Python…* again, which is what proves the
Worker was really terminated.

**Verified on device (2026-08-20).** Confirmed on real iPad Safari by the
maintainer: Stop works for every language.

**Done when.** A user can always stop what they started, in any language. This
is M2's exit criterion. *(Achieved and confirmed on device.)*

## L8 — First-run welcome experience

**Status:** ✅ Done · Milestone M3 · No decision needed · iPad check: passed 2026-08-20

**What it means.** Someone opening Altitude for the first time should
understand what they are looking at.

**Already done earlier.** New projects are seeded with a runnable `main.py`
instead of a `Program.cs` that Run could not execute, so a first-time user can
press Run and get output immediately. **This is unchanged** — only invented
*replacement* files were removed, see below.

**What the remaining work turned out to be.** This file previously listed three
empty screens as outstanding. Reading the code first showed **two of them could
not happen**:

- *No projects* — `App.start()` seeds one when storage has none, and the last
  project cannot be deleted. Unreachable.
- *Empty Run console* — the panel is `hidden` until the first run, so there is
  no blank console to explain. Confirmed with the maintainer that it should
  stay that way: it should not sit there idle at the start, and Run is
  prominent enough already.

**What was built.**

1. **An empty project is now a real state.** Deleting the last file used to
   invent `Untitled.cs` — a C# file, the one language Altitude cannot run.
   That fallback is gone from both `deleteFile()` and `ensureActiveFile()`.
   Nothing is created to fill the gap; instead the file list reads "No files
   yet — use ＋ to create one", and the editor pane shows a centred empty state
   naming the runnable extensions with a **Create a file** button. The tab and
   status bar read *No file* and Run is disabled with "Create a file to run
   something". It survives a reload and a project switch.
2. **The new-file prompt no longer defaults to C#.** It pre-filled
   `Untitled.cs` with an `src/App.cs` example. There is now **no default name
   and no default extension**, and the example is `src/helpers.py`. The
   `uniqueFileName` helper existed only to number that default and went with
   it.
3. **The console is unchanged**, by decision — including the existing **×**
   that hides it when it is in the way, verified still working.

A defect found by the browser check on the way: the empty state originally
shared a grid cell with the editor, and CodeMirror's content div intercepted
pointer events, so **Create a file** could not be clicked at all. The editor
host is now hidden outright when no file is open — better than a `z-index`,
since a blank editor was taking keystrokes that had nowhere to be saved.

Full write-up in `reports/L8 - first-run and empty states.md`.

**Size.** Precache 14,213.39 → 14,214.88 KiB (+1.49 KiB).

**Verified in headless Chromium**, 20 checks on the empty states and prompts
plus 9 on the edges (exporting an empty project, a second project's own seed,
switching back, rename/delete as no-ops with no file open).

**Verified on device (2026-08-20).** Confirmed on real iPad Safari by the
maintainer.

**Done when.** Someone opening Altitude for the first time understands what they
are looking at without being told. *(Achieved and confirmed on device.)*

---

## After L1–L8

The numbered list above is finished. Work agreed since then is recorded here in
the same way.

### Export: one file or the whole project

**Status:** ✅ Done · No decision needed · iPad check: passed 2026-08-20

Export was all-or-nothing: the button always zipped the entire project, which
is rarely what someone wants while looking at one file. Checked first — the zip
never contained anything but the project's own files, so the complaint was
about scope, not stray contents.

The button (now *Export*, not *Export ZIP*) opens a choice: **this file only**,
saved as itself rather than wrapped in an archive, or **the whole project** as
the same zip as before. It also commits the editor's current content first, so
an edit made a second earlier is in the export. An empty project says there is
nothing to export instead of offering two ways to download nothing.

`exportProject.ts` was split into pure builders plus one DOM-touching save
step, which is what made the 10 new unit tests possible. Verified in headless
Chromium, 16 checks. Precache 14,214.88 → 14,219.21 KiB (+4.33 KiB).

Full write-up in `reports/Export - one file or the whole project.md`.

### SQL: editor mode, autocomplete, and execution

**Status:** ✅ Done · No decision needed · iPad check: passed 2026-08-20

SQL was the one language in the long-term target whose "execution" means
running a query against an engine rather than compiling. All three columns
land together: `.sql` files get the CodeMirror SQL mode in its **SQLite**
dialect, keyword and builtin-function completion, and a Run button that
executes the file statement by statement against **SQLite compiled to
WebAssembly**, in its own Web Worker.

Each run gets a **fresh in-memory database**. That is deliberate and is the
main decision here: it matches what Run already means for every other language,
and it keeps persistent storage behind `ProjectRepository` rather than opening
a second, parallel store in OPFS. Persistence — and the `.db` export that
follows from it — is left as its own scoping job, not a side effect of getting
`SELECT` to work.

Statements are split by asking SQLite's own `sqlite3_complete()`, so a
semicolon inside a string, a comment, or a `CREATE TRIGGER ... BEGIN ... END;`
body does not split anything. Results print as aligned tables, capped at 200
rows and 60 characters per cell, with `NULL` spelled out and BLOBs summarized.
Errors name the failing line. Stop and the run time limit work exactly as they
do for JavaScript, because `workerExecution.ts` — extracted from
`JavaScriptRuntime.ts` in this change — is now shared by both.

**Size.** Precache 14,219.21 → 15,294.83 KiB (**+1,075.62 KiB, +7.56%**),
of which 864.75 KiB is `sqlite3.wasm` itself. A further 237 KiB of the
package's unused entry points is trimmed by a build plugin that fails loudly if
the package layout changes.

**Verified in headless Chromium**, 30 checks: multi-statement scripts, the row
cap at 5,000 rows, trigger bodies and string literals surviving the splitter,
an error naming the right line of three, Stop ending a runaway recursive CTE in
35 ms, JavaScript still running after the shared-helper extraction, and no
page-level console errors on any run.

Full write-up in `reports/SQL execution - SQLite in the browser.md`.

**Verified on device (2026-08-20).** Confirmed by the maintainer on real iPad
Safari: SQL is fully integrated — editor mode, autocomplete, and execution all
work as built. PR #20 merged into `main`.

### PHP: editor mode, autocomplete, and execution

**Status:** ✅ Done · No decision needed · iPad check: passed 2026-08-20

The sixth language Altitude can run, and the first whose runtime is bigger than
the rest of the app. `.php` and `.phtml` files get the CodeMirror PHP mode,
keyword and builtin completion, and a Run button that executes them through
**PHP 8.3.11 compiled to WebAssembly**, in its own Web Worker.

**The build was chosen by measurement**, not preference: `php-wasm`
(seanmorris) at **12.56 MiB** over `@php-wasm/web` at **18.31 MiB** for the
same PHP version — the same size-first reasoning that picked sucrase in L5.
Only one of the package's twelve PHP versions ships: `scripts/copy-php-assets.mjs`
copies one build into `public/php/`, exactly as `copy-pyodide-assets.mjs`
already does, because importing the package's own entry point would have
emitted every version.

**The whole project is mounted**, not just the open file — `require 'helpers.php'`
is ordinary PHP — and the entry runs as a real file, so `__FILE__`, a relative
`require`, and the filename in a parse error all name what the user wrote.
Nothing persists between runs; the IndexedDB-backed filesystem the package
offers is switched off, keeping storage behind `ProjectRepository`.

**The run time limit grew a second phase.** A 12.56 MiB wasm takes longer to
load than any limit a user would set, so loading has its own 120-second budget
and the user's limit starts when PHP begins running their code. Python's answer
to this was to be exempt from the limit entirely; PHP is limited, just not for
its own download.

**A real bug was found before the device, not on it.** The build carries
Emscripten's HTML5 library, which initializes `[0, document, window]`
unguarded — a `ReferenceError` in any Worker, before a line of PHP runs. Fixed
by declaring both identifiers as `undefined` so `typeof` guards still take the
Worker branch. The alternative was running PHP on the main thread, which would
have broken the standing constraint and made Stop impossible.

**Size.** Precache 15,294.83 → 28,614.98 KiB (**+13,320.15 KiB, +87.1%**) —
by far the largest addition so far, about 3.2 MiB gzipped over the wire. It
also forced `maximumFileSizeToCacheInBytes` from 11 to 16 MiB: Workbox
*silently skips* oversized files, so the old value would have built cleanly and
simply not run PHP offline.

**Known gap:** `exit(3)` reads as a finished run, because `pib_run` does not
return PHP's exit status. Fatal errors, parse errors and uncaught exceptions do
report as errors, which is the case that matters in an editor. A browser check
pins the current behaviour so it cannot change silently.

**Verified in headless Chromium**, 40 checks: hello world reporting PHP 8.3.11,
inline HTML and `<?= ?>` short echo, an uncaught exception naming its file and
line, a parse error, `require` across two project files, the 8.x standard
library (`json_encode`, `preg_match`, arrow functions, constructor promotion),
Stop ending `while (true)` in 39 ms, and JavaScript, SQL and Python all still
running. First run 746 ms, later runs 0.8–1.5 s.

Full write-up in `reports/PHP execution - php-wasm in a Worker.md`.

**Verified on device (2026-08-20).** Confirmed by the maintainer on real iPad
Safari — this was the check that mattered most, since a 12.56 MiB wasm module
per run is exactly what Mobile Safari kills tabs over, and it held up. PR #22
merged into `main`.

### Java: editor mode and autocomplete (no execution)

**Status:** ✅ Done (columns A and B only — C stays unscheduled by design) ·
No decision needed · iPad check: passed 2026-08-20

Columns **A and B only**, deliberately. `PROJECT DIRECTION.md`'s Java
recommendation argues that the editor mode is an afternoon while the runtime is
a project, and that the two should not be coupled — this is the afternoon.

`.java` files get `@codemirror/lang-java`, hand-written completions (53
keywords, 27 `java.lang`/`java.util` types, and the `System.` /
`System.out.` member chains — Java's answer to C#'s `Console.`), and seven
snippets including `main` and `sout`. `@codemirror/lang-java` exports no
completion source, so as with PHP and C# the list is written by hand.

**Nothing about execution changed.** Run stays disabled on a `.java` file and
still says which languages it can run.

That leaves Java as the **only** language with A and B but no C — a state C#
occupied until it shipped execution on 2026-08-20. Worth being deliberate
about, because L2 exists precisely to stop the editor advertising what it
cannot do. L2's actual failure was narrower than "completions without
execution": C# was the *only* language with completions **and** the only one
that could not run, so completion existed exclusively where execution did
not. That is not this. Seven languages now both complete and run; Java adds
an eighth that completes, and its Run button is disabled and says why. The
signal reads as "this language is not runnable yet", not as "this is the
language to use".

**A defect found on the way, from my own earlier work:** the snippet dialog's
language picker still listed only the pre-SQL set, so **SQL and PHP snippets
could not be created at all** after those languages shipped. Fixed here along
with adding Java, since it is the same list.

**Size.** Precache 40,392.20 → 40,435.75 KiB (**+43.55 KiB, +0.11%**),
measured against `main` after C# execution landed. `lang-java` stays a lazy
chunk — unlike Python and SQL, whose completion sources force a static import
into the main bundle. For scale, the runtime this deliberately does not ship
would be measured in tens of MiB; the editor mode is 43 KiB.

**Verified in headless Chromium**, 24 checks: Java highlighting distinct from
the plain-text fallback (34 styled tokens, keywords and strings styled
differently), keyword and type completion, `System.` offering `out` but not
`println` while `System.out.` and `System.err.` offer `println`, Tab accepting
a completion, the `sout` and `main` snippets expanding, Run disabled with an
honest title, the snippet picker listing every language, and a `.java` file
surviving a reload. Re-verified against `main` after C# execution landed.

**Verified on device (2026-08-20).** Confirmed by the maintainer on real iPad
Safari: highlighting, autocomplete, and snippets all work, and Run stays
correctly disabled with an honest title. Columns A and B only — column C
(execution) remains researched and deliberately unscheduled, per the Java
recommendation in `PROJECT DIRECTION.md`. PR #31, merged into `main`.

### HTML and CSS: autocomplete and preview (columns B and C)

**Status:** ✅ Done · Decision recorded below · iPad check: passed 2026-08-21

Column A had shipped long ago; column B was never started; column C was
documented as *not applicable*, on the grounds that markup has no interpreter.
That reasoning was answering the wrong question. Altitude's promise is that you
can write something on an iPad and then **see it do what you wrote** — for a
page, that is rendering it. So **column C for HTML and CSS is a preview**, and
`PROJECT DIRECTION.md` has been amended to say so rather than quietly
contradicted.

**Column B** comes from the language packages themselves — `cssCompletionSource`
and `htmlCompletionSource`, both tree-aware, so no list had to be written by
hand as PHP's, Java's and C#'s were. A `.html` file is three languages: the
provider finds the nested top node (`StyleSheet`, `Script`) and dispatches to
the source that owns the cursor, so completing inside a `<style>` block offers
`color`, not `<section>`. The JavaScript branch there offers `document` and
`window` — deliberately *not* offered in a `.js` file, which runs in a Worker
with no DOM.

**Column C** builds one self-contained document (every project-relative
stylesheet and script inlined, references resolved like a browser and then
validated so `../../` cannot leave the project, external URLs dropped with a
note) and renders it in a frame sandboxed **without** `allow-same-origin` — an
opaque origin with no reach into Altitude's storage or DOM. The page's
`console.log` and uncaught errors are routed to the Run console. Running a
`.css` file previews the page that links it, or a generated page of ordinary
elements when nothing does. A preview stays live until closed: Run reads
**Close**, and the pane has its own **Reload**, because the loop for markup is
edit-look-edit.

This is the only runtime that is not a Web Worker, for the only reason the
standing constraint admits — a Worker has no DOM. The cost is stated rather
than hidden: a runaway script *inside a previewed page* shares the main thread
and cannot be stopped.

**Size.** Precache 40,435.75 → 40,452.38 KiB (**+16.63 KiB, +0.04%**), and two
lazy chunks fold into the main bundle because the completion sources are
imported statically, the same trade Python and SQL already make. The cheapest
column C in the project by three orders of magnitude.

**Verified in headless Chromium, 25 checks** — inlining, the sandbox's opaque
origin, console and error routing, Reload, Close, the CSS host page and the
generated fallback, completions in all three languages of an HTML file, and
JavaScript execution still unaffected. Two defects were found that way and
fixed: an inlined `defer` script ran in `<head>` instead of after the body
(that attribute only means something on a script that is fetched), and the
preview painted *underneath* CodeMirror on a narrow screen, because CodeMirror
is positioned and the preview pane was not.

**Verified on device (2026-08-21).** Confirmed working on real iPad Safari by
the maintainer, on the branch's Cloudflare preview deployment before merging —
the preview pane, the completions, and the rest of the app all behaved. That
makes HTML and CSS the eighth and ninth languages complete on all three
columns, and the first whose column C is a render rather than a run. PR #33,
merged into `main`.

Full write-up in `reports/HTML and CSS - preview as column C.md`.

---

## Keeping this file honest

- Update the status table **and** the task's own status line in the **same
  commit** as the code. A task marked done with no commit behind it is worse
  than no list.
- Do not mark a task ✅ **Done** on automated tests alone. Chromium is necessary
  and not sufficient; WebKit is where the surprises live. Use 🟨 **Built —
  awaiting iPad** and say so plainly.
- If a task turns out to be bigger than it looks, split it and renumber the
  remainder rather than quietly widening it.
- Substantial work gets a report in `reports/`, per `CLAUDE.md`.
