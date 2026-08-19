# Rust and Go Execution on iPad — Research Review

Date: 2026-08-19
Type: review of an external research report, plus original measurement.
No production code changed.
Status: **complete — Rust and Go stay research, but "no known path" is no
longer an accurate description of either**

## 0. Summary for the impatient

An external deep-research report (ChatGPT, dated 2026-08-19) was supplied on
compiling Rust and Go locally on iPad. This document records what survives
contact with Altitude's constraints, what does not, and — because the report
measures nothing — the numbers that actually decide the question.

- **Roughly half the report is inadmissible here.** Its headline
  recommendation is a remote build host over HTTPS. That violates the
  zero-network constraint and was already rejected in the C++ spike as
  approach 5. It is not a new option; it is the same rejected one.
- **iSH and UTM SE are not features Altitude can ship.** They are separate
  App Store apps. "Install a different app and mount a Files folder" is a
  workaround a user may choose, not something Altitude can implement. Their
  only value to this project is as evidence that on-device compilation is not
  forbidden by iPadOS — which the C++ spike had already established.
- **The report's one genuinely new fact is Rubrc** — an experimental but real
  rustc + Cargo + LLVM + rust-analyzer stack running in a Web Worker. It is
  the first credible rustc-in-browser. It is also pre-release, cannot resolve
  external crates, and does not support proc macros.
- **The report's ranking of Rust above Go for in-browser compilation is
  backwards on the one axis this project decides by.** rustc drags LLVM, which
  the C++ spike already measured at **81.62 MiB compressed** on its own. Go's
  compiler has its own backend and no LLVM dependency.
- **Measured this session:** a Go compiler targeting the browser costs
  **≈14.96 MiB gzipped** for the minimum useful tier, against **103 MiB** for
  the C++/LLVM route. That is a **7× improvement** on the number that killed
  C++, and it is the first time a compiler-in-the-PWA option has landed within
  the same order of magnitude as Altitude itself.

**Recommendation: keep both out of the backlog, but reclassify. Go is now the
strongest pure-PWA compiler candidate this project has found — ahead of Rust
and far ahead of C++ — and it is worth one narrow, measured spike rather than
open-ended research.**

## 1. What the report is, and how it was handled

The supplied document is a broad survey with an unusual amount of
architectural care — it is right about the important distinctions, especially
that *"code is stored locally", "compilation is local", and "the result runs
locally" are three different properties*. That framing is genuinely useful and
is adopted below.

Its weakness is that it was written without knowledge of Altitude's
constraints, and it measures nothing. Every citation in it is an unresolvable
`citeturnNNsearchNN` token rather than a link, so **nothing in it was taken
on trust.** Load-bearing claims were re-verified this session; where the
report asserted a cost, that cost was measured directly.

One verification result worth recording: the report does not give Rubrc's
repository location, and the obvious guess (`rubrc/rubrc`) is a 404. The
project is at **`oligamiq/rubrc`**. Small, but it is the kind of detail that
costs an hour later.

## 2. Options, scored against Altitude's actual constraints

The standing constraints are offline-first, zero CDN, zero runtime network
dependency, and — from the C++ spike and the architecture end-state —
execution stays inside the embedded web layer.

| # | Option from the report | Admissible? | Why |
|---|---|---|---|
| 1 | Remote build host / HTTPS build proxy / Docker / Podman | ❌ **No** | Violates zero-network. Already rejected as C++ spike approach 5. |
| 2 | iSH + Alpine | ❌ Not shippable | A separate app. Altitude cannot implement it; a user can adopt it independently. |
| 3 | UTM SE + Alpine | ❌ Not shippable | Same, and slower — UTM SE is explicitly JIT-free. |
| 4 | Rubrc (rustc/Cargo → wasm, in a Worker) | 🟨 **Research** | Architecturally correct. Experimental; LLVM-sized; no external crates. |
| 5 | wasm-go-playground (Go gc → wasm) | 🟨 **Concept only** | Real, but stale, `runtime`-imports-only, and its author warns Safari is "unbearably slow". |
| 6 | TinyGo Playground | ❌ No | Compiles **server-side**. The report is right to flag that this is widely misread. |
| 7 | GopherJS | ❌ No | Requires an existing Go toolchain to run at all. |
| 8 | wasm-pack / cargo-wasm | ❌ No | Orchestrate a build on top of an installed Rust toolchain. |
| 9 | WASI / Emscripten | ❌ Not an option in itself | Output targets and a toolchain environment, not a compiler host. |

Options 6–9 are all instances of one confusion the report states well and
which is worth keeping in the project's own words:

> A wasm **target** is not a wasm **host**. `rustc --target wasm32-*` and
> `GOOS=wasip1 go build` both assume rustc or go is already running somewhere.
> Neither puts a compiler in Safari.

Only options 4 and 5 — the compiler itself compiled to wasm — are the right
shape for Altitude. Everything else either needs a second machine, a second
app, or a compiler that already exists on a host.

## 3. The measurement the report is missing

The C++ spike established the decision criterion for this project: **payload
size against a 13.66 MiB app**. LLVM/Clang → wasm cost 103 MiB compressed —
7.5× the entire application — and that single number, not any language
difficulty, is what deferred C++.

The report never asks this question about Rust or Go. So it was measured.

### Method

Host toolchain `go1.24.7 linux/amd64`, cross-compiling the Go toolchain itself
to the browser-facing target:

```sh
GOOS=wasip1 GOARCH=wasm go build -o gowasm/ cmd/compile cmd/link cmd/asm cmd/go
```

Gzip figures are `gzip -9`, matching how these would be served. Standard
library figures are the wasip1 **export archives** — the precompiled package
data a compiler needs to resolve imports — obtained via
`go list -export` against a clean, wasip1-only build cache.

### Results — Go toolchain compiled for wasm

| Component | Raw | Gzipped |
|---|---:|---:|
| `compile` | 39,461.16 KiB | **8,243.48 KiB** |
| `link` | 10,343.95 KiB | **2,708.86 KiB** |
| `asm` | 7,563.47 KiB | 1,951.50 KiB |
| `go` (driver) | 25,291.14 KiB | 5,890.62 KiB |
| **All four** | 82,659.72 KiB (80.72 MiB) | **18,794.47 KiB (18.35 MiB)** |
| **`compile` + `link` only** | 49,805.11 KiB (48.63 MiB) | **10,952.34 KiB (10.69 MiB)** |

### Results — wasip1 standard library export archives

| Scope | Packages | Raw | Gzipped |
|---|---:|---:|---:|
| Full `std` | 333 | 113.50 MiB | **25.66 MiB** |
| `fmt` hello-world, transitive | 55 | 20.02 MiB | **4.27 MiB** |

### What that adds up to

| Tier | Contents | Gzipped | vs. Altitude's 13.86 MiB precache |
|---|---|---:|---:|
| **Minimum useful** | `compile` + `link` + `fmt` deps | **≈14.96 MiB** | +1.08× — roughly doubles the app |
| **Full standard library** | all four binaries + full `std` | **≈44.01 MiB** | +3.2× |
| *(C++/LLVM, for reference)* | *xeus-cpp-lite stack* | *103.13 MiB* | *+7.5×* |

**This is the finding.** The minimum tier is about **one-seventh** the cost of
the C++ route. It is still a large addition — it roughly doubles the
application — but it is the first compiler payload this project has costed
that is in the same order of magnitude as Altitude itself rather than an order
above it.

The reason is structural and worth stating plainly: **Go does not use LLVM.**
Its compiler and linker are self-contained Go programs. rustc is not, which is
why the report's preference for Rust over Go as the in-browser candidate is
backwards by this project's own criterion — Rubrc necessarily carries the same
LLVM the C++ spike already priced at 81.62 MiB compressed, before rustc,
Cargo, or rust-analyzer are counted.

### Why the `go` driver is excluded from the minimum tier

Not merely to shrink the number. `wasip1` has **no process spawning**, and the
`go` driver's entire job is to spawn `compile` and `link` as subprocesses. It
cannot work unmodified in a browser regardless of size.

This is not a novel obstacle — it is the same one Rubrc solves, and its README
describes the solution exactly: *"no OS subprocess model; commands are
dispatched as direct wasm modules."* a-Shell solves the identical problem
natively via `ios_system`. Driving `compile` and `link` directly, as
wasm-go-playground does, is the established shape. **It does mean Altitude
would be reimplementing a slice of the `go` driver's build logic**, which is
real work and belongs in any estimate.

## 4. The cross-origin isolation convergence — relevant to L6 *now*

Rubrc requires the app to be served with:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Those are **the same two headers** that L6 option 1 needs for
`SharedArrayBuffer` + `Atomics.wait`, the mechanism that would preserve
Python's `input()` once Pyodide moves into a Worker.

This matters to a decision that is pending right now. L6's two options were
weighed as if cross-origin isolation were a cost paid solely for Python's
`input()`. It is not: it is also the entry ticket for **every** wasm-hosted
compiler worth considering later, all of which want threads. Option 2
(synchronous XHR through the Service Worker) buys Python `input()` and nothing
else, on a deprecated API.

The C++ spike's lesson — that a Chromium-only evaluation would have picked the
wrong path — has a counterpart here: **an option evaluated against one
feature's needs can be the wrong choice for the roadmap.** The headers are a
`_headers` file on Cloudflare Pages, and Altitude's zero-CDN rule means
`require-corp` breaks nothing.

**This does not decide L6** — that remains the maintainer's call — but it is a
new input, and it points at option 1.

## 5. Where the native shell changes things again

The C++ spike concluded that a native ARM compiler emitting wasm, executed by
WKWebView with JIT, beats an in-browser toolchain on size, compile speed and
run speed. That conclusion transfers to Go, and **fits Go considerably better
than it fits C++**:

- **No sysroot problem.** Go's standard library ships with the toolchain.
  There is no libc++/headers payload to assemble.
- **No external linker.** Go's linker is part of the toolchain and emits
  static output. The C++ compile→link→toolchain-assembly pipeline that the
  C++ spike listed as unavoidable work largely does not exist here.
- **Cross-compilation is first-class**, not a configuration exercise:
  `GOOS`/`GOARCH` is the whole interface.
- **Multi-file is native.** Go's unit of compilation is the package, so the
  "single file only" simplification breaks in a way the language already has
  an answer for.

The one iOS-specific obstacle is the same subprocess problem from §3, with the
same known solution. Go is therefore a *better* M6 candidate than C++ on
nearly every axis — while remaining gated on the same native shell.

## 6. Recommendation

1. **Reclassify Rust and Go in `PROJECT DIRECTION.md`.** "No known path yet"
   is no longer accurate. There are two identified paths of the correct shape,
   one with measured costs. They remain research, not backlog.
2. **Rank Go ahead of Rust** for any pure-PWA compiler work, on the measured
   size difference and the absence of an LLVM dependency. This reverses the
   external report's ordering, deliberately.
3. **Do not adopt Rubrc.** No external crates and no proc macros means a
   learner hits the boundary on their first `rand` or `serde` import. That is
   the same quality bar that disqualified JSCPP for C++, applied consistently.
4. **Reject the remote-build-host architecture explicitly**, so it is not
   re-proposed. It is well argued in the report and still inadmissible here.
5. **Feed §4 into the L6 decision** before it is taken.
6. **If Go is ever picked up, the spike is narrow and specific:** does the
   wasip1 `compile` binary actually run under a WASI shim in iPad Safari, and
   what is peak memory while compiling a small program? Size is now known;
   *that* is the open question.

## 7. Evidence strength

Per project convention. Nothing here was verified on iPad hardware, and no
wasm module produced this session was executed in any browser.

| Claim | How established |
|---|---|
| Go toolchain wasip1 sizes (all figures in §3) | **Measured** — `go1.24.7`, this session |
| wasip1 `std` export archive sizes | **Measured** — `go list -export`, clean cache, this session |
| Altitude precache = 14,192.67 KiB | Documented — L5 report / `TASKS.md`, not re-measured |
| LLVM → wasm = 81.62 MiB, stack = 103.13 MiB | **Measured** — prior C++ spike |
| Rubrc: components, targets, limitations, COOP/COEP | Read directly from `oligamiq/rubrc` |
| wasm-go-playground: gc-in-browser, Safari warning, `runtime`-only imports | Read directly from `ccbrown/wasm-go-playground` |
| Go compiler runs correctly under a browser WASI shim | **UNVERIFIED — the open question** |
| Peak memory compiling on iPad Safari | **UNVERIFIED — the other open question** |
| Alpine x86 Rust/Go package availability in iSH | Report's claim, not verified — not load-bearing, since iSH is inadmissible |

The last two unverified rows are what a spike would answer. Note the shape is
the mirror image of the C++ spike, which ended with size unknown and viability
known; here size is known and viability is not.

## 8. Sources

- [oligamiq/rubrc — Rust compiler that runs in the browser](https://github.com/oligamiq/rubrc)
- [ccbrown/wasm-go-playground](https://github.com/ccbrown/wasm-go-playground)
- [Go — WebAssembly wiki](https://go.dev/wiki/WebAssembly)
- `reports/C++ execution on iPad - research spike.md` — the 103 MiB measurement
  and the native-shell conclusion this review leans on
- External report supplied 2026-08-19 (ChatGPT deep research), reviewed above;
  its citations are unresolvable tokens and were not usable as sources
