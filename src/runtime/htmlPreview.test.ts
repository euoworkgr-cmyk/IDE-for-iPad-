import { describe, expect, it } from "vitest";
import {
  buildPreviewDocument,
  hostsForStylesheet,
  parseTagAttributes,
  PREVIEW_MESSAGE_KEY,
  resolvePreviewReference,
  type PreviewSourceFile
} from "./htmlPreview";

const page = (body: string): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Page</title></head>
<body>
${body}
</body>
</html>
`;

function build(files: PreviewSourceFile[], entryPath: string) {
  return buildPreviewDocument({ files, entryPath, executionId: "preview-test" });
}

describe("resolvePreviewReference", () => {
  it("resolves a sibling against the directory of the referring file", () => {
    expect(resolvePreviewReference("site/index.html", "styles.css")).toEqual({
      kind: "project",
      path: "site/styles.css"
    });
  });

  it("resolves a parent reference", () => {
    expect(resolvePreviewReference("site/pages/about.html", "../styles.css")).toEqual({
      kind: "project",
      path: "site/styles.css"
    });
  });

  it("treats a leading slash as the project root", () => {
    expect(resolvePreviewReference("site/pages/about.html", "/styles.css")).toEqual({
      kind: "project",
      path: "styles.css"
    });
  });

  it("refuses a reference that climbs out of the project", () => {
    expect(resolvePreviewReference("index.html", "../../etc/passwd")).toMatchObject({
      kind: "invalid"
    });
  });

  it("reports an absolute URL as external rather than resolving it", () => {
    expect(resolvePreviewReference("index.html", "https://cdn.example.com/app.css")).toEqual({
      kind: "external",
      url: "https://cdn.example.com/app.css"
    });
    expect(resolvePreviewReference("index.html", "//cdn.example.com/app.css")).toMatchObject({
      kind: "external"
    });
  });

  it("ignores an in-document anchor", () => {
    expect(resolvePreviewReference("index.html", "#main")).toEqual({ kind: "ignored" });
  });

  it("drops a query string and a fragment before resolving", () => {
    expect(resolvePreviewReference("index.html", "styles.css?v=3#top")).toEqual({
      kind: "project",
      path: "styles.css"
    });
  });

  it("decodes percent-escapes so a spaced file name resolves", () => {
    expect(resolvePreviewReference("index.html", "my%20styles.css")).toEqual({
      kind: "project",
      path: "my styles.css"
    });
  });
});

describe("parseTagAttributes", () => {
  it("reads quoted, single-quoted and bare values without the tag name", () => {
    const attributes = parseTagAttributes(`<link rel="stylesheet" href='a.css' media=screen>`);
    expect(attributes.get("rel")).toBe("stylesheet");
    expect(attributes.get("href")).toBe("a.css");
    expect(attributes.get("media")).toBe("screen");
    expect(attributes.has("link")).toBe(false);
  });

  it("reads a valueless attribute", () => {
    const attributes = parseTagAttributes(`<script src="app.js" defer></script>`);
    expect(attributes.has("defer")).toBe(true);
    expect(attributes.get("defer")).toBe("");
  });
});

describe("buildPreviewDocument", () => {
  it("inlines a linked project stylesheet and says so", () => {
    const files = [
      { path: "index.html", content: page(`<link rel="stylesheet" href="styles.css"><p>Hi</p>`) },
      { path: "styles.css", content: "p { color: rebeccapurple; }" }
    ];

    const built = build(files, "index.html");

    expect(built.html).toContain("<style data-altitude-source=\"styles.css\">");
    expect(built.html).toContain("color: rebeccapurple");
    expect(built.html).not.toContain('href="styles.css"');
    expect(built.notes).toContain("Inlined styles.css.");
  });

  it("inlines a script by src and drops the src attribute", () => {
    const files = [
      { path: "index.html", content: page(`<script src="app.js" type="module"></script>`) },
      { path: "app.js", content: "console.log('hello');" }
    ];

    const built = build(files, "index.html");

    expect(built.html).toContain("console.log('hello');");
    expect(built.html).toContain("data-altitude-source=\"app.js\"");
    expect(built.html).not.toContain('src="app.js"');
    // A module script keeps its type, and is left where it stood: an inline
    // module is deferred by the parser already.
    expect(built.html).toContain('type="module"');
    expect(built.html).not.toContain("moved to the end of the body");
  });

  it("moves a deferred script to the end of the body, where it would have run", () => {
    const files = [
      {
        path: "index.html",
        content: `<!doctype html><html><head><script src="app.js" defer></script></head><body><h1>Hi</h1></body></html>`
      },
      { path: "app.js", content: "document.querySelector('h1').textContent = 'set';" }
    ];

    const built = build(files, "index.html");
    const scriptAt = built.html.indexOf("data-altitude-source=\"app.js\"");

    expect(scriptAt).toBeGreaterThan(built.html.indexOf("<h1>Hi</h1>"));
    expect(scriptAt).toBeLessThan(built.html.toLowerCase().indexOf("</body>"));
    // `defer` describes a fetch that no longer happens, so it does not survive.
    expect(built.html).not.toContain("defer>");
    expect(built.html).toContain("moved to the end of the body");
  });

  it("keeps two deferred scripts in the order the document gave them", () => {
    const files = [
      {
        path: "index.html",
        content: `<!doctype html><html><head><script src="one.js" defer></script><script src="two.js" async></script></head><body></body></html>`
      },
      { path: "one.js", content: "window.first = 1;" },
      { path: "two.js", content: "window.second = 2;" }
    ];

    const built = build(files, "index.html");

    expect(built.html.indexOf("window.first")).toBeLessThan(built.html.indexOf("window.second"));
  });

  it("leaves an inline script and a non-stylesheet link alone", () => {
    const files = [
      {
        path: "index.html",
        content: page(`<link rel="icon" href="icon.png"><script>console.log(1);</script>`)
      }
    ];

    const built = build(files, "index.html");

    expect(built.html).toContain(`<link rel="icon" href="icon.png">`);
    expect(built.html).toContain("<script>console.log(1);</script>");
  });

  it("neutralizes a closing tag hidden inside inlined content", () => {
    const files = [
      { path: "index.html", content: page(`<script src="app.js"></script>`) },
      { path: "app.js", content: `const markup = "</script><img>";` }
    ];

    const built = build(files, "index.html");

    expect(built.html).toContain(`"<\\/script><img>"`);
    // The document still has exactly the scripts it should: the bootstrap and
    // the inlined file, and nothing the smuggled tag closed early.
    expect(built.html.match(/<\/script>/gi)?.length).toBe(2);
  });

  it("reports a missing stylesheet instead of failing the whole preview", () => {
    const files = [
      { path: "index.html", content: page(`<link rel="stylesheet" href="missing.css"><p>Hi</p>`) }
    ];

    const built = build(files, "index.html");

    expect(built.html).toContain("<p>Hi</p>");
    expect(built.notes.join(" ")).toContain("missing.css is linked by index.html");
  });

  it("refuses a reference that climbs out of the project, and keeps rendering", () => {
    const files = [
      { path: "index.html", content: page(`<link rel="stylesheet" href="../../secrets.css"><p>Hi</p>`) }
    ];

    const built = build(files, "index.html");

    expect(built.html).toContain("<p>Hi</p>");
    expect(built.html).not.toContain("secrets.css\"");
    expect(built.notes.join(" ")).toContain("points outside the project");
  });

  it("does not fetch an external stylesheet or script", () => {
    const files = [
      {
        path: "index.html",
        content: page(
          `<link rel="stylesheet" href="https://cdn.example.com/a.css"><script src="https://cdn.example.com/a.js"></script>`
        )
      }
    ];

    const built = build(files, "index.html");

    expect(built.html).not.toContain("cdn.example.com/a.css\"");
    expect(built.html).not.toContain("<script src=");
    expect(built.notes.join(" ")).toContain("nothing is fetched over the network");
  });

  it("notes assets it cannot inline, once", () => {
    const files = [
      {
        path: "index.html",
        content: page(`<img src="logo.png"><img src="logo.png"><img src="photo.jpg">`)
      }
    ];

    const built = build(files, "index.html");
    const assetNotes = built.notes.filter((note) => note.includes("Not loaded"));

    expect(assetNotes).toHaveLength(1);
    expect(assetNotes[0]).toContain("logo.png");
    expect(assetNotes[0]).toContain("photo.jpg");
  });

  it("injects the reporting bootstrap inside <head>", () => {
    const built = build([{ path: "index.html", content: page("<p>Hi</p>") }], "index.html");
    const headAt = built.html.toLowerCase().indexOf("<head");
    const bootstrapAt = built.html.indexOf(PREVIEW_MESSAGE_KEY);
    const bodyAt = built.html.toLowerCase().indexOf("<body");

    expect(bootstrapAt).toBeGreaterThan(headAt);
    expect(bootstrapAt).toBeLessThan(bodyAt);
    expect(built.html).toContain("preview-test");
  });

  it("injects the bootstrap into a fragment with no head at all", () => {
    const built = build([{ path: "index.html", content: "<p>Just a fragment</p>" }], "index.html");

    expect(built.html.indexOf(PREVIEW_MESSAGE_KEY)).toBeLessThan(built.html.indexOf("<p>"));
  });

  it("previews a stylesheet through the page that links it", () => {
    const files = [
      { path: "index.html", content: page(`<link rel="stylesheet" href="styles.css"><p>Hi</p>`) },
      { path: "styles.css", content: "p { color: teal; }" }
    ];

    const built = build(files, "styles.css");

    expect(built.hostPath).toBe("index.html");
    expect(built.html).toContain("<p>Hi</p>");
    expect(built.html).toContain("color: teal");
    expect(built.notes[0]).toBe("Previewing index.html, which links styles.css.");
  });

  it("names the other pages that link a stylesheet", () => {
    const files = [
      { path: "a.html", content: page(`<link rel="stylesheet" href="styles.css">`) },
      { path: "b.html", content: page(`<link rel="stylesheet" href="styles.css">`) },
      { path: "styles.css", content: "p { color: teal; }" }
    ];

    const built = build(files, "styles.css");

    expect(built.hostPath).toBe("a.html");
    expect(built.notes.join(" ")).toContain("b.html also links it");
  });

  it("falls back to a generated page for a stylesheet nothing links", () => {
    const built = build([{ path: "styles.css", content: "h1 { color: teal; }" }], "styles.css");

    expect(built.hostPath).toBeUndefined();
    expect(built.html).toContain("color: teal");
    expect(built.html).toContain("<blockquote>");
    expect(built.notes.join(" ")).toContain("generated page of ordinary elements");
  });

  it("normalizes the entry path before looking for it", () => {
    const files = [{ path: "site/index.html", content: page("<p>Hi</p>") }];

    expect(build(files, "site\\\\index.html").html).toContain("<p>Hi</p>");
  });

  it("rejects an entry that is not in the project", () => {
    expect(() => build([{ path: "index.html", content: page("") }], "other.html")).toThrow(
      /not in this project/
    );
  });

  it("rejects an entry it cannot render", () => {
    expect(() => build([{ path: "main.py", content: "print(1)" }], "main.py")).toThrow(
      /\.html, \.htm and \.css files only/
    );
  });

  it("rejects an entry path that tries to climb out of the project", () => {
    expect(() => build([{ path: "index.html", content: page("") }], "../index.html")).toThrow(
      /Invalid project-relative path/
    );
  });
});

describe("hostsForStylesheet", () => {
  it("finds the pages that link a stylesheet, in a stable order", () => {
    const files = [
      { path: "z.html", content: page(`<link rel="stylesheet" href="./styles.css">`) },
      { path: "a.html", content: page(`<link rel="stylesheet" href="styles.css">`) },
      { path: "other.html", content: page(`<link rel="stylesheet" href="other.css">`) }
    ];

    expect(hostsForStylesheet(files, "styles.css")).toEqual(["a.html", "z.html"]);
  });

  it("ignores a link that is not a stylesheet", () => {
    const files = [{ path: "a.html", content: page(`<link rel="preload" href="styles.css">`) }];

    expect(hostsForStylesheet(files, "styles.css")).toEqual([]);
  });
});
