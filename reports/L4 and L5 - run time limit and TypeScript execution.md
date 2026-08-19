# L4 and L5 — adjustable run time limit, TypeScript execution

**Date:** 2026-08-19 · **Tasks:** L4, L5 · **Status:** Built — awaiting iPad

Both tasks are implemented, the automated suite passes, and the whole feature
was driven end to end in headless Chromium. **Neither is verified on real iPad
Safari**, so neither is done. The maintainer has no iPad to hand during this
session and will check at home; both tasks stay at 🟨 in `TASKS.md` until then.

---

## L4 — Adjustable run time limit

### The decision that was open

`TASKS.md` recorded one decision: "adjustable" needs somewhere to store the
setting, and the settings screen belongs to M3 — build a minimal store now, or
pull M3 forward. The recommendation was the minimal store, and that is what was
built. Nothing of M3's settings *screen* was pulled forward.

### What was built

A small key/value settings layer, and one dialog to reach it:

- `src/settings/appSettings.ts` — the settings shape, the default (5 s), the
  supported range (1 s to 120 s), and the normalizer. Persisted settings are
  untrusted: they outlive app upgrades and can be edited through developer
  tools, so `normalizeAppSettings` is the only way a stored value enters the
  app, and it repairs rather than rejects.
- `src/settings/settingsStore.ts` — load and update, through
  `ProjectRepository`. A failed read or write never stops the app: it falls
  back to the defaults, keeps running, and the dialog says the change will not
  survive a reload. This matches how user snippets already degrade.
- `ProjectRepository.getSetting` / `saveSetting` — generic accessors over the
  `settings` object store that already held the session. **No new IndexedDB
  surface**: the repository remains the only thing in the app that touches
  IndexedDB, per the standing constraint. No schema version bump was needed.

The limit is now read **per run**, not per runtime instance —
`JavaScriptRuntime` accepts either a number or a function, and the app passes a
function. Changing the setting applies to the next run with no reload.

The timeout message changed from `JavaScript execution timed out after 5000
ms.` to `Execution stopped: it exceeded the 5 second run time limit. Change the
limit in Settings.` — it names the unit a user set and where to change it.

### Deliberate scope limits

- **Python is not covered, and the dialog says so.** Python still runs on the
  main thread and cannot be interrupted; that is L6, and L7 depends on it.
  Claiming a limit that does not apply would be worse than the gap.
- **The limit covers compilation too.** For a TypeScript run the clock starts
  before type stripping, so the limit is the whole run. Type stripping is
  measured in milliseconds, so this costs nothing in practice, and a limit that
  excluded part of the run would not be a limit.
- **The form is `novalidate`.** Range errors are reported by the app so the
  message is identical everywhere, instead of a native bubble in one browser
  and a silently swallowed submit in another. This was found in verification:
  with native validation on, an out-of-range value was refused with no message.

---

## L5 — TypeScript execution

### The measurement came first

`PROJECT DIRECTION.md` requires a bundle-size spike before integration code.
It was done first and is written up separately in
`reports/TypeScript execution - transpiler spike.md`. Summary: sucrase at
**+203.58 KiB precache (+1.46%)**, against 996 KiB gzipped for the `typescript`
package and 11.8 MiB for esbuild-wasm.

### One execution path, not two

TypeScript is stripped to JavaScript **inside the existing Worker** and then
run by the same code that runs a `.js` file. Concretely:

- `src/runtime/typescriptTranspile.ts` is the strip step and nothing else.
- `javascriptWorker.ts` calls it via a dynamic `import()` before the
  `AsyncFunction` it already had. A JavaScript run does not load it.
- `runJavaScript.ts` gained `canRunTypeScript`, `canRunScript` and
  `runActiveScript`; `runActiveScript` serves both languages and branches on
  language only to name it in the request.
- `JavaScriptRuntime` carries a `language` field and applies the matching path
  validation. The Python-derived `normalizeProjectPath` still guards it, so the
  defensive path validation required of new execution paths is unchanged rather
  than re-implemented.

No second runtime, no second Worker, no second timeout, no second output
formatter.

### What a user sees

`.ts` and `.mts` files are runnable. The console shows a compile step before
the run. A syntax error is reported against the user's file
(`src/broken.ts: Unexpected token (1:10)`) with no Altitude-internal stack —
compile failures are separated from runtime failures in the Worker precisely so
the user is not shown this app's frames for their own typo.

Type errors do not block a run. Sucrase does no type checking; `tsc` also emits
JavaScript for type-error input by default, and Altitude has nowhere to report
a type error.

### Known gaps

- `namespace` / `module` blocks are dropped by sucrase rather than compiled,
  and the failure appears at runtime as a `ReferenceError` rather than as a
  diagnosed error. Documented in the spike report.
- `.tsx` and `.cts` stay unrunnable, on the same reasoning that already
  excludes `.cjs`.
- Imports between project files still do not work — for TypeScript or for
  JavaScript. The Worker runs one file. This is unchanged by L5.

---

## Verification

`npm run check` and `npm test` pass (12 files, 113 tests, including 25 new).
`npm run build` succeeds. All three were also run from a **clean clone** of the
branch, not just the working directory.

Beyond the unit tests, the built app was driven in headless Chromium at 1024
and 1180 px, and the settings dialog checked at 320 px (Slide Over width, no
horizontal overflow: `scrollWidth` 320 against a 282 px dialog). Fifteen checks,
all passing:

- TypeScript with interfaces, an `enum`, a constructor parameter property and
  top-level `await` runs and prints the right values.
- The compile step appears in the console, exactly once. *(It appeared twice in
  the first build — the runtime and the Worker both announced it. Caught in a
  screenshot, not by a test, and fixed.)*
- A TypeScript syntax error is reported against the user's file with no
  internal stack.
- The JavaScript path and the Python path are unchanged.
- `.tsx` is not offered as runnable.
- The limit defaults to 5 s, saves, closes, persists across a reload, refuses
  an out-of-range value with a message, and resets to the default.
- A `while (true) {}` run set to a 1 s limit was stopped in 1,076 ms — the new
  limit applied, not the old 5 s — with a message naming the configured limit.
- No uncaught page errors throughout.

### What iPad verification still has to establish

Chromium is necessary and not sufficient; WebKit is where the surprises live.
On device, check:

1. **`worker.format: "es"`.** This build change makes the Worker a real ES
   module. Safari has supported module workers since 15 and the build targets
   Safari 16, but this is the change most likely to behave differently on
   WebKit, and it affects **JavaScript execution too**, not only TypeScript.
   Run a plain `.js` file first.
2. **Worker termination under the timeout.** `worker.terminate()` on a tight
   loop is exactly the area where WebKit has surprised this project before.
3. **The transpiler chunk offline.** It is a new precache entry loaded lazily
   by a Worker. Confirm a TypeScript file runs with the device in airplane
   mode, after a first load.
4. **The number input on iPad.** Confirm the run time limit field is usable
   with the software keyboard, and that the dialog is reachable at Slide Over
   width.
