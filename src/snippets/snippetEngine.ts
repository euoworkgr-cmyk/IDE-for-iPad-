import { createId, type LanguageId } from "../projects/models";

export type SnippetLanguage = LanguageId | "any";
export type SnippetSource = "builtin" | "user";

export interface SnippetDefinition {
  id: string;
  name: string;
  trigger: string;
  language: SnippetLanguage;
  body: string;
  source: SnippetSource;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetDraft {
  name: string;
  trigger: string;
  language: SnippetLanguage;
  body: string;
}

export interface ParsedPlaceholder {
  id: number;
  defaultText: string;
  from: number;
  to: number;
}

export interface ParsedSnippet {
  text: string;
  placeholders: ParsedPlaceholder[];
  order: number[];
}

export const MAX_SNIPPET_NAME_LENGTH = 80;
export const MAX_SNIPPET_TRIGGER_LENGTH = 40;

function builtin(
  id: string,
  name: string,
  trigger: string,
  language: LanguageId,
  body: string
): SnippetDefinition {
  return Object.freeze({
    id: `builtin-${id}`,
    name,
    trigger,
    language,
    body,
    source: "builtin" as const,
    createdAt: 0,
    updatedAt: 0
  });
}

export const BUILT_IN_SNIPPETS: readonly SnippetDefinition[] = Object.freeze([
  builtin("python-def", "Function", "def", "python", "def ${1:name}(${2:args}):\n    ${0:pass}"),
  builtin("python-if", "If statement", "if", "python", "if ${1:condition}:\n    ${0:pass}"),
  builtin("python-for", "For loop", "for", "python", "for ${1:item} in ${2:iterable}:\n    ${0:pass}"),
  builtin("python-while", "While loop", "while", "python", "while ${1:condition}:\n    ${0:pass}"),
  builtin("python-class", "Class", "class", "python", "class ${1:Name}:\n    ${0:pass}"),
  builtin(
    "python-main",
    "Main entry point",
    "main",
    "python",
    "def main():\n    ${0:pass}\n\n\nif __name__ == \"__main__\":\n    main()"
  ),
  builtin(
    "python-try",
    "Try / except",
    "try",
    "python",
    "try:\n    ${1:pass}\nexcept ${2:Exception} as ${3:e}:\n    ${0:pass}"
  ),
  builtin(
    "csharp-main",
    "Main program",
    "main",
    "csharp",
    "using System;\n\nclass ${1:Program}\n{\n    static void Main()\n    {\n        ${0:Console.WriteLine(\"Hello\");}\n    }\n}"
  ),
  builtin("csharp-cw", "Console.WriteLine", "cw", "csharp", "Console.WriteLine(${0:\"\"});"),
  builtin("csharp-if", "If statement", "if", "csharp", "if (${1:condition})\n{\n    ${0}\n}"),
  builtin(
    "csharp-for",
    "For loop",
    "for",
    "csharp",
    "for (int ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++)\n{\n    ${0}\n}"
  ),
  builtin(
    "csharp-foreach",
    "Foreach loop",
    "foreach",
    "csharp",
    "foreach (var ${1:item} in ${2:collection})\n{\n    ${0}\n}"
  ),
  builtin("csharp-class", "Class", "class", "csharp", "class ${1:Name}\n{\n    ${0}\n}"),
  builtin("csharp-prop", "Auto property", "prop", "csharp", "public ${1:string} ${2:Name} { get; set; }"),
  builtin(
    "csharp-try",
    "Try / catch",
    "try",
    "csharp",
    "try\n{\n    ${1}\n}\ncatch (${2:Exception} ${3:ex})\n{\n    ${0}\n}"
  ),
  // Java, like C#, gets snippets without being runnable: the ceremony a Java
  // file needs before it says anything is exactly what a snippet is for.
  builtin(
    "java-main",
    "Main class",
    "main",
    "java",
    "public class ${1:Main} {\n    public static void main(String[] args) {\n        ${0:System.out.println(\"Hello\");}\n    }\n}"
  ),
  builtin("java-sout", "Print line", "sout", "java", "System.out.println(${0:\"\"});"),
  builtin("java-if", "If statement", "if", "java", "if (${1:condition}) {\n    ${0}\n}"),
  builtin(
    "java-for",
    "For loop",
    "for",
    "java",
    "for (int ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n    ${0}\n}"
  ),
  builtin(
    "java-foreach",
    "For-each loop",
    "foreach",
    "java",
    "for (${1:String} ${2:item} : ${3:collection}) {\n    ${0}\n}"
  ),
  builtin("java-class", "Class", "class", "java", "public class ${1:Name} {\n    ${0}\n}"),
  builtin(
    "java-try",
    "Try / catch",
    "try",
    "java",
    "try {\n    ${1}\n} catch (${2:Exception} ${3:e}) {\n    ${0}\n}"
  )
]);

export function parseSnippetTemplate(template: string): ParsedSnippet {
  const placeholders: ParsedPlaceholder[] = [];
  let text = "";
  let sourceIndex = 0;
  const pattern = /\$\{(\d+)(?::([^{}]*))?\}/g;

  for (const match of template.matchAll(pattern)) {
    const matchIndex = match.index;
    text += template.slice(sourceIndex, matchIndex);
    const defaultText = match[2] ?? "";
    const from = text.length;
    text += defaultText;
    placeholders.push({ id: Number(match[1]), defaultText, from, to: text.length });
    sourceIndex = matchIndex + match[0].length;
  }
  text += template.slice(sourceIndex);

  const ordinaryIds = [...new Set(placeholders.map((placeholder) => placeholder.id).filter((id) => id !== 0))]
    .sort((left, right) => left - right);
  const order = placeholders.some((placeholder) => placeholder.id === 0)
    ? [...ordinaryIds, 0]
    : ordinaryIds;

  return { text, placeholders, order };
}

export function validateSnippetDraft(
  draft: SnippetDraft,
  existing: readonly SnippetDefinition[],
  editingId?: string
): string[] {
  const errors: string[] = [];
  const name = draft.name.trim();
  const trigger = draft.trigger.trim();

  if (!name) {
    errors.push("Name is required.");
  } else if (name.length > MAX_SNIPPET_NAME_LENGTH) {
    errors.push(`Name must be ${MAX_SNIPPET_NAME_LENGTH} characters or fewer.`);
  }
  if (!trigger) {
    errors.push("Trigger is required.");
  } else if (trigger.length > MAX_SNIPPET_TRIGGER_LENGTH) {
    errors.push(`Trigger must be ${MAX_SNIPPET_TRIGGER_LENGTH} characters or fewer.`);
  } else if (!/^[A-Za-z0-9_-]+$/.test(trigger)) {
    errors.push("Trigger may contain letters, numbers, underscores, and hyphens only.");
  }
  if (!draft.language) {
    errors.push("Language is required.");
  }
  if (
    existing.some(
      (snippet) =>
        snippet.source === "user" &&
        snippet.id !== editingId &&
        snippet.language === draft.language &&
        snippet.trigger === trigger
    )
  ) {
    errors.push(`A user snippet with trigger “${trigger}” already exists for this language.`);
  }
  return errors;
}

export function createUserSnippet(draft: SnippetDraft, now = Date.now()): SnippetDefinition {
  return {
    id: createId(),
    name: draft.name.trim(),
    trigger: draft.trigger.trim(),
    language: draft.language,
    body: draft.body,
    source: "user",
    createdAt: now,
    updatedAt: now
  };
}

export function resolveSnippet(
  trigger: string,
  language: LanguageId,
  userSnippets: readonly SnippetDefinition[]
): SnippetDefinition | undefined {
  return (
    userSnippets.find(
      (snippet) => snippet.source === "user" && snippet.language === language && snippet.trigger === trigger
    ) ??
    userSnippets.find(
      (snippet) => snippet.source === "user" && snippet.language === "any" && snippet.trigger === trigger
    ) ??
    BUILT_IN_SNIPPETS.find((snippet) => snippet.language === language && snippet.trigger === trigger)
  );
}

export function matchSnippetBeforeCursor(
  textBeforeCursor: string,
  language: LanguageId,
  userSnippets: readonly SnippetDefinition[]
): { snippet: SnippetDefinition; from: number } | undefined {
  const match = /[A-Za-z0-9_-]+$/.exec(textBeforeCursor);
  if (!match) {
    return undefined;
  }
  const candidate = match[0];
  const snippet = resolveSnippet(candidate, language, userSnippets);
  return snippet ? { snippet, from: textBeforeCursor.length - candidate.length } : undefined;
}

export function uniqueDuplicateTrigger(
  trigger: string,
  language: SnippetLanguage,
  existing: readonly SnippetDefinition[]
): string {
  const occupied = new Set(
    existing
      .filter((snippet) => snippet.source === "user" && snippet.language === language)
      .map((snippet) => snippet.trigger)
  );
  if (!occupied.has(trigger)) {
    return trigger;
  }
  const copyStem = trigger.slice(0, MAX_SNIPPET_TRIGGER_LENGTH - "-copy".length);
  let index = 1;
  let candidate = `${copyStem}-copy`;
  while (occupied.has(candidate)) {
    index += 1;
    const suffix = `-copy-${index}`;
    candidate = `${trigger.slice(0, MAX_SNIPPET_TRIGGER_LENGTH - suffix.length)}${suffix}`;
  }
  return candidate;
}
