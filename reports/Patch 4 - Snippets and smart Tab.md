# Patch 4 — Snippets and Smart Tab

**Status: implemented.** Snippets, smart Tab, user-defined IndexedDB storage,
and the offline scenario all work. Python/Pyodide, project storage, and the
Service Worker were not changed.

## 1. What was implemented

- Built-in Python and C# snippets.
- A SNIPPETS section in the Explorer.
- Create, edit, delete, and duplicate user snippets.
- Read-only viewing of protected built-in snippets.
- Language-specific and "Any language" snippets.
- Placeholder navigation, `${0}`, repeated placeholders, and Escape.
- Strict Tab priority ordering.
- Enter no longer accepts an autocomplete suggestion.
- Global offline snippet storage in a separate IndexedDB database.

## 2. Files added

- `src/snippets/snippetEngine.ts`
- `src/snippets/snippetStorage.ts`
- `src/editor/smartTab.ts`
- `src/snippets/snippetEngine.test.ts`
- `src/editor/smartTab.test.ts`

## 3. Files changed

- `src/components/App.ts` — Snippets UI and CRUD.
- `src/editor/EditorAdapter.ts` — smart Tab and the autocomplete keymap.
- `src/styles.css` — compact panel and dialog.

## 4. Snippet engine

A trigger is identified as the complete word before the cursor and matched
against the current `LanguageId`. Plain Text does not receive the Python/C#
built-ins. User edits are available to the editor immediately after saving.

## 5. Placeholder parser

Supported:

- `${1:text}`, `${2:text}`, …
- `${0:text}` and `${0}`
- numeric ordering
- repeated IDs

The editor session is built on CodeMirror's standard `snippet()`: repeated
`${1:i}` placeholders are selected simultaneously and edited in sync.

## 6. Tab priority

The order is strictly:

1. The selected autocomplete suggestion.
2. The next placeholder of the active snippet.
3. A trigger for the current language.
4. Ordinary indent.

`Shift+Tab` always outdents. Escape ends the snippet session without deleting
any text.

## 7. Autocomplete keymap

The built-in autocomplete keymap is disabled and re-registered without Enter.
`interactionDelay: 0` is set.

- Tab accepts the selected suggestion.
- Enter inserts a newline.
- Click/tap on an autocomplete option behaves as standard.

## 8. Multiline indentation

CodeMirror's snippet indentation mechanism is used. Each subsequent line
receives the base indentation of the current line plus the indentation from
the snippet body.

## 9. Storage

A separate IndexedDB database was created:

- **Database:** `altitude-snippets`
- **Version:** 1
- **Store:** `snippets`

The project database schema was not changed. Snippets are global, survive
project switching, and work fully offline.

## 10. Built-in snippets

- **Python:** `def`, `if`, `for`, `while`, `class`, `main`, `try`
- **C#:** `main`, `cw`, `if`, `for`, `foreach`, `class`, `prop`, `try`

## 11. Conflicts

Priority order:

```
user language-specific → user "Any" → built-in
```

Duplicate language + trigger pairs among user snippets are rejected.
Built-ins can be overridden via Duplicate. Copies of user snippets get a
deterministic trigger suffix: `-copy`, `-copy-2`, and so on.

## 12. Undo

Explicit history boundaries were added before and after expansion. Therefore:

```
cw → Tab → Console.WriteLine(""); → Cmd+Z → cw
```

Expansion is a single, separate undo step.

## 13. Verification

- `npm run check` — passed.
- `npm test` — passed: 6 files, 46/46 tests.
- `npm run build` — passed.

## 14. Production/PWA

- `dist` — 17 MB.
- Precache — 20 files, 13,984.11 KiB.
- Precache growth — about 18 KiB.
- All four local Pyodide assets present.
- Python WASM, stdlib, and Service Worker precache preserved.

## 15. Browser smoke test

A headless Chromium production smoke test successfully verified:

- `cw` + Tab
- `def` + Tab
- placeholder navigation
- repeated-placeholder editing
- single-step undo
- a user-defined `dbg` snippet
- persistence after reload
- accepting autocomplete via Tab
- newline via Enter
- indent and `Shift+Tab`
- no browser exceptions
- Service Worker ready

The offline smoke test also passed: the PWA loaded with no network, the saved
snippet was restored, and a new snippet was created while offline and
expanded via Tab.

## 16. iPad verification checklist

With a Magic Keyboard:

1. In a Python file, type `def` and press Tab.
2. Enter the name, Tab, the arguments, Tab, then the body.
3. Immediately after expansion, verify `Cmd+Z`.
4. Verify ordinary Tab and `Shift+Tab`.
5. In C#, type `cw` and press Tab.
6. Open autocomplete and accept via Tab.
7. With autocomplete open, press Enter — a new line should appear.
8. Create a snippet: Debug print / `dbg` / Python / `print(${0:"DEBUG"})`.
9. Verify `dbg` + Tab.
10. Close the PWA, enable airplane mode, reopen, and repeat.
11. Create one more snippet while still in airplane mode.

## 17. Known limitations

- Curly braces inside placeholder default text require standard CodeMirror
  escaping.
- Autocomplete suggestions remain at Altitude's current level; this patch
  changes how suggestions are accepted but does not add an LSP.
- Snippet import/export, VS Code JSON format, variables, and regex snippets
  were deliberately not implemented.
- Final Safari/iPadOS verification remains manual; the automated smoke test
  ran in Chromium.

## 18. Not affected

`PythonRuntime`, Pyodide, Python `input()`, file import, the project
IndexedDB, `SaveCoordinator`, `RecoveryJournal`, Export ZIP, C# editing, and
the PWA configuration were all left unchanged.
