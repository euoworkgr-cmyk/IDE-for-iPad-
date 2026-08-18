# Patch 3 — Python `input()` Hotfix

**Status: implemented** as a targeted hotfix.

## 1. Exact root cause

The problem was caused by this option:

```js
autoEOF: false
```

In Pyodide 314.0.3 a line-based stdin callback returns a whole line, and
Pyodide appends the `\n` itself.

With `autoEOF: false`, the internal `LegacyReader` kept filling the current
large read buffer after that line and immediately invoked the callback again.
As a result, a single Python `input()` could open many browser prompts.
Cancel returned an empty string, which became a string with a newline, after
which reading also continued.

## 2. Before

```js
pyodide.setStdin({
  stdin: hooks.readInput,
  autoEOF: false
});
```

stdout/stderr used byte writers with a `TextDecoder`.

## 3. After

A testable `configureLineStdin()` was introduced:

```js
pyodide.setStdin({
  stdin: () => readInput() ?? "",
  isatty: false
});
```

`autoEOF` is no longer overridden — Pyodide's standard `autoEOF: true`
behavior is used.

stdout/stderr remained byte-based and were not changed.

## 4. Why there is now exactly one prompt per `input()`

The callback returns one complete line. Pyodide then:

- appends a newline;
- passes the line to Python;
- completes the current read operation;
- invokes the callback again only on the next explicit `input()`.

In the production browser smoke test the calculator invoked the callback
exactly three times.

## 5. Cancel

`window.prompt()` returns `null`, which the stdin wrapper converts to an
empty string `""`.

Python receives one empty string. There is no retry and no infinite prompt
loop. The UI still prints the notice:

```
[Input cancelled; using an empty string.]
```

For `int(input())`, an empty string will expectedly raise a `ValueError`,
which appears in the traceback.

## 6. Files changed

- `src/runtime/PythonRuntime.ts`
- `src/components/App.ts`
- Added `src/runtime/PythonStdin.test.ts`

File import, IndexedDB, `SaveCoordinator`, the models, the PWA setup, and
the Pyodide assets were not changed.

## 7. Regression tests

Verified against a real local Pyodide/WASM instance:

- one `input()` → one callback, result `Alice`;
- three `input()` calls → exactly three callbacks;
- two `int(input())` calls with `10` and `20` → `30`;
- Cancel → a single empty string with no retry;
- Unicode text preserved without corruption;
- the full calculator flow with `10`, `20`, `+` → `30` and exactly three
  callbacks;
- the stdin configuration does not contain `autoEOF: false`.

## 8. Results

- `npm run check` — passed.
- `npm test` — passed: 4 files, 29 tests.
- `npm run build` — passed.
- Production browser smoke — passed: `calls: 3`, result `30`.
- `autoEOF:false` is absent from both the source and the main production
  bundle.
- The Pyodide loader, WASM, stdlib, lock file, and runtime `.mjs` remain in
  the Service Worker precache.

## 9. iPad verification checklist

Run this program:

```python
print("Calculator")

a = int(input("Enter the first number: "))
b = int(input("Enter the second number: "))
choice = input("Enter the operation (+, -, *, /): ")

if choice == "+":
    print(a + b)
elif choice == "-":
    print(a - b)
elif choice == "*":
    print(a * b)
elif choice == "/":
    print(a / b)
```

Enter, in order:

```
10
20
+
```

Expected: exactly three system dialogs, and the result:

```
30
```

Also verify:

- one `input()` → one dialog;
- Cancel on a string `input()` → execution continues with an empty string;
- non-ASCII text is returned without corruption;
- repeat the test in airplane mode with Wi-Fi OFF.
