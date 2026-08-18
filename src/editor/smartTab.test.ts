import { indentLess } from "@codemirror/commands";
import { describe, expect, it, vi } from "vitest";
import { autocompleteNavigationKeymap, createSmartTabBinding, decideSmartTabAction } from "./smartTab";

describe("smart Tab priority", () => {
  it.each([
    [{ autocompleteSelected: true, snippetSessionActive: true, snippetTriggerMatched: true }, "autocomplete"],
    [{ autocompleteSelected: false, snippetSessionActive: true, snippetTriggerMatched: true }, "snippet-session"],
    [{ autocompleteSelected: false, snippetSessionActive: false, snippetTriggerMatched: true }, "snippet-trigger"],
    [{ autocompleteSelected: false, snippetSessionActive: false, snippetTriggerMatched: false }, "indent"]
  ] as const)("selects the expected action", (state, expected) => {
    expect(decideSmartTabAction(state)).toBe(expected);
  });

  it("does not retain Enter as an autocomplete acceptance binding", () => {
    expect(autocompleteNavigationKeymap.some((binding) => binding.key === "Enter")).toBe(false);
  });

  it("keeps Shift+Tab bound to ordinary outdent", () => {
    const binding = createSmartTabBinding(vi.fn(() => true));
    expect(binding.key).toBe("Tab");
    expect(binding.shift).toBe(indentLess);
  });
});
