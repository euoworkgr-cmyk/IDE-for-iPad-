# L1 — A project switcher you can actually find

**Date:** 2026-08-19 · **Task:** L1 · **Milestone:** M3 · **Status:** Built — awaiting iPad

## What the task actually was

The bug report said "creating a new project makes the previous one disappear."
That had already been investigated and found to be false: projects persist, the
header listed them all, switching restored content, and it survived a reload.

So this was not a data task. It was a task about a control that lied about
itself. The header held a bare `<select>` showing the current project's name,
which reads as a **title** — nothing about it said other projects existed, and
nothing invited a tap. A user who never opened it had no reason to believe
anything was in there.

## What was built

**The header control now states the count on its face.** It is a button, not a
`<select>`:

```
┌──────────────────────────┐
│ Sensor logger            │
│ 3 projects            ▾  │
└──────────────────────────┘
```

The second line is the whole point. "3 projects" is visible without any
interaction, so the question the bug report was really asking — *are my other
projects still there?* — is answered before the user touches anything. When
there is more than one project the count is drawn in the accent colour; with a
single project it stays grey and reads "1 project", which is honest rather than
alarming.

The count is in the button's `aria-label` too, not only in the visual layout, so
it is not colour- or position-dependent.

**Tapping it opens a project list**, which is what `TASKS.md` suggested
considering. Each row carries the project name, its file count and when it was
last edited — enough to tell two similarly named projects apart. The open one is
marked three ways: a filled dot, an outlined row, and the words "open now".
`aria-current` marks it for assistive technology, and focus lands on it when the
list opens.

The list is where the answer to "which of these is which?" lives. That matters
because of the failure mode recorded in `PROJECT DIRECTION.md`: new projects
used to be seeded with an identical `Program.cs`, so every project looked the
same and switching looked like nothing had happened. The file count and edit
time give each row an identity.

## A gap this closed on the way

Rename and delete are now per-row actions in the list. They were header icon
buttons — and the stylesheet hid both below 520 px:

```css
.topbar > .icon-button[data-action="rename-project"],
.topbar > .icon-button[data-action="delete-project"] { display: none; }
```

On a narrow iPad, including Slide Over, **there was no way to rename or delete a
project at all**. Putting them on the rows makes them reachable at every width,
and that dead rule is gone. Verified at 320 px.

This also made the operations more precise: they used to act on whichever
project was open, so deleting a project you were not in was impossible. They now
take a project id. Deleting a project you are *not* in leaves your editor
exactly where it was — verified, because that is the obvious way to reintroduce
the "my project disappeared" complaint this task exists to remove.

## Design decisions worth recording

- **The list is ordered by most recently edited, and the open project is not
  floated to the top.** A list whose first row moves as you switch is harder to
  navigate, not easier. It matches the order `ProjectRepository` already
  returns.
- **Relative times are coarse** ("just now", "3 hours ago", "yesterday", then a
  date). A coarse answer stays correct without a timer re-rendering the list.
- **`New project` is in the list as well as the header.** Someone who opens the
  list to look for a project they cannot find is exactly the person who may want
  to make one.
- **The list stays open after a delete** and re-renders, so the user sees the
  result rather than being dropped back to the editor.

## Verification

`npm run check`, `npm test` (13 files, 131 tests, 18 new) and `npm run build`
all pass, from a **clean clone** as well as the working directory. Bundle cost
is +4.4 KiB on the main chunk (445.87 → 450.27 KiB); precache 14,192.67 →
14,198.97 KiB.

The display logic is pure and unit-tested on its own
(`src/projects/projectSummary.ts`): singular vs plural wording, every branch of
the relative-time formatter including a clock that has moved backwards, ordering
by edit time, non-mutation of the caller's array, and exactly one row marked
current.

Beyond that, 31 end-to-end checks in headless Chromium, all passing, at 1024 px
and at 320 px:

- The count is visible and correct with one project and with several, in the
  visible text and in the accessible name.
- Every project is listed, including ones created earlier — the original bug
  report, asserted directly.
- Tapping a row switches project; the choice survives a reload.
- Renaming another project from the list does not move you out of yours.
- Deleting another project leaves your editor untouched; deleting the open one
  falls back to another; the last project is protected.
- Escape and the close button both dismiss the list.
- No horizontal overflow at 320 px, and rename/delete are reachable there.
- No uncaught page errors.

### What iPad verification still has to establish

1. **Whether there was a real WebKit `<select>` problem underneath.** `TASKS.md`
   flagged this as never reproduced on Safari. The `<select>` is now gone, so
   if the original complaint was partly a WebKit rendering issue, this change
   removes it rather than fixing it — worth confirming the new control behaves
   on device.
2. **`showModal()` on iPad Safari.** The snippet and settings dialogs already
   use it, but this is the first one on the critical path of switching project.
3. **Touch targets.** Rows are 52 px and the row actions 38 px. Confirm the
   rename/delete buttons are comfortably tappable next to a row that switches
   project — a mis-tap there deletes something.
4. **Long project names** at Slide Over width, where the name ellipsizes.
