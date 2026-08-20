# C, C++ and C# on iPad — Review of Incoming Research

Date: 2026-08-20
Type: review of an external research document, no production code changed
Status: **complete — three items adopted, three rejected, both language
verdicts unchanged**

## 0. Summary

The document ("Running C, C++, and C# Locally in an iPad PWA IDE") is broadly
competent and lands on the same conclusion Altitude already reached
independently: the C-family languages are not blocked by language support, they
are blocked by iPad memory. Its architecture section arrives at four rules,
**three of which Altitude already implements** — which is useful corroboration
rather than new direction.

What is genuinely new and worth keeping is narrow but real:

- **A working, fully client-side Roslyn reference implementation exists**
  (BlazorCodeEditor), plus a specific documented failure mode. This is the
  first concrete starting point the blocked C# v2 spike has had.
- **Two measured iPad memory ceilings** — a jetsam "highwater" band of
  316–522 MB, and `WebAssembly.Memory` rejecting a 2048 MB *maximum* on iOS
  Safari while 256 MB works. The second is the sharper finding: the declared
  ceiling is itself the problem, independent of actual usage.

What must be rejected is also clear: the document re-proposes **remote
compilation**, which the C++ spike already rejected on sight as a violation of
the offline-first constraint, and an **OPFS toolchain cache** built on a SQLite
persistence layer that Altitude deliberately does not have.

**Neither the C++ deferral nor the C# block changes.** Nothing in the document
addresses the size figures that produced either verdict.

## 1. The one number the document omits, measured

The document orders three C/C++ toolchains "lightest to heaviest" and
recommends starting with the lightest, **wasm-clang** (binji) — but gives no
size for it. That omission is the whole question, so it was measured directly
from the project's own demo host, 2026-08-20:

| Asset | Raw bytes | Raw | Gzipped transfer |
|---|---:|---:|---:|
| `clang` | 31,214,472 | 29.77 MiB | 10.21 MiB |
| `lld` | 19,490,094 | 18.59 MiB | 6.51 MiB |
| `sysroot.tar` | 9,297,920 | 8.87 MiB | 1.78 MiB |
| `memfs` | 345,442 | 0.33 MiB | — |
| **Total** | **60,347,928** | **57.55 MiB** | **≈18.6 MiB** |

Altitude's entire production precache today is **28,614.98 KiB = 27.94 MiB**
across 29 entries. So the document's recommended *first, lightest* step is
**+57.55 MiB — 2.06× the whole existing application**, held on device.

Two further corrections to the document's characterisation:

1. **It is not a C-only toolchain.** The document places wasm-clang at step 3
   of its build order as the plain-C option. wasm-clang compiles **C++** — the
   sysroot ships the C++ standard headers and libraries, and the project came
   out of a CppCon 2019 talk. Using it "for C" means paying the full C++ price
   for none of the benefit.
2. **It is the lightest of the three, and that is still not light.** 57.55 MiB
   raw versus the ~103 MiB measured for the xeus/LLVM route in the C++ spike.
   The ordering in the document is directionally correct; the conclusion it
   draws from that ordering is not.

The comparison that matters: if plain **C alone** is ever wanted, Altitude's
existing note already has a better answer — **TCC at ~100 KB**, roughly **600×
smaller** than wasm-clang, comfortably inside the current bundle. The document's
step 3 is strictly worse than the option already recorded in
`PROJECT DIRECTION.md`.

Also worth stating plainly: the author of wasm-clang calls it *"still very much
alpha demoware"*, and the repository has 45 commits total. Under the project's
general-audience quality bar, that is the same disqualification applied to JSCPP
in the C++ spike.

## 2. C# — the one section that advances a blocked item

This is the most valuable part of the document, and both of its load-bearing
claims were verified.

**The existence proof.** [BlazorCodeEditor](https://github.com/thatplatypus/BlazorCodeEditor)
is a fully client-side C# editor: Blazor WebAssembly hosts Roslyn, which
compiles the user's code at runtime, with metadata references resolved
in-browser and the **Webcil** format — a WASM-compatible representation of .NET
assemblies — used to get the result into executable form. No server at any
point. Because Roslyn is itself written in C#, it runs on the same .NET WASM
runtime as the compiled output; there is no separate native toolchain.

**The gotcha.** Roslyn builds concurrently by default, which the browser sandbox
does not support, throwing:

```text
System.PlatformNotSupportedException: Cannot wait on monitors on this runtime
```

The fix is one argument:

```csharp
var compilationOptions = new CSharpCompilationOptions(
    OutputKind.DynamicallyLinkedLibrary,
    concurrentBuild: false
);
```

**Honest limits on what this buys us.** Spike v1 failed with a
`TypeLoadException` resolving types from `System.Runtime`, which is a *different*
failure from the one documented here. So this does **not** explain, and does not
retroactively fix, why v1 died. What it provides is step 1 of the v1 report's
own recommendation list — *"get a minimal Roslyn compile/run working in
Chromium"* — as something with a known-good reference rather than a blank page,
plus one trap removed from the path.

**Size is untouched, so the block stands.** Spike v1 measured **≈29 MB** of
Roslyn overhead in web assets, across 855 published files. The document does not
engage with this at all. Since v1 was measured, PHP has taken the precache from
15,294.83 KiB to 28,614.98 KiB (+87.1%); adding another ~29 MB on top is a
larger proportional jump than PHP was, for a language whose runtime has never
once reached a working "Hello World" here. **C# remains blocked. The v2 spike
now has a starting recipe, and that is all that changed.**

## 3. The iPad memory ceiling — adopted as a standing constraint

The document's strongest general contribution, and it applies to everything
Altitude already ships, not just to C:

- A team reported a web app crashing **only on iPad**, with WebKit's GPU process
  killed by the OS's **jetsam** mechanism for "highwater" memory usage, observed
  in the **316–522 MB** band.
- Requesting a **2048 MB maximum** for a `WebAssembly.Memory` instance throws
  out-of-memory on iOS Safari 16.2. Lowering the *maximum* to **256 MB**
  resolves it — **the declared ceiling is the failure, not the actual usage.**

The second point is the one to carry forward, because it is counter-intuitive
and cheap to trip over. It reframes the screening question for every future
toolchain from "how much memory does it use?" to "what maximum does it
*declare*?" — a runtime that reserves generously can fail on iPad while using
almost nothing.

Altitude does not construct `WebAssembly.Memory` anywhere in `src/`; Pyodide,
`sqlite-wasm` and `php-wasm` each manage their own. So there is no code change
to make today. It becomes an **evaluation criterion for candidate toolchains**,
and an explanation to reach for first if a shipped runtime is ever reported
dying on device without a JS-visible error.

## 4. Architecture rules — three of four are already how Altitude works

The document proposes a "toolchain-pack" architecture. Checked against the code:

| # | Document's rule | Altitude today |
|---|---|---|
| 1 | One language loaded at a time | **Already true.** Each runtime is a separate lazily-constructed Worker; nothing hosts two language runtimes at once. |
| 2 | Fresh Worker per compile, terminated after | **Already true for JS, SQL and PHP** — `SqlRuntime` and `PhpRuntime` each build a Worker per run and `terminate()` it, sharing `src/runtime/workerExecution.ts`. **Python is the documented exception:** `PythonRuntime` reuses one Worker and only calls `discardWorker()` when a run leaves it untrustworthy. |
| 3 | Explicit conservative memory ceilings | Not applicable yet — see §3. Adopted as a screening criterion. |
| 4 | Cache toolchain packs in OPFS | **Rejected — see §5.** |

Rule 2's rationale is worth recording because it is better argued than the
project's own version: terminating returns the entire linear-memory allocation
to the OS and avoids heap fragmentation, and **fragmentation is the more likely
proximate cause of a jetsam kill than any single large allocation**. That is a
memory argument for the per-run Worker pattern; L7 arrived at the same pattern
from a *cancellation* argument. Two independent reasons for one design is a good
sign.

**It does put a question against the Python runtime.** Pyodide's Worker is
long-lived precisely because booting it is expensive, so "terminate after every
run" would trade a multi-second cold start onto every single Python run. That
trade is not obviously worth making and is **not** adopted here — but the
document names the cost of the current choice honestly, and if Python is ever
reported dying on device after a long session, this is the first thing to look
at.

## 5. Rejected

**Remote-build fallback ("build it early, costs almost nothing now").**
Rejected. `PROJECT DIRECTION.md` makes zero runtime network dependency a hard
constraint, and the C++ spike already rejected remote compilation on sight,
recording it *"only so nobody re-proposes it."* It has now been re-proposed by a
document that did not know the constraint. The rejection stands, and the reason
is not squeamishness about servers: a code editor whose C++ support silently
requires connectivity is not the offline-first product, it is a different one.

**OPFS toolchain-pack caching.** Rejected as written. The document grounds it in
*"the same OPFS plumbing used for the SQLite persistence layer"* — Altitude has
no such layer. Every storage-backed SQLite VFS is switched off **deliberately**,
because storage outside `ProjectRepository` is an architectural decision of its
own, not a convenience. Toolchain assets ship in the Workbox precache today.

**Lazily-fetched packs generally.** The deeper tension the document does not
notice: a "lazily-fetched pack" is a runtime network dependency for its first
use. A user who installs Altitude on wifi, flies, and then opens a `.c` file
gets nothing. Either a language works offline or it does not ship — the same
reasoning that made PHP accept a +87.1% precache rather than fetch on demand.
Any future pack system has to resolve this, and "cache it after first download"
does not.

## 6. Build order — independent confirmation

The document proposes: SQLite → PHP → C → C# → C++ → Java, reasoning that memory
limits should be characterised on cheap toolchains before expensive ones are
committed to.

**Steps 1 and 2 are already done** — SQL shipped 2026-08-20 (+1,075.62 KiB), PHP
the same day (+13,320.15 KiB), both verified on real iPad Safari. An outside
document independently proposing the exact sequence already executed is decent
evidence the sequencing instinct was right.

The remainder diverges from Altitude's roadmap in two places, and Altitude's
version is better supported in both:

- **C should mean TCC (~100 KB), not wasm-clang (57.55 MiB)** — §1.
- **Go belongs ahead of C++.** The document omits Go entirely. Altitude's
  research measured a browser-targeting Go `compile` + `link` plus a hello-world
  standard library at **≈14.96 MiB gzipped**, one-seventh the LLVM route, with
  no sysroot and no external linker. On the document's own "cheapest risk first"
  logic, Go outranks C++ — and it did not consider it.

## 7. Evidence table

| Claim | How established |
|---|---|
| wasm-clang totals 57.55 MiB raw / ≈18.6 MiB gzipped | **Measured** — HTTP `content-length` from `binji.github.io/wasm-clang`, this session |
| wasm-clang compiles C++, is "alpha demoware", 45 commits | **Verified** — project README read directly |
| Altitude precache = 28,614.98 KiB / 29 entries | **Measured** — recorded in the PHP report |
| Python's Worker is long-lived; SQL/PHP terminate per run | **Verified** — read from `src/runtime/*.ts` this session |
| Altitude constructs no `WebAssembly.Memory` | **Verified** — grep over `src/`, `scripts/`, `vite.config.ts` |
| BlazorCodeEditor: client-side Roslyn, Webcil, `concurrentBuild: false` | **Verified** — repository and independent write-up |
| Roslyn overhead ≈29 MB, `TypeLoadException` | **Measured** — spike v1, `reports/C# Roslyn WASM spike.md` |
| Go ≈14.96 MiB gzipped | **Measured** — `reports/Rust and Go execution on iPad - research review.md` |
| jetsam highwater 316–522 MB | **Second-hand** — reported in the document, not independently confirmed |
| `WebAssembly.Memory` max 2048 MB fails / 256 MB works on iOS 16.2 | **Second-hand** — reported in the document, not independently confirmed |
| Wasmer JS SDK tested working in Safari | **Second-hand, and desktop** — vendor claim; the project's own rule is that desktop Safari is not evidence for iPadOS |

The last three rows are the document's own uncorroborated claims. The two memory
figures are adopted anyway — not because they are proven, but because they are
cheap to design around and expensive to discover late. The Wasmer Safari claim
is **not** adopted as evidence of anything, per the standing rule.

## 8. What this changes

- `PROJECT DIRECTION.md` — C# row gains the v2 spike's starting point; the
  C (alone) row gains the measured wasm-clang comparison; a new standing
  constraint records the iPad memory ceiling.
- **No source changes.** Nothing here is implementable today.
- **No verdict reversals.** C++ stays deferred to the native shell, C# stays
  blocked, Go stays ahead of C++ as the better M6 candidate.

## 9. Sources

- [wasm-clang (binji)](https://github.com/binji/wasm-clang) · [demo host](https://binji.github.io/wasm-clang)
- [BlazorCodeEditor (thatplatypus)](https://github.com/thatplatypus/BlazorCodeEditor)
- [Compiling and running C# in the browser with Roslyn (Zack Yang)](https://yangzhongke8.medium.com/without-blazor-webassembly-develop-a-web-site-that-compiles-and-runs-c-code-on-browser-c381873f6d03)
- [Emception](https://github.com/jprendes/emception) · [Wasmer: Clang in the browser](https://wasmer.io/posts/clang-in-browser)
- Prior Altitude work: `reports/C++ execution on iPad - research spike.md`,
  `reports/C# Roslyn WASM spike.md`,
  `reports/Rust and Go execution on iPad - research review.md`,
  `reports/PHP execution - php-wasm in a Worker.md`
