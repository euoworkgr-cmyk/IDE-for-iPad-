# R1 — Settings that fit the device

**Date:** 2026-08-22 · **Milestone:** M3 · **Status:** done, verified on real
iPad Safari.

First task of the release-preparation list (`TASKS.md`, R1–R8). Language work
stopped at nine of twelve target languages complete on all three A/B/C columns;
what is left before the PWA can ship is M3 and M4, and this is M3's **Settings**
item.

## What M3 asked for

> There is no settings *screen* — there is now a single-setting dialog holding
> the execution timeout, and the persistence layer behind it (`src/settings/`),
> built for L4. Still missing: editor font size (critical on iPad — the current
> size is a guess), light/dark/system theme, and tab/indent width. These can be
> added to the existing store rather than needing a new one.

All three are now there, and the prediction held: they went into L4's store, no
new persistence was needed, and no settings *screen* was built — the existing
dialog grew three controls. A screen would have been a bigger surface with
nothing more in it.

## Appearance

The problem was not that a light theme was missing. It was that **there was no
theme layer at all**: 154 colour literals were spread across `styles.css`, and
another 40 or so lived inside `src/editor/editorTheme.ts` as a second,
unrelated copy of the same palette.

So the work was mostly the tokenisation. Every colour in the application is now
defined once, per palette, at the top of `styles.css` and used through a custom
property everywhere else — **including inside the CodeMirror theme**, which
reads the same properties rather than carrying its own. That has a consequence
worth stating: switching appearance is one attribute on the root element. It is
not a reconfiguration of every open document, and it is not a rebuild of the
highlight style, so it costs nothing and cannot get out of step with the rest
of the app.

Two things could not be custom properties:

- **CodeMirror's `dark` flag.** `EditorView.theme(spec, { dark })` uses it to
  pick its own built-in styling, so it is not CSS. The theme is therefore
  generated twice from one spec and swapped through a compartment
  (`EditorAdapter.applyPreferences`).
- **The `theme-color` meta tag**, which is what tints Safari's toolbar. The
  appearance controller rewrites it.

### No flash on a cold start

The stored preference lives in IndexedDB and arrives asynchronously. If the
stylesheet did not already know what the system wants, every single launch
would paint the wrong palette and correct itself a moment later — which is
exactly the sort of thing that looks broken on a device.

The stylesheet's own default therefore follows `prefers-color-scheme`:

```css
:root { /* dark */ }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { /* light */ } }
:root[data-theme="light"] { /* light */ }
```

`AppearanceController` sets `data-theme` only once there is an answer to
honour, and an explicit Light or Dark then wins over the system in both
directions. Nothing is written to the page before that — covered by a test,
because it is the sort of invariant that is easy to break later by "helpfully"
initialising the controller.

**System is live.** The controller listens on the media query, so changing the
iPad's appearance (including on the automatic evening switch) re-themes the app
without a reload, and reconfigures the editor along with it.

### Contrast

The light palette was checked against WCAG AA rather than eyeballed. Four
values were darkened after the first pass because they came in under 4.5:1 —
the accent (`#0c8477` → `#0a7568`, which also lifted the white-on-accent
primary button from 4.58 to 5.59), the faint text used for section headings and
empty-state notes, and the editor's gutter numbers. Every foreground/background
pair the app actually renders now clears 4.5:1 except the disabled states,
which are meant to recede.

This is *not* the accessibility task — R3 covers VoiceOver, focus order and
Dynamic Type. It is only that shipping a new palette without measuring it would
have created work for R3 rather than saving it.

## Editor text size

11–24 px, default **15** — the value the editor theme previously hard-coded, so
nobody's editor changes size because they upgraded.

It is a slider rather than a number field. Choosing a text size is a "does this
look right" judgement, and on a tablet dragging one beats tapping a stepper.
The value is applied on `input`, not `change`, so the editor re-sizes as the
slider moves; the work behind that is setting one custom property, which is
cheap enough to do per frame.

## Indent width

2, 4 or 8 spaces, default 4 — and this one **fixed a real bug**.

`EditorAdapter` set `EditorState.tabSize.of(4)` and the status bar read
"Spaces: 4". But `tabSize` only says how wide a literal tab character is drawn.
What Tab actually inserts, and what every language mode's auto-indent uses, is
`indentUnit` — which was never configured, so CodeMirror's default of **two
spaces** is what the editor had always done. The status bar had been wrong
since the beginning. Both facets are now set together from the setting, and the
status bar states the setting rather than a constant.

Unlike the other two numbers this is a choice from a list, not a range.
Clamping would silently turn a stored `3` into `4`; a width the form cannot
show is a value the app should not be honouring at all, so `normalizeIndentWidth`
rejects it back to the default.

## Live preview, and what Cancel means

Appearance and text size apply **as you change them**, which is the whole point
of them — you cannot judge a text size from a number. That makes Cancel
load-bearing: closing the dialog without saving re-applies the stored settings,
so a rejected preview does not survive. Indent width previews too, for
consistency.

One behaviour changed deliberately. Saving while settings storage is
unavailable now leaves the dialog open with its explanation visible, instead of
closing immediately — the note said "this change lasts only until the app is
reloaded" and then hid itself before anyone could read it.

## Also fixed, found on the way past

A copy-paste in `styles.css` had pasted about sixty lines of `.export-option`
rules into the middle of the `@media (max-width: 520px)` block. It had
swallowed half of the rule that makes dialog action rows wrap on a narrow
screen, so `.snippet-dialog-actions` never wrapped — only
`.settings-dialog-actions` did. Restored to the two-selector rule it was
meant to be.

## Verification

`npm run check`, `npm test` (364 tests, 25 files) and `npm run build` all pass.

New unit tests cover the settings normalizers (including that a record written
by the L4 build, which had one key, still reads back with its limit intact) and
`AppearanceController` — explicit choice beating the system, System following a
live change, the controller leaving the page alone until it has a preference,
and the listener being released on dispose.

**Verified in headless Chromium, driven end to end:**

- a cold start under a light system paints light, and under a dark system dark,
  with nothing stored and `data-theme` set correctly in each;
- the `theme-color` meta follows;
- changing appearance, text size and indent width in the dialog applies before
  Save;
- Save persists, and all three survive a reload;
- Tab inserts **eight** spaces after choosing 8 — the `indentUnit` fix,
  observed rather than assumed;
- Cancel reverts a previewed appearance;
- Python still runs, and a traceback still renders as a failure block, in the
  light palette;
- no page errors in any of it.

**Size.** Precache 40,452.38 → 40,466.34 KiB (**+13.96 KiB, +0.03%**). The CSS
bundle is 17.41 → 25.82 KiB raw, 4.10 → 5.66 KiB gzipped — the cost of carrying
a second palette. No JavaScript chunk moved measurably.

**Verified on real iPad Safari, 2026-08-22.** The maintainer confirmed the
whole change on the branch's Cloudflare preview deployment before it merged —
the light palette, the text-size range and the system-appearance follow
included. Nothing WebKit-only turned up this time, which is worth recording
because the last two device checks each found one (L1's clipped focus ring,
L3's message-less `error.stack`). PR #35, merged into `main`.
