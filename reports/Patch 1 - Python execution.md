# Patch 1 — Python Execution

**Status: implemented.**

## 1. What was implemented

Local execution of the active Python file via ▶ Run, `Cmd+Enter`, and
`Ctrl+Enter`; a stdout/stderr/traceback console; `input()` support; a virtual
project filesystem; runtime reuse; and isolation between runs.

## 2. Files added

- `src/runtime/PythonRuntime.ts`
- `src/runtime/runPython.ts`
- `src/runtime/runPython.test.ts`
- `scripts/copy-pyodide-assets.mjs`
- Four files in `public/pyodide/`

## 3. Files changed

- `src/components/App.ts`
- `src/editor/EditorAdapter.ts`
- `src/styles.css`
- `vite.config.ts`
- `package.json` and `package-lock.json`

`dist/` was rebuilt.

## 4. PythonRuntime

Pyodide 314.0.3 loads only on the first Run. The runtime configures the
streams, recreates the project directory, executes code via
`compile(..., real_filename, "exec")`, and returns a structured result.

## 5. Production build

`npm run build` first runs `prepare:pyodide`, which copies the core assets
from the installed npm package. The base URL is derived from
`document.baseURI`, so hosting outside the domain root is supported.

## 6. Assets in `dist/pyodide`

| Asset | Size |
|---|---:|
| `pyodide.asm.wasm` | 9,596,462 bytes |
| `python_stdlib.zip` | 2,545,106 bytes |
| `pyodide.asm.mjs` | 1,249,447 bytes |
| `pyodide-lock.json` | 113,804 bytes |
| Loader: `dist/assets/pyodide-DkmTkHc_.js` | ~19.5 KB |

## 7. Offline cache

The Workbox glob was extended with the `mjs`, `wasm`, `zip`, and `json`
types. The loader and all four runtime assets were confirmed present in the
generated `sw.js`.

## 8. Largest asset

`pyodide.asm.wasm`: 9,596,462 bytes, roughly 9.15 MiB.

## 9. Workbox limit

Previously unset, so the default 2 MiB limit applied. It is now set to
`11 * 1024 * 1024` — 11 MiB: enough for the WASM file with a small margin,
without inflating the limit excessively.

## 10. stdout/stderr

Pyodide byte writers and a streaming `TextDecoder` are used. This preserves
Unicode, line breaks, and an unterminated `input()` prompt.

## 11. `input()`

A synchronous browser `prompt` is used. The Python prompt text appears in
Output, and the entered line is returned to Python. Cancel returns an empty
string and prints a clear notice.

## 12. Virtual filesystem

All project files are mapped into `/home/pyodide/altitude-project`; nested
directories are created automatically. The working directory is set to the
project root, so local imports and `open("data/config.json")` work.

## 13. Isolation

Each run gets a fresh globals dictionary. Modules loaded from the virtual
project are removed from `sys.modules`, so edits to `utils.py` are not
shadowed by a stale module cache.

## 14. Limitations

Pyodide runs on the main thread: an infinite loop will freeze the UI, and
there is no Stop button yet. Additional wheels/pip are not shipped. Physical
verification on iPad remains mandatory. Current Pyodide officially recommends
Safari 16.4+ and supports local Vite asset delivery — see
[browser support](https://pyodide.org/en/stable/usage/index.html) and
[Vite bundling](https://pyodide.org/en/stable/usage/working-with-bundlers.html).

## 15–18. Verification

- `npm run check` — passed.
- `npm test` — passed: 2 test files, 10 tests.
- `npm run build` — passed. Vite emits harmless warnings about conditional
  Node branches inside the Pyodide package; browser execution was verified.
- Production `dist` — 17 MB. `npm run preview -- --host 0.0.0.0` starts, and
  the UI opens with Run and Output. A browser smoke test confirmed `input()`,
  imports, stdout, `__file__`, isolation, and a traceback from `main.py`.

## 19. Service Worker

Precache contains 20 entries, about 13,963.58 KiB. After warming the Service
Worker, the local server was stopped; a new browser session re-ran Python
from the offline cache and produced `OFFLINE-PYTHON 5`. The network log for
the first run contained only local requests. The loader does contain
Pyodide's own built-in CDN fallback string, but Altitude explicitly overrides
`indexURL`, `packageBaseUrl`, and `cdnUrl` with a local URL, so it is never
used.

## 20. iPad verification checklist

1. Open the new version online and wait for `Offline cached`.
2. Create `main.py` with `print("Altitude Python works")` and run it.
3. Verify `name = input("Name: "); print("Hello,", name)`.
4. Verify `print(10 / 0)` and that the traceback references `main.py`.
5. Create `utils.py` with `add()` and import it from `main.py`.
6. Verify Run, `Cmd+Enter`, and Clear.
7. Close the PWA, enable airplane mode, and turn Wi-Fi fully off.
8. Reopen Altitude and repeat all Python runs.
9. Close and reopen the app once more; confirm the project persisted.
10. Separately, open `Program.cs`, change the text, wait for `Saved`, restart
    the PWA, and confirm the C# file persisted while Run stays unavailable
    for it.
