import "fake-indexeddb/auto";
import { indentUnit } from "@codemirror/language";
import { EditorState, type Transaction } from "@codemirror/state";
import { clearSnippet, hasNextSnippetField, nextSnippetField, snippet } from "@codemirror/autocomplete";
import { history, isolateHistory, undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import {
  createUserSnippet,
  matchSnippetBeforeCursor,
  parseSnippetTemplate,
  resolveSnippet,
  validateSnippetDraft,
  type SnippetDraft
} from "./snippetEngine";
import { SnippetRepository } from "./snippetStorage";

const draft: SnippetDraft = {
  name: "Debug print",
  trigger: "dbg",
  language: "python",
  body: "print(${0:\"DEBUG\"})"
};

describe("snippet matching", () => {
  it("matches only a complete trigger immediately before the cursor", () => {
    expect(matchSnippetBeforeCursor("    for", "python", [])?.snippet.trigger).toBe("for");
    expect(matchSnippetBeforeCursor("before", "python", [])).toBeUndefined();
  });

  it("uses the current language", () => {
    expect(resolveSnippet("main", "python", [])?.body).toContain("__name__");
    expect(resolveSnippet("main", "csharp", [])?.body).toContain("using System");
    expect(resolveSnippet("main", "text", [])).toBeUndefined();
  });

  it("prefers user language snippets, then Any, then built-ins", () => {
    const any = createUserSnippet({ ...draft, trigger: "main", language: "any", body: "any" }, 1);
    const python = createUserSnippet({ ...draft, trigger: "main", body: "custom-python" }, 2);
    expect(resolveSnippet("main", "python", [any])?.body).toBe("any");
    expect(resolveSnippet("main", "python", [any, python])?.body).toBe("custom-python");
  });
});

describe("placeholder parsing", () => {
  it("extracts placeholder text and orders zero last", () => {
    const parsed = parseSnippetTemplate("def ${1:name}(${2:args}): ${0:pass}");
    expect(parsed.text).toBe("def name(args): pass");
    expect(parsed.order).toEqual([1, 2, 0]);
    expect(parsed.placeholders.map((placeholder) => placeholder.defaultText)).toEqual(["name", "args", "pass"]);
  });

  it("tracks repeated placeholder IDs", () => {
    const parsed = parseSnippetTemplate("${1:i} < ${2:length}; ${1:i}++");
    expect(parsed.order).toEqual([1, 2]);
    expect(parsed.placeholders.filter((placeholder) => placeholder.id === 1)).toHaveLength(2);
  });

  it("supports an empty final cursor placeholder", () => {
    const parsed = parseSnippetTemplate("if (ready) { ${0} }");
    expect(parsed.text).toBe("if (ready) {  }");
    expect(parsed.order).toEqual([0]);
  });
});

describe("CodeMirror snippet application", () => {
  it("adds base indentation to every following line in one transaction", () => {
    let state = EditorState.create({ doc: "if ready:\n    for", extensions: [indentUnit.of("    ")] });
    const apply = snippet("for ${1:item} in ${2:iterable}:\n    ${0:pass}");
    apply(
      { state, dispatch: (transaction) => { state = transaction.state; } },
      null,
      state.doc.length - 3,
      state.doc.length
    );
    expect(state.doc.toString()).toBe("if ready:\n    for item in iterable:\n        pass");
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("item");
  });

  it("selects every occurrence of a repeated placeholder", () => {
    let state = EditorState.create({ doc: "for", extensions: [EditorState.allowMultipleSelections.of(true)] });
    snippet("for (int ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++)")(
      { state, dispatch: (transaction) => { state = transaction.state; } },
      null,
      0,
      3
    );
    expect(state.selection.ranges).toHaveLength(3);
    expect(state.selection.ranges.map((range) => state.sliceDoc(range.from, range.to))).toEqual(["i", "i", "i"]);
    state = state.update(state.replaceSelection("index")).state;
    expect(state.doc.toString()).toBe("for (int index = 0; index < length; index++)");
  });

  it("moves through placeholders, clears on Escape, and expands as one undo step", () => {
    let state = EditorState.create({
      doc: "",
      extensions: [EditorState.allowMultipleSelections.of(true), history()]
    });
    const dispatch = (transaction: Transaction) => {
      state = transaction.state;
    };
    dispatch(state.update({ changes: { from: 0, insert: "def" }, userEvent: "input.type" }));
    dispatch(state.update({ annotations: isolateHistory.of("full") }));
    snippet("def ${1:name}(${2:args}):\n    ${0:pass}")({ state, dispatch }, null, 0, 3);
    dispatch(state.update({ annotations: isolateHistory.of("full") }));
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("name");
    expect(nextSnippetField({ state, dispatch })).toBe(true);
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("args");
    expect(clearSnippet({ state, dispatch })).toBe(true);
    expect(hasNextSnippetField(state)).toBe(false);
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe("def");
  });
});

describe("snippet validation and persistence", () => {
  it("rejects a duplicate user language and trigger", () => {
    const existing = createUserSnippet(draft, 1);
    expect(validateSnippetDraft(draft, [existing])).toContain(
      "A user snippet with trigger “dbg” already exists for this language."
    );
    expect(validateSnippetDraft({ ...draft, language: "csharp" }, [existing])).toEqual([]);
  });

  it("persists, updates, and deletes user snippets independently", async () => {
    const databaseName = `snippet-test-${crypto.randomUUID()}`;
    const repository = new SnippetRepository(indexedDB, databaseName);
    const value = createUserSnippet(draft, 10);
    await repository.save(value);
    await expect(repository.list()).resolves.toEqual([value]);

    const updated = { ...value, body: "print('updated')", updatedAt: 20 };
    await repository.save(updated);
    await expect(repository.list()).resolves.toEqual([updated]);
    await repository.delete(value.id);
    await expect(repository.list()).resolves.toEqual([]);
    repository.close();
    indexedDB.deleteDatabase(databaseName);
  });
});
