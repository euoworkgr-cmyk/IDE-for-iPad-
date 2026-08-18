# Patch 2 — File Import from Files.app

**Status: implemented**, with no changes to `PythonRuntime`, the IndexedDB
schema, or the PWA architecture.

## 1. What was implemented

A compact ⇧ button with an `Import file` tooltip was added to the Explorer.
Once a file is selected it is:

- read locally via `File.text()`;
- turned into a normal `ProjectFile`;
- saved to IndexedDB;
- opened in CodeMirror;
- listed in the Explorer and included in Export ZIP;
- immediately runnable via ▶ Run if it is a `.py` file.

Cancelling the picker changes nothing and is not treated as an error.

## 2. Files changed

Added:

- `src/filesystem/importFile.ts`
- `src/filesystem/importFile.test.ts`

Modified:

- `src/components/App.ts`
- `src/projects/models.ts`
- `src/editor/languages.ts`

`dist/` was rebuilt. `PythonRuntime.ts`, the Service Worker configuration,
and the Pyodide assets were not touched.

## 3. iPad Files picker

A hidden standard input is used:

```html
<input type="file">
```

The Explorer button calls `input.click()` synchronously, so Safari shows the
system Files picker. The File System Access API, a backend, and any upload
API are all unused.

## 4. Supported extensions

The picker targets:

- **Python:** `.py`
- **C/C++:** `.c`, `.cc`, `.cp`, `.cpp`, `.cxx`, `.h`, `.hh`, `.hpp`, `.hxx`
- **C#:** `.cs`
- **JavaScript/TypeScript:** `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`
- **Web:** `.html`, `.htm`, `.css`
- **Data/text:** `.json`, `.xml`, `.yaml`, `.yml`, `.toml`, `.ini`, `.txt`,
  `.md`, `.csv`
- Unknown text files — imported as Plain Text

## 5. Language detection

The existing `languageFromPath()` was extended; there is no second detector:

- `.py` → Python
- `.c`, `.h` → C
- `.cc`, `.cp`, `.cpp`, `.cxx`, C++ headers → C++
- `.cs` → C#
- `.js` → JavaScript
- `.ts`, `.mts`, `.cts` → TypeScript
- unknown extension → Plain Text

C/C++ files currently open without dedicated highlighting, and Run stays
disabled for them.

## 6. Name conflicts

Files are never overwritten:

```
main.py
main (1).py
main (2).py
```

Comparison is case-insensitive and deterministic.

## 7. Size limit and errors

The maximum is 5 MiB per file. Size is checked *before* `file.text()`, so a
large file never reaches memory or CodeMirror.

Also handled:

- read errors;
- binary content;
- invalid filenames;
- IndexedDB write errors;
- empty files — imported as valid text files;
- picker cancellation — silent exit.

On error the current project is not mutated.

## 8. IndexedDB and autosave

A copy of the project including the imported file is created first, then
saved through the existing `ProjectRepository`. The UI only switches to it
after a successful write.

Subsequent edits to the imported file go through the normal
`SaveCoordinator` and recovery journal.

## 9. Export ZIP

Yes — Export ZIP already iterates `project.files`, so imported files are
included automatically with their name and content preserved.

## 10. Verification

- `npm run check` — passed.
- `npm test` — passed: 3 files, 22 tests.
- `npm run build` — passed.
- Production UI smoke test — Import button, tooltip, file input, and Run all
  present; no fatal errors.
- The new `sw.js` contains the Pyodide loader, WASM, stdlib, lock file, and
  runtime `.mjs`.
- The import implementation contains no `fetch`, XHR, `FormData`, or upload
  calls.

## 11. iPad verification checklist

1. On Linux, create `test.py` containing:
   ```python
   print("Imported Python works")
   ```
2. Transfer `test.py` to Files.app.
3. Open the project in Altitude and tap ⇧ Import file.
4. Select `test.py`.
5. Check the name and content.
6. Confirm ▶ Run is enabled.
7. Run it and expect:
   ```
   Imported Python works
   ```
8. Close the PWA, reopen it, and confirm `test.py` persisted.
9. Enable airplane mode and turn Wi-Fi off.
10. Import a different `.py` from Files.app and run it offline.
11. Import `test.py` a second time and confirm the name is `test (1).py`.
12. Import `.cp` and `.cpp` files: they should open and save, but Run must
    stay disabled.
