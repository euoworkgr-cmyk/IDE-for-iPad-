import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

export const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c6a0f6" },
  { tag: [tags.name, tags.propertyName, tags.character], color: "#d7e0ea" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#7aa2f7" },
  { tag: [tags.definition(tags.name), tags.namespace], color: "#8bd5ca" },
  { tag: [tags.typeName, tags.className], color: "#eed49f" },
  { tag: [tags.number, tags.bool, tags.atom], color: "#f5a97f" },
  { tag: [tags.operatorKeyword, tags.operator, tags.punctuation], color: "#91d7e3" },
  { tag: [tags.string, tags.regexp, tags.inserted], color: "#a6da95" },
  { tag: [tags.comment, tags.meta], color: "#66788c", fontStyle: "italic" },
  { tag: tags.heading, color: "#f0c6c6", fontWeight: "bold" },
  { tag: tags.link, color: "#7aa2f7", textDecoration: "underline" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.invalid, color: "#ff6b81" }
]);

export const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "#d7e0ea",
      backgroundColor: "#0d131c",
      fontSize: "15px"
    },
    ".cm-content": {
      caretColor: "#8bd5ca",
      padding: "12px 0 48px",
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      lineHeight: "1.62"
    },
    ".cm-line": {
      padding: "0 12px"
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#8bd5ca"
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#31415d"
    },
    ".cm-activeLine": {
      backgroundColor: "#141d29"
    },
    ".cm-gutters": {
      backgroundColor: "#0d131c",
      color: "#536174",
      border: "none",
      paddingLeft: "6px"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#141d29",
      color: "#9aa9ba"
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#1b2635",
      border: "none",
      color: "#8d9bac"
    },
    ".cm-panels": {
      backgroundColor: "#131c27",
      color: "#d7e0ea"
    },
    ".cm-panel.cm-search": {
      padding: "8px",
      gap: "6px"
    },
    ".cm-panel.cm-search input": {
      backgroundColor: "#0b1017",
      color: "#d7e0ea",
      border: "1px solid #2a3749",
      borderRadius: "6px",
      minHeight: "34px"
    },
    ".cm-panel.cm-search button": {
      backgroundColor: "#202c3c",
      color: "#d7e0ea",
      border: "1px solid #31415a",
      borderRadius: "6px",
      minHeight: "34px"
    },
    ".cm-tooltip": {
      backgroundColor: "#172130",
      border: "1px solid #34445a"
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "#29415b",
      color: "#ffffff"
    }
  },
  { dark: true }
);
