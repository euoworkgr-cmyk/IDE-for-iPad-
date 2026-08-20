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
    // SQLite is the dialect Altitude actually executes (see SqlRuntime), so the
    // editor highlights the same dialect the Run button will run.
    case "sql": {
      const { sql, SQLite } = await import("@codemirror/lang-sql");
      return sql({ dialect: SQLite, upperCaseKeywords: true });
    }
    // The mode handles a whole .php file: inline HTML outside the tags, PHP
    // inside them, which is how the runtime reads it too.
    case "php": {
      const { php } = await import("@codemirror/lang-php");
      return php();
    }
    // Editor support only. Java has no execution path — see the CheerpJ
    // recommendation in PROJECT DIRECTION.md — so a .java file highlights and
    // completes, and the Run button says plainly that it cannot run it.
    case "java": {
      const { java } = await import("@codemirror/lang-java");
      return java();
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
    sql: "SQL",
    php: "PHP",
    java: "Java",
    text: "Plain Text"
  };

  return labels[language];
}
