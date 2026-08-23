# R3–R8 — Release preparation

**Date:** 2026-08-23 · **Milestones:** M3 and M4 · **Status:** R3–R6 built,
**awaiting the maintainer's iPad Safari check**; R7 and R8 are documentation
and are done.

Written as one report because these six were built in a single pass, against a
standing instruction: get everything to a state the maintainer can check when
an iPad is next to hand. Nothing here has been on device.

---

## R3 — Accessibility

### Dynamic Type

The hard part was that **the web has no API for the system text size**. There
is no media query for it and no property to read.

What iOS does expose is the `-apple-system-body` font shorthand, which resolves
to the user's current Dynamic Type body size. Measuring an offscreen probe
styled with it is the only reliable way to read that number, so
`DynamicTypeController` does exactly that: measure, divide by the 17 px
default, publish the ratio as `--ui-scale`, and multiply all 58 UI font sizes
by it.

Three decisions worth recording:

- **Clamped to 1–1.6.** The largest accessibility sizes are roughly 3×, which
  would leave no room for the editor on an iPad. A cap is a compromise, but an
  interface the user cannot reach is not an accessible one.
- **Never scales below 1.** The app already has its own text-size setting;
  shrinking the chrome further only makes touch targets harder to hit.
- **The editor is deliberately excluded.** It has its own explicit setting from
  R1, and a user who chose 15 px meant 15 px. Only the surrounding chrome
  follows the system.

Re-measured on `visibilitychange` and `resize`, because changing the system
text size means leaving the app for Settings and coming back — precisely when
the cached value goes stale.

Where `-apple-system-body` does not resolve — every non-Apple browser — the
measurement returns `undefined`, which means *leave the scale alone*, never
"assume something". That distinction is tested.

### Landmarks, names and focus

- Named `toolbar`, `explorer`, `editor` and `status` regions.
- A **skip link**, because the explorer and snippet panel sit between the top
  bar and the editor in DOM order — a keyboard user otherwise crosses several
  dozen controls to reach the thing they opened the app for.
- **`aria-current` on the open file.** Which file is open was signalled only by
  a background colour, which a screen reader cannot see.
- The **Run button's glyph** moved into an `aria-hidden` span. Set as one
  string, VoiceOver reads "black right-pointing triangle Run"; split, it reads
  "Run", and `title` still carries the fuller description.

### Contrast

R1 measured the light palette and never the dark one. Auditing all 34
foreground/background pairs found **four below WCAG AA**:

| Token | Before | After |
|---|---|---|
| `text-faint` on raised surfaces | 4.14 | 4.86 |
| `editor-gutter-text` — line numbers | 2.95 | 5.10 |
| `syn-comment` | 4.11 | 5.48 |
| `text-disabled` | 3.26 | *left as-is* |

Disabled text stays where it is: WCAG 1.4.3 explicitly exempts inactive
controls, and lifting it would make disabled buttons read as available.

### A layout regression, from R2 rather than from this task

Found while testing Dynamic Type, and worth recording because it shipped.

The notice bar added in R2 is `display: none` until something needs saying. With
`grid-template-rows` but no explicit row assignments, a hidden element is not a
grid item — so **every remaining child shifted up one row**. The status bar
landed in the flexible `1fr` row and swallowed all leftover height, while the
workspace shrank to its content.

It was subtly visible in R2's own screenshots and I did not catch it: the
verification checked that the hidden notice added no gap *below the top bar*,
which was true, and never measured the status bar. Every child now names its
own row, which is immune to a child disappearing.

**Verification.** 428 tests. Landmarks present; skip link off-screen at rest,
revealed on focus, and moves focus to the editor when activated; `--ui-scale`
1.6 scales the chrome while the editor holds its own size. Layout correct at
both scale extremes and with a notice showing.

---

## R4 — iPad-native UX

### Keyboard

Cmd+Enter was the only shortcut, which is thin for a device people attach a
hardware keyboard to specifically so they can write code on it. Added: save,
new file, next/previous file, settings, export, and Escape-to-close.

Kept as a pure `matchShortcut()` mapping — testable without a DOM, and readable
as one table rather than inferred from listeners scattered across the file.

Details that matter:

- **Cmd *and* Ctrl** are both accepted. An iPad Magic Keyboard sends Cmd; a
  USB-C or Bluetooth PC keyboard sends Ctrl, and both get plugged into iPads.
- **Alt is excluded** from every binding, so a shortcut cannot fire while
  someone is typing an accented character.
- **A modal dialog owns the keyboard while open.** Escape closes the dialog
  rather than the console behind it, and Cmd+N cannot create a file the user
  cannot see.
- **Escape with nothing to close is left to the browser** rather than being
  swallowed.

### The software keyboard

The classic iPad web-app failure: the keyboard slides over the page **without
changing `100dvh`**, so the bottom of the layout — the status bar, the console,
and the line being typed — ends up underneath it.

`visualViewport` is the only API reporting the area actually left visible, so
`ViewportFitController` sizes the shell from that, and publishes
`--keyboard-inset` and a `data-keyboard` flag for anything that wants to style
around it. `100dvh` remains the CSS fallback, so nothing changes on a browser
without `visualViewport`.

One detail from testing real-world behaviour: the inset is **clamped at zero**,
because Safari briefly reports a visual viewport *taller* than the layout one
during rubber-band scrolling, and a negative inset would push the status bar
off-screen.

**Verification.** Every shortcut performs its action; Escape prefers a dialog to
the console; the console closes on Escape once open. No horizontal overflow and
the status bar on screen at **320, 507, 678 and 768 px** — Slide Over through
Split View. Rotating 820×1180 → 1180×820 **mid-edit** preserves the document and
re-fits the layout, with `--app-height` tracking the viewport both ways.

---

## R5 — Updates you can see

The app was on `registerType: "autoUpdate"`. That calls `skipWaiting()` as soon
as a new worker installs, swapping the assets under a running page. For an
editor holding unsaved work and a loaded multi-megabyte language runtime, that
is a mid-session rug-pull — and a lazily-imported chunk requested afterwards
may no longer exist at the URL the old build expects.

Now `"prompt"`: the new worker waits, and a notice offers **Reload**.

**The detail that would have made this not work.** A plain
`window.location.reload()` does not activate a waiting worker — the old one
still controls the page, so the reload just serves the old assets again. The
Reload button routes through the registration's own updater, which posts
`SKIP_WAITING` first and reloads once the new worker has taken over. Confirmed
in the built `sw.js`: it registers a `SKIP_WAITING` message listener and no
longer calls `skipWaiting()` at install.

R2's notice bar was **generalised rather than duplicated**: its `offerExport`
boolean became an action slot (`"export"` or `"reload"`) and it gained an
informational severity. One bar now carries storage problems and update news.
The update notice is dismissible on purpose — an update is not urgent, and
someone mid-debug should be able to put it away.

The running **version** now appears in Advanced settings, injected from
`package.json` at build time. A prompt is only half of legible updates; the
other half is being able to check afterwards that it took.

---

## R6 — Data safety

Export already covered one file or one project. **Neither is a backup**: Safari
can clear Website Data and take every project at once, and R2's eviction
detection can only report that after the fact, never undo it.

**Backup** is one JSON file holding every project and file, stamped with the
format version, the app version and a date. JSON rather than a zip of zips
because a backup has to survive being opened by something that is not Altitude,
and a person looking at it in Files should be able to see their code really is
in there.

**Restore is additive and cannot destroy anything.** A project whose id is free
keeps it, so a clean restore onto a wiped device is exact; a colliding id is
brought in as a copy with a fresh id and a "(restored)" name. That means there
is no destructive-action confirmation to get wrong, and restoring the wrong file
is untidy rather than costly.

Everything in the file goes through the same normalizer that guards records read
from storage, since a backup is a file from outside the app — possibly
hand-edited, possibly truncated by whatever copied it.

**The Export dialog no longer refuses to open for an empty project.** It used to
bail with "This project has no files to export yet", which would have blocked
Restore in exactly the situation it exists for: the project in front of you is
empty *because* storage was cleared. The per-file and per-project options
disable themselves instead.

**Verification.** Two projects with distinctive content backed up; IndexedDB and
`localStorage` wiped; both restored with content intact. Restoring the same file
twice took 3 projects to 5, with marked copies and nothing lost. A JSON file
that is not a backup is refused with a clear message rather than partly applied.

### A testing note worth keeping

The duplicate-restore check appeared to fail at first — the database stayed at
three projects. It was the **test**, not the product: Playwright's
`setInputFiles` does not re-fire `change` for an identical file, so the second
restore never ran, and the assertion was reading stale `textContent` from an
element that was actually hidden. Resetting the input's value first — which is
what the real Restore button does before opening the picker — showed the
collision path working correctly. Recorded because "the test was wrong" is a
conclusion that deserves evidence, and the evidence was the probe output showing
the handler was never entered.

---

## R7 — Documentation and a privacy statement

**`HELP.md`** — the user guide: getting started, running code and what Run does
per language, files and projects, the full shortcut table, autocomplete and
snippets, settings, keeping work safe, offline, updates, every error message the
app can show, and what is not supported yet.

**`PRIVACY.md`** — required by the App Store and worth having for the PWA
regardless. Written from what the code actually does rather than from a
template: the only `fetch` in the entire source is same-origin, loading the
app's own bundled C# reference assemblies. No analytics, no third parties, no
outbound requests.

It is also **honest about the one thing that is not zero**: Cloudflare's
infrastructure logs requests when the app is downloaded, as any web server does.
Claiming otherwise would have been easy and wrong.

Both are linked from the README and from Settings → Advanced settings, so the
privacy statement is reachable from inside the app — which the App Store will
require later.

---

## R8 — The written release checklist

`RELEASE-CHECKLIST.md`. Ten sections: the build, all nine languages, storage
failures, offline, updates, device fit, accessibility, WebKit performance, the
words, and distribution — plus a sign-off block recording version, commit, date
and the device it was checked on.

Two deliberate choices:

- **Every item carries a Device column.** This project's history is that
  headless Chromium passes and WebKit finds something — L1's clipped focus
  ring, L3's message-less `error.stack`, R2's Private Browsing surprise. Items
  marked **iPad** cannot be signed off from a build server, and saying so in the
  checklist is the only way that survives release pressure.
- **M3's outstanding performance and memory measurement lives here as a gate**,
  not as a task of its own. It is a measurement that can only happen on the
  maintainer's device, and it blocks release: WebKit kills tabs under memory
  pressure, and an editor that loses work that way is unusable.

The checklist also states that a failed item stops the release unless
explicitly waived **in writing, in `reports/`** — because the failure mode for
a checklist is a verbal "that's probably fine" at the wrong moment.

---

## Overall verification

`npm run check`, `npm test` and `npm run build` all pass. **462 tests**, up
from 415 at the end of R2.

Precache 40,481.33 → 40,501.71 KiB (**+20.38 KiB**), essentially all of it
application code — no new runtime assets.

**Nothing in R3–R6 has been verified on real iPad Safari**, and four of these
six are specifically about behaviours that only exist on that device: Dynamic
Type resolves `-apple-system-body`, which no other browser does; the software
keyboard has no headless equivalent; Split View and Stage Manager are iPadOS
window modes; and VoiceOver is not Chromium's accessibility tree.
`RELEASE-CHECKLIST.md` sections 5, 6 and 7 are written to be worked through on
device and are the intended way to check all of it.
