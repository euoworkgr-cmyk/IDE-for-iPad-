import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

/**
 * Both of these are defined once and never rebuilt. Every colour is a custom
 * property that `styles.css` defines per palette, so switching between light
 * and dark is a change of one attribute on the root element rather than a
 * reconfiguration of every open document — and the editor's text size is a
 * property too, for the same reason.
 *
 * `EditorView.theme`'s `dark` flag is the one thing that cannot come from CSS:
 * CodeMirror uses it to pick its own built-in styling, so it is passed as a
 * generated pair and swapped through a compartment in `EditorAdapter`.
 */
export const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syn-keyword)" },
  { tag: [tags.name, tags.propertyName, tags.character], color: "var(--syn-name)" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "var(--syn-function)" },
  { tag: [tags.definition(tags.name), tags.namespace], color: "var(--syn-definition)" },
  { tag: [tags.typeName, tags.className], color: "var(--syn-type)" },
  { tag: [tags.number, tags.bool, tags.atom], color: "var(--syn-number)" },
  { tag: [tags.operatorKeyword, tags.operator, tags.punctuation], color: "var(--syn-operator)" },
  { tag: [tags.string, tags.regexp, tags.inserted], color: "var(--syn-string)" },
  { tag: [tags.comment, tags.meta], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: tags.heading, color: "var(--syn-heading)", fontWeight: "bold" },
  { tag: tags.link, color: "var(--syn-link)", textDecoration: "underline" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.invalid, color: "var(--syn-invalid)" }
]);

const editorThemeSpec = {
  "&": {
    height: "100%",
    color: "var(--editor-text)",
    backgroundColor: "var(--editor-bg)",
    fontSize: "var(--editor-font-size)"
  },
  ".cm-content": {
    caretColor: "var(--editor-caret)",
    padding: "12px 0 48px",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: "1.62"
  },
  ".cm-line": {
    padding: "0 12px"
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--editor-caret)"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--editor-selection)"
  },
  ".cm-activeLine": {
    backgroundColor: "var(--editor-active-line)"
  },
  ".cm-gutters": {
    backgroundColor: "var(--editor-bg)",
    color: "var(--editor-gutter-text)",
    border: "none",
    paddingLeft: "6px"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--editor-active-line)",
    color: "var(--editor-active-gutter-text)"
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--editor-fold-bg)",
    border: "none",
    color: "var(--editor-fold-text)"
  },
  ".cm-panels": {
    backgroundColor: "var(--editor-panel-bg)",
    color: "var(--editor-text)"
  },
  ".cm-panel.cm-search": {
    padding: "8px",
    gap: "6px"
  },
  ".cm-panel.cm-search input": {
    backgroundColor: "var(--editor-panel-input-bg)",
    color: "var(--editor-text)",
    border: "1px solid var(--editor-panel-border)",
    borderRadius: "6px",
    minHeight: "34px"
  },
  ".cm-panel.cm-search button": {
    backgroundColor: "var(--editor-panel-button-bg)",
    color: "var(--editor-text)",
    border: "1px solid var(--editor-panel-button-border)",
    borderRadius: "6px",
    minHeight: "34px"
  },
  ".cm-tooltip": {
    backgroundColor: "var(--editor-tooltip-bg)",
    border: "1px solid var(--editor-tooltip-border)"
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--editor-selected-bg)",
    color: "var(--editor-selected-text)"
  }
};

const darkTheme = EditorView.theme(editorThemeSpec, { dark: true });
const lightTheme = EditorView.theme(editorThemeSpec, { dark: false });

export function editorThemeFor(appearance: "light" | "dark") {
  return appearance === "dark" ? darkTheme : lightTheme;
}
