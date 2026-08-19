# L3 — Errors that look like errors

**Date:** 2026-08-19 · **Task:** L3 · **Milestone:** M2 · **Status:** Built — awaiting iPad

## The task

A failed run was styled almost exactly like a successful one: `appendConsole`
wrapped every chunk in a `<span>` whose only distinction was colour, so a
traceback and a `print` differed by hue alone. And the traceback itself arrived
as one undifferentiated block — the wall of text the task names.

## What was built

**Failures are now a block, not a line.** A run failure renders as a bordered,
tinted region with an **Error** badge and the exception set at full strength:

```
┌ ERROR  ZeroDivisionError: division by zero
│ crash.py, line 9
│ print(compute())
│ crash.py, line 6, in compute
│ return divide(1, 0)
```

The badge matters as much as the tint: the failure is announced in a word, so
the signal does not depend on distinguishing red from grey.

**The exception leads.** This is the substantive change. Python prints the
exception *last*, after the frames — the one line the user needs is the one
they have to scroll to find. JavaScript prints it *first*, buried above the
frames. `parseErrorReport` extracts it either way and the view puts it at the
top, with the frames beneath as secondary detail.

**Frames are rows, not text.** Each frame carries its location and, for Python,
the echoed source and caret line, kept pre-formatted so the carets still line
up under the expression they point at.

The parser lives in `src/runtime/errorReport.ts` and is pure, so all of the
above is unit-tested without a browser.

### The rule the parser follows

**Nothing is discarded.** Any line it does not recognise is kept, in order, as
a text line. A parser that silently ate output would be worse than no parser.
Chained exceptions, `[Previous line repeated 996 more times]`, and anything
else unexpected all survive.

The one apparent exception is Altitude's own frames — and even those are
*flagged*, not deleted (`internal: true`), with the view choosing not to draw
them. If a failure is genuinely inside Altitude there are no user frames, and
`presentableFrames` falls back to showing the internal ones rather than an
empty trace.

## Three things found by looking at real output

None of these were visible from reading the code; each came from running a
real failure and reading what actually appeared.

**1. Half of a Python traceback was Altitude's own machinery.** A three-line
user error rendered six frames, of which the first three were
`/lib/python314.zip/_pyodide/_base.py` twice and `<exec>` — Pyodide's harness
and the wrapper this app compiles user source into. Now hidden. The stdlib is
deliberately *not* hidden: a frame in `json/decoder.py` is the user's problem
to read, and its path is the only thing identifying it.

**2. JavaScript stacks leaked the build.** The last frame was
`f (http://127.0.0.1:4173/assets/javascriptWorker-1WlJ2H2i.js:1:2584)` — our
Worker bundle, complete with content hash. User code is compiled with
`//# sourceURL=<entry path>`, so its frames carry a bare project path and
anything with a URL scheme is ours by construction.

**3. The heading scrolled out of view.** The console scrolls to the bottom
after every write, so a tall traceback pushed the exception message — the
entire point of the block — off the top. `revealFailure` now scrolls the
heading back into view once the closing line is written. Caught by asserting
it, not by eyeballing a screenshot.

A long trace also folds its middle behind a **Show N more frames** control,
keeping three frames at each end. Python already collapses recursive repeats
itself, so this is for the ordinary deep-call case rather than `RecursionError`.

## The Safari finding

Running the suite against WebKit turned up a defect that predates this task and
would have shipped unnoticed.

**Safari's `error.stack` contains no message and, for `Function`-constructed
code, no locations either.** Measured on both engines, same code:

| | `error.stack` |
|---|---|
| Chromium (V8) | `TypeError: Cannot read properties of undefined (reading 'x')\n    at inner (crash.js:3:37)\n    at outer (crash.js:4:27)…` |
| WebKit (JSC) | `inner@\nouter@\n@\nanonymous@\n@` |

V8 puts `Name: message` at the top of the stack; JavaScriptCore starts at the
first frame and drops the message entirely. Since `formatJavaScriptError`
returned `error.stack` verbatim, **a JavaScript error on iPad Safari reached
the console with nothing saying what went wrong** — no message, no line
numbers, just function names. That was true before L3; L3 only made it
obvious, because the headline had nowhere to come from.

Two fixes:

- `formatJavaScriptError` now guarantees the message is present, prepending
  `Name: message` when the stack does not already begin with it. V8 output is
  untouched, so nothing is duplicated.
- The parser reads JavaScriptCore's `name@url:line:column` form as well as
  V8's `at name (url:line:column)`, normalising both to the same rendering. A
  frame with a name but no location keeps the name; a frame with neither is
  hidden as noise.

The guard against a false match is worth noting: a bare `/(.*)@(\S*)/` would
treat "could not reach support@example.com" as a stack frame. A line only
counts as a JavaScriptCore frame if it contains no whitespace, or names one of
JSC's pseudo-functions (`global code`, `eval code`, `module code`). Tested.

## One fix carried over from L5

With the headline now prominent, a TypeScript compile error read
`broken.ts: Error transforming broken.ts: Unexpected token (1:10)` — sucrase's
message already names the file, and `compileErrorMessage` was prefixing it
again. Now `broken.ts: Unexpected token (1:10)`.

## Verification

`npm run check`, `npm test` (14 files, **162 tests**, 31 new) and
`npm run build` all pass. Bundle cost: precache 14,198.97 → 14,204.09 KiB
(+5.1 KiB).

Twenty end-to-end checks in `verify-l3.mjs`, passing on **both** Chromium and
WebKit with an iPad device descriptor:

- A Python failure renders as its own block with a visual boundary, and leads
  with the exception although Python prints it last.
- The block is labelled in words, not only by colour.
- Only the user's frames are shown; neither `_pyodide` nor `<exec>` nor the
  Worker bundle appears.
- Each frame carries its source line.
- The exception is still on screen when the run ends.
- A JavaScript stack leads with the exception — including on WebKit, where the
  raw stack has no message at all.
- Streamed stderr is distinguishable from ordinary output.
- A compile error reads as a headline with no invented frames.
- A deep trace folds its middle and expands on request.
- A successful run renders no failure block.

The L1, L4/L5 and precache suites were re-run on both engines afterwards; all
eight combinations pass, so nothing regressed.

### What iPad verification still has to establish

1. **That the Safari message fix works on a real device.** The WebKit finding
   above was measured through Playwright's WebKit on Linux. The fix does not
   depend on that environment, but the behaviour it corrects is Safari's, so
   it is the thing to check first: run a `.js` file that throws and confirm the
   console names the error.
2. **Legibility of the block on a real screen** — the tint is subtle by design
   and iPad brightness and colour handling differ from a desktop panel.
3. **The Show more frames control as a touch target** at 32 px tall.
4. **Long single-line messages** wrapping inside the block at Slide Over width.
