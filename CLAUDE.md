# Altitude — working notes for Claude

Offline-first code editor for iPad. PWA: Vite + TypeScript + CodeMirror 6 +
Pyodide + IndexedDB. Execution — not editing — is the product.

**👉 [`TASKS.md`](TASKS.md) is the current working list — start there.** It
holds the agreed tasks **L1–L8** in the order they should be done, with status
for each. If you are here to build something, that file says what.

**Read [`PROJECT DIRECTION.md`](PROJECT%20DIRECTION.md) for the why.** It holds
the mission, the language-execution roadmap, the M1–M6 milestones, and the
standing architectural constraints. (Note the filename contains a space, not an
underscore.) `TASKS.md` is the short-term plan; this is the long-term one.

## Working model

Development happens in **this git repository**. Claude does both the planning
and the implementation, split across chats:

- **Architecture / planning chats** — scope work, review designs, decide
  trade-offs, review incoming diffs. No code changes.
- **Implementation chats** — work directly on the repo: branch, change code,
  run the checks, commit, push.

Either kind of chat should say which mode it is operating in if there is any
ambiguity. A planning chat that finds itself editing source has drifted.

### Merge protocol (agreed 2026-08-19)

The maintainer's only iPad is the verification step for every feature — see
Verification discipline below — so **they, not Claude, decide when a branch
is ready for `main`.** The split:

1. **Claude:** branch, implement, commit, push, open a PR against `main`
   (do this without waiting to be asked — it is standing instruction for this
   repo, overriding the general default of not opening a PR unannounced).
   Say plainly that it is pushed and awaiting the maintainer's iPad check —
   not "done".
2. **Maintainer:** tests the pushed branch on real iPad Safari.
3. **On explicit confirmation** — the maintainer says the tested change works
   and the task is finished — **that statement is itself the merge
   authorization.** Claude merges the open PR into `main` without asking
   again, then says so.
4. Further fixes on the same task go as more commits to the same branch/PR,
   not a new one. Once merged, the branch is retired — the next task starts a
   fresh branch off `main`, never reuses a merged one (a branch whose PR
   already merged has no live path back to `main`; pushing more commits to it
   afterward silently strands them — this is exactly what went wrong on
   2026-08-19 and is the reason for this section).

This does not relax anything else in the Git Safety Protocol — no
force-push, no `--no-verify`, no rewriting another author's history. It is
narrowly about who decides *when a normal merge happens*.

**Documentation-only exception (agreed 2026-08-20).** A PR that touches only
docs — `README.md`, `PROJECT DIRECTION.md`, `TASKS.md`, `CLAUDE.md`, files
under `reports/` — has nothing an iPad check could verify, so step 2 above
does not apply to it. **Claude merges a docs-only PR immediately after
pushing it, without waiting for the maintainer's separate confirmation.**
Still say plainly that it merged and why (nothing device-testable changed).
The instant this diff touches anything else — source, config, scripts,
assets — the ordinary protocol resumes in full: push, state the preview URL,
wait for the iPad check.

**Cloudflare Pages preview deployments are enabled (since 2026-08-19)** for
non-`main` branches, so step 2 above is literal: every pushed branch gets its
own preview URL the maintainer can open on iPad *before* merging. Before this
was enabled, only `main` was deployed, which made step 2 unsatisfiable for a
branch that hadn't merged yet — discovered during L2, worked around by
merging first and verifying after. Don't repeat that workaround now that
previews exist: get the preview URL and say it in the same message as
"pushed and awaiting the maintainer's iPad check," and wait for it to be
tested there, before `main`, same as every other step in this protocol.

**Finding the preview URL.** It is not a predictable branch-name slug — it is
keyed to the deployment hash (e.g. `https://18724d83.ide-for-ipad.pages.dev`)
and only exists once Cloudflare has built the pushed commit. After pushing
(a bare push is enough; a PR is not required for the build to start), read it
off the `"Cloudflare Pages"` GitHub check run for that commit — either
`pull_request_read` with `method: "get_check_runs"` once a PR is open, or the
check run's `details_url` / `html_url` otherwise. The check run's own fields
don't carry the link directly; fetch its `html_url` page (e.g. via WebFetch)
and read the `*.pages.dev` URL out of the rendered summary. Give the build a
few seconds after pushing before the check run appears at all.

Historical note: earlier work used a different split, where Claude acted only
as architect and a separate tool implemented changes in Google Drive. **That
workflow is retired.** Google Drive is no longer used for development, and
files should never be treated as living anywhere but this repository.

## Standing constraints

These apply to every feature. `PROJECT DIRECTION.md` is authoritative; the
load-bearing ones are:

- **Offline-first is hard.** Zero CDN, zero runtime network dependency.
  Everything ships in the bundle or does not ship.
- **`ProjectRepository` (`src/storage/database.ts`) is the only interface to
  project storage.** Nothing outside it touches `indexedDB` directly — that
  seam gets swapped for a native storage bridge later.
- **IndexedDB writes go through `SaveCoordinator`** (promise-chained). No
  unguarded concurrent writes.
- **New execution paths need defensive path validation**, matching
  `normalizeProjectPath` in `PythonRuntime.ts`.
- **Code execution belongs in a Web Worker**, not the main thread. See
  `JavaScriptRuntime.ts` for the pattern. (Python predates this and still
  runs on the main thread — a known, documented gap.)
- **Push back on scope creep.** Spikes get time-boxed and measured before
  commitment; see the C# report for why.

## Verification discipline

Do not report a feature as working on the strength of it having been written.

```bash
npm run check   # TypeScript (tsc -b)
npm test        # Vitest
npm run build   # production build + PWA precache
```

Verify from a **clean clone**, not just a working directory — a stale local
state has already hidden a broken build once (see below).

**No feature claim is "done" until verified on real iPad Safari hardware.**
Headless Chromium and simulators are necessary but not sufficient. WebKit is
where the surprises live — worker termination, Service Worker cache behavior,
and memory limits all differ. When iPad verification has not happened, say so
plainly and leave the phase open.

Report bundle-size and Workbox precache deltas for anything that adds weight.

## Repository gotchas

- **`public/pyodide/` is generated and gitignored.** It is copied from
  `node_modules/pyodide` by `scripts/copy-pyodide-assets.mjs` via
  `postinstall`, `pretest`, and `build`. It was once committed and the files
  arrived truncated at 768 KiB, which silently broke Python execution and the
  test suite. Do not commit these assets. If Python fails to start, run
  `npm run prepare:pyodide`.
- **`reports/`** is the project's written record — implementation reports and
  spike findings, including failures. Add a report for substantial work;
  do not rewrite past reports, they are history.
- Documentation is **English only**. Earlier reports were translated from
  Russian; keep new prose in English.

## Layout

```text
src/
  autocomplete/   completion providers
  components/     application UI (App.ts)
  editor/         CodeMirror adapter, theme, language adapters
  filesystem/     file import and ZIP export
  projects/       platform-independent project/file models
  runtime/        Python (Pyodide) and JavaScript/TypeScript (Worker) execution
  settings/       app settings model and persistence
  snippets/       snippet engine and storage
  storage/        IndexedDB, recovery journal, save coordinator
```
