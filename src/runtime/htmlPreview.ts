import { normalizeProjectPath } from "./projectPaths";

/**
 * HTML and CSS have no interpreter to run them, so their equivalent of column C
 * is *rendering*: the document the user wrote, drawn by the same engine that
 * would draw it on the open web, with everything it references pulled out of
 * the project instead of off a network.
 *
 * This module is the whole build step and none of the browser part. It takes a
 * project and an entry file and returns one self-contained document string:
 * every project-relative stylesheet and script is inlined, so the rendered
 * document needs no network, no server, and no origin of its own — which is
 * what lets the frame that renders it be sandboxed to an opaque origin.
 *
 * The rewriting is textual rather than DOM-based on purpose: the same build has
 * to run under Node in the tests, and a preview must never depend on the
 * document being well-formed enough for a parser to keep its structure.
 */

export interface PreviewSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface PreviewDocument {
  /** The complete `srcdoc` for the sandboxed frame. */
  readonly html: string;
  /** The `.html` file that was rendered, or `undefined` for a generated host. */
  readonly hostPath: string | undefined;
  /** What the build had to decide for itself, in the user's words. */
  readonly notes: readonly string[];
}

export type ResolvedReference =
  | { readonly kind: "project"; readonly path: string }
  /** A URL the preview cannot fetch: it has a scheme, or is protocol-relative. */
  | { readonly kind: "external"; readonly url: string }
  /** An in-document anchor, or an empty reference. Nothing to resolve. */
  | { readonly kind: "ignored" }
  /** Syntactically a project path, but not one this project may reach. */
  | { readonly kind: "invalid"; readonly reason: string };

/** The message envelope the injected bootstrap posts back to the app. */
export const PREVIEW_MESSAGE_KEY = "__altitudePreview";

export type PreviewMessageKind = "stdout" | "stderr" | "error" | "ready";

export interface PreviewMessage {
  readonly [PREVIEW_MESSAGE_KEY]: string;
  readonly kind: PreviewMessageKind;
  readonly text: string;
}

function directoryOf(path: string): string[] {
  const segments = path.split("/");
  segments.pop();
  return segments;
}

/**
 * Resolves an `href`/`src` the way the browser would, then applies the same
 * defensive validation every execution path gets: the result has to name a file
 * inside the project, so a `../../` chain cannot walk out of it.
 */
export function resolvePreviewReference(fromPath: string, reference: string): ResolvedReference {
  const trimmed = reference.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return { kind: "ignored" };
  }
  if (trimmed.startsWith("//") || /^[a-z][a-z\d+\-.]*:/i.test(trimmed)) {
    return { kind: "external", url: trimmed };
  }

  const withoutFragment = trimmed.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";
  if (withoutQuery === "") {
    return { kind: "ignored" };
  }

  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    // A malformed escape is not a reason to fail the whole preview; the raw
    // text is still checked below and will simply not match a project file.
  }

  const absolute = decoded.startsWith("/");
  const base = absolute ? [] : directoryOf(normalizeProjectPath(fromPath));
  const resolved = [...base];
  for (const segment of decoded.replace(/^\/+/, "").split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolved.length === 0) {
        return { kind: "invalid", reason: `${reference} points outside the project` };
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  if (resolved.length === 0) {
    return { kind: "invalid", reason: `${reference} does not name a file` };
  }

  try {
    return { kind: "project", path: normalizeProjectPath(resolved.join("/")) };
  } catch (error) {
    return { kind: "invalid", reason: error instanceof Error ? error.message : String(error) };
  }
}

// The value is optional: `defer`, `async` and `hidden` are attributes too, and
// a preview that could not see them would run a deferred script at the wrong
// moment. A valueless attribute reads back as the empty string.
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

export function parseTagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  // Skip the tag name so an attribute cannot be read out of it.
  const body = tag.replace(/^<\s*[a-zA-Z][-\w:.]*/, "");
  for (const match of body.matchAll(ATTRIBUTE_PATTERN)) {
    const name = (match[1] ?? "").toLowerCase();
    const raw = match[2] ?? "";
    const value =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
    if (!attributes.has(name)) {
      attributes.set(name, value);
    }
  }
  return attributes;
}

/**
 * Inlined content ends the element it is inlined into the moment it contains
 * that element's closing tag — the classic `</script>`-inside-a-string trap.
 * Both forms are neutralised the same way, by breaking the `<` from the name.
 */
function neutralizeClosingTag(content: string, tag: "script" | "style"): string {
  return content.replace(new RegExp(`</(?=${tag}\\b)`, "gi"), "<\\/");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function isStylesheetLink(attributes: Map<string, string>): boolean {
  const rel = attributes.get("rel")?.toLowerCase() ?? "";
  return rel.split(/\s+/).includes("stylesheet");
}

interface InlineContext {
  readonly fileMap: ReadonlyMap<string, string>;
  readonly hostPath: string;
  readonly notes: string[];
}

function note(context: InlineContext, text: string): void {
  if (!context.notes.includes(text)) {
    context.notes.push(text);
  }
}

function inlineStylesheets(html: string, context: InlineContext): string {
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    const attributes = parseTagAttributes(tag);
    if (!isStylesheetLink(attributes)) {
      return tag;
    }
    const href = attributes.get("href");
    if (href === undefined) {
      return tag;
    }

    const resolved = resolvePreviewReference(context.hostPath, href);
    if (resolved.kind === "external") {
      note(context, `${href} is not part of this project, so the preview left it out — nothing is fetched over the network.`);
      return `<!-- altitude: external stylesheet ${escapeText(href)} not loaded -->`;
    }
    if (resolved.kind === "invalid") {
      note(context, `${href} could not be used: ${resolved.reason}.`);
      return `<!-- altitude: stylesheet ${escapeText(href)} rejected -->`;
    }
    if (resolved.kind === "ignored") {
      return tag;
    }

    const content = context.fileMap.get(resolved.path);
    if (content === undefined) {
      note(context, `${resolved.path} is linked by ${context.hostPath} but is not in this project.`);
      return `<!-- altitude: stylesheet ${escapeText(resolved.path)} not found -->`;
    }

    note(context, `Inlined ${resolved.path}.`);
    return `<style data-altitude-source="${escapeAttribute(resolved.path)}">\n${neutralizeClosingTag(content, "style")}\n</style>`;
  });
}

/**
 * `defer` and `async` are attributes of a *fetch*: the parser only honours them
 * on a script it has to go and get. Inlining a deferred script where it stood
 * would therefore run it early — in `<head>`, before the elements it is written
 * against exist — which is the single most common way a page is put together
 * (`<script src="app.js" defer>` in the head) and would have made the preview
 * lie about it. Deferred and async scripts are moved to the end of `<body>`
 * instead, in document order, which is where the parser would have run them.
 */
function endOfBodyAt(html: string): number {
  const closing = /<\/body\s*>/i.exec(html);
  if (closing) {
    return closing.index;
  }
  const closingHtml = /<\/html\s*>/i.exec(html);
  return closingHtml ? closingHtml.index : html.length;
}

function inlineScripts(html: string, context: InlineContext): string {
  const deferred: string[] = [];

  // A `src` script's inline content is ignored by the parser, so it is dropped
  // here too rather than being concatenated with the file it names.
  const rewritten = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (tag, rawAttributes: string) => {
    const attributes = parseTagAttributes(`<script${rawAttributes}>`);
    const src = attributes.get("src");
    if (src === undefined) {
      return tag;
    }

    const resolved = resolvePreviewReference(context.hostPath, src);
    if (resolved.kind === "external") {
      note(context, `${src} is not part of this project, so the preview left it out — nothing is fetched over the network.`);
      return `<!-- altitude: external script ${escapeText(src)} not loaded -->`;
    }
    if (resolved.kind === "invalid") {
      note(context, `${src} could not be used: ${resolved.reason}.`);
      return `<!-- altitude: script ${escapeText(src)} rejected -->`;
    }
    if (resolved.kind === "ignored") {
      return tag;
    }

    const content = context.fileMap.get(resolved.path);
    if (content === undefined) {
      note(context, `${resolved.path} is referenced by ${context.hostPath} but is not in this project.`);
      return `<!-- altitude: script ${escapeText(resolved.path)} not found -->`;
    }
    if (/\.(ts|tsx|mts|cts)$/i.test(resolved.path)) {
      note(context, `${resolved.path} is TypeScript; the preview renders a document rather than compiling one, so it was left out. Run the .ts file itself to execute it.`);
      return `<!-- altitude: TypeScript ${escapeText(resolved.path)} not inlined -->`;
    }

    // Everything else on the tag is kept — `type="module"` above all — minus
    // the `src` the content has now replaced and the fetch-only attributes,
    // which mean nothing on an inline script and would only mislead a reader.
    const keptAttributes = rawAttributes.replace(ATTRIBUTE_PATTERN, (attribute, name: string) =>
      name.toLowerCase() === "src" ? "" : attribute
    );
    const withoutFetchHints = keptAttributes.replace(/\s(?:defer|async)(?=[\s/>]|$)/gi, "");
    const element = `<script${withoutFetchHints} data-altitude-source="${escapeAttribute(resolved.path)}">\n${neutralizeClosingTag(content, "script")}\n</script>`;
    note(context, `Inlined ${resolved.path}.`);

    // An inline module script is already deferred by the parser, so only the
    // classic ones have to be moved.
    const isModule = (attributes.get("type") ?? "").toLowerCase() === "module";
    if (!isModule && (attributes.has("defer") || attributes.has("async"))) {
      deferred.push(element);
      return `<!-- altitude: ${escapeText(resolved.path)} moved to the end of the body, as ${attributes.has("defer") ? "defer" : "async"} asked -->`;
    }
    return element;
  });

  if (deferred.length === 0) {
    return rewritten;
  }
  const at = endOfBodyAt(rewritten);
  return `${rewritten.slice(0, at)}\n${deferred.join("\n")}\n${rewritten.slice(at)}`;
}

/**
 * Anything left pointing at a project file the preview cannot inline — images,
 * fonts, video — is reported once rather than silently rendering as a broken
 * box, because "my image is missing" is otherwise an unexplained failure.
 */
function noteUninlinedAssets(html: string, context: InlineContext): void {
  const unresolved = new Set<string>();
  for (const match of html.matchAll(/<(?:img|source|video|audio|embed|iframe)\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const reference = attributes.get("src");
    if (reference === undefined) {
      continue;
    }
    const resolved = resolvePreviewReference(context.hostPath, reference);
    if (resolved.kind === "external") {
      unresolved.add(reference);
    } else if (resolved.kind === "project" && !context.fileMap.has(resolved.path)) {
      unresolved.add(resolved.path);
    }
  }
  if (unresolved.size > 0) {
    note(
      context,
      `Not loaded — the preview has no network and Altitude stores text files only: ${[...unresolved].join(", ")}.`
    );
  }
}

/** The script the frame reports back through. Kept ES5-plain: it is not built. */
export function previewBootstrap(executionId: string): string {
  const id = JSON.stringify(executionId);
  const key = JSON.stringify(PREVIEW_MESSAGE_KEY);
  return `<script data-altitude-bootstrap>
(function () {
  var id = ${id};
  var key = ${key};
  function send(kind, text) {
    try {
      var message = { kind: kind, text: String(text) };
      message[key] = id;
      parent.postMessage(message, "*");
    } catch (error) {
      /* A frame that cannot report is still a frame that renders. */
    }
  }
  function format(value) {
    if (typeof value === "string") { return value; }
    if (value === null) { return "null"; }
    if (value === undefined) { return "undefined"; }
    if (value instanceof Error) { return (value.name || "Error") + ": " + value.message; }
    var type = typeof value;
    if (type === "number" || type === "boolean" || type === "bigint" || type === "symbol") { return String(value); }
    if (type === "function") { return value.name ? "[Function: " + value.name + "]" : "[Function (anonymous)]"; }
    if (value && value.nodeType === 1) { return "<" + String(value.tagName || "element").toLowerCase() + ">"; }
    try {
      var json = JSON.stringify(value);
      return typeof json === "string" ? json : String(value);
    } catch (error) {
      return String(value);
    }
  }
  function line(values) {
    var parts = [];
    for (var index = 0; index < values.length; index += 1) { parts.push(format(values[index])); }
    return parts.join(" ") + "\\n";
  }
  function patch(name, kind) {
    var original = console[name];
    console[name] = function () {
      var values = Array.prototype.slice.call(arguments);
      send(kind, line(values));
      if (typeof original === "function") { original.apply(console, values); }
    };
  }
  patch("log", "stdout");
  patch("info", "stdout");
  patch("debug", "stdout");
  patch("warn", "stderr");
  patch("error", "stderr");
  window.addEventListener("error", function (event) {
    var where = event.lineno ? " (line " + event.lineno + ")" : "";
    send("error", (event.message || "Script error") + where + "\\n");
  });
  window.addEventListener("unhandledrejection", function (event) {
    send("error", "Unhandled promise rejection: " + format(event.reason) + "\\n");
  });
  if (document.readyState === "complete") {
    send("ready", "");
  } else {
    window.addEventListener("load", function () { send("ready", ""); });
  }
})();
</script>
`;
}

function injectBootstrap(html: string, executionId: string): string {
  const bootstrap = previewBootstrap(executionId);
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${bootstrap}${html.slice(at)}`;
  }
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${html.slice(0, at)}\n${bootstrap}${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    return `${html.slice(0, doctype[0].length)}\n${bootstrap}${html.slice(doctype[0].length)}`;
  }
  return `${bootstrap}${html}`;
}

/** The `.html` files that link a given stylesheet, nearest sibling first. */
export function hostsForStylesheet(
  files: readonly PreviewSourceFile[],
  stylesheetPath: string
): string[] {
  const target = normalizeProjectPath(stylesheetPath);
  const hosts: string[] = [];
  for (const file of files) {
    if (!/\.(html|htm)$/i.test(file.path)) {
      continue;
    }
    for (const match of file.content.matchAll(/<link\b[^>]*>/gi)) {
      const attributes = parseTagAttributes(match[0]);
      const href = attributes.get("href");
      if (href === undefined || !isStylesheetLink(attributes)) {
        continue;
      }
      const resolved = resolvePreviewReference(file.path, href);
      if (resolved.kind === "project" && resolved.path === target) {
        hosts.push(normalizeProjectPath(file.path));
        break;
      }
    }
  }
  return hosts.sort((left, right) => left.localeCompare(right));
}

/**
 * A stylesheet nothing links still has to be shown against something. This is
 * that something: one page of ordinary elements, deliberately unstyled by
 * Altitude, so whatever appears is the user's CSS and nothing else.
 */
export function buildStylesheetScaffold(stylesheetPath: string, css: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(stylesheetPath)}</title>
<style data-altitude-source="${escapeAttribute(stylesheetPath)}">
${neutralizeClosingTag(css, "style")}
</style>
</head>
<body>
<header>
<h1>${escapeText(stylesheetPath)}</h1>
<p>No HTML file in this project links this stylesheet, so Altitude is showing it against a page of ordinary elements.</p>
</header>
<main>
<h2>Heading level two</h2>
<p>A paragraph with <a href="#link">a link</a>, <strong>bold text</strong>, <em>emphasis</em> and <code>inline code</code>.</p>
<h3>Heading level three</h3>
<ul><li>First list item</li><li>Second list item</li><li>Third list item</li></ul>
<ol><li>Ordered one</li><li>Ordered two</li></ol>
<blockquote><p>A block quotation.</p></blockquote>
<pre><code>const preview = "a block of code";</code></pre>
<table>
<caption>A table</caption>
<thead><tr><th>Column</th><th>Value</th></tr></thead>
<tbody><tr><td>First</td><td>1</td></tr><tr><td>Second</td><td>2</td></tr></tbody>
</table>
<form>
<label for="preview-input">A text field</label>
<input id="preview-input" type="text" placeholder="Type here">
<label for="preview-select">A select</label>
<select id="preview-select"><option>One</option><option>Two</option></select>
<button type="button">A button</button>
</form>
<div class="card"><p>A <code>div.card</code>, for stylesheets that expect one.</p></div>
</main>
<footer><p>Generated by Altitude to preview ${escapeText(stylesheetPath)}.</p></footer>
</body>
</html>
`;
}

export interface PreviewBuildRequest {
  readonly files: readonly PreviewSourceFile[];
  readonly entryPath: string;
  readonly executionId: string;
}

/**
 * Builds the document for one preview run. Throws only when the entry itself is
 * unusable — everything a page merely *references* degrades to a note, because
 * a broken link is not a reason to refuse to render the rest of the page.
 */
export function buildPreviewDocument(request: PreviewBuildRequest): PreviewDocument {
  const entryPath = normalizeProjectPath(request.entryPath);
  const fileMap = new Map<string, string>();
  for (const file of request.files) {
    fileMap.set(normalizeProjectPath(file.path), file.content);
  }

  const entryContent = fileMap.get(entryPath);
  if (entryContent === undefined) {
    throw new Error(`${entryPath} is not in this project.`);
  }

  const notes: string[] = [];
  let hostPath: string | undefined;
  let source: string;

  if (/\.css$/i.test(entryPath)) {
    const hosts = hostsForStylesheet(request.files, entryPath);
    const [first, ...alternatives] = hosts;
    if (first === undefined) {
      source = buildStylesheetScaffold(entryPath, entryContent);
      notes.push(`No HTML file links ${entryPath}, so the preview shows it against a generated page of ordinary elements.`);
    } else {
      hostPath = first;
      source = fileMap.get(first) ?? "";
      notes.push(`Previewing ${first}, which links ${entryPath}.`);
      if (alternatives.length > 0) {
        notes.push(`${alternatives.join(", ")} also link${alternatives.length === 1 ? "s" : ""} it — open one of those to preview it instead.`);
      }
    }
  } else if (/\.(html|htm)$/i.test(entryPath)) {
    hostPath = entryPath;
    source = entryContent;
  } else {
    throw new Error(`The preview renders .html, .htm and .css files only: ${entryPath}`);
  }

  if (hostPath !== undefined) {
    const context: InlineContext = { fileMap, hostPath, notes };
    source = inlineStylesheets(source, context);
    source = inlineScripts(source, context);
    noteUninlinedAssets(source, context);
  }

  return {
    html: injectBootstrap(source, request.executionId),
    hostPath,
    notes
  };
}
