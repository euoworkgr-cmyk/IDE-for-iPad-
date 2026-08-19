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
| **L2** | Autocomplete for the languages that actually run | ⬜ Not started |
| **L3** | Errors that look like errors | 🟨 Built — awaiting iPad |
| **L4** | Adjustable run time limit | ✅ Done |
| **L5** | TypeScript execution | ✅ Done |
| **L6** | Python runs off the main thread | ⬜ Not started — ⚠️ needs a decision first |
| **L7** | Stop button for every language | ⬜ Not started — depends on L6 |
| **L8** | First-run welcome experience | 🟨 Partly done |

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

**Status:** ⬜ Not started · Milestone M3 · No decision needed · iPad check: light

**What it means.** Code suggestions should work for Python, JavaScript and
TypeScript.

**The problem.** `src/autocomplete/completionProvider.ts` offers **C# keywords
and `Console.*` only** — and C# is the one language Altitude cannot execute. So
the only language with completion support is the only one that does not run.

**Done when.** Keyword and builtin completion works for Python, JavaScript and
TypeScript. Keeping the C# list is fine; it just must not be the only one.

## L3 — Errors that look like errors

**Status:** 🟨 Built — awaiting iPad · Milestone M2 · No decision needed · iPad check: light

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

**Still to check on device.** Above all that the Safari message fix holds on
real hardware — run a `.js` file that throws and confirm the console names the
error. Also block legibility on an iPad screen, the fold control as a touch
target, and long messages wrapping at Slide Over width.

**Done when.** Failures are visually distinct from ordinary output, and a
multi-line traceback or stack is readable rather than a wall of text.
*(Both achieved; awaiting iPad.)*

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

**Status:** ⬜ Not started · Milestone M1 · ⚠️ **Needs a decision first** · iPad check: yes

**What it means.** Today, if your Python code loops forever, the whole app
freezes and the only escape is reloading the page — losing your place. Python
should run in the background like JavaScript already does.

**Why it matters most.** This is the keystone. It fixes the freeze, and it is
what makes **L7** possible at all.

⚠️ **The decision, before any code.** Moving Python into a Worker **breaks
`input()`**, because it is built on `window.prompt`, which does not exist in a
Worker, and Python's `input()` must block until a line arrives. Two options:

1. **`SharedArrayBuffer` + `Atomics.wait`** — needs `COOP`/`COEP` response
   headers. **Available:** hosting is Cloudflare Pages, which supports a
   `_headers` file. Zero-CDN helps here — `require-corp` breaks cross-origin
   subresources and Altitude has none.
2. **Synchronous `XMLHttpRequest` brokered through the Service Worker** — no
   headers needed, but relies on deprecated sync XHR and entangles execution
   with the Service Worker already used for offline caching.

**This is an architecture decision with a hosting consequence. The maintainer
decides it before implementation starts, not during.**

**Done when.** Python runs in a Worker, `input()` still works, and an infinite
loop no longer freezes the interface.

## L7 — Stop button for every language

**Status:** ⬜ Not started · Milestone M2 · **Blocked by L6** · iPad check: yes

**What it means.** One button that reliably stops whatever is running.

**Why it is blocked.** A main-thread Pyodide run cannot be interrupted — there
is no separate thread to interrupt it from. JavaScript already stops correctly
via `worker.terminate()`. So this task is really "bring Python up to where
JavaScript already is, then expose one consistent control for both." **L6 must
land first.**

**Done when.** A user can always stop what they started, in any language. This
is M2's exit criterion.

## L8 — First-run welcome experience

**Status:** 🟨 Partly done · Milestone M3 · No decision needed · iPad check: light

**Already done.** New projects are seeded with a runnable `main.py` instead of a
`Program.cs` that Run could not execute, so a first-time user can press Run and
get output immediately. Verified end to end in a browser.

**Still outstanding.** Beyond that one file, a new user gets no explanation.
Every screen that can be empty should say what it is and what to do next: no
projects yet, no files in this project, empty Run console.

**Done when.** Someone opening Altitude for the first time understands what they
are looking at without being told.

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
