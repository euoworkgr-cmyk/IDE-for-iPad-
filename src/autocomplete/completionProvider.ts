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

// `@codemirror/lang-php` exports no completion source, so PHP's keywords and
// builtins are listed here. The builtins are scoped to what the shipped
// interpreter actually answers to — no `mysqli_*` or `curl_*`, since those
// extensions are not in this build, and no `header()`, since nothing here is
// serving a request.
const phpKeywords: Completion[] = [
  "abstract", "and", "array", "as", "break", "callable", "case", "catch",
  "class", "clone", "const", "continue", "declare", "default", "do", "echo",
  "else", "elseif", "empty", "enddeclare", "endfor", "endforeach", "endif",
  "endswitch", "endwhile", "enum", "extends", "final", "finally", "fn", "for",
  "foreach", "function", "global", "goto", "if", "implements", "include",
  "include_once", "instanceof", "insteadof", "interface", "isset", "list",
  "match", "namespace", "new", "or", "print", "private", "protected", "public",
  "readonly", "require", "require_once", "return", "static", "switch", "throw",
  "trait", "try", "unset", "use", "var", "while", "xor", "yield",
  "true", "false", "null"
].map((label) => ({ label, type: "keyword" }));

const phpFunctions: Completion[] = [
  { label: "var_dump", type: "function", detail: "output" },
  { label: "print_r", type: "function", detail: "output" },
  { label: "printf", type: "function", detail: "output" },
  { label: "sprintf", type: "function", detail: "output" },
  { label: "number_format", type: "function", detail: "output" },
  { label: "count", type: "function", detail: "array" },
  { label: "array_map", type: "function", detail: "array" },
  { label: "array_filter", type: "function", detail: "array" },
  { label: "array_reduce", type: "function", detail: "array" },
  { label: "array_keys", type: "function", detail: "array" },
  { label: "array_values", type: "function", detail: "array" },
  { label: "array_merge", type: "function", detail: "array" },
  { label: "array_slice", type: "function", detail: "array" },
  { label: "array_search", type: "function", detail: "array" },
  { label: "in_array", type: "function", detail: "array" },
  { label: "sort", type: "function", detail: "array" },
  { label: "usort", type: "function", detail: "array" },
  { label: "implode", type: "function", detail: "array" },
  { label: "explode", type: "function", detail: "string" },
  { label: "strlen", type: "function", detail: "string" },
  { label: "str_repeat", type: "function", detail: "string" },
  { label: "str_replace", type: "function", detail: "string" },
  { label: "str_contains", type: "function", detail: "string" },
  { label: "str_starts_with", type: "function", detail: "string" },
  { label: "str_pad", type: "function", detail: "string" },
  { label: "substr", type: "function", detail: "string" },
  { label: "strtolower", type: "function", detail: "string" },
  { label: "strtoupper", type: "function", detail: "string" },
  { label: "ucfirst", type: "function", detail: "string" },
  { label: "trim", type: "function", detail: "string" },
  { label: "preg_match", type: "function", detail: "regex" },
  { label: "preg_replace", type: "function", detail: "regex" },
  { label: "preg_split", type: "function", detail: "regex" },
  { label: "json_encode", type: "function", detail: "JSON" },
  { label: "json_decode", type: "function", detail: "JSON" },
  { label: "abs", type: "function", detail: "math" },
  { label: "max", type: "function", detail: "math" },
  { label: "min", type: "function", detail: "math" },
  { label: "round", type: "function", detail: "math" },
  { label: "intdiv", type: "function", detail: "math" },
  { label: "rand", type: "function", detail: "math" },
  { label: "date", type: "function", detail: "date and time" },
  { label: "time", type: "function", detail: "date and time" },
  { label: "file_get_contents", type: "function", detail: "filesystem" },
  { label: "file_put_contents", type: "function", detail: "filesystem" },
  { label: "gettype", type: "function", detail: "types" },
  { label: "is_array", type: "function", detail: "types" },
  { label: "is_string", type: "function", detail: "types" },
  { label: "is_numeric", type: "function", detail: "types" },
  { label: "intval", type: "function", detail: "types" },
  { label: "floatval", type: "function", detail: "types" }
];

const phpMagicConstants: Completion[] = [
  { label: "__FILE__", type: "constant" },
  { label: "__DIR__", type: "constant" },
  { label: "__LINE__", type: "constant" },
  { label: "__FUNCTION__", type: "constant" },
  { label: "__CLASS__", type: "constant" },
  { label: "PHP_EOL", type: "constant" },
  { label: "PHP_INT_MAX", type: "constant" },
  { label: "PHP_VERSION", type: "constant" }
];

// `@codemirror/lang-java` exports no completion source either, so Java's list
// is hand-written like PHP's and C#'s. Java does not execute here — see the
// CheerpJ recommendation in PROJECT DIRECTION.md — so unlike the runnable
// languages there is no runtime to scope this against. It is scoped instead to
// what someone writing plain Java reaches for: `java.lang` and the collections,
// not the whole JDK.
const javaKeywords: Completion[] = [
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new",
  "package", "private", "protected", "public", "record", "return", "sealed",
  "short", "static", "strictfp", "super", "switch", "synchronized", "this",
  "throw", "throws", "transient", "try", "var", "void", "volatile", "while",
  "yield", "true", "false", "null"
].map((label) => ({ label, type: "keyword" }));

const javaTypes: Completion[] = [
  { label: "String", type: "class", detail: "java.lang" },
  { label: "Integer", type: "class", detail: "java.lang" },
  { label: "Long", type: "class", detail: "java.lang" },
  { label: "Double", type: "class", detail: "java.lang" },
  { label: "Boolean", type: "class", detail: "java.lang" },
  { label: "Character", type: "class", detail: "java.lang" },
  { label: "Object", type: "class", detail: "java.lang" },
  { label: "Math", type: "class", detail: "java.lang" },
  { label: "System", type: "class", detail: "java.lang" },
  { label: "StringBuilder", type: "class", detail: "java.lang" },
  { label: "Thread", type: "class", detail: "java.lang" },
  { label: "Exception", type: "class", detail: "java.lang" },
  { label: "RuntimeException", type: "class", detail: "java.lang" },
  { label: "IllegalArgumentException", type: "class", detail: "java.lang" },
  { label: "List", type: "interface", detail: "java.util" },
  { label: "ArrayList", type: "class", detail: "java.util" },
  { label: "Map", type: "interface", detail: "java.util" },
  { label: "HashMap", type: "class", detail: "java.util" },
  { label: "Set", type: "interface", detail: "java.util" },
  { label: "HashSet", type: "class", detail: "java.util" },
  { label: "Arrays", type: "class", detail: "java.util" },
  { label: "Collections", type: "class", detail: "java.util" },
  { label: "Optional", type: "class", detail: "java.util" },
  { label: "Scanner", type: "class", detail: "java.util" },
  { label: "Objects", type: "class", detail: "java.util" },
  { label: "Stream", type: "interface", detail: "java.util.stream" },
  { label: "Collectors", type: "class", detail: "java.util.stream" }
];

/** `System.out.` is Java's `Console.` — the one member chain worth special-casing. */
const javaSystemMembers: Completion[] = [
  { label: "out", type: "property", detail: "PrintStream" },
  { label: "err", type: "property", detail: "PrintStream" },
  { label: "in", type: "property", detail: "InputStream" },
  { label: "currentTimeMillis", type: "method", apply: "currentTimeMillis()" },
  { label: "nanoTime", type: "method", apply: "nanoTime()" },
  { label: "lineSeparator", type: "method", apply: "lineSeparator()" },
  { label: "exit", type: "method", apply: "exit(0)" }
];

const javaPrintStreamMembers: Completion[] = [
  { label: "println", type: "method", apply: "println()" },
  { label: "print", type: "method", apply: "print()" },
  { label: "printf", type: "method", apply: "printf()" },
  { label: "format", type: "method", apply: "format()" },
  { label: "flush", type: "method", apply: "flush()" }
];

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

    if (language === "java") {
      const token = context.matchBefore(/[\w.]+/);
      if (!token || (!context.explicit && token.from === token.to)) {
        return null;
      }

      // Two member chains, longest first: `System.out.` has to be tested
      // before `System.`, or the shorter prefix would swallow it.
      const memberList = token.text.startsWith("System.out.") || token.text.startsWith("System.err.")
        ? javaPrintStreamMembers
        : token.text.startsWith("System.")
          ? javaSystemMembers
          : undefined;
      if (memberList) {
        return {
          from: token.from + token.text.lastIndexOf(".") + 1,
          options: memberList,
          validFor: /^\w*$/
        };
      }

      return {
        from: token.from,
        options: [...javaKeywords, ...javaTypes],
        validFor: /^\w*$/
      };
    }

    if (language === "php") {
      // A `.php` file is PHP inside the tags and HTML outside them, so
      // completion only fires on a word — never on the markup around it.
      const token = context.matchBefore(/[\w_]+/);
      if (!token || (!context.explicit && token.from === token.to)) {
        return null;
      }
      return {
        from: token.from,
        options: [...phpKeywords, ...phpFunctions, ...phpMagicConstants],
        validFor: /^\w*$/
      };
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
