# Release checklist

**The quality bar, agreed before shipping rather than negotiated during it.**
That is the whole point of writing it down first — at release time there is
always a reason why one more item could slide, and a checklist agreed in
advance is the answer to that.

This covers **M5a, the PWA release**. M5b (App Store) adds its own items and is
not blocked on anything here.

Every box needs a real answer. "Probably fine" is a **no**.

---

## How to use this

Work top to bottom. Anything that fails stops the release until it is fixed or
explicitly, knowingly waived in writing — with the waiver recorded in
`reports/`, not agreed in conversation and forgotten.

The **Device** column matters: Altitude's history is that headless Chromium
passes and WebKit finds something. Items marked **iPad** cannot be signed off
from a build server.

---

## 1. The build is sound

| ✅ | Check | Device |
|---|---|---|
| ☐ | `npm run check` passes with no errors | any |
| ☐ | `npm test` passes, no skipped tests | any |
| ☐ | `npm run build` succeeds | any |
| ☐ | Verified **from a clean clone** (`npm ci` then `npm run build`), not just a working directory — stale local state has hidden a broken build before | any |
| ☐ | The precache total is known and recorded, and every language runtime is actually in it (Workbox silently *skips* files over its size limit) | any |
| ☐ | No `console.log` debugging left in shipped code | any |
| ☐ | Version in `package.json` is correct and matches what Settings displays | any |

## 2. Every language does what the README claims

For each of **Python, JavaScript, TypeScript, SQL, PHP, C#**: write something,
press Run, get correct output. For **HTML and CSS**: preview renders.

| ✅ | Check | Device |
|---|---|---|
| ☐ | All nine languages verified on real hardware | **iPad** |
| ☐ | A deliberate error in each produces a readable error block, not a raw stack | **iPad** |
| ☐ | Stop actually stops a long-running program, in every language | **iPad** |
| ☐ | Java shows syntax highlighting and completions, and its Run button is disabled with a reason | **iPad** |
| ☐ | The README's language table matches reality — no row claims more than ships | any |

## 3. It survives the storage failures

R2 built these paths; the release confirms they still behave.

| ✅ | Check | Device |
|---|---|---|
| ☐ | Private Browsing: app opens, banner says nothing is being saved, code still runs | **iPad** |
| ☐ | A normal tab shows no storage banner at all | **iPad** |
| ☐ | Backup produces a file; wiping storage and restoring brings the projects back intact | **iPad** |
| ☐ | Restoring twice adds "(restored)" copies rather than overwriting | any |
| ☐ | A non-backup file is refused with a clear message | any |

## 4. It works offline

| ✅ | Check | Device |
|---|---|---|
| ☐ | Load once online, wait for **Offline cached** | **iPad** |
| ☐ | Enable Airplane Mode, force-quit, reopen — the app starts | **iPad** |
| ☐ | Every language still runs with no connection (this is what the precache is for) | **iPad** |
| ☐ | Added to Home Screen: opens full screen, own icon, no Safari chrome | **iPad** |

## 5. Updates are legible

| ✅ | Check | Device |
|---|---|---|
| ☐ | Publishing a new build shows the "new version is ready" bar rather than swapping assets silently | **iPad** |
| ☐ | Taking **Reload** actually lands on the new version — confirm the version in Settings changed | **iPad** |
| ☐ | Dismissing the bar leaves the app working on the old version, with no broken chunk loads | **iPad** |
| ☐ | Projects survive the update | **iPad** |

## 6. It fits the device

| ✅ | Check | Device |
|---|---|---|
| ☐ | Portrait and landscape, rotated **mid-edit**, no lost content or broken layout | **iPad** |
| ☐ | Split View at both sizes, and Slide Over | **iPad** |
| ☐ | Stage Manager at an arbitrary window size | **iPad** |
| ☐ | The software keyboard does not cover the line being typed or the status bar | **iPad** |
| ☐ | Magic Keyboard: every shortcut in `HELP.md` does what it says | **iPad** |
| ☐ | No horizontal scrolling at any width | **iPad** |

## 7. It is usable by everyone

| ✅ | Check | Device |
|---|---|---|
| ☐ | System text size at a large accessibility setting: chrome scales, nothing is clipped or unreachable | **iPad** |
| ☐ | VoiceOver: the explorer, editor, console and dialogs can all be navigated and are sensibly labelled | **iPad** |
| ☐ | Focus order is sensible, and the skip link reaches the editor | **iPad** |
| ☐ | Light and dark both checked in real daylight, not just on a desk | **iPad** |
| ☐ | Contrast audit re-run if any colour changed since R3 | any |

## 8. Performance and memory under WebKit

This is M3's remaining measurement item and can only be done on device. It is a
**gate**, not a nice-to-have: WebKit kills tabs under memory pressure, and an
editor that loses work that way is unusable.

| ✅ | Check | Device |
|---|---|---|
| ☐ | A large file (~5 000 lines) opens and types without noticeable lag | **iPad** |
| ☐ | A project with many files (~100) does not slow the explorer | **iPad** |
| ☐ | Loading Python, then PHP, then C# in one session does not crash the tab | **iPad** |
| ☐ | Numbers recorded in `reports/`, whatever they are — including if they are bad | **iPad** |

## 9. The words are right

| ✅ | Check | Device |
|---|---|---|
| ☐ | `README.md` opens with something a non-developer understands | any |
| ☐ | `HELP.md` matches what the app actually does — every shortcut, every message | any |
| ☐ | `PRIVACY.md` is accurate: still no analytics, no third parties, no outbound requests | any |
| ☐ | Privacy statement is reachable from the app (Settings → Advanced) | any |
| ☐ | No placeholder text, lorem ipsum, or TODO anywhere user-visible | any |

## 10. Distribution

| ✅ | Check | Device |
|---|---|---|
| ☐ | The production URL is decided and works | any |
| ☐ | Custom domain configured, if there is to be one | any |
| ☐ | HTTPS, and cross-origin isolation headers present in production (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`) — Python's `input()` depends on them | any |
| ☐ | `dist/` is not committed | any |
| ☐ | A push to `main` deploys, and the deployed build matches the commit | any |
| ☐ | Someone who is not the maintainer can install and use it without being told how | **iPad** |

---

## Sign-off

Nothing ships until section 8 has numbers and every **iPad** box has been
checked on real hardware. That last requirement is not bureaucracy — it is the
project's entire testing history in one line.

| Field | Value |
|---|---|
| Version | |
| Commit | |
| Date | |
| Checked on | *(iPad model and iPadOS version)* |
| Waivers | *(link to `reports/`, or "none")* |
