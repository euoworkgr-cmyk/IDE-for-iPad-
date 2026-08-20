# L8 — First-run welcome experience

**Date:** 2026-08-20 · **Milestone:** M3 · **Status:** done, verified on real
iPad Safari.

## What the task actually turned out to be

`TASKS.md` listed three empty screens as outstanding: no projects, no files in
the current project, and an empty Run console. Reading the code before writing
any showed that **two of the three could not happen**:

- **No projects.** `App.start()` seeds a project when storage returns none, and
  `deleteProject()` refuses to remove the last one ("Create another project
  before deleting this one"). The state is unreachable.
- **Empty Run console.** The console panel carries `hidden` until the first run
  — `setConsoleOpen(true)` is only called from `runActiveFile()` — so there is
  no blank panel for a first-time user to be puzzled by. The maintainer
  confirmed this should stay as it is: the console should not sit there idle at
  the start, and the Run button is prominent enough on its own.

That left one real state, plus two defects found on the way.

## The empty project is now a real, supported state

Previously it was impossible in a different way: deleting the last file
silently created **`Untitled.cs`** — a C# file, the one language Altitude
cannot execute. So emptying a project left the user staring at a file that
could not run and that they had not asked for. The same fallback lived in
`ensureActiveFile()`.

Both are gone. **Nothing is invented to fill an empty project.** Deleting the
last file leaves the project genuinely empty, and the interface says so:

- The **file list** reads "No files yet — use ＋ to create one."
- The **editor pane** shows a centred empty state: a heading, one sentence
  naming which extensions can actually be run (`.py`, `.js`, `.ts`), and a
  **Create a file** button.
- The tab reads *No file*, the status bar reads *No file*, and **Run** is
  disabled with the title "Create a file to run something".

This survives a reload — `activeFileId` is stored as `""` and the empty state
comes back — and switching away to another project and back restores it.

### A defect the browser check caught

The first version layered the empty state over the editor in the same grid
cell. It looked right and was **unusable**: CodeMirror's content div sits on
top and intercepts pointer events, so the "Create a file" button could not be
clicked at all — on iPad, tapping it would simply do nothing.

The fix is better than a `z-index` would have been: the editor host is now
`hidden` outright when no file is open. A blank editor with no file behind it
was wrong anyway — it accepted a text cursor and swallowed keystrokes that had
nowhere to be saved.

## The new-file prompt no longer defaults to C#

`newFile()` pre-filled `Untitled.cs` and its example read `src/App.cs`. Both
pointed at the only language that cannot run. As requested, there is now **no
default name and no default extension at all** — the prompt opens empty — and
the example is `src/helpers.py`.

The `uniqueFileName` helper existed only to number that default (`Untitled2.cs`
and so on) and was deleted with it.

What is unchanged: a **newly created project** still seeds a runnable `main.py`
carrying the welcome comment. That was the part of L8 already done, and the
point of it — a first-time user presses Run and gets output — still holds. Only
the invented replacement file is gone.

## The console

No change, by decision. It stays hidden until the first run, and the existing
**×** in the console header hides it again when it is in the way — verified
working, along with the editor reclaiming the space (`data-console="closed"`)
and the console returning on the next run.

## Verification

```
npm run check   ✅
npm test        ✅ 17 files, 201 tests
npm run build   ✅
```

The empty states are DOM behaviour and this project has no jsdom test
environment, so they are covered in a real browser, as L1's interface work was.

**Headless Chromium, 20/20:** a new project seeds one `main.py`; deleting it
invents no replacement; the file list and editor both explain the empty state;
the tab reads *No file*; Run is disabled with the right reason; the editor is
blank rather than still showing the deleted file; the empty project survives a
reload; the new-file prompt suggests **no name at all** and its example is a
`.py` file, from both the empty-state button and the header ＋; creating a file
clears the empty state and re-enables Run; the console appears on a run, hides
on **×**, gives the space back, and returns on the next run.

**Edge cases, 9/9:** exporting a project with no files throws nothing and still
produces a zip; a second project gets its own seeded `main.py`; switching back
to the empty project restores the empty state; rename and delete are harmless
no-ops with no file open; the last project still cannot be deleted.

**Verified on iPad Safari (2026-08-20).** Confirmed by the maintainer on the
deployed preview.

## Size

Precache: **14,213.39 → 14,214.88 KiB (+1.49 KiB).**
