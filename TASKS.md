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
| **L1** | A project switcher you can actually find | ⬜ Not started |
| **L2** | Autocomplete for the languages that actually run | ⬜ Not started |
| **L3** | Errors that look like errors | ⬜ Not started |
| **L4** | Adjustable run time limit | ⬜ Not started |
| **L5** | TypeScript execution | ⬜ Not started |
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

**Status:** ⬜ Not started · Milestone M3 · No decision needed · iPad check: yes

**What it means.** Make it obvious that you have more than one project and that
you can move between them.

**The problem.** Reported as "creating a new project makes the previous one
disappear." Investigated — **nothing is lost.** Projects persist, the `<select>`
in the header lists them all, switching restores content, and it survives a
reload; verified in Chromium at four widths down to Slide Over (320 px). The
real problem is that the control does not *look* like a switcher: it is a bare
`<select>` showing the current project name, so it reads as a title. Nothing
signals that other projects exist.

**Where.** `.project-select` in `src/components/App.ts` (markup ~line 105,
`renderProjects()` ~line 372), styles in `src/styles.css` ~line 169.

**Done when.** A user can tell at a glance that they have several projects, and
can switch without knowing to tap a dropdown. Consider a project list view
rather than a `<select>`. **Not yet reproduced on Safari** — check on device
whether there is also a real WebKit `<select>` problem underneath.

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

**Status:** ⬜ Not started · Milestone M2 · No decision needed · iPad check: light

**What it means.** When code fails, it should be obvious at a glance.

**The problem.** A Python traceback and a successful `print` are styled almost
identically apart from colour, and a JavaScript stack arrives as one
undifferentiated block. Errors are the main output of a failed run and deserve
first-class presentation.

**Where.** `appendConsole()` in `src/components/App.ts` and the
`.console-output-*` rules in `src/styles.css` (~line 654).

**Done when.** Failures are visually distinct from ordinary output, and a
multi-line traceback or stack is readable rather than a wall of text.

## L4 — Adjustable run time limit

**Status:** ⬜ Not started · Milestone M2 · **One small decision** · iPad check: light

**What it means.** Right now JavaScript is force-stopped after exactly 5
seconds, always. That should be changeable.

**The problem.** `JAVASCRIPT_EXECUTION_TIMEOUT_MS = 5_000` is hard-coded at
`src/runtime/JavaScriptRuntime.ts:3`. Five seconds is arbitrary — too short for
a real computation, too long for a typo'd infinite loop.

**The decision.** "Adjustable" needs somewhere to store the setting, and the
settings screen belongs to M3. Either build a minimal settings store as part of
this task, or accept the coupling and pull a small piece of M3 forward.
**Recommendation:** build the minimal store here — a tiny key/value setting
saved like snippets are. It is needed for every later setting anyway.

**Done when.** The limit is user-changeable, persists across restarts, and has
a sensible default.

## L5 — TypeScript execution

**Status:** ⬜ Not started · Milestone M1 / Phase 2 · No decision needed · iPad check: yes

**What it means.** You can already *write* TypeScript in Altitude. This makes it
**run**.

**The approach**, as set out in `PROJECT DIRECTION.md`: strip the types, then
hand the resulting JavaScript to the Worker path that already exists from Phase
1. **Do not build a second execution path.**

⚠️ **Measure before committing.** The direction document requires a bundle-size
spike *before* any integration code: report the real cost to the production
build and the Workbox precache total. If pulling the full `typescript` package
is too heavy, evaluate lighter transpile-only options first. This is the same
discipline that stopped the C# work — see `reports/C# Roslyn WASM spike.md` for
why it exists.

**Done when.** A `.ts` file runs, the size cost is reported, and no separate
execution path was created.

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
