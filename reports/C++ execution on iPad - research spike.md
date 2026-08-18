# C++ Execution on iPad — Research Spike

Date: 2026-08-18
Type: research spike, no production code changed
Status: **complete — recommendation is to defer C++ past the PWA phase**

## 0. Summary for the impatient

Running C++ on iPad is **technically possible today and proven in shipping
software**, but not on terms Altitude can currently accept.

- The full-fidelity in-browser toolchain (LLVM/Clang compiled to WASM) costs
  **~103 MiB compressed** — **7.5× Altitude's entire current app** (13.66 MiB
  precache). Measured, not estimated.
- The incremental/REPL variant of that toolchain depends on a mechanism that
  is **broken in Safari on both macOS and iOS**, with an open upstream bug and
  no workaround.
- The lightweight alternatives are each disqualified: TCC is C-only, JSCPP is
  an unmaintained educational subset.
- **The native Swift shell changes the economics completely.** A native ARM
  compiler producing WASM, executed by WKWebView, is better on every axis:
  size, compile speed, and run speed. This is the path a shipping App Store
  app (a-Shell) already takes.

**Recommendation: do not attempt C++ in the PWA. Schedule it as a native-shell
feature, and revisit with a second spike once the shell exists.**

## 1. The constraint, stated correctly

The project has been carrying a slightly wrong mental model. The blocker is
**not** "C-family languages cannot run on iOS." It is narrower and more
useful than that:

> iOS forbids third-party apps from generating and executing **native machine
> code** at runtime. There is no JIT entitlement for ordinary apps.

Two consequences that matter:

1. **Compiling is not the problem — executing native output is.** A compiler
   is just a program that transforms text into bytes. Running it on-device is
   perfectly legal. What you may not do is mark those bytes executable and
   jump into them.
2. **WASM is the escape hatch, and Altitude already uses it.** Pyodide is
   CPython compiled to WASM, running in the WebView today. The exact same
   trick works for C++.

### Where the code runs decides how fast it is

JavaScript and WASM inside **WKWebView** get JIT — not because the app has JIT
rights, but because WebKit runs web content in Apple's own separate, brokered
WebContent process. An engine linked into the app's own process
(JavaScriptCore via `JSContext`, wasm3, WAMR) is **interpreter-only**.

That distinction is worth real numbers. The a-Shell maintainer benchmarked the
same Fibonacci workload across runtimes on iOS:

| Runtime | Where it runs | Time | Penalty |
|---|---|---:|---:|
| Apple's engine (WKWebView) | WebContent process, **JIT** | 4.3 s | 1× |
| wasm3 | in-process interpreter | 22.6 s | **5.3×** |
| WAMR | in-process interpreter | 78.3 s | **18×** |

This is the strongest empirical support yet for the standing architectural
decision in `PROJECT DIRECTION.md`: **execution stays inside the embedded web
layer even after the native shell exists.** Moving execution into native code
would cost a 5–18× slowdown. The direction doc asserted this on reasoning;
these are measurements.

## 2. Approaches evaluated

| # | Approach | C++? | Payload | Verdict |
|---|---|---|---|---|
| 1 | LLVM/Clang → WASM, batch compile (Emception, Wasmer) | ✅ Full | ~100 MiB uncompressed | **Too heavy for the PWA** |
| 2 | clang-repl → WASM, incremental (xeus-cpp-lite) | ✅ Full | 103 MiB compressed | **Blocked on Safari** |
| 3 | TCC compiled to WASM | ❌ C only | ~100 KB | Disqualified — no C++ |
| 4 | JSCPP (C++ interpreter in JS) | ⚠️ Subset | 19.8 MiB | Disqualified — unmaintained |
| 5 | Remote compile service | ✅ Full | ~0 | **Violates offline-first** |
| 6 | Native compiler in Swift shell → WASM → WKWebView | ✅ Full | TBD | **Recommended, post-shell** |

### 1 & 2 — LLVM/Clang compiled to WebAssembly

This is the real thing: actual Clang, actual libc++, full language support.
Two flavors exist.

**Batch** (Emception, Wasmer's `clang` package): compile a source file to a
standalone `.wasm`, then instantiate and run it. Architecturally this is a
perfect match for how Altitude already runs Python and JavaScript — a discrete
"Run" that produces output.

**Incremental/REPL** (xeus-cpp-lite, upstream clang-repl): each input becomes
a Partial Translation Unit, lowered to LLVM IR, compiled to a WASM object,
linked with `wasm-ld`, and loaded as an Emscripten **side module** sharing
memory with the main module. Notably, LLVM 17 added a WASM-specific
`IncrementalExecutor` precisely *because* the normal ORC JIT cannot work in a
WASM sandbox — you cannot write executable memory at runtime. This work is
upstream in LLVM, not a fork.

Altitude does not need a REPL. It needs "run this file." **So the batch model
is the correct target, and it sidesteps the Safari bug described in §4.**

#### The measured cost

Package sizes pulled directly from the emscripten-forge `emscripten-wasm32`
channel index (`repo.prefix.dev`), which is what xeus-cpp-lite ships:

| Package | Version | Compressed download |
|---|---|---:|
| `llvm` | 21.1.8 | **81.62 MiB** |
| `cppinterop` | 1.7.0 | 17.50 MiB |
| `xeus-cpp` | 0.8.1 | 3.08 MiB |
| `clang-resource-headers` | 20.1.8 | 0.47 MiB |
| `xeus`, `xeus-lite` | — | 0.46 MiB |
| **Total** | | **103.13 MiB** |

Wasmer's independently-built browser `clang` package corroborates the order of
magnitude: **~100 MB uncompressed**, with a stated goal of ~30 MB compressed —
and their demo covers **C only**, not C++.

For comparison, Altitude's **entire** production precache today is
**13,988 KiB ≈ 13.66 MiB**, of which Pyodide is the bulk. Adding C++ this way
is **7.5× the whole existing application**, shipped up front, to every user,
before they open a file.

That is not a bundle-size concern. It is a different product.

### 3 — TCC (Tiny C Compiler)

Genuinely tiny (~100 KB), self-hosting, ported to WASM. **It compiles C, not
C++.** For a roadmap item explicitly about C++ it is disqualified. Worth
remembering if plain C ever becomes a separate goal — the size is extraordinary
and it would fit the offline constraint effortlessly.

### 4 — JSCPP

A C++ interpreter in pure JavaScript. Attractive on paper: no WASM, no
toolchain. Reality, from the npm registry:

- Latest version **2.0.9**, published **2021-01-27** — over five years stale
- 19.76 MiB unpacked
- MIT licensed
- Self-described as built "mainly for educational uses for a MOOC course"

`PROJECT DIRECTION.md` targets a **general audience**, where "robustness,
predictable behavior, and graceful degradation matter as much as raw feature
count." An unmaintained educational-subset interpreter fails that bar. Users
would hit the subset boundary constantly and blame Altitude.

### 5 — Remote compilation

Rejected on sight. **Zero CDN / zero runtime network dependency** is a hard
constraint, and offline-first is the product's reason to exist. Recorded only
so nobody re-proposes it.

### 6 — Native compiler in the Swift shell

**This is the answer, and it is already proven in production.**

[a-Shell](https://holzschu.github.io/a-Shell_iOS/) is a free App Store app
that ships `clang`/`clang++` on-device, compiles C and C++ to WebAssembly with
a WASI sysroot, and executes the result. It has been on the store for years.

Mapped onto Altitude's planned architecture:

- The **native Swift shell** ships a native ARM Clang. Native ARM binaries are
  dramatically smaller and faster than the same compiler cross-compiled to
  WASM — no 82 MiB `llvm.wasm`.
- Compilation produces a `.wasm` artifact.
- That artifact is handed to the **WKWebView**, which executes it **with JIT** —
  the 4.3 s tier from §1, not the 22.6 s interpreter tier.
- Altitude's existing runtime seam (`JavaScriptRuntime`, `PythonRuntime`) is
  where this plugs in. No new execution architecture.

Every axis improves versus the PWA route: smaller, faster to compile, faster
to run. The only thing it requires is the native shell — which is already the
documented architecture end-state, not new scope.

Size caveat, stated honestly: a-Shell's App Store download is **1,944.9 MiB**.
That is *not* a measurement of clang alone — a-Shell ships an entire Unix
userland including Python, Lua, Perl, TeX and more. It does establish that
nobody has made on-device C++ compilation *small*. iOS **On-Demand Resources**
are the standard mitigation: ship the compiler as an optional post-install
download rather than in the base app. That keeps Altitude small for the
majority who only write Python and JavaScript.

## 3. What Altitude would actually need

Even choosing approach 6, C++ is not a drop-in. The gap list:

- **A sysroot.** Headers and libc++/libc for the WASM target. This is a large
  fraction of any C++ toolchain payload and cannot be omitted.
- **A linker step.** Unlike Python and JS, C++ has a compile→link→run pipeline.
  Altitude's `Run` currently models compile-and-go.
- **Multi-file compilation.** C++ without multiple translation units is a toy.
  This breaks the "single-file only" simplification both current runtimes rely
  on, and pulls in a real project/build model.
- **Diagnostics UX.** Compiler errors are the primary output of C++ development.
  Piping raw stderr to the Run console — today's model — is not adequate.
- **Compile latency.** Every prior runtime here is start-and-run. C++ adds a
  multi-second compile step needing its own progress and cancellation UI.

Each of these is real work independent of which compiler is chosen. This is
why C++ is a phase, not a feature.

## 4. The Safari-specific blocker (and why it does not sink the plan)

Emscripten's `dlopen` for dynamically-loaded **side modules** is broken in
Safari on both macOS and iOS:
[emscripten#21571](https://github.com/emscripten-core/emscripten/issues/21571),
**open since March 2024, no fix and no workaround documented.** Symbol
resolution across side modules is *non-deterministic* — Safari reports symbols
as unresolved that belong to entirely different modules, and fails differently
on each attempt. It works fine in Chrome.

This is exactly the mechanism the **incremental/REPL** approach (§2, item 2)
depends on. So xeus-cpp-lite and anything built on clang-repl's WASM backend
is, as of now, **not viable on the target platform** — independent of size.

It does **not** block the **batch** model, which produces one standalone
`.wasm` and instantiates it normally. That is the model Altitude wants anyway.

Two lessons worth carrying forward:

1. This bug is a textbook instance of the project's own rule that **WebKit is
   where the surprises live**. A Chromium-only evaluation would have declared
   the REPL approach viable and lost the time downstream.
2. Any future C++ work must be validated on real Safari **early**, not at the
   end.

## 5. App Store risk

There is precedent in both directions, and it should be understood before
committing.

In **November 2020**, Apple threatened both a-Shell and iSH with removal under
guideline **2.5.2** ("may not download, install, or execute code"). a-Shell was
told to remove `curl`, `pip`, and `wasm`. After appeal and press attention,
**Apple backtracked** — App Review called, apologised, and accepted the appeal.
a-Shell still ships WebAssembly and Clang today.

The reasoning that holds up: WASM executed by a runtime that shipped inside the
reviewed binary is **data interpreted by shipped code** — the same category as
shipping JavaScript to JavaScriptCore. a-Shell also argued, effectively, that
Apple's own WKWebView embeds a WASM VM.

Assessment: **precedented and currently accepted, but contested history.** Not
a blocker. It is a reason to (a) execute inside WKWebView rather than embedding
a separate VM, which is both faster and the less novel posture at review, and
(b) not build a business model that dies if one guideline is reinterpreted.

## 6. Recommendation

1. **Do not attempt C++ in the PWA phase.** 103 MiB against a 13.66 MiB app
   fails the offline-first constraint in practice even though it satisfies it
   in theory. The lightweight alternatives fail the quality bar.
2. **Move C++ behind the native Swift shell** in the roadmap. The shell is
   already the architecture end-state; C++ becomes a *reason* to build it
   rather than a competing priority.
3. **Update the roadmap's C/C++ row** from "spike required" — this spike is
   done. The next spike is narrower: *how small can a native ARM Clang plus
   WASI sysroot be, delivered via On-Demand Resources?*
4. **Keep C# blocked.** Nothing here rehabilitates it; Roslyn remains heavier
   than Clang with a worse runtime story.
5. **Note TCC** as a cheap future option if plain **C** — not C++ — is ever
   wanted standalone. ~100 KB is within reach of the current bundle.

## 7. Evidence strength

Explicitly labelled, per project convention — nothing here was verified on
iPad hardware.

| Claim | How established |
|---|---|
| 103.13 MiB toolchain payload | **Measured** — emscripten-forge channel index, this session |
| Altitude precache = 13,988 KiB | **Measured** — `npm run build`, this session |
| JSCPP 19.76 MiB, stale since 2021 | **Measured** — npm registry API |
| a-Shell = 1,944.9 MiB | **Measured** — iTunes lookup API |
| Wasmer clang ~100 MB, C only | Vendor blog post |
| Safari `dlopen` bug, open, no fix | Upstream issue #21571, read directly |
| clang-repl WASM mechanism | Primary presentation, compiler-research.org |
| wasm3/WAMR/JIT benchmarks | a-Shell maintainer, GitHub discussion #843 |
| App Store 2020 threat and reversal | Contemporaneous press + community reports |
| **Native ARM Clang is small enough** | **UNVERIFIED — this is the open question** |

The last row is the one that matters and the one nobody has measured. It is the
subject of the follow-up spike proposed in §6.3.

## 8. Sources

- [Emception — Emscripten in the browser](https://github.com/jprendes/emception)
- [Running Clang in the browser using WebAssembly (Wasmer)](https://wasmer.io/posts/clang-in-browser)
- [Xeus-Cpp-Lite — Interpreting C++ in the Browser](https://compiler-research.org/assets/presentations/Anutosh_Bhat_Xeus-Cpp-Lite.pdf)
- [C++ in Jupyter — Interpreting C++ in the Web](https://blog.jupyter.org/c-in-jupyter-interpreting-c-in-the-web-c9d93542f20b)
- [emscripten#21571 — emscripten_dlopen fails on Safari](https://github.com/emscripten-core/emscripten/issues/21571)
- [a-Shell](https://holzschu.github.io/a-Shell_iOS/) · [source](https://github.com/holzschu/a-shell) · [WasmKit benchmarks, discussion #843](https://github.com/holzschu/a-shell/discussions/843)
- [Apple backtracks on App Store removal threat for Unix shell iOS apps](https://appleinsider.com/articles/20/11/09/apple-backtracks-on-app-store-removal-threat-for-unix-shell-ios-apps)
- [iSH and a-Shell vs. the App Store](https://mjtsai.com/blog/2020/11/09/ish-and-a-shell-vs-the-app-store/)
- [TCC — Tiny C Compiler](https://bellard.org/tcc/)
- [JSCPP](https://github.com/felixhao28/JSCPP)
