# Altitude — Project Direction

Last updated: 2026-08-18

## Mission

Altitude is an offline-first code editor for anyone who wants to write and
actually *run* code on an iPad. Not just an editor with syntax highlighting —
execution is the differentiator. Editing without running is a solved problem
on iPad already; local execution across languages is not.

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
| Python | **Done** | Pyodide, working, tested |
| JavaScript | **Phase 1 implemented, not closed** | Worker-based sandbox, console redirect, and 5s `terminate()` timeout are built and unit-tested. Runs natively in WKWebView's JS engine — no added runtime. **Still open:** real iPad Safari verification per the definition of done below, and the console-formatting defects noted in the Phase 1 report. |
| TypeScript | **Next (Phase 2)** | Transpile-then-run on top of the JS execution path. Needs a bundle-size spike before commit (see below) — do not repeat the C# mistake of adding megabytes before measuring. |
| C / C++ | **Spike done — deferred to the native shell** | In-browser LLVM/Clang measures **103 MiB compressed**, 7.5× Altitude's entire app; the incremental clang-repl variant is additionally blocked by an open Safari `dlopen` bug. A native ARM Clang emitting WASM, executed by WKWebView, wins on size, compile speed and run speed — and is proven on the App Store by a-Shell. Full findings in `reports/C++ execution on iPad - research spike.md`. Next step is a narrower spike: how small can native Clang + a WASI sysroot be via On-Demand Resources? |
| C (alone) | Cheap option, unscheduled | If plain C is ever wanted without C++, TCC compiles to WASM at ~100 KB — comfortably inside the current bundle. Noted so it is not forgotten. |
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

# Release roadmap

Everything above describes *what* Altitude is. This section describes the arc
from today's state to a shipped product.

**Naming:** "Phase 1 / Phase 2" already mean the JavaScript and TypeScript
execution tasks and are referenced throughout `reports/`. The broader arc is
therefore numbered as **milestones (M1–M6)** to avoid renumbering history.

**Release target:** staged. **M4 ships the PWA publicly**; **M5 ships the
native App Store app.** The PWA is a real release, not a rehearsal — it is how
the product reaches users while the native shell is built.

## M1 — Execution foundation complete

*The three supported languages all execute correctly and safely.*

- **Phase 1 (JavaScript)** — close it. Code is written and unit-tested; the
  outstanding work is real-iPad verification (especially Worker termination on
  an infinite loop) plus the console-formatter defects recorded in the Phase 1
  report.
- **Phase 2 (TypeScript)** — bundle-size spike first, then transpile-then-run
  on the Phase 1 Worker path.
- **Python → Worker retrofit** — the long-documented gap below. An infinite
  loop in user Python currently freezes the UI with no recovery short of
  reload. For a general audience that is a defect, not a limitation. The Worker
  pattern is now proven in `JavaScriptRuntime.ts`, so this is a port rather
  than a design problem, and it is a prerequisite for M2's Stop button.

**Exit:** all three languages run in Workers, are interruptible, and have been
verified on real iPad hardware.

### Known risk on the Python retrofit — read before starting

Moving Python into a Worker **breaks `input()`**, and this is not a small
detail: `input()` is currently implemented with `window.prompt`, which does not
exist in a Worker. Python's `input()` is synchronous, so the Worker must block
until the main thread supplies a line. There are only two known ways to do
that, and both have consequences beyond the runtime:

1. **`SharedArrayBuffer` + `Atomics.wait`.** Requires **cross-origin
   isolation** — the app must be served with `Cross-Origin-Opener-Policy:
   same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. This is a
   **hosting requirement, not a code change**. **Altitude is hosted on
   Cloudflare Pages, which supports custom headers via a `_headers` file, so
   this route is available** — it would have been blocked on a host like
   GitHub Pages, which cannot set headers at all. Zero-CDN also works in our
   favour: `require-corp` breaks cross-origin subresources, and Altitude has
   none.
2. **Synchronous `XMLHttpRequest` brokered through a Service Worker.** Avoids
   the headers, but relies on deprecated synchronous XHR and entangles
   execution with the Service Worker that already handles offline caching.

**Decide this before writing code, not during.** It is an architecture
decision with a hosting consequence, and picking option 1 late would mean
discovering at M4 that the chosen host cannot serve the app. Verify whichever
option is chosen on real iPad Safari early — `SharedArrayBuffer` availability
and Service Worker interception are both areas where WebKit has historically
differed.

## M2 — Run experience hardened

*Execution stops being a demo and becomes dependable.*

- **Stop button and cancellation** for every language — impossible for Python
  until the M1 retrofit lands.
- **Configurable timeouts** — 5,000 ms is currently hard-coded.
- **Console correctness** — the formatter defects generalise: `NaN`/`Infinity`
  rendering as `null`, false `[Circular]` on repeated references, `Map`/`Set`
  rendering as `{}`.
- **Diagnostics UX** — errors and tracebacks presented as first-class output,
  not raw stderr.

**Exit:** a user can always stop what they started, and output is trustworthy.

## M3 — Product completeness for a general audience

*The largest and least glamorous milestone. Most release risk lives here.*

**Onboarding and empty states.** Right now a first-time user lands in an app
with no project, no file, and no explanation. Every screen that can be empty
needs to say what it is and what to do next: no projects yet, no files in this
project, empty Run console. Plus a sample project on first launch so the very
first thing a user sees is code that runs. This is the difference between
"looks broken" and "looks new".

**Settings.** There is no settings screen at all. Minimum: editor font size
(critical on iPad — the current size is a guess), light/dark/system theme,
execution timeout (currently hard-coded to 5,000 ms), and tab/indent width.
Settings need their own persistence, separate from project storage.

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

**Autocomplete coverage.** Currently C#-only, which is backwards: C# is the
one language that **cannot** execute, while Python, JavaScript and TypeScript
all can. At minimum, keyword and builtin completion for the three languages
that actually run.

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
- C# stays blocked. Rust and Go stay research, not backlog.

## Deployment

Altitude is hosted on **Cloudflare Pages**.

Two properties of that host matter to the roadmap and should not be forgotten:

- **Custom headers are supported** via a `_headers` file in the build output.
  This is what makes M1's `SharedArrayBuffer` route viable — see the Python
  retrofit risk above. It is a one-file change when M1 needs it, not a
  migration.
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
  is impossible before M1's Python retrofit.
- **M3 is the one to resist cutting.** It is unglamorous and it is where a
  general-audience product is won or lost.
- **M5a and M5b are independent of each other**, and both depend only on M4.
  Ship M5a when M4 lands; M5b whenever a Mac exists. Neither blocks the other.
- **Nothing advances a milestone on Chromium evidence alone.** The Safari
  `dlopen` bug found during the C++ spike is exactly the failure mode this rule
  exists to catch.

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
