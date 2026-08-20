# PHP — editor mode, autocomplete, and execution

Date: 2026-08-20
Status: **Done — verified on real iPad Safari 2026-08-20.** PR #22, merged
into `main`.

PHP is the sixth language Altitude can run and the first whose runtime is
bigger than the entire rest of the app. All three coverage columns land
together: the CodeMirror PHP mode, keyword and builtin completion, and a Run
button that executes the open file through **PHP 8.3 compiled to WebAssembly**,
in its own Web Worker.

## What ships

- **A — editor mode.** `.php` and `.phtml` files get `@codemirror/lang-php`,
  which handles a real PHP file: HTML outside the tags, PHP inside them.
- **B — autocomplete.** 58 keywords, 51 builtin functions and 8 magic
  constants. The package exports no completion source, so unlike SQL this list
  is hand-written — and deliberately scoped to what the shipped interpreter
  actually answers to. No `mysqli_*`, no `curl_*`, no `header()`.
- **C — execution.** `php-wasm` 0.1.0 (seanmorris), PHP 8.3.11, in a dedicated
  Worker, one per run. Output streams to the console as PHP writes it; the run
  is stoppable and covered by the run time limit.

## The decisions worth recording

### The build: `php-wasm` over `@php-wasm/web`, on size

Both were measured, in the repo, before choosing:

| Build | PHP 8.3 wasm | gzipped |
|---|---|---|
| `@php-wasm/web` (WordPress Playground) | 18.31 MiB (asyncify) / 17.68 MiB (JSPI) | — |
| **`php-wasm` (seanmorris)** | **12.56 MiB** | **3.15 MiB** |

`@php-wasm/web` is the more actively maintained of the two and is the one to
revisit if this ever needs WordPress-shaped features. It is also **5.75 MiB
larger for the same PHP version**, which on an offline-first app aimed at an
iPad is the deciding number — the same reasoning that chose sucrase over the
`typescript` package during the L5 spike. Size won.

### Only one PHP version ships, and that took a copy script

The package contains every PHP release from 5.2 to 8.5 — about 190 MiB of wasm
in `node_modules` — and its `PhpWeb` entry point reaches all of them through
twelve separate dynamic imports. Importing `PhpWeb` would make the bundler emit
*every* version.

So `scripts/copy-php-assets.mjs` copies exactly one build into `public/php/`,
and the Worker loads it by URL. **This is the pattern `copy-pyodide-assets.mjs`
already established**, down to the details: the copy is gitignored build output,
it runs from `postinstall`/`pretest`/`build` (now via a `prepare:runtimes`
script that does Pyodide and PHP together), and the main thread resolves the URL
and posts it to the Worker, because a Worker cannot derive it — its own script
lives in the built asset directory.

The script reads the `.wasm` filename out of the module rather than hardcoding
it, and **throws if it cannot find one**, so a package upgrade that changes the
layout fails the build instead of shipping a runtime with no interpreter.

The 190 MiB is a `node_modules` cost paid at build time. What ships is one
12.56 MiB file.

### A real WebKit-shaped bug, found before the device

The first browser run failed with `document is not defined`, and it is worth
recording *why*, because the failure had nothing to do with PHP:

```js
var specialHTMLTargets = [0, document, window];
```

That is Emscripten's HTML5 library, compiled into the build, and it runs at
module-initialization time with no guard. In a Worker neither identifier
exists, so the interpreter threw a `ReferenceError` before a line of PHP ever
ran. The whole module — every DOM, fullscreen and audio helper in it — is dead
code for this SAPI; only that one array literal touches it eagerly.

The fix is three lines in `phpWorker.ts`: declare `document` and `window` as
properties holding `undefined`. That makes the *identifiers* resolve while
leaving `typeof document` as `"undefined"`, so every guarded branch inside the
module still takes its Worker path — verified, that is exactly what happens.
Nothing else lives in that Worker, so the two globals reach nothing but the
interpreter.

The alternative was to run PHP on the main thread, which is what the package's
own demos do. That would have broken the standing constraint, frozen the
interface on `while (true)`, and made Stop impossible.

### The whole project is mounted, not just the open file

`require 'helpers.php'` is ordinary PHP, not an advanced feature, so all project
files are written into the interpreter's filesystem under `/altitude` — the
choice Python already makes, and reusing Python's `mapProjectFiles`, which
gained a root parameter for the purpose. Every path still goes through
`normalizeProjectPath`, so nothing can climb out of the root.

The entry runs as a **file** (`require '/altitude/index.php'`) rather than as a
source string. That is what makes `__FILE__`, `__DIR__`, a relative `require`,
and the filename in a parse error all name what the user actually wrote:

```text
Parse error: syntax error, unexpected end of file, expecting variable
or "${" or "{$" in /altitude/index.php on line 3
```

Nothing persists between runs. `autoTransaction` is turned off, which is what
the package uses to mirror its filesystem into IndexedDB — the same decision as
SQL's in-memory database, for the same reason: persistent storage belongs to
`ProjectRepository`.

### The run time limit had to grow a second phase

Every other runtime starts its timer when the Worker starts. PHP cannot: a
12.56 MiB wasm takes over a second to instantiate even warm, and any run time
limit a user would plausibly set — the default is 5 seconds, the minimum 1 —
could expire before their code began.

`PhpRuntime` therefore runs two budgets on one timer. Loading gets a fixed
120-second budget that exists only so a wasm that never arrives cannot hang the
Run button forever. **The user's configured limit starts when the Worker reports
that PHP is running their code**, so what it measures is their program. Both
phases are unit-tested, including the case that would have been the bug: 30
seconds of loading under a 5-second limit still finishes.

Python's answer to the same problem was to be exempt from the limit entirely.
PHP does better: it is limited, just not for someone else's download.

## Size

| Build | Precache | Entries |
|---|---|---|
| Before | 15,294.83 KiB | 23 |
| After | **28,614.98 KiB** | 29 |
| Delta | **+13,320.15 KiB (+87.1%)** | +6 |

This is by far the largest thing Altitude has ever added — it nearly doubles
the precache — and there is no version of "PHP offline" that does not. Over the
wire it is about **3.2 MiB gzipped**, since the wasm compresses to a quarter of
its size, but the precache figure is raw bytes and that is what a device holds.

**`maximumFileSizeToCacheInBytes` had to rise from 11 MiB to 16 MiB.** This is
worth understanding rather than just noting: Workbox *silently skips* files over
that limit instead of failing, so the old value would have produced a build that
looked fine, passed every test with a network, and simply failed to run PHP
offline. The comment in `vite.config.ts` says so, and the built `sw.js` was
checked to confirm both PHP assets are in the precache manifest.

Timings in headless Chromium, run end to end through the app: **746 ms** cold,
0.8–1.5 s warm. That is slower than SQL's 100 ms and much faster than Python's
first load. As with SQL, the Worker is not kept alive between runs.

## Verification

`npm run check`, `npm test` (261 tests, 21 files) and `npm run build` all pass.
14 new unit tests cover path validation, the `.php`/`.phtml` restriction, both
timeout phases, the startup budget, Stop, exit-code handling, and that every
project file is sent.

**40 checks in headless Chromium** against the production build:

- Hello world runs and reports `PHP 8.3.11`; string interpolation, `printf`,
  and output with no trailing newline all arrive.
- Inline HTML outside the tags is emitted, and `<?= $n ?>` short echo works
  inside a `foreach ... endforeach` block.
- An uncaught exception fails the run, keeps the output printed before it, and
  names `/altitude/index.php` and the line.
- A parse error fails the run and names the file and line.
- `require __DIR__ . "/helpers.php"` works across two project files, and
  `__FILE__` is the user's own path.
- `json_encode`, `preg_match`, `date`, `strrev`, `array_map` with an arrow
  function, and constructor property promotion all work — that last one
  confirming this really is PHP 8 syntax and not an older build.
- Stop ends `while (true)` in 39 ms and reads as *Stopped*; PHP runs again
  afterwards.
- JavaScript, SQL and Python all still run — Python specifically because
  `mapProjectFiles` is shared, and its check covers a cross-file import.
- No page-level console errors on any run.

**Not yet verified on real iPad Safari.** This is the one where that matters
most: a 12.56 MiB wasm module instantiated per run, in a tab that already knows
how to load Pyodide, on a device whose browser kills memory-hungry tabs without
warning. Worth checking specifically: the first cold run over a real network,
whether a second run soon after is still fast, and whether switching between a
PHP run and a Python run in the same session survives.

**Verified on device (2026-08-20).** Confirmed by the maintainer on real iPad
Safari: PHP is fully integrated — the editor mode, autocomplete, and execution
described above all work as built, including a run at this file size. PR #22
merged into `main`.

## Known gaps

- **`exit(3)` reads as a finished run.** `pib_run` does not return PHP's own
  exit status, so a deliberate non-zero exit is not distinguished from a clean
  one. Fatal errors, parse errors and uncaught exceptions *do* report as
  errors, which is the case that matters in an editor. A browser check asserts
  the current behaviour so it cannot change silently.
- **No `mysqli`, `curl`, `gd` or `intl`.** This build ships the core plus the
  common extensions; the package offers others as separate downloads, which
  would each add weight. PDO/SQLite is worth a look if PHP and SQL ever need to
  meet.
- **Nothing is served.** There is no request, so `$_GET`, `$_POST`, sessions
  and `header()` have nothing to act on. PHP here is the CLI, not a web server.
