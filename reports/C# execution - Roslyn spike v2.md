# C# Execution — Roslyn Spike v2

Date: 2026-08-20
Type: measurement spike, no Altitude production code changed
Status: **complete — PASSED. 11.49 MiB raw, and it compiles and runs.**

## 0. Result

Spike v1 stopped C# with ~29 MB of web assets and a `TypeLoadException` before
it ever reached a "Hello World". This spike was scoped by a budget the
maintainer set — **< 15 MB yes, 15–20 MB maybe, ≥ 25 MB no**, measured as the
raw precache delta — and it lands well inside the first band:

| Measurement | Value |
|---|---:|
| **Raw precache delta** | **12,049,400 bytes = 11,767.0 KiB = 11.49 MiB (12.05 MB)** |
| Gzipped (over the wire) | 4,461,234 bytes = **4.25 MiB** |
| Files added to precache | **42** (29 → 71 entries) |
| Precache growth | **+41.1%** (28,614.98 KiB → 40,381.98 KiB) |
| Largest single file | `Microsoft.CodeAnalysis.CSharp.dll`, 5.00 MiB |

Under 15 on either reading — 11.49 MiB binary, 12.05 MB decimal.

**And unlike v1, it actually works.** Verified in Chromium:

```text
Hello from C# on WebAssembly
squares: 1, 4, 9, 16, 25
```

That is real Roslyn, compiling real C# with LINQ, executing in the browser with
no server involved.

## 1. Why v1 measured 29 MB and this measures 11.49

Three changes, in order of how much they were worth.

### 1.1 Drop Blazor entirely — v1's largest unforced cost

v1 built on Blazor WebAssembly, whose baseline alone was 11.76 MB of web assets
before Roslyn was added. **Altitude does not need Blazor.** Its UI is CodeMirror
and TypeScript; .NET is wanted only as a compile-and-execute engine inside a
Worker, with no UI of its own.

The non-Blazor `wasmbrowser` template (`Microsoft.NET.Sdk.WebAssembly`,
delivered by the `wasm-experimental` workload) does exactly that. Measured here
as **2.60 MiB raw / 0.96 MiB gzipped across 9 files** — trimmed, invariant
globalization, invariant timezone.

For the record, published guidance quotes this template at 6.8 MB raw / 4.3 MB
invariant. That figure counts the `.gz` and `.br` sidecars the SDK emits
alongside every asset. Altitude ships the raw files and lets Cloudflare compress
on the fly, so counting all three would triple-count. **All numbers in this
report exclude the `.gz`/`.br` sidecars.**

### 1.2 Drop 13 locales of compiler messages — the single biggest win

The first Roslyn build measured **17.86 MiB**, which is the 15–20 "maybe" band.
Inspecting it found **26 satellite assemblies totalling 6.36 MiB** — localized
Roslyn diagnostics for cs, de, es, fr, it, ja, ko, pl, pt-BR, ru, tr, zh-Hans
and zh-Hant. Thirteen copies of `Microsoft.CodeAnalysis.CSharp.resources.dll`
alone, at 396–603 KiB each.

Altitude's documentation and UI are English only, by an existing project rule.

```xml
<SatelliteResourceLanguages>en</SatelliteResourceLanguages>
```

**17.86 MiB → 11.49 MiB.** One line, 6.36 MiB, and it moved the verdict from
"maybe" to "yes".

### 1.3 Use the runtime's own assemblies as reference assemblies

Roslyn needs `MetadataReference`s to compile against. The obvious approach ships
a reference-assembly pack — a second copy of the framework's public surface.
Instead, the assemblies already shipped **for execution** are fetched and handed
to Roslyn as references. Five of them (`System.Private.CoreLib`,
`System.Runtime`, `System.Console`, `System.Linq`, `System.Collections`) cost
**zero extra bytes**, because they were going to ship anyway.

This is also the most likely explanation for v1's `TypeLoadException`, which is
what an incomplete or mismatched reference set produces.

Two properties make it work:

```xml
<!-- Roslyn's MetadataReference reads PE. Webcil is a WASM-specific
     repackaging it cannot parse, so assemblies must ship as .dll. -->
<WasmEnableWebcil>false</WasmEnableWebcil>
<WasmFingerprintAssets>false</WasmFingerprintAssets>
```

The assemblies user code may compile against are pinned as
`TrimmerRootAssembly`, so trimming cannot delete capability that is advertised.

## 2. The concurrent-build trap, confirmed

The trap identified in the incoming research is real and was applied from the
start, so it never cost a debugging session:

```csharp
var options = new CSharpCompilationOptions(
    OutputKind.ConsoleApplication,
    concurrentBuild: false,
    optimizationLevel: OptimizationLevel.Release);
```

No `PlatformNotSupportedException` was ever observed. Worth noting this is **not**
what killed v1 — that was a `TypeLoadException`, a different failure — so the
research finding removed a future trap rather than explaining a past one.

## 3. Measured behaviour, Chromium

Driven headlessly via Playwright against the published output.

| Stage | Time |
|---|---:|
| Runtime boot (`dotnet.create()` + exports) | **267 ms** |
| Load 5 reference assemblies | **73 ms** |
| First compile + run (cold JIT) | **1,359 ms** |
| **Second compile + run (warm)** | **18 ms** |
| Compile with errors | 67 ms |
| Unhandled exception at runtime | 31 ms |

The warm number is the one that matters for how this feels in use: **18 ms**
per compile-and-run once the runtime is up. The 1.36 s first compile is JIT
warm-up, not a per-run cost.

**Diagnostics come back properly structured**, with position and error code —
this is what C# needs and what no existing Altitude runtime models:

```text
COMPILE_ERROR
2:46: CS0029: Cannot implicitly convert type 'string' to 'int'
2:68: CS0117: 'Console' does not contain a definition for 'WriteLin'
```

Runtime exceptions preserve output written before the throw, plus a stack trace:

```text
before

UNHANDLED: System.InvalidOperationException: boom
   at Program.Main()
```

## 4. Integration findings — two that would bite

### 4.1 The Workbox glob does not match `.dll` — offline would silently break

**38 of the 42 shipped files are `.dll`.** Altitude's current glob is:

```js
globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2,wasm,zip,json}"]
```

`dll` is absent. Workbox **silently skips** what it does not match, exactly as
the existing comment in `vite.config.ts` warns about the file-size limit. The
result would be a C# that works in development and on a warm network, then
fails offline with nothing in the logs to explain it — the precise failure mode
that comment exists to prevent. **`dll` must be added to the glob.**

The largest single file, at 5.00 MiB, is comfortably under the existing
16 MiB `maximumFileSizeToCacheInBytes`, so that limit does not need raising.

### 4.2 The build pipeline has no .NET — this is an open decision

Pyodide and PHP both arrive as npm packages and are copied into `public/` by a
script at `postinstall`/`pretest`/`build`. **The C# runtime has no equivalent**:
it is a project that must be compiled by the .NET SDK, and Altitude builds on
Cloudflare Pages with Node only.

This is a genuine architectural fork and is **not** decided here:

- **Commit the published output** (42 files, 11.49 MiB) under `public/dotnet/`
  as a vendored artifact, rebuilt by hand when the C# host changes. Conflicts
  with the established rule that generated assets are gitignored — a rule that
  exists because committed Pyodide assets once arrived truncated and silently
  broke Python.
- **Publish the host as an npm package**, restoring the Pyodide/PHP pattern at
  the cost of a second release process.
- **Build it in CI** and attach the output, which means teaching the deploy
  pipeline about .NET.

## 5. What is not yet known

Stated plainly, per project convention.

- **Nothing here has touched real iPad Safari.** All measurements are Chromium
  on Linux. The standing constraint added on 2026-08-20 — screen a runtime on
  the memory ceiling it *declares* — is unverified for .NET's WASM heap, and
  .NET is a plausible candidate to trip it.
- **No Worker integration yet.** The spike ran on the main thread of a test
  page. Altitude requires execution in a Worker, one per run, terminated after.
- **Single file only.** Multi-file C# projects, `async Main`, and stdin were not
  exercised.
- **Stop/cancellation is unimplemented.** Roslyn compilation accepts a
  `CancellationToken`, but terminating the Worker is the project's existing
  answer and should be the one used.

## 6. Evidence table

| Claim | How established |
|---|---|
| 11.49 MiB raw / 4.25 MiB gzipped / 42 files | **Measured** — published output, this session |
| Bare `wasmbrowser` = 2.60 MiB | **Measured** — this session |
| Satellite assemblies = 6.36 MiB across 26 files | **Measured** — this session |
| Compiles and runs C# with LINQ | **Verified** — Chromium via Playwright |
| Warm compile 18 ms, boot 267 ms | **Measured** — Chromium, this session |
| Diagnostics carry line/column/code | **Verified** — output quoted above |
| `.dll` absent from the Workbox glob | **Verified** — read from `vite.config.ts` |
| Behaviour on iPad Safari | **UNVERIFIED — the open question** |

## 7. Recommendation

1. **Unblock C# for the PWA.** The budget is met with 3.5 MiB of headroom, and
   the runtime demonstrably works rather than merely building.
2. **Decide the build-pipeline question (§4.2) before writing integration
   code** — it determines where the C# host project lives and how it is built.
3. **Add `dll` to the Workbox glob** as part of any integration, or offline C#
   will fail silently.
4. **Reach a real iPad early**, not at the end. The C++ spike's lesson applies
   verbatim: desktop evidence is not device evidence, and .NET's memory
   behaviour under jetsam is exactly the sort of thing that only shows up there.
5. **C# no longer needs the remote-compilation exception.** It was listed as the
   most likely candidate; on this measurement it should ship locally instead.

## 8. Reproduction

Spike lived entirely in a scratch directory; no Altitude file was modified.

```bash
./dotnet-install.sh --channel 10.0 --install-dir ./dotnet
dotnet workload install wasm-tools wasm-experimental
dotnet new wasmbrowser -o host
# csproj: PublishTrimmed, InvariantGlobalization, InvariantTimezone,
#         SatelliteResourceLanguages=en, WasmEnableWebcil=false,
#         WasmFingerprintAssets=false, + Microsoft.CodeAnalysis.CSharp 5.0.0
dotnet publish -c Release
```

.NET SDK 10.0.400, workload packs 10.0.11, `Microsoft.CodeAnalysis.CSharp` 5.0.0.
