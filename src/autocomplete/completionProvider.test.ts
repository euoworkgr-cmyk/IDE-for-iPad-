import { CompletionContext } from "@codemirror/autocomplete";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { EditorState, type Extension } from "@codemirror/state";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LanguageId } from "../projects/models";
import { createCompletionProvider } from "./completionProvider";

function languageExtension(language: LanguageId): Extension[] {
  switch (language) {
    case "python":
      return [python()];
    case "javascript":
      return [javascript()];
    case "typescript":
      return [javascript({ typescript: true })];
    case "java":
      return [java()];
    case "html":
      return [html()];
    case "css":
      return [css()];
    default:
      return [];
  }
}

function contextFor(doc: string, language: LanguageId, explicit = true): CompletionContext {
  const state = EditorState.create({ doc, extensions: languageExtension(language) });
  return new CompletionContext(state, doc.length, explicit);
}

function labelsFor(doc: string, language: LanguageId): string[] {
  const provider = createCompletionProvider(() => language);
  const result = provider(contextFor(doc, language));
  if (!result || result instanceof Promise) {
    return [];
  }
  return result.options.map((option) => option.label);
}

describe("createCompletionProvider", () => {
  it("offers Python builtins and keywords", () => {
    const labels = labelsFor("pri", "python");
    expect(labels).toContain("print");
    expect(labels).toContain("range");
  });

  it("offers JavaScript keywords and safe globals", () => {
    const labels = labelsFor("cons", "javascript");
    expect(labels).toContain("const");
    expect(labels).toContain("console");
    expect(labels).not.toContain("document");
    expect(labels).not.toContain("window");
  });

  it("completes console. members for JavaScript", () => {
    const labels = labelsFor("console.", "javascript");
    expect(labels).toEqual(["log", "error"]);
  });

  it("offers TypeScript-only keywords in addition to JavaScript ones", () => {
    const labels = labelsFor("inter", "typescript");
    expect(labels).toContain("interface");
    expect(labels).toContain("const");
  });

  it("still offers only the C# list for C#, unaffected by other languages", () => {
    const labels = labelsFor("Cons", "csharp");
    expect(labels).toContain("Console");
    expect(labels).not.toContain("print");
    expect(labels).not.toContain("console");
  });

  it("offers Java keywords and standard types", () => {
    const labels = labelsFor("Str", "java");
    expect(labels).toContain("String");
    expect(labels).toContain("StringBuilder");
    expect(labels).toContain("static");
  });

  it("completes System. members for Java", () => {
    const labels = labelsFor("System.", "java");
    expect(labels).toContain("out");
    expect(labels).toContain("currentTimeMillis");
    expect(labels).not.toContain("println");
  });

  /**
   * `System.out.` has to beat `System.` — the shorter prefix would otherwise
   * swallow it and offer the wrong members.
   */
  it("completes PrintStream members after System.out. and System.err.", () => {
    expect(labelsFor("System.out.", "java")).toContain("println");
    expect(labelsFor("System.out.pri", "java")).toContain("printf");
    expect(labelsFor("System.err.", "java")).toContain("println");
    expect(labelsFor("System.out.", "java")).not.toContain("out");
  });

  it("keeps Java's list separate from the other languages", () => {
    const labels = labelsFor("cl", "java");
    expect(labels).toContain("class");
    expect(labels).not.toContain("console");
    expect(labels).not.toContain("print");
    expect(labels).not.toContain("Console");
  });

  it("offers nothing for languages with no completion support", () => {
    const provider = createCompletionProvider(() => "text");
    expect(provider(contextFor("anything", "text"))).toBeNull();
  });
});

describe("HTML and CSS completion", () => {
  // `@codemirror/lang-css` reads its property list off `document.body.style`,
  // so it knows exactly what the browser it is running in supports. Node has
  // no document, so a minimal stand-in supplies three properties here; the
  // value, tag and at-rule lists are static and need no help. The package
  // caches the list on first use, which is why it is installed before any
  // completion runs and not removed until the file is done.
  const hadDocument = "document" in globalThis;

  beforeAll(() => {
    if (!hadDocument) {
      Reflect.set(globalThis, "document", { body: { style: { color: "", display: "", margin: "" } } });
    }
  });

  afterAll(() => {
    if (!hadDocument) {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  it("offers HTML tags", () => {
    const labels = labelsFor("<sect", "html");
    expect(labels).toContain("section");
  });

  it("offers the attributes of the tag being written", () => {
    const labels = labelsFor("<img ", "html");
    expect(labels).toContain("src");
    expect(labels).toContain("alt");
  });

  it("offers CSS properties in a stylesheet", () => {
    const labels = labelsFor("a { colo", "css");
    expect(labels).toContain("color");
  });

  it("offers CSS values for the property being written", () => {
    const labels = labelsFor("a { display: fle", "css");
    expect(labels).toContain("flex");
  });

  it("completes CSS, not tags, inside an HTML style block", () => {
    const labels = labelsFor("<style>a { colo", "html");
    expect(labels).toContain("color");
    expect(labels).not.toContain("section");
  });

  it("completes JavaScript inside an HTML script block, with DOM globals", () => {
    const labels = labelsFor("<script>docu", "html");
    expect(labels).toContain("document");
  });
});
