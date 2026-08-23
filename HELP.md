# Using Altitude

A short guide to writing and running code on your iPad.

If you are looking for build instructions or architecture notes, those are in
[`README.md`](README.md) — this file is for using the app.

---

## Getting started

Altitude opens on a project with one file, `main.py`. Press **Run** (or
**Cmd + Enter**) and you will see its output appear below the editor. That is
the whole loop: write something, run it, read the result.

**Put it on your Home Screen.** Altitude works in a browser tab, but it is
better as an installed app — full screen, its own icon, and far less likely to
have its data cleared. In Safari, tap **Share → Add to Home Screen**.

> **Do not use Private Browsing.** Safari throws away everything a site stored
> when you close a private tab. Altitude will appear to work perfectly and then
> lose your projects. Use a normal tab.

---

## Running code

Press **Run**, or **Cmd + Enter**. What happens depends on the file:

| File | What Run does |
|---|---|
| `.py` | Runs it with Python |
| `.js`, `.ts` | Runs it as JavaScript or TypeScript |
| `.sql` | Runs the query against a fresh in-memory SQLite database |
| `.php` | Runs it with PHP |
| `.cs` | Compiles and runs it as C# |
| `.html`, `.css` | Opens a live **Preview** of the page |

**The first run of a language is slow.** Python, PHP and C# each load a real
interpreter, which is several megabytes. It happens once per session — after
that, runs start immediately.

**Stopping.** While something is running, the Run button becomes **Stop**.
Python stops in two stages: it interrupts the interpreter first, and only kills
the worker if the code cannot be reached that way. A preview stays live until
you close it, because a page is not "finished" the way a script is.

**The run time limit** stops runaway JavaScript, TypeScript, SQL and PHP after
5 seconds by default. You can change it in **Settings → Advanced settings**.
Python is not time-limited — its first run has to load the interpreter — but
Stop always works.

### Reading errors

When a run fails, the output shows the error as its own block: the exception
first, then the lines that led to it, with Altitude's own internal frames
hidden so you only see your code.

---

## Files and projects

- **New file** — the **+** in the Files panel, or **Cmd + N**. Type the whole
  name including the extension; the extension is what decides the language.
- **Nested paths** work: `src/helpers.py` creates the folder structure.
- **Import** a file from the Files app with the **⇧** button.
- **Rename** and **delete** with **✎** and **⌫**.

**Projects** are separate workspaces. The button in the top bar shows how many
you have — tap it to switch, rename, or create one.

Everything saves automatically, about a third of a second after you stop
typing. The status in the top bar tells you where things stand.

---

## Keyboard shortcuts

With a Magic Keyboard or any attached keyboard. **Ctrl** works everywhere
**Cmd** does.

| Shortcut | Action |
|---|---|
| **Cmd + Enter** | Run, or stop what is running |
| **Cmd + S** | Save now, without waiting for autosave |
| **Cmd + N** | New file |
| **Cmd + Shift + ]** | Next file |
| **Cmd + Shift + [** | Previous file |
| **Cmd + ,** | Settings |
| **Cmd + Shift + E** | Export and backup |
| **Esc** | Close the output or preview pane |

In the editor, **Tab** indents — or accepts a completion, or jumps to the next
snippet placeholder, depending on what is in front of it. **Enter** always
inserts a newline, never accepts a completion.

---

## Autocomplete and snippets

Suggestions appear as you type, and **Tab** accepts one. Coverage is best for
the languages that run: Python, JavaScript, TypeScript, SQL, PHP and C# all get
builtins and keywords; HTML and CSS complete tags, properties and values, and
know which language you are inside within an `.html` file.

**Snippets** are in the panel below the file list. Type a trigger and press
**Tab** to expand it, then **Tab** again to move between placeholders. You can
add your own with the **+** button — they are shared across all your projects.

---

## Settings

**Settings** (the gear, or **Cmd + ,**) has two levels.

The main screen has the two things most people want:

- **Appearance** — Light, Dark, or follow the system. Following the system
  updates live, including at sunset.
- **Editor text size** — 11 to 24 points.

Both apply as you change them so you can see the result. **Cancel** puts them
back.

**Advanced settings** holds the rest: indent width, the run time limit, the app
version, and a note about Private Browsing. Each setting has an **i** button
that explains what it does.

---

## Keeping your work safe

**This matters more than it would on a desktop.** Altitude stores your projects
in the browser's storage on your device, and Safari can clear that on its own —
typically for sites you have not opened in a while. If that happens, your
projects are gone, and the app can only tell you it happened.

So:

1. **Add Altitude to your Home Screen.** Installed apps are much less likely to
   be cleared than a browser tab.
2. **Take a backup now and then.** **Export & backup → Everything, as a
   backup** saves a single file containing every project and file. Keep it in
   iCloud Drive or anywhere outside the browser.
3. **Restore** from that file with **Restore a backup…** in the same dialog.
   Restoring never overwrites anything — if a project is already there, the
   restored one arrives alongside it marked "(restored)".

You can also export a single file on its own, or one project as a `.zip`.

---

## Working offline

Once Altitude has finished loading for the first time, it works with no
connection — including every language runtime. The top bar shows
**Offline cached** when this is ready.

If you are installing it for offline use, open it once while online, wait for
that indicator, *then* add it to your Home Screen.

---

## Updates

When a new version is available, a bar appears offering **Reload**. Nothing
changes until you take it, so it will not interrupt you mid-run. Your projects
are unaffected either way.

The version you are running is shown in **Settings → Advanced settings**.

---

## When something goes wrong

**"Nothing on this page is being saved"** — the browser is refusing storage,
usually Private Browsing. You can keep working and export, but nothing will be
kept. Move to a normal tab.

**"Storage is full"** — the device is out of room. Export what you need, then
delete files or projects.

**"A saved project could not be read"** — one stored record was damaged and was
skipped. Everything else opened normally.

**"This device removed Altitude's saved data"** — Safari cleared the site's
storage. This is what backups are for.

**A language will not start** — its runtime files did not finish downloading.
Go online once, reload, and try again.

---

## What is not supported yet

- **C, C++ and Go** have no editor support or execution yet.
- **Java** has syntax highlighting and autocomplete, but cannot be run.
- **SQL databases do not persist** between runs — each run starts empty by
  design.
- **Private Browsing**, as above.
