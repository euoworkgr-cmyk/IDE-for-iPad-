import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { LanguageId } from "../projects/models";

const csharpKeywords: Completion[] = [
  "class",
  "public",
  "private",
  "protected",
  "internal",
  "static",
  "void",
  "string",
  "int",
  "double",
  "bool",
  "if",
  "else",
  "for",
  "foreach",
  "while",
  "using",
  "namespace",
  "return",
  "new",
  "async",
  "await"
].map((label) => ({ label, type: "keyword" }));

const csharpGlobals: Completion[] = [
  { label: "Console", type: "class", detail: "System.Console" },
  { label: "DateTime", type: "class", detail: "System.DateTime" },
  { label: "List", type: "class", detail: "System.Collections.Generic" }
];

const consoleMembers: Completion[] = [
  { label: "Write", type: "method", apply: "Write()" },
  { label: "WriteLine", type: "method", apply: "WriteLine()" },
  { label: "ReadLine", type: "method", apply: "ReadLine()" },
  { label: "Clear", type: "method", apply: "Clear()" }
];

export function createCompletionProvider(getLanguage: () => LanguageId) {
  return (context: CompletionContext): CompletionResult | null => {
    if (getLanguage() !== "csharp") {
      return null;
    }

    const token = context.matchBefore(/[\w.]+/);
    if (!token || (!context.explicit && token.from === token.to)) {
      return null;
    }

    if (token.text.startsWith("Console.")) {
      return {
        from: token.from + token.text.lastIndexOf(".") + 1,
        options: consoleMembers,
        validFor: /^\w*$/
      };
    }

    return {
      from: token.from,
      options: [...csharpKeywords, ...csharpGlobals],
      validFor: /^\w*$/
    };
  };
}
