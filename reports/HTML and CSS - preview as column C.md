# HTML and CSS: autocomplete, and preview as column C

**Date:** 2026-08-21
**Status:** Built; awaiting the maintainer's iPad Safari check.
**Scope:** `.html` / `.htm` / `.css` — columns B and C. Column A was already done.

## What was asked, and the question it forced

"Implement CSS and HTML in three columns." Column A (the CodeMirror modes) has
shipped since before the A/B/C matrix existed. Column B was simply not started.
Column C was the interesting one, because `PROJECT DIRECTION.md` said this:

> HTML and CSS are markup/styling, not executable programs, so C does not apply
> to them by design — A and B are the whole target for those two.

That sentence is defensible as far as it goes: there is no interpreter to run,
no exit status, and no stdout. But it answers the wrong question. Altitude's
promise is not "this app runs interpreters", it is **"you can write something on
an iPad and then see it do what you wrote"**. For a page, seeing it do what you
wrote means *rendering* it. Someone writing HTML on an iPad and unable to look
at the result has exactly the gap the whole project exists to close.

So column C for HTML and CSS is **preview**: the document the user wrote,
rendered by the same engine that would render it on the web, with everything it
references resolved out of the project rather than off a network. The direction
document has been amended rather than quietly contradicted — the entry now says
what column C means for these two languages and why.

## Column B — autocomplete

Both language packages ship a completion source that reads the syntax tree, so
unlike PHP, Java and C# there was no list to write by hand:

- `.css` → `cssCompletionSource`: properties, values, at-rules, pseudo-classes.
  Its property list is read off `document.body.style`, so it is exactly what the
  browser doing the rendering supports — on iPad that is WebKit's list, not a
  list someone typed a year ago.
- `.html` → `htmlCompletionSource`: tags, and the attributes of the tag being
  written.

A `.html` file is three languages, though. `@codemirror/lang-html` parses the
contents of `<style>` and `<script>` with the CSS and JavaScript parsers and
puts their trees in the same tree, so the provider walks up from the innermost
node, finds the nested top node (`StyleSheet` or `Script`), and dispatches to
the source that belongs to it. Completing inside a `<style>` block offers
`color`, not `<section>`.

The JavaScript branch inside HTML offers `document`, `window`, `querySelector`
and friends — deliberately **not** offered in a `.js` file, where the code runs
in a Worker with no DOM at all. The completions describe where the code will
actually run.

## Column C — how the preview works

`src/runtime/htmlPreview.ts` builds one self-contained document; the runtime
mounts it. The split is the same one the other runtimes use: everything
interesting is a pure function, and the platform-touching part is thin.

**Inlining.** Every project-relative `<link rel="stylesheet">` becomes a
`<style>` block and every `<script src>` becomes an inline script, read out of
the project. The result needs no network, no server, and no origin of its own —
which is what makes the sandbox below possible. References are resolved the way
a browser would (relative to the referring file, leading `/` meaning the project
root, query and fragment dropped, percent-escapes decoded) and then validated
with `normalizeProjectPath`, the same defensive check every execution path gets:
`../../` cannot walk out of the project.

**Nothing is fetched.** An external URL is not loaded — it is removed, and the
console says so rather than leaving a page mysteriously unstyled. That is the
offline-first constraint applying to previewed pages exactly as it applies to
Altitude itself.

**The sandbox.** The frame is `sandbox="allow-scripts allow-forms allow-modals
allow-popups"` — with `allow-same-origin` deliberately **absent**, so the
document runs on an opaque origin: `localStorage` throws inside it, and it
cannot reach Altitude's DOM or IndexedDB. Verified, not assumed (check 5 below).
This is the one runtime that is not a Web Worker, for the one reason the
standing constraint allows: a Worker has no DOM, and a document has to be
rendered by a browsing context. The isolation argument is unchanged — a
throwaway context per run, torn down on Stop.

**Reporting back.** A small bootstrap script is injected at the top of `<head>`.
It patches `console.log/info/debug/warn/error`, listens for `error` and
`unhandledrejection`, and posts each one to the app with the run's correlation
id. A sandboxed frame's `event.origin` is the string `"null"` and proves
nothing, so the id — generated per run, seen only by the document that run
mounted — is what the runtime matches on.

**`defer` is a fetch attribute.** This one was caught by the browser run, not by
reasoning: `defer` and `async` only mean anything on a script the parser has to
go and get. Inlining `<script src="app.js" defer>` where it stood ran it in
`<head>`, before the elements it was written against existed — and
`<script src="app.js" defer>` in the head is the single most common way a page
is put together. Deferred and async scripts are now moved to the end of
`<body>`, in document order, which is where the parser would have run them.
(Inline *module* scripts are deferred by the parser already, so they stay put.)
Finding this needed a real browser; the unit tests were happy.

**A stylesheet is not a page.** Pressing Run on a `.css` file previews the
`.html` file that links it, naming the file in the console — and the others, if
several link it. If nothing links it, Altitude renders a generated page of
ordinary elements (headings, lists, a table, a form, a `div.card`) with the
stylesheet applied, and says that is what it did.

**A preview is live until it is closed.** Unlike a script, a page is not
finished when it has loaded, so the Run control reads **Close** while a preview
is up, and closing it is what stops it — removing the frame ends its timers and
listeners. There is also a **Reload** button in the preview header, because the
loop for markup is edit, look, edit, and making that a two-tap
close-then-run would have been a poor trade. The run time limit does not apply,
and Settings now says so.

## Size

| | Baseline (`main`) | With this change | Delta |
|---|---|---|---|
| Precache | 40,435.75 KiB (73 entries) | 40,452.38 KiB (71 entries) | **+16.63 KiB (+0.04%)** |
| Main JS chunk | 324 KiB | 360 KiB | +36 KiB |

Two entries *disappear*: `lang-css` and `lang-html` stop being lazy chunks,
because the completion provider imports their completion sources statically —
the same trade Python and SQL already make. The preview itself ships no runtime
at all. It is the cheapest column C in the project by three orders of magnitude:
C# cost 11.50 MiB and PHP 12.56 MiB.

## Verification

`npm run check`, `npm test` (336 tests, 42 of them new), and `npm run build` all
pass. Automated browser verification in headless Chromium, **25 checks**, all
passing:

1. Run opens the preview pane on an `.html` file
2. An inlined script runs inside the preview, in the right order
3. The linked project stylesheet is applied (computed `background-color`)
4. The frame is sandboxed with `allow-scripts` and without `allow-same-origin`
5. The preview cannot reach the app's storage (`localStorage` throws)
6. `console.log` from the page reaches Altitude's console
7. An uncaught error in the page is reported as an error
8. Inlining is reported by name for both files
9. An external stylesheet is refused, with the reason
10. An asset that cannot be inlined is named once
11. The preview header names the file being rendered
12. The status line says the preview is live
13. Run becomes Close while the preview is live
14. Reload renders the edited file
15. Stop closes the preview and removes the frame
16. Closing is reported in the console
17. Run reads Preview on a `.css` file
18. A stylesheet nothing links renders against the generated page
19. The stylesheet under test is applied to that page
20. HTML tag completion offers `<section>`
21. CSS property completion works inside an HTML `<style>` block
22. CSS value completion offers `flex`
23. On a narrow screen the preview covers the editor (a stacking bug found this
    way: CodeMirror is positioned, so the preview needed a stacking context of
    its own or it painted *underneath* the editor)
24. The preview frame is the topmost element at that point
25. JavaScript execution is unaffected

**Not yet verified on real iPad Safari.** Two things specifically want a device
check: whether an `srcdoc` frame renders as expected inside a cross-origin
isolated page (Altitude serves COOP/COEP for Python's `SharedArrayBuffer`), and
whether closing a preview reclaims memory the way removing the element should.

## Known limits, stated rather than discovered later

- **Text files only.** Altitude stores text, so an `<img src="logo.png">`
  pointing at a project file has nothing to load. The console names what was
  left out rather than leaving a broken image unexplained.
- **A runaway script in a preview cannot be stopped.** The frame shares the main
  thread; a `while (true)` inside a previewed page will lock the tab, and Stop
  cannot run because nothing can. Worker-backed runtimes do not have this
  problem, and this is the honest cost of rendering being a DOM operation. A
  future mitigation would be to strip or wrap long-running scripts, which is
  worse than it sounds; for now it is documented, not hidden.
- **Rewriting is textual, not DOM-based.** `<link>` and `<script src>` are
  matched with regular expressions, so a tag hidden inside an HTML comment is
  still inlined. The trade buys a build step that runs in Node under test and
  does not depend on the document being well-formed.
- **TypeScript referenced from a page is not compiled.** `<script src="app.ts">`
  is left out with a note pointing at running the `.ts` file itself.
