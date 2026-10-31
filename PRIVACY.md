# Privacy

**Last updated: 2026-08-23**

Altitude is an offline-first code editor that runs entirely on your device.
This statement describes exactly what happens to your data. It is short because
there is not much to describe.

## The short version

**Altitude does not collect anything about you.** There is no account, no
sign-in, no analytics, no tracking, no advertising, and no third-party
services. Your code never leaves your device unless you choose to export it.

## What Altitude stores, and where

Everything Altitude keeps is stored **in your browser, on your device**:

| What | Where | Why |
|---|---|---|
| Your projects and files | IndexedDB | So your work is still there next time |
| Your settings (appearance, text size, indent width, run time limit) | IndexedDB | So the app looks and behaves the way you left it |
| Your snippets | IndexedDB | So your snippets persist |
| Unsaved changes, briefly | `localStorage` | Crash recovery, cleared once the change is written |

None of this is transmitted anywhere. It is not backed up to a server, it is
not synced between devices, and it cannot be read by us — we have no way to
reach it.

## Code you write and run

Code you write in Altitude runs **on your device**, inside your browser. Python,
JavaScript, TypeScript, SQL, PHP and C# all execute locally, using interpreters
that ship inside the app. Nothing you write is uploaded to be compiled or run,
and there is no remote execution service behind the Run button.

HTML and CSS previews render locally too, in a sandboxed frame with no access to
Altitude's own storage.

## Network access

Altitude makes **no network requests of its own** once it has loaded. It has no
analytics endpoint, no error-reporting service and no external content — no
fonts, scripts or images loaded from anywhere else. This is enforced by design:
the app is built to work with no connection at all.

The one thing that does require the network is **downloading the app itself**
the first time, and downloading an update when one is published.

## Hosting

The Altitude web app is served from **Cloudflare Pages**. Like any web server,
Cloudflare's infrastructure may record standard request information — such as
your IP address, the time of the request and your browser's user-agent string —
in its own logs, under Cloudflare's policies rather than ours. This happens when
your browser fetches the app's files. It does not include anything about your
projects or your code, because those are never sent.

Once the app is installed and cached, it runs without contacting the server at
all.

## Files you export

Export and backup produce a file that your browser saves wherever you tell it
to — usually the Files app or your Downloads folder. From that point the file is
yours and is governed by whatever you do with it. Altitude does not upload it,
and does not know it exists.

## Data you can remove

You are always in control of the data on your device:

- **Delete a project** from the project list to remove it and its files.
- **Clear Website Data** for Altitude's address in Safari's settings to remove
  *everything* — projects, settings and snippets. This is immediate and cannot
  be undone from inside the app, so export or back up first.

Note that Safari may also clear this data on its own, without asking, for sites
that have not been opened in a while. This is a browser behaviour, not an
Altitude one, and it is the reason the app offers a backup. See the README's
installation section.

## Children

Altitude collects no personal information from anyone, of any age.

## Changes to this statement

If this ever changes, the date at the top of this file changes with it, and the
change will be visible in the project's git history.

## Contact

Altitude is developed in the open at
<https://github.com/euoworkgr-cmyk/IDE-for-iPad->. Questions about privacy can
be raised as an issue there.
