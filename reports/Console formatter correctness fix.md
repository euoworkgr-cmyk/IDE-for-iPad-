# Console Formatter Correctness Fix

Date: 2026-08-18
Milestone: M2 (run experience hardened) — partial
Scope: `src/runtime/javascriptOutput.ts` only

## Why

A review of the Phase 1 JavaScript execution work found that the console
formatter misreported several common values. The Phase 1 report lists
"deterministic text formatting" as a delivered feature; it was deterministic
but, in these cases, deterministically wrong.

All three defects traced to one root cause: the formatter was built on
`JSON.stringify`. JSON has no representation for `NaN`, `Infinity`,
`undefined`, `Map`, or `Set`, so `JSON.stringify` silently substitutes `null`
or drops the value entirely. That is acceptable for data interchange and
unacceptable for a debugging console.

## Defects fixed

Each was reproduced against the real module before the fix.

| Input | Before | After |
|---|---|---|
| `console.log(NaN)` | `null` | `NaN` |
| `console.log(Infinity)` | `null` | `Infinity` |
| `console.log({x: NaN})` | `{"x":null}` | `{"x":NaN}` |
| `console.log({x: s, y: s})` | `{"x":{"a":1},"y":"[Circular]"}` | `{"x":{"a":1},"y":{"a":1}}` |
| `console.log(new Map([[1,2]]))` | `{}` | `Map(1) {1 => 2}` |
| `console.log(new Set([1,2]))` | `{}` | `Set(2) {1, 2}` |
| `console.log({a: undefined})` | `{}` | `{"a":undefined}` |
| `console.log({value: 7n})` | `{"value":"7n"}` | `{"value":7n}` |

**The worst of these was `NaN` → `null`.** Logging `NaN` is routine when
debugging arithmetic, and reporting it as `null` tells the user they have a
missing value when they actually have a numeric error — it points debugging in
the wrong direction.

**The false `[Circular]` was the subtlest.** The old code tracked every object
it had ever seen in a `WeakSet` and never released entries when leaving a
subtree. A value referenced twice from the same parent — an ordinary diamond,
not a cycle — was reported as circular, hiding real data. The fix tracks only
the objects on the current path from the root, adding on entry and removing on
exit, so genuine cycles are still caught while repeated references print
normally.

`bigint` was also inconsistent rather than merely wrong: `7n` at top level but
`"7n"` when nested, which reads as the *string* `"7n"`. Both now render `7n`.

## Deliberate changes beyond the defect list

Two behaviours changed that were not strictly defects, noted so they are not
mistaken for accidents:

- **Functions** now render as `[Function: name]` instead of their full source
  text. Dumping an entire function body into the run console is noise,
  especially nested inside an object.
- **Dates** render as a bare ISO string rather than a quoted one, and an
  invalid date renders `Invalid Date` instead of `null`.

A **depth limit of 4** was added, below which nested values render as
`[Object]` / `[Array]`, and a getter that throws now renders `[Throws]` rather
than aborting the run. Neither was a reported defect; both prevent a hostile or
pathological value from breaking output entirely.

## Format

Object and array syntax is unchanged — `{"key":value}` and `[a,b]` — so the
diff to existing output is limited to the values that were wrong. Note that
the output was never valid JSON and is not now: it is console output shaped
like JSON.

## Verification

- `npm run check` — passed.
- `npm test` — passed, **75 tests** (up from 61). 14 new tests, one per defect
  plus the robustness cases.
- `npm run build` — passed.

Two pre-existing tests asserted the buggy output and were updated. They are
listed here explicitly because rewriting a passing test deserves scrutiny:

- the multi-argument test kept its expectation unchanged;
- the "values that JSON.stringify cannot normally represent" test previously
  asserted `{"value":"7n","self":"[Circular]"}` and now asserts
  `{"value":7n,"self":[Circular]}`.

### Bundle delta

| Measurement | Before | After | Delta |
|---|---:|---:|---:|
| JavaScript Worker asset | 1.77 kB | 2.45 kB | **+0.68 kB** |
| Main application JS | 439.68 kB | 439.68 kB | unchanged |
| Workbox precache | 13,988.38 KiB | 13,989.04 KiB | **+0.66 KiB** |
| Precache entries | 21 | 21 | unchanged |

No dependency was added. The formatter runs inside the Worker, so the main
bundle is untouched.

## Not verified

Real iPad Safari. This is pure string formatting with no platform-specific
surface — no Worker lifecycle, no Service Worker, no WebKit API — so the risk
of divergence is low. It is still unverified, and it does not on its own close
Phase 1, which remains open on the iPad checklist in the Phase 1 report.
