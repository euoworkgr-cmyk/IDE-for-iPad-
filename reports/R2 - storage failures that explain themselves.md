# R2 — Storage failures that explain themselves

**Date:** 2026-08-22 · **Milestone:** M3 · **Status:** done, verified on real
iPad Safari (see the addendum at the end — the device check found something
worth reading before this write-up's main body).

Second task of the release-preparation list. M3's **Failure handling** item
named five paths that "exist in the code but have never been deliberately
tested, and each one currently fails silently or cryptically". Reading the code
first, as L8 did, was again worth it: two of the five were worse than the
milestone said, and two problems it did not mention turned out to matter more
than one that it did.

## What each path actually did

| Path | Before |
|---|---|
| Quota exceeded mid-save | `console.error`, and the save pill read "Save failed" until the next successful save of any project overwrote it |
| Storage restricted (Private Browsing) | `PrimaryStorageError` → a dead page saying "check Safari website data permissions and reload", advice that changes nothing in the case it was shown for |
| Safari evicting Website Data | Nothing detected it. The app seeded a fresh project and looked like a first launch |
| Corrupt or half-written record | `listProjects()` cast `getAll()` straight to `Project[]`. One record missing its `files` array threw on first access and took the app down — making every *good* project unreachable too |
| A runtime failing to load | Surfaced, but as the browser's raw wording: "Failed to fetch" on Chromium, "Load failed" on Safari |

**Not in M3's list, found while reading.** These are the two that changed the
shape of the task:

- **The failure signals were hidden exactly where they were needed.**
  `styles.css` hid `.save-status` below **760 px** and `.storage-status` below
  **520 px**. On an iPad in Split View, or portrait on a smaller iPad, "Save
  failed" was not rendered at all. The only channel the app had for "your work
  is not being written" disappeared at the widths an iPad is most often used
  at. A better message in that pill would have fixed nothing.
- **Three different places wrote to the storage status line** — persistence,
  the recovery journal, and nothing at all for a failed save — so whichever ran
  last won, and a real problem could be overwritten by a routine message.

## The decision: session-only mode

Put to the maintainer, who chose it: when storage cannot be used, **the app
opens anyway and says so**, rather than refusing to start with a better
explanation.

`ProjectRepository` no longer throws on the way in. It falls back to an
in-memory store and raises a notice. Everything works — editing, running every
language, export — and nothing is kept. That is a deliberate trade, and it only
holds because the user is told: a session that keeps nothing is worth more than
a session that will not start, *provided* the banner is there.

This stays inside the standing constraint that `ProjectRepository` is the only
interface to project storage. The memory fallback is inside that same seam,
which is also the seam that gets swapped for a native storage bridge later.

## What was built

**A failure taxonomy** (`src/storage/storageFailure.ts`). `PrimaryStorageError`
was one class for everything, so the five cases could not be told apart.
Classification reads `DOMException.name` — the only part of an IndexedDB failure
that is stable across browsers — and looks through the repository's own wrapper
to the cause, which is where the real name lives after an `open()` failure.

Deliberately **symptom-based rather than browser-mode-based**. "Private
Browsing" cannot be detected reliably: modern Safari allows IndexedDB there with
a small quota and clears it on close, older versions refuse it outright, other
browsers differ again. What Altitude *can* observe is that a write did not
happen, and that is what the user is told.

**A notice bar**, in a row of the shell rather than a status pill. It cannot be
hidden by a media query, it states what to do rather than what went wrong, and
it offers Export — the escape hatch — from inside itself. One notice at a time,
and a persistent one is never replaced by a dismissible one: "nothing is being
saved" outranks "a project could not be read". The still-true conditions
(session-only, full, write-failed) cannot be dismissed, because dismissing them
would only hide the fact that nothing is being saved. The after-the-fact ones
(a damaged record, an eviction) can be.

**Validation on read** (`src/projects/projectRecords.ts`), the same shape as
`normalizeAppSettings`. Repair what can be repaired, skip what cannot, never
throw. A project with one unreadable file opens with its other files. A record
with no `id` is discarded rather than repaired — without an identity it cannot
be saved back, switched to or deleted, and inventing one would fork the project
on the next write — and the user is told how many were skipped.

**A full device does not degrade to memory.** It leaves everything already
stored exactly where it was, and switching to memory there would quietly abandon
it. Only a storage layer that has become unusable is worth falling back for.

**Repeat suppression.** Autosave fires every 350 ms; without it a failing write
would raise the same banner several times a second.

**Eviction detection** (`src/storage/evictionWatch.ts`), and it is **best effort
by design**. The marker lives in `localStorage`, which Safari often clears in
the same sweep as IndexedDB — when it does, there is nothing to compare against
and no warning appears. That is the right way to be wrong: a missed warning is
much better than telling someone their projects were deleted when they were not.
A first launch has no marker either, so it stays quiet.

**Runtime load failures** (`src/runtime/runtimeStartFailure.ts`). The load step
is now separated from the run's own error handling in all four heavy workers, so
a Pyodide that never loaded is not reported as though the user's program raised
it. The message names the runtime, explains that its files ship with the app and
are stored offline, says what to do — and keeps the browser's original wording
in parentheses, so a bug report still carries it.

**Three fixes to what was already there.** One method now owns the storage
status line. `.save-status` and `.storage-status` keep their *failure* states
visible at narrow widths while still hiding the idle text. And `setSaveState`
no longer says "Saved" in session-only mode — the write really did succeed, into
memory, so the top bar was the one place left that could tell the user their
work was safe while the banner two rows above said it was not.

`showFatalError` is no longer where a storage problem lands, so it now says
plainly that something went wrong, shows the message, and offers Reload,
instead of blaming browser settings.

## Verification

`npm run check`, `npm test` (**415 tests**, up from 405) and `npm run build` all
pass. 51 new unit tests cover classification, the notices, record
normalization, the repository's degradation, the eviction watch and the runtime
message.

**Driven end to end in headless Chromium**, with `window.indexedDB` removed to
reproduce the restricted-storage case:

- a normal start shows no notice at all, and the banner row collapses to 0 px;
- with no IndexedDB the app opens, the banner says "Nothing on this page is
  being saved", the status line says "Not saving", the save pill says "Not
  saved", and the dismiss button is not offered — clicking it does nothing;
- **Python still runs to completion in that state** and prints its output;
- a deliberately corrupt record written straight into the object store no longer
  stops the app: it opens with both projects, warns that one could not be read,
  and that warning dismisses;
- at **700 px wide** — the Split View case — the storage warning is visible,
  which it was not before;
- no page errors in any of it, in both palettes.

**Size.** Precache 40,466.34 → 40,480.85 KiB (**+14.51 KiB, +0.04%**).

**Not verified on real iPad Safari.** The case this exists for is real Safari
Private Browsing, which behaves differently from a removed `indexedDB` global —
it is the one path that cannot be reproduced faithfully anywhere else. Worth
testing on device: a Private Browsing tab, and a normal tab to confirm nothing
changed there.

## Addendum, 2026-08-22: what the device check actually found

This is appended rather than rewritten into the sections above — per this
repo's convention that reports are history — because it changes the story the
original write-up told, not just adds a footnote to it.

**The predicted device-only difference showed up, and it was bigger than
expected.** Testing in a real Private Browsing tab produced *no warning at
all*: creating a file and running code both worked exactly as in a normal tab.
The original report treated `window.indexedDB` removal as a faithful stand-in
for Private Browsing. It is not. Cross-checked against WebKit's own
tracking-prevention documentation: Private Browsing runs each tab on "a new
ephemeral session… where nothing is persisted to disk," and IndexedDB inside
it is "made ephemeral" rather than blocked. It works normally for the whole
session and is discarded, unannounced, when the tab closes. Nothing throws,
so session-only mode — built to react to a thrown error — has nothing to
react to. This also silently disarms `EvictionWatch`: its own `localStorage`
marker is wiped in the same private session, so there is no "you had projects
before" signal left to find on the next launch either.

**A proactive check was prototyped and then not shipped.** A diagnostic build
put the real `navigator.storage.estimate()` reading in the status bar rather
than guessing a threshold from web sources, which turned out to be necessary —
search results on this specific API in this specific mode were inconsistent
and mostly described a different, older API (`localStorage`'s separate
0-quota behaviour, not IndexedDB's). The maintainer's own device supplied two
real numbers: an ordinary tab's quota scales with free disk space, while a
private tab's read a suspiciously round **1000 MB** — a strong, device-sourced
signal that a quota-based heuristic was viable.

**Decided against it anyway.** Put to the maintainer as a choice, who took the
simpler path: Private Browsing is not a failure to recover from — it is a
setting the user chose — and warning about a choice they are already inside
of adds a heuristic (with its own false-positive risk on a genuinely
low-storage device) to solve a problem documentation solves for free. The
quota diagnostic was removed. In its place: a permanent, unconditional note in
the Settings dialog ("Private Browsing is not supported…"), and a matching
paragraph in the README's installation section. Neither depends on detecting
anything, which is the point — there is nothing reliable left to detect.

**Net effect on R2's actual scope.** The four other failure paths — a full
device, an unclassified write failure, a damaged record, a runtime that will
not load — are unaffected by any of this and remain as designed. Only the
"storage restricted" path changed shape: from a notice the app raises to a
caution the user reads before it matters, because current Safari never gives
the app a chance to raise it.
