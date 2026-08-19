# WebKit emulation addendum — L1, L4, L5

**Date:** 2026-08-19 · **Status of all three tasks: unchanged, still 🟨 Built — awaiting iPad**

This is an addendum to `reports/L1 - project switcher.md` and
`reports/L4 and L5 - run time limit and TypeScript execution.md`, not a
replacement for either. It records extra automated testing done after those
reports, using Playwright's real WebKit engine (the same rendering engine
Safari uses) with an iPad device descriptor, in place of the Chromium used
for the original verification.

**This is not iPad Safari, and does not close either report's open item.**
Playwright's WebKit build runs on Linux: no iOS process model, no iOS JIT
policy or memory limits, and — as this session found directly — its handling
of Service Workers under `context.setOffline()` is not fully reliable. It
narrows risk. It does not substitute for the maintainer's own device.
`TASKS.md` still records all three tasks as 🟨, and nothing here changes that.

## What was tested and what came back

**L1 (project switcher).** The full 31-check suite from
`reports/L1 - project switcher.md`, unchanged, run against WebKit with an
iPad viewport, touch events and iPad user agent. **All 31 pass.** This
covers the two risks that report named as likeliest to differ on WebKit —
`showModal()` on the project dialog, and touch interaction with the row
actions — and both behaved identically to Chromium.

**L4 + L5 (settings, TypeScript execution).** The 15-check suite from the
L4/L5 report, same treatment. Five checks initially failed. All five traced
to one cause in the *test*, not the app: the test cleared the editor with
select-all-then-delete before typing, and that step silently no-ops under
Playwright's WebKit-on-Linux build — confirmed with targeted diagnostics
showing the keydown events and `getSelection()` length are correct, so the
selection itself is fine; something in how WebKit-on-Linux applies the
deletion to CodeMirror's editable surface is not. `navigator.platform`
reporting `Linux x86_64` under an iPad user agent — a combination no real
device produces — points at the same root cause. The test was simplified to
type into an already-empty new file instead of clearing one, which sidesteps
the issue rather than working around it. **After that fix, all 15 checks
pass**, including the two items the L4/L5 report flagged as needing a device
check: `worker.terminate()` under the configured timeout, and the
`worker.format: "es"` build change.

**Offline precaching (the open item from the L5 report).** The L5 report
asked whether the TypeScript transpiler's lazily loaded chunk actually works
once precached and the device is offline. Two approaches were tried:

1. *Go offline, reload, run a `.ts` file.* This worked cleanly on Chromium —
   all 4 checks pass, including a Python run for comparison, once a bug in
   the test itself was fixed (see below). On WebKit, the reload while offline
   failed both times it was attempted, with `WebKit encountered an internal
   error` — a Playwright driver-level error, not a page timeout or an
   application error. That specific error string, together with Chromium
   succeeding on the identical test, points at a Playwright-WebKit-on-Linux
   tooling limitation with offline navigation rather than a defect in
   Altitude. It could not be resolved from this environment.
2. *Inspect Cache Storage directly*, without navigating — the same lookup
   the Service Worker's fetch handler performs, minus the reload. This
   avoids the failing code path entirely and **passes identically on both
   engines**: the Service Worker installs, the precache holds all 21
   entries, and the transpiler chunk (`typescriptTranspile-*.js`) is
   fetchable from cache with a 200 status and a 201,048-byte body — matching
   the built asset size exactly, so it is a real cached response, not a
   stub. `pyodide.asm.wasm` and the JavaScript Worker chunk are confirmed
   precached the same way.

So: the *precaching* half of the open item is now confirmed on WebKit, not
just Chromium. The *actual offline reload* half remains unverified on
WebKit, for tooling reasons rather than any finding against the app, and is
still something only a real device — with the network genuinely off — can
settle.

## A bug in the verification script, caught and fixed

While chasing the above, `verify-offline.mjs`'s Python check failed
consistently on Chromium, in a way that looked like a real regression at
first. It was not: the script ran a TypeScript file and then a Python file
back to back without clearing the console between them, so the Python run's
completion check (`waitForFunction` watching for `.console-status` to read
"Finished" or "Error") could resolve immediately on the *TypeScript* run's
leftover "Finished" text, before the Python run had done anything — and the
output was then read too early. Confirmed by instrumenting the exact same
sequence: the real final state was "Loading Python…", not the value the
premature check read. Fixed by clearing the console before the second run,
matching what the existing `verify.mjs` suite already did between runs. This
is recorded because it is exactly the kind of false result this addendum
exists to avoid presenting uncritically.

## Net effect

WebKit-emulated coverage now matches the Chromium coverage in both existing
reports, plus confirms the precache contents relevant to L5's open item, on
WebKit specifically. The one thing that stayed out of reach is driving an
actual offline page reload under Playwright's WebKit build — which is a
statement about this testing environment, not about Altitude.

**All three tasks remain 🟨 Built — awaiting iPad.** This addendum narrows
what real-device verification needs to focus on — it does not shorten the
checklists in the original two reports, and none of it substitutes for the
maintainer confirming on physical iPad Safari.
