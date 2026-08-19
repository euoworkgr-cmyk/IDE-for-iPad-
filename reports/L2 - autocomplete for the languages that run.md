# L2 — Autocomplete for the languages that actually run

**Date:** 2026-08-19 · **Task:** L2 · **Milestone:** M3 · **Status:** Built — awaiting iPad

## What the task actually was

`src/autocomplete/completionProvider.ts` offered C# keywords and `Console.*`
members only. C# is the one language Altitude cannot execute — TASKS.md put
it plainly: the only language with completion support was the only one that
does not run.

## Root cause

The provider was never missing Python/JS/TS logic by omission — it was wired
to exclude it. `EditorAdapter.ts` installs it with:

```ts
autocompletion({
  override: [createCompletionProvider(() => this.currentLanguage)],
  ...
})
```

`override` doesn't add a source alongside CodeMirror's normal language-data
completion gathering — it replaces that gathering entirely. `@codemirror/lang-python`
and `@codemirror/lang-javascript` were already installed and already register
their own completion sources (builtins, keywords, local-scope names) as
language data, the mechanism `override` bypasses. So the packages were present
and correct, and nothing reached them: only the hand-rolled C# function ran,
and it returned `null` for every language that wasn't `"csharp"`.

## What was built

`completionProvider.ts` now dispatches on the editor's current language:

- **Python** reuses `globalCompletion` (builtins and keywords) and
  `localCompletionSource` (locally-defined names) from `@codemirror/lang-python`
  directly, rather than re-listing Python's builtins by hand.
- **JavaScript / TypeScript** combine `localCompletionSource` from
  `@codemirror/lang-javascript` with a hand-written keyword, snippet, and
  global list. The package doesn't export its keyword table (only `snippets`
  and `typescriptSnippets`), so keywords are listed here. The global list is
  scoped to what Altitude's execution Worker actually exposes — `console`,
  `Math`, `JSON`, `Promise`, `Map`, `Set`, etc. — deliberately **excluding**
  `document` and `window`, since JS/TS code runs in a Worker with no DOM
  (`src/runtime/javascriptWorker.ts`). `console.` still completes to `log`
  and `error` only, matching the two methods the Worker actually overrides.
  TypeScript adds its own keyword set (`interface`, `type`, `enum`,
  `implements`, ...) on top of the JavaScript one.
- **C#** is unchanged — same keyword list, same `Console.*` members, still
  gated to `.cs` files only.

### The merging problem

`@codemirror/lang-python` normally registers `localCompletionSource` and
`globalCompletion` as two independent language-data sources; CodeMirror's
`autocompletion()` queries every matching source for a position and merges
their results. Because `override` takes over that merging too, Altitude has
to do it by hand. The first attempt used `local ?? global`, which is wrong:
a source with nothing to suggest still returns a `CompletionResult` with an
empty `options` array — that's truthy, so `??` picked it and never reached
the other source. Caught by the new test suite before it shipped; the fix is
a small `mergeSources` helper that drops empty results and concatenates the
rest.

## Testing

New file: `src/autocomplete/completionProvider.test.ts`, six cases —
Python builtins/keywords, JavaScript keywords and globals (with `document`/
`window` asserted absent), `console.` member completion, TypeScript-only
keywords layered on the JavaScript set, the C# path still working and
staying scoped to C#, and no completions for languages with none (`text`).
Constructs a real `EditorState` with the actual `python()`/`javascript()`
language extensions attached — an earlier version of the test used a bare
`EditorState` with no language and got empty results back, because
`localCompletionSource` needs the syntax tree the language extension
produces.

`npm run check`, `npm test`, `npm run build` all pass (168 tests, up from
162).

## Bundle-size impact

Reusing the language packages' completion sources means
`completionProvider.ts` now imports `@codemirror/lang-python` and
`@codemirror/lang-javascript` **statically**, where previously only
`src/editor/languages.ts` imported them dynamically (to load syntax
highlighting lazily, per-file-type). Vite's build now reports:

```
[INEFFECTIVE_DYNAMIC_IMPORT] node_modules/@codemirror/lang-javascript/dist/index.js
  is dynamically imported by src/editor/languages.ts but also statically
  imported by ... src/autocomplete/completionProvider.ts
[INEFFECTIVE_DYNAMIC_IMPORT] node_modules/@codemirror/lang-python/dist/index.js
  is dynamically imported by src/editor/languages.ts but also statically
  imported by src/autocomplete/completionProvider.ts
```

Both language packages now load in the initial bundle rather than only when
a file of that language is first opened. Measured precache size:

- Before: 14204.09 KiB (22 entries)
- After: 14207.22 KiB (21 entries)
- **Delta: +3.13 KiB precache**

Because the PWA precaches every chunk regardless of when it first loads, the
total offline payload is essentially unchanged — the cost lands on
time-to-interactive on first load (these chunks now load up front rather
than on first Python/JS file open), not on what ships or is cached.

## Still to check on device

Not yet verified on real iPad Safari. Specifically: that a tap or the
smart-Tab binding accepts a suggestion without fighting the software
keyboard's autocorrect, and that the completion popup is legible and
reachable at Slide Over width.

## Done when

Keyword and builtin completion works for Python, JavaScript and TypeScript,
and the C# list is no longer the only one. Both achieved; iPad verification
is what's left before this can move to Done.
