# Export — one file or the whole project

**Date:** 2026-08-20 · Follow-up after L1–L8 · **Status:** done, verified on
real iPad Safari.

## The request

> The Export ZIP button currently saves more than just your code — it includes
> additional files. There should be a choice: export either the selected file
> or the entire project.

## What the zip actually contained

Worth stating plainly, because the fix is different depending on the answer:
`exportProject()` zipped `project.files` and nothing else. There were no
metadata files, no manifest, nothing Altitude added of its own. Confirmed in a
browser — a two-file project exports a zip with exactly two entries.

So "more than just your code" meant **everything in the project, when you
wanted the file you were looking at**. That is what changed.

## What was built

**Export is now a choice.** The header button (relabelled from *Export ZIP* to
*Export*, since it no longer always makes one) opens a small dialog with two
targets:

- **This file only** — with the open file's path underneath it.
- **The whole project** — with "*N* files, as a .zip" underneath it.

Plus Cancel, which downloads nothing.

**A single file is saved as itself**, not wrapped in an archive:
`src/utils/math.py` arrives as `math.py`. Unpacking a zip to reach one file is
work the user did not ask for, and iPadOS Files makes it more work than a
desktop does. The whole-project export is unchanged — same zip, same structure,
same name.

**The export is what is on screen.** The old path flushed pending saves before
zipping; it now also commits the editor's current content first, the way the
Run path already did. An edit made a second before pressing Export is in the
file, rather than whatever was last written to IndexedDB.

**An empty project says so** — "This project has no files to export yet." —
instead of opening a dialog offering two ways to download nothing. (Exporting
an empty project still produces a valid empty zip if it is reached another way;
that is covered by a test.)

## Structure

`exportProject.ts` was one function that built a zip and drove a download link
in the same breath, which made it untestable without a DOM. It is now:

- `buildProjectArchive(project)` → `Download` — pure.
- `buildFileDownload(file)` → `Download` — pure.
- `exportFileName(path)` — pure; the file's own name, with the folders and any
  `..` segments dropped.
- `saveDownload(download)` — the only part that touches the DOM.
- `exportProject` / `exportFile` — the two composed for callers.

Path safety is unchanged in the archive and now applies to the single-file name
too: a path cannot escape into a name of its own.

## Verification

```
npm run check   ✅
npm test        ✅ 18 files, 211 tests (+10)
npm run build   ✅
```

New unit tests on the now-pure builders: every file packed with its folder
structure, the archive named after the project with filesystem-hostile
characters replaced, a fallback name when nothing of the name survives,
`..` segments dropped from archive paths, a valid empty archive, a single file
saved as itself with its own name and content, nested and escaping paths
reduced to a bare name, and Unicode content preserved byte for byte.

**Headless Chromium, 16/16:** Export opens a choice rather than downloading
immediately; the button no longer says ZIP; the summary and both option details
say what will happen; Cancel downloads nothing; "this file only" saves
`helpers.py` with the editor's exact contents; "the whole project" saves
`My Python Project.zip` containing exactly `main.py` and `utils/helpers.py` —
**two entries and nothing else**; an edit made a moment earlier is in the
export; an empty project explains itself instead of opening the dialog.

**Verified on iPad Safari (2026-08-20).** Confirmed by the maintainer on the
deployed preview.

## Size

Precache: **14,214.88 → 14,219.21 KiB (+4.33 KiB).**
