import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeBrackets,
  closeBracketsKeymap,
  completionStatus,
  hasNextSnippetField,
  nextSnippetField,
  selectedCompletion,
  snippet,
  snippetKeymap
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentMore, isolateHistory } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  tooltips
} from "@codemirror/view";
import { createCompletionProvider } from "../autocomplete/completionProvider";
import type { LanguageId } from "../projects/models";
import { matchSnippetBeforeCursor, type SnippetDefinition } from "../snippets/snippetEngine";
import { editorHighlightStyle, editorTheme } from "./editorTheme";
import { loadLanguageExtension } from "./languages";
import { autocompleteNavigationKeymap, createSmartTabBinding, decideSmartTabAction } from "./smartTab";

interface CachedDocument {
  state: EditorState;
  language: LanguageId;
  desiredLanguage: LanguageId;
}

export class EditorAdapter {
  private readonly languageCompartment = new Compartment();
  private readonly cachedDocuments = new Map<string, CachedDocument>();
  private currentFileId = "";
  private currentLanguage: LanguageId = "text";
  private readonly view: EditorView;

  constructor(
    parent: HTMLElement,
    private readonly onChange: (fileId: string, content: string) => void,
    private readonly onSaveShortcut: () => void,
    private readonly onRunShortcut: () => void,
    private readonly getUserSnippets: () => readonly SnippetDefinition[] = () => []
  ) {
    this.view = new EditorView({ parent });
  }

  open(fileId: string, content: string, language: LanguageId): void {
    this.cacheCurrentState();
    this.currentFileId = fileId;
    this.currentLanguage = language;

    let cached = this.cachedDocuments.get(fileId);
    if (!cached) {
      cached = {
        state: EditorState.create({
          doc: content,
          extensions: this.baseExtensions()
        }),
        language: "text",
        desiredLanguage: language
      };
      this.cachedDocuments.set(fileId, cached);
    } else {
      cached.desiredLanguage = language;
    }

    this.view.setState(cached.state);
    this.view.focus();
    if (cached.language !== language) {
      void this.applyLanguage(fileId, language);
    }
  }

  /**
   * Shows an empty document because no file is open — a project can genuinely
   * have none. The outgoing file's state is cached first, so this is safe when
   * the file still exists and the caller is only moving away from it.
   */
  clear(): void {
    this.cacheCurrentState();
    this.currentFileId = "";
    this.currentLanguage = "text";
    this.view.setState(
      EditorState.create({ doc: "", extensions: this.baseExtensions() })
    );
  }

  forget(fileId: string): void {
    this.cachedDocuments.delete(fileId);
  }

  focus(): void {
    this.view.focus();
  }

  content(): string {
    return this.view.state.doc.toString();
  }

  destroy(): void {
    this.view.destroy();
  }

  private cacheCurrentState(): void {
    if (!this.currentFileId) {
      return;
    }

    this.cachedDocuments.set(this.currentFileId, {
      state: this.view.state,
      language: this.cachedDocuments.get(this.currentFileId)?.language ?? "text",
      desiredLanguage: this.currentLanguage
    });
  }

  private async applyLanguage(fileId: string, language: LanguageId): Promise<void> {
    const extension = await loadLanguageExtension(language);
    const cached = this.cachedDocuments.get(fileId);
    if (!cached || cached.desiredLanguage !== language) {
      return;
    }

    const sourceState = this.currentFileId === fileId ? this.view.state : cached.state;
    cached.state = sourceState.update({
      effects: this.languageCompartment.reconfigure(extension)
    }).state;
    cached.language = language;
    if (this.currentFileId === fileId) {
      this.view.setState(cached.state);
      this.view.focus();
    }
  }

  private baseExtensions(): Extension[] {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(editorHighlightStyle),
      bracketMatching(),
      closeBrackets(),
      autocompletion({
        override: [createCompletionProvider(() => this.currentLanguage)],
        defaultKeymap: false,
        interactionDelay: 0
      }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      tooltips({ position: "absolute" }),
      EditorView.contentAttributes.of({
        autocapitalize: "off",
        autocomplete: "off",
        autocorrect: "off",
        spellcheck: "false"
      }),
      EditorState.tabSize.of(4),
      snippetKeymap.of([]),
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (this.onSaveShortcut(), true) },
        { key: "Mod-Enter", preventDefault: true, run: () => (this.onRunShortcut(), true) },
        { key: "Ctrl-Enter", preventDefault: true, run: () => (this.onRunShortcut(), true) },
        createSmartTabBinding((view) => this.smartTab(view)),
        ...autocompleteNavigationKeymap,
        { key: "Escape", run: clearSnippet },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap
      ]),
      this.languageCompartment.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && this.currentFileId) {
          this.onChange(this.currentFileId, update.state.doc.toString());
        }
      }),
      editorTheme
    ];
  }

  private smartTab(view: EditorView): boolean {
    const selection = view.state.selection;
    const cursor = selection.main.head;
    const triggerMatch =
      selection.ranges.length === 1 && selection.main.empty
        ? matchSnippetBeforeCursor(
            view.state.sliceDoc(0, cursor),
            this.currentLanguage,
            this.getUserSnippets()
          )
        : undefined;
    const action = decideSmartTabAction({
      autocompleteSelected:
        completionStatus(view.state) === "active" && selectedCompletion(view.state) !== null,
      snippetSessionActive: hasNextSnippetField(view.state),
      snippetTriggerMatched: Boolean(triggerMatch)
    });

    if (action === "autocomplete") {
      return acceptCompletion(view);
    }
    if (action === "snippet-session") {
      return nextSnippetField(view);
    }
    if (action === "snippet-trigger" && triggerMatch) {
      view.dispatch({ annotations: isolateHistory.of("full") });
      snippet(triggerMatch.snippet.body)(view, null, triggerMatch.from, cursor);
      view.dispatch({ annotations: isolateHistory.of("full") });
      return true;
    }
    return indentMore(view);
  }
}
