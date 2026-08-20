# L7 — Stop button for every language

**Date:** 2026-08-19 · **Milestone:** M2 (exit criterion) · **Status:** done,
verified on real iPad Safari.

## What changed

One control. The Run button becomes **Stop** while anything is running —
Python, JavaScript or TypeScript — and pressing it ends the run. Cmd/Ctrl+Enter
follows the same control rather than being a Run shortcut that does nothing
while something is running.

This is M2's exit criterion: *a user can always stop what they started.* L6 is
what made it possible; before Python moved into a Worker there was no thread to
interrupt it from.

## How Python stops: two tiers

The obvious implementation — terminate the Worker — is correct but expensive.
Terminating throws away the loaded interpreter, so the next Run pays for
megabytes of wasm again. That would make Stop something a user learns to avoid.

So Python stops in two tiers:

1. **SIGINT through Pyodide's interrupt buffer.** A one-byte
   `SharedArrayBuffer`, handed to `pyodide.setInterruptBuffer` when the Worker
   loads. Writing `2` into it makes CPython raise `KeyboardInterrupt` from its
   eval loop. The run ends, **the interpreter stays loaded**, and the next Run
   starts instantly. Measured in Chromium: a stop lands in ~50–70 ms and the
   following run takes ~60 ms with no reload.
2. **Worker termination**, 500 ms later, if the run is still going. Code
   blocked somewhere that never returns to the eval loop cannot see the signal,
   so the guarantee cannot rest on tier 1 alone. Termination discards the
   Worker; the next Run reloads Pyodide.

The guarantee is that the run stops. The interrupt is only how it stops
cheaply when it can.

Cross-origin isolation, already in place from L6, is what makes tier 1
available at all — `SharedArrayBuffer` requires it. Where it is missing, there
is no interrupt buffer and `stop()` goes straight to termination. Verified:
Stop still works, it is just the expensive kind.

### Catching `KeyboardInterrupt` inside Python

The first working version let the `KeyboardInterrupt` propagate out of
`runPythonAsync`. It worked, but the browser check showed the exception also
surfacing as an **uncaught error inside the Worker**, by way of Pyodide's own
event loop (`webloop.run_handle` → `eval_code_async`). That error reached the
main thread's `worker.onerror` and raced the run's own `failure` message. The
`failure` won every time it was observed — but had the error won, a run the
user stopped on purpose would have been reported as a **failure**, with a
traceback, in the console.

Rather than rely on winning a race, the interrupt is now caught in Python, in
the same snippet that runs the entry file:

```python
__altitude_stopped = False
try:
    exec(compile(__altitude_source, __altitude_filename, "exec"), ...)
except KeyboardInterrupt:
    __altitude_stopped = True
```

Nothing escapes into the event loop, the uncaught Worker error is gone, and the
Worker reports a dedicated `stopped` message instead of a failure that has to
be reinterpreted. A user's own `except KeyboardInterrupt` still runs first,
which is the correct semantics anyway.

Behind that, the runtime keeps a belt-and-braces rule: **once a stop has been
requested, no way the run can end is reported as an error.** The interrupt, a
Worker error raised on the way down, a hard termination — all resolve as
stopped. An error the user caused deliberately is not an error to show them.

## How JavaScript stops

`worker.terminate()`, and nothing more. A JavaScript run owns its Worker
outright — the runtime already creates one per run and terminates it on
timeout — so there is no interpreter to preserve and no reason for a graceful
tier. The existing timeout path is untouched and still reports the run time
limit by name; only a user-pressed stop reports as stopped.

## The control

`renderRunAvailability` now drives both states:

- **Idle:** `▶ Run`, disabled when the active file cannot run.
- **Running:** `■ Stop`, enabled, styled red (`data-mode="stop"`) so it reads
  as a different action rather than the same button with new words.
- **Stopping:** `■ Stopping…`, disabled — the control never looks available
  when pressing it again would do nothing.

A stopped run prints `Process stopped.` as status text, not as an error, and
the console status reads **Stopped**. No traceback, no "finished with errors".

The Settings dialog's note about Python changed again: the run time limit is
still JavaScript and TypeScript only — Python's first run has to load the
interpreter, which would trip any sensible limit — but Stop now ends a Python
run at any point, and the hint says so.

## Verification

```
npm run check   ✅
npm test        ✅ 17 files, 201 tests (+15)
npm run build   ✅
```

New tests: seven on `PythonRuntime.stop()` (no-op when idle, SIGINT written
before any termination, the Worker surviving a graceful stop, termination when
the grace period lapses, immediate termination with no interrupt buffer, a
second stop ignored, a stale signal cleared so the next run is not interrupted
at birth, the grace timer not firing at a run that ended on its own), two on
the failure-coercion rule (a Worker error during a stop reports as stopped; a
genuine `ZeroDivisionError` with no stop pending still reports as an error),
four on `JavaScriptRuntime.stop()` (including that the timeout keeps its own
message), and two on the `stopped` outcome mapping.

**Headless Chromium**, 13/13 against `vite preview`:

- the Run button becomes Stop, and is pressable;
- a sleeping Python loop stops in **53 ms** and reports *Stopped*, not an error;
- the next Python run takes **63 ms with no reload** — the interpreter survived;
- `while True: pass` stops in **67 ms** (the eval loop does see the signal);
- Python still runs after both kinds of stop;
- a JavaScript loop stops in **14 ms**, and JavaScript runs again afterwards.

**Hard-stop tier**, 5/5 against a plain static server with no isolation headers,
which removes the interrupt buffer and forces termination:

- the run stops in 25 ms and reports *Stopped*;
- Python recovers afterwards, and the console shows *Loading Python…* again —
  confirming the Worker really was terminated rather than interrupted.

**Verified on iPad Safari (2026-08-20).** Confirmed by the maintainer on the
deployed preview: Stop works for every language.

## Size

Precache: **14,210.60 → 14,213.39 KiB (+2.79 KiB, +0.02%)**.

## What this does not do

The run time limit still covers JavaScript and TypeScript only. Extending it to
Python is a separate decision — the first run's interpreter load would trip any
limit worth setting — and now a much smaller one, since Stop covers the case
the limit existed to catch.
