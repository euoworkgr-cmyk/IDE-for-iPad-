# C# Execution — Architectural Spike (v1, failed)

**Outcome: the C# patch was NOT merged.** The mandatory architectural spike
uncovered serious risks around bundle size, PWA caching, and runtime
compatibility. In line with the patch requirements, work stopped before any
Altitude production code was changed.

## Spike result

The following stack was evaluated:

- .NET SDK 10.0.110
- .NET WebAssembly
- Roslyn `Microsoft.CodeAnalysis.CSharp` 5.0.0
- Local compilation and execution of the assembly via `Assembly.Load`
- Test run in Chromium

The official browser-WASM pipeline uses `browser-wasm` and a generated
`dotnet.js`, but the corresponding workload/template is still classified as
experimental tooling. See
[.NET WebAssembly Browser App](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/wasm-browser-app?view=aspnetcore-10.0).

### Measurements

| Variant | Raw web assets | Full publish |
|---|---:|---:|
| Baseline Blazor WASM | 11.76 MB | 27 MB |
| WASM + Roslyn | 40.47 MB | 75 MB |
| **Roslyn overhead** | **≈28.71 MB** | — |

The Roslyn publish output contains 855 files. The largest are:

- `Microsoft.CodeAnalysis.CSharp.wasm` — 6.83 MB
- `Microsoft.CodeAnalysis.wasm` — 3.05 MB
- `System.Private.Xml.wasm` — 3.10 MB
- `dotnet.native.wasm` — 3.00 MB
- `System.Private.CoreLib.wasm` — 1.65 MB

In the browser, the spike terminated with a `TypeLoadException` while
resolving types from `System.Runtime` — before it ever compiled a first
"Hello World". There is therefore no confirmed working configuration even
for Chromium, let alone one that could safely ship to Safari/iPadOS.

## Why the rollout was stopped

- Adding Roslyn grows web assets by roughly 29 MB.
- The runtime requests hundreds of framework files.
- The current Workbox glob does not include ICU `.dat` files.
- Full offline support requires precaching the runtime up front. That would
  make runtime loading lazy only with respect to initialization, not with
  respect to network download.
- Such a precache would noticeably slow Service Worker installation and may
  be unstable memory-wise on a real iPad.
- Web Worker support is official as of .NET 10, but it addresses UI
  responsiveness — not bundle size and not the runtime error. See
  [.NET on Web Workers](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-on-webworkers?view=aspnetcore-10.0).
- JS/.NET interop is technically available but does not by itself remove the
  Roslyn loading problems. See
  [.NET JavaScript interop](https://learn.microsoft.com/en-us/aspnet/core/client-side/dotnet-interop/?view=aspnetcore-10.0).

## What was changed

**No Altitude files were modified.**

The spike lived only in a temporary `/tmp` directory and never entered the
project. Therefore:

- `PythonRuntime` unchanged.
- Pyodide assets unchanged.
- File import, IndexedDB, and `SaveCoordinator` unchanged.
- Service Worker and Workbox configuration unchanged.
- No C# Run, diagnostics, stdin, or runtime cache were added.
- No new C# unit tests were added, since no production feature was
  implemented.

## Altitude regression check

- `npm run check` — passed.
- `npm test` — passed, 29/29 tests.
- `npm run build` — passed.
- Production precache — 20 files, 13,966.43 KiB.
- `dist` — 17 MB.
- Local Pyodide assets present, including WASM and the Python stdlib.

Existing behavior is preserved: `.cs` files can still be imported, opened,
and saved, but Run remains unavailable because there is no confirmed C#
runtime yet.

## Recommendation

A separate experimental stage is required before any production patch:

1. Get a minimal Roslyn compile/run working successfully in Chromium.
2. Reduce reference assemblies, satellite resources, and the total number of
   framework assets.
3. Move the runtime into a Web Worker.
4. Measure cold start, repeat runs, and memory usage on a real iPad.
5. Separately agree on the trade-off: a large mandatory precache, versus an
   optional pre-installed offline C# runtime.

For now, iPad testing only needs to re-verify existing Import File, Python
Run, and offline startup for regressions. There is nothing to test for C#
execution — a risky runtime was deliberately not added to Altitude.
