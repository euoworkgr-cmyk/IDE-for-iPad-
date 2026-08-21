# C# Execution — Roslyn in a Web Worker

Date: 2026-08-20
Type: implementation
Status: **done — verified on real iPad Safari 2026-08-20 (PR #29, merged into `main`)**

## 0. What shipped

C# runs. `.cs` files compile with Roslyn and execute on the .NET WebAssembly
runtime, in a dedicated Web Worker, one per run, terminated after — the same
shape SQL and PHP use.

| Measurement | Value |
|---|---:|
| Precache before | 28,614.98 KiB · 29 entries |
| Precache after | **40,392.20 KiB · 72 entries** |
| **Delta** | **+11,777.22 KiB = +11.50 MiB (+41.2%), +43 entries** |
| Gzipped (over the wire) | ~4.25 MiB |
| Largest single file | `Microsoft.CodeAnalysis.CSharp.dll`, 5.00 MiB |
| Budget | **< 15 MB — passed with 3.50 MiB of headroom** |

These are the figures from the **CI build**, which is the one that ships. An
earlier local measurement read 11.62 MiB across 45 files; that publish
directory had accumulated stale assemblies across repeated rebuilds — notably
a `System.Text.Json.dll` left behind after that dependency was removed. CI
checks out clean, so its 42 files are the real payload. Worth remembering: a
local `dotnet publish` into a reused output directory over-reports.

This is the second-largest addition Altitude has made, behind PHP's
+13,320.15 KiB.

Spike v2 (`reports/C# execution - Roslyn spike v2.md`) established the number
and the approach; this is the integration, and it landed within 0.01 MiB of
the spike's 11.49 MiB estimate.

## 1. The build pipeline — the decision this needed first

Pyodide and PHP arrive as npm packages that a script copies into `public/`. A
Roslyn host has no npm equivalent, and Cloudflare Pages builds with Node and no
.NET SDK. Three options were put to the maintainer; **the third was chosen —
build it in CI.**

The shape:

1. **`runtime-csharp/`** holds the host: a `wasmbrowser` project (not Blazor)
   plus `Program.cs`, which is the whole compile-and-run engine.
2. **`.github/workflows/build-csharp-runtime.yml`** installs the .NET SDK and
   the `wasm-tools` / `wasm-experimental` workloads, publishes, strips the
   template demo page and the `.gz`/`.br` sidecars, and uploads a tarball plus
   its SHA-256 as a GitHub release asset.
3. **`scripts/copy-dotnet-assets.mjs`** downloads that asset into
   `public/dotnet/` at `postinstall` / `pretest` / `build`, exactly where the
   Pyodide and PHP scripts put theirs. `public/dotnet/` is gitignored.

Two details worth keeping:

- **The version lives in one file.** `runtime-csharp/VERSION` is both what the
  workflow tags the release with and what the download script asks for, so the
  build and the download cannot drift apart. The script also stamps
  `public/dotnet/.version` and skips the download when it already matches.
- **The checksum is verified, not trusted.** This project has already been bitten
  by silently truncated runtime assets — committed Pyodide files arrived at
  768 KiB and broke Python and the test suite with no error. A size check would
  not have caught that; a digest does.

The workflow also **enforces the 15 MiB budget and fails the build if it is
exceeded**, so a future dependency bump cannot quietly spend the headroom.

## 2. Two findings that would have broken this silently

### 2.1 `dll` was missing from the Workbox glob

38 of the 42 shipped assets are `.dll`, and the glob was:

```js
globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2,wasm,zip,json}"]
```

Workbox **silently skips** what it does not match. C# would have worked in
development and on a warm network, then failed offline with nothing in the
logs — the same trap the existing comment about `maximumFileSizeToCacheInBytes`
warns about. `dll` was added, and the precache manifest was checked afterwards
to confirm all 38 are really in it.

They are `.dll` rather than Webcil `.wasm` on purpose: Roslyn compiles the
user's code against the runtime's own assemblies, and `MetadataReference` reads
PE, which Webcil is not.

### 2.2 `JsonSerializer` does not work under trimming

The compile result crosses from C# to JS as JSON. `JsonSerializer.Serialize`
throws `JsonSerializerIsReflectionDisabled` at runtime under `PublishTrimmed` —
it builds fine and fails only when called. The envelope is now written by hand
with explicit RFC 8259 escaping, which also keeps `System.Text.Json` off the
critical path. Escaping is covered by an end-to-end case with quotes, newlines
and tabs in program output.

## 3. Design decisions

**Compile and run are two calls, not one.** The first implementation had a
single `CompileAndRun`, which worked — but made the `"running"` status
unreachable, so a program that ran for ten seconds would sit there claiming to
be compiling. `Compile` now emits to memory and returns diagnostics; `Run`
invokes what it produced. The Worker reports `compiling` between them and
`running` before the invoke, and the console shows all three states.

**C# is the first language here with a compile phase.** Every earlier runtime
fails one way and reports one `error` string. C# can fail with several
diagnostics at once, each with a position, before a line of it runs. So
`CSharpExecutionResult` carries `diagnostics`, and `App.ts` renders them the
way a compiler does:

```text
2 compile errors:
Program.cs(4,17): error CS0029: Cannot implicitly convert type 'string' to 'int'
Program.cs(5,17): error CS0117: 'Console' does not contain a definition for 'WriteLin'
```

Warnings render on the status channel and do not turn a successful run into a
failure.

**The run time limit starts at `compiling`, not at load.** Loading 11.50 MiB on
a cold cache takes longer than any sensible limit, so — as with PHP — there are
two budgets: a 120 s startup budget that exists only to bound a runtime that
never arrives, and the user's own limit, which starts when their code does.

**Single file, deliberately.** C#'s multi-file story is a project system —
`.csproj`, assembly references, namespaces across files — and approximating it
by throwing every `.cs` in the project at one compilation would produce
confusing failures. `runActiveCSharp` still takes the project so multi-file has
somewhere to go later.

**Console output streams.** `Console.Out` and `Console.Error` are redirected
through a `TextWriter` that calls into JS per write, so a long-running program
shows progress and one cut short by the time limit still shows what it printed.
Verified: a program that throws still shows what it wrote first.

## 4. .NET stack traces now hide Altitude's plumbing

Every C# exception ends with the reflection call Altitude uses to invoke `Main`:

```text
System.InvalidOperationException: boom
   at Program.Main()
   at System.Reflection.MethodBaseInvoker.InterpretedInvoke_Method(...)
   at System.Reflection.MethodBaseInvoker.InvokeWithNoArgs(...)
```

`errorReport.ts` already had the concept for this — Pyodide's `eval_code_async`
harness and Altitude's bundled JS frames are flagged `internal` and hidden — but
its two patterns are URL-based and .NET frames carry no URL, so all three showed.
`System.Reflection.*`, `System.RuntimeMethodHandle.*` and `CSharpRunner.*` are
now flagged the same way. Nothing is deleted, per that module's own rule: if a
failure is entirely inside Altitude, the internal frames are all there is and
they are still shown.

The rendered failure is now just the user's frame:

```html
<span class="console-failure-title">System.InvalidOperationException: boom</span>
<li class="console-trace-frame"><span class="console-frame-where">Program.Main()</span></li>
```

## 5. Verification

`npm run check`, `npm test` (**282 passing**, 22 files), and `npm run build` all
pass. 21 new tests: 17 for the runtime and `canRunCSharp`/`runActiveCSharp`,
4 for C# stack traces in `errorReport`.

Driven end to end against the **production build** in Chromium via Playwright —
the real app, real Worker, real precached assets, not a test page:

| Case | Result |
|---|---|
| Hello World with LINQ | `C# runs in Altitude` / `1 4 9 16 25`, "Process finished successfully." |
| Run button label | "Run C# (Cmd/Ctrl+Enter)" |
| Status transitions | `Loading the C# runtime…` → `> Compiling Program.cs` → `> Running Program.cs` |
| Two compile errors | Both rendered with file, line, column and CS code; status "Error" |
| Unhandled exception | Output before the throw preserved; headline is the exception; only `Program.Main()` shown |

Measured in the spike, unchanged here: runtime boot 267 ms, warm compile-and-run
18 ms, first compile 1,359 ms (JIT warm-up, not per-run).

## 6. What is not done

- **Multi-file C#** — see §3.
- **`Console.ReadLine`** — Python's stdin has no C# equivalent yet; a program
  that reads input will see end-of-stream.
- **Cancelling a compile** — Stop terminates the Worker, which is immediate and
  correct, but Roslyn's own `CancellationToken` is unused.

## 7. iPad verification

Confirmed by the maintainer on real iPad Safari, 2026-08-20: "C# working."
This was the open risk this report flagged — the largest WebAssembly runtime
Altitude ships, against a memory-ceiling constraint that was unverified for
.NET's heap at write-time. It held. PR #29 merged into `main` on that
confirmation, per the project's merge protocol.

## 8. Files

| File | Change |
|---|---|
| `runtime-csharp/` | New — the host project, `Program.cs`, and `VERSION` |
| `.github/workflows/build-csharp-runtime.yml` | New — builds, budget-checks, publishes the release asset |
| `scripts/copy-dotnet-assets.mjs` | New — downloads and verifies into `public/dotnet/` |
| `src/runtime/CSharpRuntime.ts` | New — Worker lifecycle, two budgets, diagnostics in the result |
| `src/runtime/csharpWorker.ts` | New — hosts .NET, feeds references, compiles then runs |
| `src/runtime/runCSharp.ts` | New — `canRunCSharp` / `runActiveCSharp` |
| `src/runtime/CSharpRuntime.test.ts` | New — 17 tests |
| `src/runtime/errorReport.ts` | .NET reflection frames flagged internal |
| `src/components/App.ts` | Run dispatch, Stop, status, diagnostics rendering |
| `vite.config.ts` | `dll` added to the Workbox glob |
| `package.json`, `.gitignore` | `prepare:dotnet`; `public/dotnet/` ignored |
