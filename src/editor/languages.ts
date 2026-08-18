import type { Extension } from "@codemirror/state";
import type { LanguageId } from "../projects/models";

export async function loadLanguageExtension(language: LanguageId): Promise<Extension> {
  switch (language) {
    case "csharp": {
      const { csharp } = await import("@replit/codemirror-lang-csharp");
      return csharp();
    }
    case "python": {
      const { python } = await import("@codemirror/lang-python");
      return python();
    }
    case "javascript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript();
    }
    case "typescript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true });
    }
    case "html": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "css": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "c":
    case "cpp":
    case "text":
      return [];
  }
}

export function languageLabel(language: LanguageId): string {
  const labels: Record<LanguageId, string> = {
    c: "C",
    cpp: "C++",
    csharp: "C#",
    python: "Python",
    javascript: "JavaScript",
    typescript: "TypeScript",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    text: "Plain Text"
  };

  return labels[language];
}
