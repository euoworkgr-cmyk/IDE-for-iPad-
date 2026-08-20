import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { localCompletionSource as javascriptLocalCompletion, snippets as javascriptSnippets, typescriptSnippets } from "@codemirror/lang-javascript";
import { globalCompletion as pythonGlobalCompletion, localCompletionSource as pythonLocalCompletion } from "@codemirror/lang-python";
import { keywordCompletionSource as sqlKeywordCompletion, SQLite } from "@codemirror/lang-sql";
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

// Keywords are not exported by @codemirror/lang-javascript, so they are
// listed here alongside the globals actually reachable inside Altitude's
// execution Worker (see javascriptWorker.ts) — no `document` or `window`,
// since the code never runs on the main thread or in a DOM.
const javascriptKeywords: Completion[] = [
  "const",
  "let",
  "var",
  "function",
  "class",
  "extends",
  "if",
  "else",
  "for",
  "of",
  "in",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "return",
  "try",
  "catch",
  "finally",
  "throw",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "async",
  "await",
  "yield",
  "import",
  "export",
  "default",
  "this",
  "super",
  "null",
  "undefined",
  "true",
  "false"
].map((label) => ({ label, type: "keyword" }));

const typescriptOnlyKeywords: Completion[] = [
  "interface",
  "type",
  "enum",
  "implements",
  "readonly",
  "as",
  "namespace",
  "declare",
  "public",
  "private",
  "protected",
  "abstract"
].map((label) => ({ label, type: "keyword" }));

const javascriptGlobals: Completion[] = [
  { label: "console", type: "namespace" },
  { label: "Math", type: "namespace" },
  { label: "JSON", type: "namespace" },
  { label: "Object", type: "class" },
  { label: "Array", type: "class" },
  { label: "String", type: "class" },
  { label: "Number", type: "class" },
  { label: "Boolean", type: "class" },
  { label: "Date", type: "class" },
  { label: "RegExp", type: "class" },
  { label: "Error", type: "class" },
  { label: "Map", type: "class" },
  { label: "Set", type: "class" },
  { label: "Promise", type: "class" },
  { label: "Symbol", type: "class" },
  { label: "parseInt", type: "function", apply: "parseInt()" },
  { label: "parseFloat", type: "function", apply: "parseFloat()" },
  { label: "isNaN", type: "function", apply: "isNaN()" },
  { label: "NaN", type: "constant" },
  { label: "Infinity", type: "constant" },
  { label: "setTimeout", type: "function" },
  { label: "clearTimeout", type: "function" }
];

const consoleGlobalMembers: Completion[] = [
  { label: "log", type: "method", apply: "log()" },
  { label: "error", type: "method", apply: "error()" }
];

// @codemirror/lang-python normally registers `localCompletionSource` and
// `globalCompletion` as two independent language-data sources, and
// `autocompletion()` queries and merges all of them. Using `override` here
// means Altitude has to do that merging itself — a source with no match
// still returns a result with empty `options`, so `??` alone would pick it
// and never reach the other source.
function mergeSources(...results: Array<CompletionResult | null>): CompletionResult | null {
  const present = results.filter((result): result is CompletionResult => Boolean(result?.options.length));
  const [first, ...rest] = present;
  if (!first) {
    return null;
  }
  return {
    from: Math.min(first.from, ...rest.map((result) => result.from)),
    options: present.flatMap((result) => result.options),
    validFor: first.validFor
  };
}

// `globalCompletion`'s declared type allows an async result (it shares the
// generic CompletionSource signature), but it never actually returns one.
// SQLite's own dialect keywords come from the language package; its builtin
// functions do not, so the ones a scratch database actually answers to are
// listed here. Scoped to what SqlRuntime ships — no extension-only functions.
const sqliteFunctions: Completion[] = [
  { label: "count", type: "function", detail: "aggregate" },
  { label: "sum", type: "function", detail: "aggregate" },
  { label: "avg", type: "function", detail: "aggregate" },
  { label: "min", type: "function", detail: "aggregate" },
  { label: "max", type: "function", detail: "aggregate" },
  { label: "total", type: "function", detail: "aggregate" },
  { label: "group_concat", type: "function", detail: "aggregate" },
  { label: "abs", type: "function" },
  { label: "coalesce", type: "function" },
  { label: "ifnull", type: "function" },
  { label: "iif", type: "function" },
  { label: "instr", type: "function" },
  { label: "length", type: "function" },
  { label: "lower", type: "function" },
  { label: "upper", type: "function" },
  { label: "ltrim", type: "function" },
  { label: "rtrim", type: "function" },
  { label: "trim", type: "function" },
  { label: "replace", type: "function" },
  { label: "round", type: "function" },
  { label: "substr", type: "function" },
  { label: "printf", type: "function" },
  { label: "random", type: "function" },
  { label: "typeof", type: "function" },
  { label: "json", type: "function", detail: "JSON1" },
  { label: "json_array", type: "function", detail: "JSON1" },
  { label: "json_object", type: "function", detail: "JSON1" },
  { label: "json_extract", type: "function", detail: "JSON1" },
  { label: "date", type: "function", detail: "date and time" },
  { label: "time", type: "function", detail: "date and time" },
  { label: "datetime", type: "function", detail: "date and time" },
  { label: "julianday", type: "function", detail: "date and time" },
  { label: "strftime", type: "function", detail: "date and time" },
  { label: "unixepoch", type: "function", detail: "date and time" }
];

const sqlKeywordSource = sqlKeywordCompletion(SQLite, true);

function syncResult(value: CompletionResult | Promise<CompletionResult | null> | null): CompletionResult | null {
  return value instanceof Promise ? null : value;
}

export function createCompletionProvider(getLanguage: () => LanguageId): CompletionSource {
  return (context: CompletionContext) => {
    const language = getLanguage();

    if (language === "python") {
      return mergeSources(pythonLocalCompletion(context), syncResult(pythonGlobalCompletion(context)));
    }

    if (language === "javascript" || language === "typescript") {
      const token = context.matchBefore(/[\w.]+/);
      if (token?.text.startsWith("console.")) {
        return {
          from: token.from + token.text.lastIndexOf(".") + 1,
          options: consoleGlobalMembers,
          validFor: /^\w*$/
        };
      }

      const local = javascriptLocalCompletion(context);

      if (!token || (!context.explicit && token.from === token.to)) {
        return mergeSources(local);
      }

      const options =
        language === "typescript"
          ? [...typescriptSnippets, ...javascriptKeywords, ...typescriptOnlyKeywords, ...javascriptGlobals]
          : [...javascriptSnippets, ...javascriptKeywords, ...javascriptGlobals];

      return mergeSources(local, { from: token.from, options, validFor: /^\w*$/ });
    }

    if (language === "sql") {
      const token = context.matchBefore(/[\w$]+/);
      if (!token || (!context.explicit && token.from === token.to)) {
        return mergeSources(syncResult(sqlKeywordSource(context)));
      }
      return mergeSources(syncResult(sqlKeywordSource(context)), {
        from: token.from,
        options: sqliteFunctions,
        validFor: /^\w*$/
      });
    }

    if (language !== "csharp") {
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
