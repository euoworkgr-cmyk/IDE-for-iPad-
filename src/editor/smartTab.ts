import type { KeyBinding } from "@codemirror/view";
import { indentLess } from "@codemirror/commands";
import { completionKeymap } from "@codemirror/autocomplete";

export type SmartTabAction = "autocomplete" | "snippet-session" | "snippet-trigger" | "indent";

export function decideSmartTabAction(state: {
  autocompleteSelected: boolean;
  snippetSessionActive: boolean;
  snippetTriggerMatched: boolean;
}): SmartTabAction {
  if (state.autocompleteSelected) {
    return "autocomplete";
  }
  if (state.snippetSessionActive) {
    return "snippet-session";
  }
  if (state.snippetTriggerMatched) {
    return "snippet-trigger";
  }
  return "indent";
}

export function createSmartTabBinding(run: NonNullable<KeyBinding["run"]>): KeyBinding {
  return { key: "Tab", run, shift: indentLess };
}

export const autocompleteNavigationKeymap: readonly KeyBinding[] = completionKeymap.filter(
  (binding) => binding.key !== "Enter"
);
