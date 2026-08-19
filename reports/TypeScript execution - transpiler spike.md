# TypeScript execution — transpiler spike

**Date:** 2026-08-19 · **Task:** L5 · **Milestone:** M1 / Phase 2

`PROJECT DIRECTION.md` requires a bundle-size measurement before any
integration code is written for TypeScript execution. This is that
measurement. It was taken first; the implementation followed the result.

## What was measured

Each candidate was bundled on its own with esbuild (`--bundle --minify
--format=esm --target=safari16`) around the smallest entry point that performs
a type-strip, and the output measured raw and gzipped. WebAssembly-based
candidates ship their payload as a separate file rather than in the bundle, so
the `.wasm` size is quoted directly — it is what the Workbox precache would
have to carry.

| Candidate | Raw | Gzipped | Verdict |
|---|---:|---:|---|
| **sucrase 3.35** | **201.2 KiB** | **46.0 KiB** | **Chosen** |
| typescript 5.9 (`transpileModule`) | 3,478.4 KiB | 995.7 KiB | Rejected |
| esbuild-wasm 0.25 | 11,834.7 KiB (wasm) | — | Rejected |
| @swc/wasm-web 1.7 | 22,178.2 KiB (wasm) | — | Rejected |

Note on the `typescript` package: the repository already depends on
`typescript@7.0.2` as a dev dependency, but v7 is the native compiler and
ships platform binaries, so it cannot run in a browser at all. The measurement
above is against `typescript@5.9.2`, the newest version that still ships the
JavaScript `transpileModule` API. Using it would have meant pinning a second,
older TypeScript purely to run code.

## Why sucrase

The three rejected candidates were rejected on weight alone. The precache is
already 13,989 KiB, dominated by Pyodide; adding 996 KiB gzipped for
`typescript`, or 11.8 MiB for esbuild-wasm, is a large cost for a step that
only has to delete type annotations.

Sucrase is transpile-only by design: it does no type checking and does not
build a full AST. That is the right trade for Altitude. Altitude has no
type-checking UI and no place to report a type error, and a type error should
not stop a run — `tsc` itself emits JavaScript for type-error input by default.
What Altitude needs is exactly what sucrase does.

## Measured cost of the integration

Production build, before and after, on the same machine:

| | Before | After | Delta |
|---|---:|---:|---:|
| Workbox precache | 13,989.09 KiB | 14,192.67 KiB | **+203.58 KiB (+1.46%)** |
| Precache entries | 21 | 22 | +1 |
| Main chunk (`index-*.js`) | 439.72 KiB (141.80 gz) | 445.87 KiB (143.30 gz) | +6.15 KiB (+1.50 gz) |
| Worker chunk | 2.45 KiB | 2.89 KiB | +0.44 KiB |
| Transpiler chunk | — | 201.38 KiB | new |

The +6.15 KiB on the main chunk is the L4 settings work in the same commit, not
the transpiler. The transpiler's whole weight is the new 201.38 KiB chunk.

### Keeping it out of the JavaScript path

The first build put all 201 KiB inside the Worker chunk: Vite's default worker
format is `iife`, which cannot code-split, so the dynamic `import()` was
inlined and every plain JavaScript run would have loaded the transpiler.

Setting `worker.format: "es"` in `vite.config.ts` fixed this — the transpiler
became its own chunk and the Worker chunk stayed at 2.89 KiB. This is also
simply more correct: the runtime already creates its Worker with
`{ type: "module" }`, so an ES-format build is what it was asking for. Module
workers are supported from Safari 15, and the build targets Safari 16.

The precache total is the same either way — everything precaches — so this buys
parse time on a JavaScript run, not download size.

## What sucrase does not do

Verified by executing the stripped output, not by reading the emitted code:

- **Works:** annotations, `interface`, `type`, generics, `as` / `satisfies`,
  non-null assertions, `import type`, `abstract` / `implements`, `enum`,
  constructor parameter properties, top-level `await`.
- **Does not work:** `namespace` / `module` blocks are dropped rather than
  compiled, so code depending on them fails at runtime with a `ReferenceError`.
  TypeScript's own `erasableSyntaxOnly` mode forbids namespaces for the same
  reason, so this is a shrinking corner of the language, but it is a real gap
  and it is not diagnosed — the failure surfaces as a runtime error.
- **Not attempted:** `.tsx` needs the JSX transform and a React-shaped runtime
  that Altitude does not ship, and `.cts` is CommonJS, which the Worker's
  module execution cannot run. Both stay unrunnable, matching how `.cjs` is
  already excluded from the JavaScript path.

## Conclusion

Sucrase at +203.58 KiB precache (+1.46%) is proportionate to what TypeScript
execution is worth. The alternatives cost between 5x and 58x more for the same
type stripping. The spike discipline that stopped the C# work supported this
one going ahead.
