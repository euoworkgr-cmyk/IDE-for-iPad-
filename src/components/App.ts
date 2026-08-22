import { EditorAdapter } from "../editor/EditorAdapter";
import { languageLabel } from "../editor/languages";
import { exportFile, exportProject } from "../filesystem/exportProject";
import {
  createImportedProjectFile,
  IMPORT_FILE_ACCEPT,
  ImportFileError
} from "../filesystem/importFile";
import {
  createFile,
  createProject,
  languageFromPath,
  type Project,
  type ProjectFile
} from "../projects/models";
import { formatFileCount, formatProjectCount, summarizeProjects } from "../projects/projectSummary";
import { ProjectRepository } from "../storage/database";
import { EvictionWatch } from "../storage/evictionWatch";
import { describeStorageNotice, type StorageNotice } from "../storage/storageFailure";
import { RecoveryJournal } from "../storage/recoveryJournal";
import { SaveCoordinator, type SaveState } from "../storage/saveCoordinator";
import { JavaScriptRuntime, type JavaScriptRuntimeStatus } from "../runtime/JavaScriptRuntime";
import { PythonRuntime, type PythonRuntimeStatus } from "../runtime/PythonRuntime";
import { canRunScript, canRunTypeScript, runActiveScript } from "../runtime/runJavaScript";
import { canRunPython, runActivePython } from "../runtime/runPython";
import { SqlRuntime, type SqlRuntimeStatus } from "../runtime/SqlRuntime";
import { canRunSql, runActiveSql } from "../runtime/runSql";
import { PhpRuntime, type PhpRuntimeStatus } from "../runtime/PhpRuntime";
import {
  CSharpRuntime,
  type CSharpDiagnostic,
  type CSharpRuntimeStatus
} from "../runtime/CSharpRuntime";
import { canRunPhp, runActivePhp } from "../runtime/runPhp";
import { canRunCSharp, runActiveCSharp } from "../runtime/runCSharp";
import { PreviewRuntime, type PreviewRuntimeStatus } from "../runtime/PreviewRuntime";
import { IframePreviewSurface } from "../runtime/previewSurface";
import { canRunPreview, runActivePreview } from "../runtime/runPreview";
import { parseErrorReport, presentableFrames } from "../runtime/errorReport";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_EXECUTION_TIMEOUT_MS,
  INDENT_WIDTHS,
  MAX_EDITOR_FONT_SIZE,
  MAX_EXECUTION_TIMEOUT_MS,
  MIN_EDITOR_FONT_SIZE,
  MIN_EXECUTION_TIMEOUT_MS,
  normalizeEditorFontSize,
  normalizeIndentWidth,
  normalizeTheme,
  timeoutMsFromSeconds,
  timeoutSecondsFromMs,
  type AppSettings
} from "../settings/appSettings";
import { AppearanceController, DARK_SCHEME_QUERY } from "../settings/appearance";
import { SettingsStore } from "../settings/settingsStore";
import {
  BUILT_IN_SNIPPETS,
  createUserSnippet,
  uniqueDuplicateTrigger,
  validateSnippetDraft,
  type SnippetDefinition,
  type SnippetDraft,
  type SnippetLanguage
} from "../snippets/snippetEngine";
import { SnippetRepository } from "../snippets/snippetStorage";

/** Formats a byte count for the status bar's storage-quota diagnostic. */
function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function requireElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function normalizedFilePath(input: string): string {
  return input
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function snippetLanguageLabel(language: SnippetLanguage): string {
  return language === "any" ? "Any" : languageLabel(language);
}

export class App {
  private readonly repository = new ProjectRepository((notice) => this.showStorageNotice(notice));
  private readonly evictionWatch = new EvictionWatch();
  private readonly snippetRepository = new SnippetRepository();
  private readonly journal: RecoveryJournal;
  private readonly saveCoordinator: SaveCoordinator;
  private readonly editor: EditorAdapter;
  private readonly settingsStore = new SettingsStore(this.repository);
  private readonly pythonRuntime = new PythonRuntime();
  // The limit is read per run, so changing it in Settings applies immediately.
  private readonly javaScriptRuntime = new JavaScriptRuntime(undefined, () =>
    this.settingsStore.settings.executionTimeoutMs
  );
  private readonly sqlRuntime = new SqlRuntime(undefined, () =>
    this.settingsStore.settings.executionTimeoutMs
  );
  private readonly phpRuntime = new PhpRuntime(undefined, () =>
    this.settingsStore.settings.executionTimeoutMs
  );
  private readonly cSharpRuntime = new CSharpRuntime(undefined, () =>
    this.settingsStore.settings.executionTimeoutMs
  );
  // Built in the constructor rather than here: unlike the Worker-backed
  // runtimes, a preview needs an element to render into, and the markup does
  // not exist until the constructor has written it.
  private readonly previewRuntime: PreviewRuntime;
  private projects: Project[] = [];
  private currentProject: Project | undefined;
  private userSnippets: SnippetDefinition[] = [];
  private editingSnippet: SnippetDefinition | undefined;
  private dialogSnippet: SnippetDefinition | undefined;
  private snippetStorageAvailable = true;
  private executionRunning = false;
  private activeRun: Promise<void> | undefined;
  /** Which file the live preview was built from, so Reload re-renders that one. */
  private previewFileId: string | undefined;
  private executionStopping = false;
  private runningLanguage: "python" | "script" | "sql" | "php" | "csharp" | "preview" = "script";
  private failureBlock: HTMLElement | undefined;

  private readonly shell: HTMLElement;
  private readonly projectSwitcher: HTMLButtonElement;
  private readonly projectSwitcherName: HTMLElement;
  private readonly projectSwitcherCount: HTMLElement;
  private readonly projectDialog: HTMLDialogElement;
  private readonly projectDialogSummary: HTMLElement;
  private readonly projectList: HTMLUListElement;
  private readonly fileList: HTMLUListElement;
  private readonly fileImportInput: HTMLInputElement;
  private readonly builtInSnippetList: HTMLElement;
  private readonly userSnippetList: HTMLElement;
  private readonly snippetDialog: HTMLDialogElement;
  private readonly snippetDialogTitle: HTMLElement;
  private readonly snippetNameInput: HTMLInputElement;
  private readonly snippetTriggerInput: HTMLInputElement;
  private readonly snippetLanguageSelect: HTMLSelectElement;
  private readonly snippetBodyInput: HTMLTextAreaElement;
  private readonly snippetFormError: HTMLElement;
  private readonly snippetSaveButton: HTMLButtonElement;
  private readonly snippetDeleteButton: HTMLButtonElement;
  private readonly snippetDuplicateButton: HTMLButtonElement;
  private readonly tabTitle: HTMLElement;
  private readonly languageStatus: HTMLElement;
  private readonly saveStatus: HTMLElement;
  private readonly networkStatus: HTMLElement;
  private readonly storageStatus: HTMLElement;
  private readonly runButton: HTMLButtonElement;
  private readonly consolePanel: HTMLElement;
  private readonly consoleOutput: HTMLElement;
  private readonly consoleStatus: HTMLElement;
  private readonly editorEmpty: HTMLElement;
  private readonly editorHost: HTMLElement;
  private readonly previewPanel: HTMLElement;
  private readonly previewHost: HTMLElement;
  private readonly previewTitle: HTMLElement;
  private readonly exportDialog: HTMLDialogElement;
  private readonly exportSummary: HTMLElement;
  private readonly exportFileButton: HTMLButtonElement;
  private readonly exportFileDetail: HTMLElement;
  private readonly exportProjectDetail: HTMLElement;
  private readonly settingsDialog: HTMLDialogElement;
  private readonly settingsTimeoutInput: HTMLInputElement;
  private readonly settingsThemeSelect: HTMLSelectElement;
  private readonly settingsFontSizeInput: HTMLInputElement;
  private readonly settingsFontSizeValue: HTMLOutputElement;
  private readonly settingsIndentSelect: HTMLSelectElement;
  private readonly settingsFormError: HTMLElement;
  private readonly settingsPersistenceNote: HTMLElement;
  private readonly indentStatus: HTMLElement;
  private readonly appearanceController: AppearanceController;
  private readonly noticeBar: HTMLElement;
  private readonly noticeTitle: HTMLElement;
  private readonly noticeDetail: HTMLElement;
  private readonly noticeExport: HTMLButtonElement;
  private readonly noticeDismiss: HTMLButtonElement;
  /** Which notice is on screen, so a repeat does not replace a worse one. */
  private currentNotice: StorageNotice | undefined;
  private persistentStorageGranted = false;
  private recoveryJournalAvailable = true;
  /**
   * Diagnostic for the R2 follow-up: whether Private Browsing is silently
   * ephemeral rather than erroring. `navigator.storage.estimate()`'s numbers
   * for a private session are not consistently documented across current
   * Safari/iPadOS versions, so this surfaces the real figure in the status bar
   * instead of guessing a threshold to warn on. Once a real device has
   * reported back what a private tab actually shows, this becomes the basis
   * for a proper heuristic notice rather than staying a diagnostic.
   */
  private storageQuotaLabel: string | undefined;
  private offlineReady = false;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="app-shell" data-sidebar="open">
        <header class="topbar">
          <button class="icon-button sidebar-toggle" type="button" aria-label="Toggle files" title="Toggle files">☰</button>
          <div class="brand" aria-label="Altitude Code"><span class="brand-mark">A</span><span class="brand-name">Altitude</span></div>
          <button class="project-switcher" data-action="open-projects" type="button" aria-haspopup="dialog" aria-expanded="false">
            <span class="project-switcher-text">
              <span class="project-switcher-name">Project</span>
              <span class="project-switcher-count">1 project</span>
            </span>
            <span class="project-switcher-chevron" aria-hidden="true">▾</span>
          </button>
          <button class="icon-button" data-action="new-project" type="button" aria-label="New project" title="New project">＋</button>
          <div class="topbar-spacer"></div>
          <button class="run-button" data-action="run" type="button" title="Run (Cmd/Ctrl+Enter)">▶ Run</button>
          <span class="save-status" aria-live="polite">Saved</span>
          <span class="network-status">Online</span>
          <button class="icon-button" data-action="open-settings" type="button" aria-label="Settings" title="Settings">⚙</button>
          <button class="primary-button" data-action="export" type="button">Export</button>
        </header>
        <!--
          role="alert" rather than a status: this only appears when something
          the user needs to act on has happened, and the whole point of the
          task is that these conditions stopped being silent.
        -->
        <div class="notice-bar" role="alert" hidden>
          <span class="notice-mark" aria-hidden="true">!</span>
          <div class="notice-text">
            <strong class="notice-title"></strong>
            <span class="notice-detail"></span>
          </div>
          <button class="notice-action" data-action="notice-export" type="button">Export…</button>
          <button class="notice-dismiss" data-action="dismiss-notice" type="button" aria-label="Dismiss">×</button>
        </div>
        <main class="workspace">
          <aside class="explorer">
            <div class="explorer-heading">
              <span>Files</span>
              <div class="explorer-actions">
                <button class="icon-button" data-action="new-file" type="button" aria-label="New file" title="New file">＋</button>
                <button class="icon-button" data-action="import-file" type="button" aria-label="Import file" title="Import file">⇧</button>
                <button class="icon-button" data-action="rename-file" type="button" aria-label="Rename file" title="Rename file">✎</button>
                <button class="icon-button danger-hover" data-action="delete-file" type="button" aria-label="Delete file" title="Delete file">⌫</button>
              </div>
            </div>
            <input class="file-import-input" type="file" accept="${IMPORT_FILE_ACCEPT}" hidden>
            <ul class="file-list" aria-label="Project files"></ul>
            <section class="snippets-panel" aria-label="Snippets">
              <div class="snippets-heading">
                <span>Snippets</span>
                <button class="icon-button" data-action="new-snippet" type="button" aria-label="New snippet" title="New snippet">＋</button>
              </div>
              <div class="snippets-scroll">
                <details class="snippet-group" open>
                  <summary>Built-in</summary>
                  <div class="builtin-snippet-list"></div>
                </details>
                <details class="snippet-group" open>
                  <summary>My snippets</summary>
                  <div class="user-snippet-list"></div>
                </details>
              </div>
            </section>
          </aside>
          <section class="editor-pane">
            <div class="editor-tab"><span class="file-dot"></span><span class="tab-title">No file</span></div>
            <div class="editor-host"></div>
            <div class="editor-empty" hidden>
              <h2>No files in this project</h2>
              <p>
                A project can be empty. Create a file to start writing — Python
                <code>.py</code>, JavaScript <code>.js</code>, TypeScript
                <code>.ts</code>, SQL <code>.sql</code>, PHP <code>.php</code> and
                C# <code>.cs</code> files can be run from here, and HTML
                <code>.html</code> and CSS <code>.css</code> files can be previewed.
              </p>
              <button class="primary-button" data-action="new-file-empty" type="button">Create a file</button>
            </div>
            <section class="editor-preview" aria-label="Preview" hidden>
              <header class="preview-header">
                <span>Preview</span>
                <span class="preview-title"></span>
                <span class="console-spacer"></span>
                <button class="console-button" data-action="reload-preview" type="button" title="Render the file again">⟳ Reload</button>
                <button class="console-button" data-action="close-preview" type="button" aria-label="Close preview" title="Close preview">×</button>
              </header>
              <div class="preview-host"></div>
            </section>
            <section class="editor-console" aria-label="Run output" hidden>
              <header class="console-header">
                <span>Output</span>
                <span class="console-status" aria-live="polite">Idle</span>
                <span class="console-spacer"></span>
                <button class="console-button" data-action="clear-console" type="button">Clear</button>
                <button class="console-button console-close" data-action="close-console" type="button" aria-label="Close output" title="Close output">×</button>
              </header>
              <pre class="console-output" role="log" aria-live="polite" aria-relevant="additions text"></pre>
            </section>
          </section>
        </main>
        <footer class="statusbar">
          <span class="language-status">Plain Text</span>
          <span class="status-spacer"></span>
          <span class="storage-status">Local storage</span>
          <span class="indent-status">Spaces: 4</span>
        </footer>
      </div>
      <dialog class="snippet-dialog" aria-labelledby="snippet-dialog-title">
        <form class="snippet-form">
          <header class="snippet-dialog-header">
            <h2 id="snippet-dialog-title">Snippet</h2>
            <button class="snippet-close" data-action="close-snippet" type="button" aria-label="Close" title="Close">×</button>
          </header>
          <label>Name<input class="snippet-name" name="name" maxlength="80" required></label>
          <label>Trigger<input class="snippet-trigger" name="trigger" maxlength="40" autocapitalize="off" autocomplete="off" spellcheck="false" required></label>
          <label>Language
            <select class="snippet-language" name="language" required>
              <option value="python">Python</option>
              <option value="csharp">C#</option>
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="sql">SQL</option>
              <option value="php">PHP</option>
              <option value="java">Java</option>
              <option value="c">C</option>
              <option value="cpp">C++</option>
              <option value="html">HTML</option>
              <option value="css">CSS</option>
              <option value="json">JSON</option>
              <option value="text">Plain Text</option>
              <option value="any">Any language</option>
            </select>
          </label>
          <label class="snippet-body-label">Body<textarea class="snippet-body" name="body" rows="10" spellcheck="false"></textarea></label>
          <p class="snippet-form-error" role="alert" hidden></p>
          <footer class="snippet-dialog-actions">
            <button class="secondary-button" data-action="duplicate-snippet" type="button">Duplicate</button>
            <button class="secondary-button danger-button" data-action="delete-snippet" type="button">Delete</button>
            <span class="dialog-spacer"></span>
            <button class="secondary-button" data-action="cancel-snippet" type="button">Cancel</button>
            <button class="primary-button" data-action="save-snippet" type="submit">Save</button>
          </footer>
        </form>
      </dialog>
      <dialog class="project-dialog" aria-labelledby="project-dialog-title">
        <div class="project-dialog-body">
          <header class="project-dialog-header">
            <h2 id="project-dialog-title">Projects</h2>
            <button class="snippet-close" data-action="close-projects" type="button" aria-label="Close" title="Close">×</button>
          </header>
          <p class="project-dialog-summary"></p>
          <ul class="project-list" aria-label="All projects"></ul>
          <footer class="project-dialog-actions">
            <button class="primary-button" data-action="new-project-from-list" type="button">New project</button>
          </footer>
        </div>
      </dialog>
      <dialog class="export-dialog" aria-labelledby="export-dialog-title">
        <div class="export-panel">
          <header class="snippet-dialog-header">
            <h2 id="export-dialog-title">Export</h2>
            <button class="snippet-close" data-action="close-export" type="button" aria-label="Close" title="Close">×</button>
          </header>
          <p class="export-summary"></p>
          <div class="export-options">
            <button class="export-option" data-action="export-current-file" type="button">
              <span class="export-option-title">This file only</span>
              <span class="export-option-detail export-file-detail"></span>
            </button>
            <button class="export-option" data-action="export-whole-project" type="button">
              <span class="export-option-title">The whole project</span>
              <span class="export-option-detail export-project-detail"></span>
            </button>
          </div>
          <footer class="settings-dialog-actions">
            <span class="dialog-spacer"></span>
            <button class="secondary-button" data-action="cancel-export" type="button">Cancel</button>
          </footer>
        </div>
      </dialog>
      <dialog class="settings-dialog" aria-labelledby="settings-dialog-title">
        <!-- novalidate: the form reports range errors itself, so the message is
             the same in every browser rather than a native bubble in some and
             a silently swallowed submit in others. -->
        <form class="settings-form" novalidate>
          <header class="settings-dialog-header">
            <h2 id="settings-dialog-title">Settings</h2>
            <button class="snippet-close" data-action="close-settings" type="button" aria-label="Close" title="Close">×</button>
          </header>
          <label>Appearance
            <select class="settings-theme" name="theme">
              <option value="system">Follow the system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>Editor text size
            <span class="settings-range">
              <input class="settings-font-size" name="editorFontSize" type="range"
                min="${MIN_EDITOR_FONT_SIZE}" max="${MAX_EDITOR_FONT_SIZE}" step="1">
              <!-- aria-hidden: this is the visual echo of the slider's value,
                   which assistive technology already reads from the range's
                   own aria-valuetext. Left exposed it would be announced
                   twice, once as part of the label. -->
              <output class="settings-font-size-value" aria-hidden="true"></output>
            </span>
          </label>
          <label>Indent width
            <select class="settings-indent" name="indentWidth">
              ${INDENT_WIDTHS.map((width) => `<option value="${width}">${width} spaces</option>`).join("")}
            </select>
          </label>
          <p class="settings-hint">
            Appearance and text size apply as you change them, so you can see the result before
            you keep it — Cancel puts them back. Indent width is what Tab inserts and what every
            language mode indents by, and it is what the status bar reports.
          </p>
          <label>Run time limit (seconds)
            <input class="settings-timeout" name="executionTimeout" type="number" inputmode="decimal"
              min="${timeoutSecondsFromMs(MIN_EXECUTION_TIMEOUT_MS)}"
              max="${timeoutSecondsFromMs(MAX_EXECUTION_TIMEOUT_MS)}" step="0.5" required>
          </label>
          <p class="settings-hint">
            A JavaScript, TypeScript, SQL or PHP run is stopped once it passes this limit, so a
            runaway loop or query cannot hold the Run button forever. For PHP the limit covers your
            code, not the seconds the interpreter spends loading. Between
            ${timeoutSecondsFromMs(MIN_EXECUTION_TIMEOUT_MS)} and
            ${timeoutSecondsFromMs(MAX_EXECUTION_TIMEOUT_MS)} seconds; the default is
            ${timeoutSecondsFromMs(DEFAULT_EXECUTION_TIMEOUT_MS)}.
            Python is not time-limited — its first run has to load the interpreter, which would
            trip any sensible limit — but the Stop button ends a Python run at any point.
            An HTML or CSS preview is not time-limited either: a page is not finished when it has
            loaded, so it stays live until you close it.
          </p>
          <p class="settings-form-error" role="alert" hidden></p>
          <p class="settings-persistence-note" hidden>
            Settings storage is unavailable, so this change lasts only until the app is reloaded.
          </p>
          <footer class="settings-dialog-actions">
            <button class="secondary-button" data-action="reset-settings" type="button">Reset to default</button>
            <span class="dialog-spacer"></span>
            <button class="secondary-button" data-action="cancel-settings" type="button">Cancel</button>
            <button class="primary-button" data-action="save-settings" type="submit">Save</button>
          </footer>
        </form>
      </dialog>
    `;

    this.shell = requireElement(root, ".app-shell");
    this.projectSwitcher = requireElement(root, ".project-switcher");
    this.projectSwitcherName = requireElement(root, ".project-switcher-name");
    this.projectSwitcherCount = requireElement(root, ".project-switcher-count");
    this.projectDialog = requireElement(root, ".project-dialog");
    this.projectDialogSummary = requireElement(root, ".project-dialog-summary");
    this.projectList = requireElement(root, ".project-list");
    this.fileList = requireElement(root, ".file-list");
    this.fileImportInput = requireElement(root, ".file-import-input");
    this.builtInSnippetList = requireElement(root, ".builtin-snippet-list");
    this.userSnippetList = requireElement(root, ".user-snippet-list");
    this.snippetDialog = requireElement(root, ".snippet-dialog");
    this.snippetDialogTitle = requireElement(root, "#snippet-dialog-title");
    this.snippetNameInput = requireElement(root, ".snippet-name");
    this.snippetTriggerInput = requireElement(root, ".snippet-trigger");
    this.snippetLanguageSelect = requireElement(root, ".snippet-language");
    this.snippetBodyInput = requireElement(root, ".snippet-body");
    this.snippetFormError = requireElement(root, ".snippet-form-error");
    this.snippetSaveButton = requireElement(root, '[data-action="save-snippet"]');
    this.snippetDeleteButton = requireElement(root, '[data-action="delete-snippet"]');
    this.snippetDuplicateButton = requireElement(root, '[data-action="duplicate-snippet"]');
    this.tabTitle = requireElement(root, ".tab-title");
    this.languageStatus = requireElement(root, ".language-status");
    this.saveStatus = requireElement(root, ".save-status");
    this.networkStatus = requireElement(root, ".network-status");
    this.storageStatus = requireElement(root, ".storage-status");
    this.runButton = requireElement(root, '[data-action="run"]');
    this.consolePanel = requireElement(root, ".editor-console");
    this.consoleOutput = requireElement(root, ".console-output");
    this.editorEmpty = requireElement(root, ".editor-empty");
    this.editorHost = requireElement(root, ".editor-host");
    this.previewPanel = requireElement(root, ".editor-preview");
    this.previewHost = requireElement(root, ".preview-host");
    this.previewTitle = requireElement(root, ".preview-title");
    this.exportDialog = requireElement(root, ".export-dialog");
    this.exportSummary = requireElement(root, ".export-summary");
    this.exportFileButton = requireElement(root, '[data-action="export-current-file"]');
    this.exportFileDetail = requireElement(root, ".export-file-detail");
    this.exportProjectDetail = requireElement(root, ".export-project-detail");
    this.consoleStatus = requireElement(root, ".console-status");
    this.settingsDialog = requireElement(root, ".settings-dialog");
    this.settingsTimeoutInput = requireElement(root, ".settings-timeout");
    this.settingsThemeSelect = requireElement(root, ".settings-theme");
    this.settingsFontSizeInput = requireElement(root, ".settings-font-size");
    this.settingsFontSizeValue = requireElement(root, ".settings-font-size-value");
    this.settingsIndentSelect = requireElement(root, ".settings-indent");
    this.indentStatus = requireElement(root, ".indent-status");
    this.noticeBar = requireElement(root, ".notice-bar");
    this.noticeTitle = requireElement(root, ".notice-title");
    this.noticeDetail = requireElement(root, ".notice-detail");
    this.noticeExport = requireElement(root, '[data-action="notice-export"]');
    this.noticeDismiss = requireElement(root, '[data-action="dismiss-notice"]');
    this.settingsFormError = requireElement(root, ".settings-form-error");
    this.settingsPersistenceNote = requireElement(root, ".settings-persistence-note");

    this.previewRuntime = new PreviewRuntime(
      new IframePreviewSurface(this.previewHost, (visible) => this.setPreviewOpen(visible)),
      window
    );

    this.journal = new RecoveryJournal(undefined, () => this.showRecoveryWarning());
    this.saveCoordinator = new SaveCoordinator(this.repository, this.journal, (state) => this.setSaveState(state));
    this.editor = new EditorAdapter(
      requireElement(root, ".editor-host"),
      (fileId, content) => this.handleEditorChange(fileId, content),
      () => void this.saveCoordinator.flush(),
      () => void this.handleRunControl(),
      () => this.userSnippets
    );

    // Built after the editor, because a system appearance change has to
    // reconfigure it: CodeMirror's `dark` flag is the one part of the theme
    // that cannot be a custom property.
    this.appearanceController = new AppearanceController(
      document,
      window.matchMedia?.(DARK_SCHEME_QUERY),
      (appearance) =>
        this.editor.applyPreferences({
          appearance,
          indentWidth: this.settingsStore.settings.indentWidth
        })
    );

    this.bindEvents();
  }

  async start(): Promise<void> {
    // No try/catch around the storage calls any more. The repository does not
    // throw on the way in: it falls back to memory and raises a notice, so a
    // device that cannot store anything gets a usable app with a warning
    // instead of the dead page this used to end at.
    this.projects = await this.repository.listProjects();

    // Only meaningful when real storage answered — an empty list in
    // session-only mode says nothing about what is on the device.
    const evicted =
      this.repository.mode === "indexeddb" && this.evictionWatch.wasEvicted(this.projects.length);

    if (this.projects.length === 0) {
      const initialProject = createProject("My Python Project");
      await this.saveProjectQuietly(initialProject);
      this.projects.push(initialProject);
    }

    const recoveredProjects = this.journal.recover(this.projects);
    for (const recoveredProject of recoveredProjects) {
      await this.saveProjectQuietly(recoveredProject);
    }
    for (const project of this.projects) {
      this.journal.clearIfSaved(project.id, project.updatedAt);
    }

    await this.settingsStore.load();
    this.applyDisplaySettings(this.settingsStore.settings);
    const session = await this.repository.getSession();
    this.currentProject =
      this.projects.find((project) => project.id === session?.activeProjectId) ?? this.projects[0];
    this.ensureActiveFile();
    try {
      this.userSnippets = await this.snippetRepository.list();
    } catch (error) {
      console.error("User snippets could not be loaded", error);
      this.snippetStorageAvailable = false;
    }
    this.renderAll();
    await this.rememberCurrentProject();

    if (evicted) {
      this.showStorageNotice(describeStorageNotice("evicted"));
    }
    if (this.repository.mode === "indexeddb") {
      this.evictionWatch.record(this.projects.length);
    }
    this.setSaveState("idle");

    await this.requestPersistentStorage();
    void this.reportStorageQuota();
    this.renderStorageState();
    this.watchOfflineCache();
  }

  /**
   * Startup writes whose failure is already being reported by the repository's
   * notice. Letting them reject here would abort the rest of `start()` and
   * leave the app half-built, which is the outcome session-only mode exists to
   * avoid.
   */
  private async saveProjectQuietly(project: Project): Promise<void> {
    try {
      await this.repository.saveProject(project);
    } catch (error) {
      console.error("Project could not be written during startup", error);
    }
  }

  /**
   * The last resort, and no longer where a storage problem lands — those now
   * degrade to session-only mode with a notice. What is left is a genuine
   * defect, so this says so plainly instead of blaming the browser's settings
   * and offering advice ("check website data permissions and reload") that
   * changed nothing in the case it used to be shown for.
   */
  showFatalError(error: unknown): void {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    this.root.replaceChildren();

    const panel = document.createElement("main");
    panel.className = "fatal-error";

    const heading = document.createElement("h1");
    heading.textContent = "Altitude could not start";

    const explanation = document.createElement("p");
    explanation.textContent =
      "Something went wrong before the editor could open. Your saved projects have not been touched — reloading is safe.";

    const detail = document.createElement("p");
    detail.className = "fatal-error-detail";
    detail.textContent = message;

    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "primary-button";
    reload.textContent = "Reload Altitude";
    reload.addEventListener("click", () => window.location.reload());

    panel.append(heading, explanation, detail, reload);
    this.root.append(panel);
  }

  private bindEvents(): void {
    requireElement(this.root, ".sidebar-toggle").addEventListener("click", () => {
      this.shell.dataset.sidebar = this.shell.dataset.sidebar === "open" ? "closed" : "open";
    });

    this.projectSwitcher.addEventListener("click", () => this.openProjectDialog());
    requireElement(this.root, '[data-action="close-projects"]').addEventListener("click", () => this.closeProjectDialog());
    requireElement(this.root, '[data-action="new-project-from-list"]').addEventListener("click", () => {
      this.closeProjectDialog();
      void this.newProject();
    });
    this.projectDialog.addEventListener("click", (event) => {
      if (event.target === this.projectDialog) {
        this.closeProjectDialog();
      }
    });
    this.projectDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeProjectDialog();
    });
    requireElement(this.root, '[data-action="new-project"]').addEventListener("click", () => void this.newProject());
    requireElement(this.root, '[data-action="new-file"]').addEventListener("click", () => this.newFile());
    requireElement(this.root, '[data-action="import-file"]').addEventListener("click", () => {
      this.fileImportInput.value = "";
      this.fileImportInput.click();
    });
    this.fileImportInput.addEventListener("change", () => void this.importSelectedFile());
    requireElement(this.root, '[data-action="new-snippet"]').addEventListener("click", () => {
      this.openSnippetDialog();
    });
    requireElement<HTMLFormElement>(this.root, ".snippet-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveSnippet();
    });
    requireElement(this.root, '[data-action="close-snippet"]').addEventListener("click", () => this.closeSnippetDialog());
    requireElement(this.root, '[data-action="cancel-snippet"]').addEventListener("click", () => this.closeSnippetDialog());
    this.snippetDeleteButton.addEventListener("click", () => void this.deleteSnippet());
    this.snippetDuplicateButton.addEventListener("click", () => this.duplicateSnippet());
    this.snippetDialog.addEventListener("click", (event) => {
      if (event.target === this.snippetDialog) {
        this.closeSnippetDialog();
      }
    });
    this.snippetDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeSnippetDialog();
    });
    requireElement(this.root, '[data-action="new-file-empty"]').addEventListener("click", () => this.newFile());
    requireElement(this.root, '[data-action="rename-file"]').addEventListener("click", () => this.renameFile());
    requireElement(this.root, '[data-action="delete-file"]').addEventListener("click", () => this.deleteFile());
    requireElement(this.root, '[data-action="export"]').addEventListener("click", () => void this.openExportDialog());
    requireElement(this.root, '[data-action="close-export"]').addEventListener("click", () => this.closeExportDialog());
    requireElement(this.root, '[data-action="cancel-export"]').addEventListener("click", () => this.closeExportDialog());
    this.exportFileButton.addEventListener("click", () => this.exportActiveFile());
    requireElement(this.root, '[data-action="export-whole-project"]').addEventListener("click", () =>
      this.exportWholeProject()
    );
    this.runButton.addEventListener("click", () => void this.handleRunControl());
    requireElement(this.root, '[data-action="clear-console"]').addEventListener("click", () => {
      this.consoleOutput.replaceChildren();
      this.failureBlock = undefined;
      this.consoleStatus.textContent = "Idle";
    });
    requireElement(this.root, '[data-action="reload-preview"]').addEventListener("click", () => {
      void this.reloadPreview();
    });
    requireElement(this.root, '[data-action="close-preview"]').addEventListener("click", () => {
      // Closing the preview *is* stopping it: the document only stops running
      // when its frame is removed, so the × and Stop do the same thing.
      this.previewRuntime.stop();
      this.editor.focus();
    });
    requireElement(this.root, '[data-action="close-console"]').addEventListener("click", () => {
      this.setConsoleOpen(false);
      this.editor.focus();
    });
    requireElement(this.root, '[data-action="open-settings"]').addEventListener("click", () => {
      this.openSettingsDialog();
    });
    requireElement<HTMLFormElement>(this.root, ".settings-form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveSettings();
    });
    requireElement(this.root, '[data-action="close-settings"]').addEventListener("click", () => this.closeSettingsDialog());
    requireElement(this.root, '[data-action="cancel-settings"]').addEventListener("click", () => this.closeSettingsDialog());
    requireElement(this.root, '[data-action="reset-settings"]').addEventListener("click", () => {
      this.fillSettingsForm(DEFAULT_APP_SETTINGS);
      this.applyDisplaySettings(DEFAULT_APP_SETTINGS);
      this.settingsFormError.hidden = true;
    });
    // Live preview. "input" rather than "change" so dragging the text-size
    // slider re-sizes the editor as it moves; the work behind it is setting a
    // custom property, which is cheap enough to do per frame.
    for (const control of [
      this.settingsThemeSelect,
      this.settingsFontSizeInput,
      this.settingsIndentSelect
    ]) {
      control.addEventListener("input", () => this.applyDisplaySettings(this.settingsFormDraft()));
    }
    this.settingsDialog.addEventListener("click", (event) => {
      if (event.target === this.settingsDialog) {
        this.closeSettingsDialog();
      }
    });
    this.settingsDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeSettingsDialog();
    });

    window.addEventListener("keydown", (event) => {
      if (
        !event.defaultPrevented &&
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        void this.handleRunControl();
      }
    });

    this.noticeExport.addEventListener("click", () => void this.openExportDialog());
    this.noticeDismiss.addEventListener("click", () => this.dismissNotice());

    window.addEventListener("online", () => this.renderNetworkState());
    window.addEventListener("offline", () => this.renderNetworkState());
    window.addEventListener("pagehide", () => void this.saveCoordinator.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        void this.saveCoordinator.flush();
      }
    });
  }

  private renderAll(): void {
    this.renderProjects();
    this.renderFiles();
    this.renderSnippets();
    this.openActiveFile();
    this.renderNetworkState();
  }

  private renderProjects(): void {
    const count = this.projects.length;
    const name = this.currentProject?.name ?? "No project";
    this.projectSwitcherName.textContent = name;
    this.projectSwitcherCount.textContent = formatProjectCount(count);
    // The count is the part that answers "do I have other projects?", so it is
    // in the accessible name too rather than only in the visual layout.
    this.projectSwitcher.setAttribute(
      "aria-label",
      `Current project: ${name}. ${formatProjectCount(count)}. Switch project.`
    );
    this.projectSwitcher.title = `${name} — ${formatProjectCount(count)}`;
    this.projectSwitcher.dataset.multiple = String(count > 1);
    if (this.projectDialog.open) {
      this.renderProjectList();
    }
  }

  private renderProjectList(): void {
    const summaries = summarizeProjects(this.projects, this.currentProject?.id, Date.now());
    this.projectDialogSummary.textContent =
      summaries.length === 1
        ? "This is your only project. Everything you make is kept on this device."
        : `${formatProjectCount(summaries.length)}, all kept on this device. Tap one to open it.`;

    const fragment = document.createDocumentFragment();
    for (const summary of summaries) {
      const item = document.createElement("li");
      item.className = "project-row";
      item.dataset.current = String(summary.isCurrent);

      const open = document.createElement("button");
      open.type = "button";
      open.className = "project-open";
      if (summary.isCurrent) {
        open.setAttribute("aria-current", "true");
      }
      const mark = document.createElement("span");
      mark.className = "project-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = summary.isCurrent ? "●" : "○";
      const text = document.createElement("span");
      text.className = "project-text";
      const name = document.createElement("span");
      name.className = "project-name";
      name.textContent = summary.name;
      const detail = document.createElement("span");
      detail.className = "project-detail";
      detail.textContent = summary.isCurrent ? `${summary.detail} · open now` : summary.detail;
      text.append(name, detail);
      open.append(mark, text);
      open.addEventListener("click", () => {
        this.closeProjectDialog();
        void this.switchProject(summary.id);
      });

      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "icon-button project-row-action";
      rename.textContent = "✎";
      rename.title = `Rename ${summary.name}`;
      rename.setAttribute("aria-label", `Rename ${summary.name}`);
      rename.addEventListener("click", () => this.renameProject(summary.id));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button danger-hover project-row-action";
      remove.textContent = "⌫";
      remove.title = `Delete ${summary.name}`;
      remove.setAttribute("aria-label", `Delete ${summary.name}`);
      remove.addEventListener("click", () => void this.deleteProject(summary.id));

      item.append(open, rename, remove);
      fragment.append(item);
    }
    this.projectList.replaceChildren(fragment);
  }

  private openProjectDialog(): void {
    this.renderProjectList();
    if (!this.projectDialog.open) {
      this.projectDialog.showModal();
    }
    this.projectSwitcher.setAttribute("aria-expanded", "true");
    window.setTimeout(() => {
      this.projectList.querySelector<HTMLButtonElement>('.project-open[aria-current="true"]')?.focus();
    }, 0);
  }

  private closeProjectDialog(): void {
    if (this.projectDialog.open) {
      this.projectDialog.close();
    }
    this.projectSwitcher.setAttribute("aria-expanded", "false");
  }

  private renderFiles(): void {
    const project = this.currentProject;
    if (!project) {
      this.fileList.replaceChildren();
      return;
    }

    if (project.files.length === 0) {
      const empty = document.createElement("li");
      empty.className = "file-empty";
      empty.textContent = "No files yet — use ＋ to create one.";
      this.fileList.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    const sortedFiles = [...project.files].sort((left, right) => left.path.localeCompare(right.path));
    for (const file of sortedFiles) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file-button";
      button.dataset.active = String(file.id === project.activeFileId);
      button.title = file.path;
      button.innerHTML = '<span class="file-icon">◇</span>';
      const label = document.createElement("span");
      label.className = "file-name";
      label.textContent = file.path;
      button.append(label);
      button.addEventListener("click", () => this.selectFile(file.id));
      item.append(button);
      fragment.append(item);
    }
    this.fileList.replaceChildren(fragment);
  }

  private renderSnippets(): void {
    const builtInFragment = document.createDocumentFragment();
    for (const language of ["python", "csharp"] as const) {
      const heading = document.createElement("div");
      heading.className = "snippet-language-heading";
      heading.textContent = languageLabel(language);
      builtInFragment.append(heading);
      for (const snippet of BUILT_IN_SNIPPETS.filter((candidate) => candidate.language === language)) {
        builtInFragment.append(this.createSnippetButton(snippet));
      }
    }
    this.builtInSnippetList.replaceChildren(builtInFragment);

    if (this.userSnippets.length === 0) {
      const empty = document.createElement("p");
      empty.className = "snippet-empty";
      empty.textContent = this.snippetStorageAvailable ? "No custom snippets" : "Custom snippet storage unavailable";
      this.userSnippetList.replaceChildren(empty);
      return;
    }
    const userFragment = document.createDocumentFragment();
    for (const snippet of [...this.userSnippets].sort((left, right) => left.name.localeCompare(right.name))) {
      userFragment.append(this.createSnippetButton(snippet));
    }
    this.userSnippetList.replaceChildren(userFragment);
  }

  private createSnippetButton(snippetDefinition: SnippetDefinition): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "snippet-button";
    button.title = `${snippetDefinition.name} — ${snippetLanguageLabel(snippetDefinition.language)}`;
    const name = document.createElement("span");
    name.textContent = snippetDefinition.name;
    const trigger = document.createElement("code");
    trigger.textContent = snippetDefinition.trigger;
    button.append(name, trigger);
    button.addEventListener("click", () => this.openSnippetDialog(snippetDefinition));
    return button;
  }

  private openSnippetDialog(snippetDefinition?: SnippetDefinition, duplicate = false): void {
    const source = snippetDefinition;
    this.dialogSnippet = source;
    const viewingBuiltIn = source?.source === "builtin" && !duplicate;
    this.editingSnippet = source?.source === "user" && !duplicate ? source : undefined;

    let draft: SnippetDraft;
    if (source) {
      draft = {
        name: duplicate ? `${source.name} Copy` : source.name,
        trigger: duplicate
          ? uniqueDuplicateTrigger(source.trigger, source.language, this.userSnippets)
          : source.trigger,
        language: source.language,
        body: source.body
      };
    } else {
      const currentLanguage = this.activeFile()?.language ?? "python";
      draft = { name: "", trigger: "", language: currentLanguage, body: "" };
    }

    this.snippetDialogTitle.textContent = viewingBuiltIn
      ? "Built-in snippet"
      : this.editingSnippet
        ? "Edit snippet"
        : duplicate
          ? "Duplicate snippet"
          : "New snippet";
    this.snippetNameInput.value = draft.name;
    this.snippetTriggerInput.value = draft.trigger;
    this.snippetLanguageSelect.value = draft.language;
    this.snippetBodyInput.value = draft.body;
    this.snippetNameInput.readOnly = viewingBuiltIn;
    this.snippetTriggerInput.readOnly = viewingBuiltIn;
    this.snippetLanguageSelect.disabled = viewingBuiltIn;
    this.snippetBodyInput.readOnly = viewingBuiltIn;
    this.snippetSaveButton.hidden = viewingBuiltIn;
    this.snippetDeleteButton.hidden = !this.editingSnippet;
    this.snippetDuplicateButton.hidden = !source || duplicate;
    this.snippetFormError.hidden = true;
    this.snippetFormError.textContent = "";
    this.snippetDialog.dataset.mode = viewingBuiltIn ? "view" : "edit";
    if (!this.snippetDialog.open) {
      this.snippetDialog.showModal();
    }
    if (!viewingBuiltIn) {
      window.setTimeout(() => this.snippetNameInput.focus(), 0);
    }
  }

  private closeSnippetDialog(): void {
    if (this.snippetDialog.open) {
      this.snippetDialog.close();
    }
    this.editingSnippet = undefined;
    this.dialogSnippet = undefined;
    this.editor.focus();
  }

  private duplicateSnippet(): void {
    const source = this.dialogSnippet;
    if (source) {
      this.openSnippetDialog(source, true);
    }
  }

  private async saveSnippet(): Promise<void> {
    if (this.snippetDialog.dataset.mode === "view") {
      return;
    }
    const draft: SnippetDraft = {
      name: this.snippetNameInput.value,
      trigger: this.snippetTriggerInput.value,
      language: this.snippetLanguageSelect.value as SnippetLanguage,
      body: this.snippetBodyInput.value
    };
    const errors = validateSnippetDraft(draft, this.userSnippets, this.editingSnippet?.id);
    if (errors.length > 0) {
      this.showSnippetFormError(errors.join(" "));
      return;
    }
    if (!draft.body && !window.confirm("This snippet body is empty. Save it anyway?")) {
      return;
    }
    if (!this.snippetStorageAvailable) {
      this.showSnippetFormError("Custom snippets cannot be saved because IndexedDB is unavailable.");
      return;
    }

    const now = Date.now();
    const value = this.editingSnippet
      ? {
          ...this.editingSnippet,
          name: draft.name.trim(),
          trigger: draft.trigger.trim(),
          language: draft.language,
          body: draft.body,
          updatedAt: now
        }
      : createUserSnippet(draft, now);
    this.snippetSaveButton.disabled = true;
    try {
      await this.snippetRepository.save(value);
      const existingIndex = this.userSnippets.findIndex((snippet) => snippet.id === value.id);
      if (existingIndex >= 0) {
        this.userSnippets[existingIndex] = value;
      } else {
        this.userSnippets.push(value);
      }
      this.renderSnippets();
      this.closeSnippetDialog();
    } catch (error) {
      console.error("Snippet could not be saved", error);
      this.showSnippetFormError("The snippet could not be saved to IndexedDB.");
    } finally {
      this.snippetSaveButton.disabled = false;
    }
  }

  private async deleteSnippet(): Promise<void> {
    const snippetDefinition = this.editingSnippet;
    if (!snippetDefinition || !window.confirm(`Delete snippet “${snippetDefinition.name}”?`)) {
      return;
    }
    this.snippetDeleteButton.disabled = true;
    try {
      await this.snippetRepository.delete(snippetDefinition.id);
      this.userSnippets = this.userSnippets.filter((snippet) => snippet.id !== snippetDefinition.id);
      this.renderSnippets();
      this.closeSnippetDialog();
    } catch (error) {
      console.error("Snippet could not be deleted", error);
      this.showSnippetFormError("The snippet could not be deleted from IndexedDB.");
    } finally {
      this.snippetDeleteButton.disabled = false;
    }
  }

  private showSnippetFormError(message: string): void {
    this.snippetFormError.textContent = message;
    this.snippetFormError.hidden = false;
  }

  private openActiveFile(): void {
    const file = this.activeFile();
    if (!file) {
      // A project with no files is a real state, not an error: deleting the
      // last file leaves one, and nothing is created to fill the gap.
      this.editor.clear();
      // The editor is hidden rather than left blank behind the empty state: it
      // would otherwise sit on top of the button and take keystrokes that have
      // nowhere to go.
      this.editorHost.hidden = true;
      this.editorEmpty.hidden = false;
      this.tabTitle.textContent = "No file";
      this.languageStatus.textContent = "No file";
      document.title = "Altitude";
      this.renderRunAvailability();
      return;
    }

    this.editorEmpty.hidden = true;
    this.editorHost.hidden = false;
    this.editor.open(file.id, file.content, file.language);
    this.tabTitle.textContent = file.path;
    this.languageStatus.textContent = languageLabel(file.language);
    document.title = `${file.path} — Altitude`;
    this.renderRunAvailability();
  }

  private handleEditorChange(fileId: string, content: string): void {
    const project = this.currentProject;
    const file = project?.files.find((candidate) => candidate.id === fileId);
    if (!project || !file || file.content === content) {
      return;
    }

    const now = Date.now();
    file.content = content;
    file.updatedAt = now;
    project.updatedAt = now;
    this.saveCoordinator.schedule(project, file);
  }

  private openSettingsDialog(): void {
    this.fillSettingsForm(this.settingsStore.settings);
    this.settingsFormError.hidden = true;
    this.settingsFormError.textContent = "";
    this.settingsPersistenceNote.hidden = this.settingsStore.persistenceAvailable;
    if (!this.settingsDialog.open) {
      this.settingsDialog.showModal();
    }
    // The first control in the dialog, not the last: Appearance now leads it.
    window.setTimeout(() => this.settingsThemeSelect.focus(), 0);
  }

  /**
   * Closing without saving is the only way back from a preview, so it has to
   * undo one: appearance and text size are applied live while the dialog is
   * open, which is the whole point of them, and Cancel would otherwise leave
   * the app looking like a change the user rejected.
   */
  private closeSettingsDialog(): void {
    this.applyDisplaySettings(this.settingsStore.settings);
    if (this.settingsDialog.open) {
      this.settingsDialog.close();
    }
    this.editor.focus();
  }

  private fillSettingsForm(settings: AppSettings): void {
    this.settingsTimeoutInput.value = String(timeoutSecondsFromMs(settings.executionTimeoutMs));
    this.settingsThemeSelect.value = settings.theme;
    this.settingsFontSizeInput.value = String(settings.editorFontSize);
    this.settingsIndentSelect.value = String(settings.indentWidth);
    this.showFontSize(settings.editorFontSize);
  }

  /** A slider announces a bare number, so the unit has to be said explicitly. */
  private showFontSize(fontSize: number): void {
    this.settingsFontSizeValue.textContent = `${fontSize} px`;
    this.settingsFontSizeInput.setAttribute("aria-valuetext", `${fontSize} pixels`);
  }

  /** What the form currently says, whether or not it has been saved. */
  private settingsFormDraft(): Pick<AppSettings, "theme" | "editorFontSize" | "indentWidth"> {
    return {
      theme: normalizeTheme(this.settingsThemeSelect.value),
      editorFontSize: normalizeEditorFontSize(Number(this.settingsFontSizeInput.value)),
      indentWidth: normalizeIndentWidth(Number(this.settingsIndentSelect.value))
    };
  }

  /**
   * The single place the three display settings reach the page. Everything
   * except CodeMirror's `dark` flag travels as a custom property, so this is
   * cheap enough to call on every drag of the text-size slider.
   */
  private applyDisplaySettings(
    settings: Pick<AppSettings, "theme" | "editorFontSize" | "indentWidth">
  ): void {
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${settings.editorFontSize}px`
    );
    this.showFontSize(settings.editorFontSize);
    this.indentStatus.textContent = `Spaces: ${settings.indentWidth}`;
    // setTheme applies the appearance, which calls back into the editor with
    // the indent width alongside it, so the editor is reconfigured once.
    this.appearanceController.setTheme(settings.theme);
  }

  private async saveSettings(): Promise<void> {
    const seconds = Number(this.settingsTimeoutInput.value);
    const minimum = timeoutSecondsFromMs(MIN_EXECUTION_TIMEOUT_MS);
    const maximum = timeoutSecondsFromMs(MAX_EXECUTION_TIMEOUT_MS);
    if (!Number.isFinite(seconds) || seconds < minimum || seconds > maximum) {
      this.settingsFormError.textContent = `Enter a run time limit between ${minimum} and ${maximum} seconds.`;
      this.settingsFormError.hidden = false;
      return;
    }

    await this.settingsStore.update({
      executionTimeoutMs: timeoutMsFromSeconds(seconds),
      ...this.settingsFormDraft()
    });
    this.applyDisplaySettings(this.settingsStore.settings);
    if (!this.settingsStore.persistenceAvailable) {
      this.settingsPersistenceNote.hidden = false;
      return;
    }
    // Not closeSettingsDialog(): that reverts the preview, and these values
    // are now the stored ones.
    if (this.settingsDialog.open) {
      this.settingsDialog.close();
    }
    this.editor.focus();
  }

  /**
   * Run and Stop are one control (L7), so whichever the button currently says
   * is what this does — and Cmd/Ctrl+Enter follows it, rather than being a Run
   * shortcut that does nothing while something is running.
   */
  private handleRunControl(): void {
    if (this.executionRunning) {
      this.stopActiveRun();
      return;
    }
    this.activeRun = this.runActiveFile();
    void this.activeRun;
  }

  /**
   * A preview is worth re-rendering far more often than a script is worth
   * re-running — the loop is edit, look, edit — so it gets a control of its
   * own. It closes the live preview and waits for that run to settle before
   * starting the next, so the two never overlap.
   */
  private async reloadPreview(): Promise<void> {
    if (!this.executionRunning || this.runningLanguage !== "preview") {
      return;
    }
    const fileId = this.previewFileId;
    this.previewRuntime.stop();
    await this.activeRun;
    // Reload renders the file the preview is of, not whatever happens to be
    // open — the two come apart as soon as someone opens another file with the
    // preview still up, so Reload brings that file back first.
    if (fileId !== undefined && this.activeFile()?.id !== fileId) {
      this.selectFile(fileId);
    }
    if (!canRunPreview(this.activeFile())) {
      return;
    }
    this.activeRun = this.runActiveFile();
    await this.activeRun;
  }

  private stopActiveRun(): void {
    if (!this.executionRunning || this.executionStopping) {
      return;
    }
    this.executionStopping = true;
    this.consoleStatus.textContent = "Stopping…";
    this.renderRunAvailability();
    if (this.runningLanguage === "python") {
      this.pythonRuntime.stop();
    } else if (this.runningLanguage === "sql") {
      this.sqlRuntime.stop();
    } else if (this.runningLanguage === "php") {
      this.phpRuntime.stop();
    } else if (this.runningLanguage === "csharp") {
      this.cSharpRuntime.stop();
    } else if (this.runningLanguage === "preview") {
      this.previewRuntime.stop();
    } else {
      this.javaScriptRuntime.stop();
    }
  }

  private async runActiveFile(): Promise<void> {
    if (this.executionRunning) {
      return;
    }
    const project = this.currentProject;
    const file = this.activeFile();
    if (!project || !file) {
      return;
    }

    this.setConsoleOpen(true);
    const pythonSupported = canRunPython(file);
    const scriptSupported = canRunScript(file);
    const sqlSupported = canRunSql(file);
    const phpSupported = canRunPhp(file);
    const cSharpSupported = canRunCSharp(file);
    const previewSupported = canRunPreview(file);
    if (
      !pythonSupported &&
      !scriptSupported &&
      !sqlSupported &&
      !phpSupported &&
      !cSharpSupported &&
      !previewSupported
    ) {
      this.appendConsole(
        `Only Python, JavaScript .js/.mjs, TypeScript .ts/.mts, SQL .sql, PHP .php/.phtml and C# .cs files can run, and HTML .html/.htm and CSS .css files can be previewed. ${file.path} is ${languageLabel(file.language)}.\n`,
        "error"
      );
      this.consoleStatus.textContent = "Unsupported language";
      return;
    }

    this.executionRunning = true;
    this.executionStopping = false;
    this.runningLanguage = pythonSupported
      ? "python"
      : sqlSupported
        ? "sql"
        : phpSupported
          ? "php"
          : cSharpSupported
            ? "csharp"
            : previewSupported
              ? "preview"
              : "script";
    this.previewFileId = previewSupported ? file.id : undefined;
    this.failureBlock = undefined;
    this.renderRunAvailability();
    if (this.consoleOutput.textContent && !this.consoleOutput.textContent.endsWith("\n")) {
      this.appendConsole("\n");
    }

    const beforeRun = async (): Promise<void> => {
      this.handleEditorChange(file.id, this.editor.content());
      await this.saveCoordinator.flush();
    };
    const outputHooks = {
      onStdout: (chunk: string) => this.appendConsole(chunk, "stdout"),
      onStderr: (chunk: string) => this.appendConsole(chunk, "stderr")
    };
    const result = pythonSupported
      ? await runActivePython(this.pythonRuntime, project, file, beforeRun, {
          onStatus: (status) => this.renderPythonStatus(status, file.path),
          ...outputHooks,
          readInput: () => {
            const value = window.prompt("Python input:");
            if (value === null) {
              this.appendConsole("[Input cancelled; using an empty string.]\n", "status");
            }
            return value;
          }
        })
      : sqlSupported
        ? await runActiveSql(this.sqlRuntime, file, beforeRun, {
            onStatus: (status) => this.renderSqlStatus(status, file.path),
            ...outputHooks
          })
        : phpSupported
          ? await runActivePhp(this.phpRuntime, project, file, beforeRun, {
              onStatus: (status) => this.renderPhpStatus(status, file.path),
              ...outputHooks
            })
          : cSharpSupported
            ? await runActiveCSharp(this.cSharpRuntime, project, file, beforeRun, {
                onStatus: (status) => this.renderCSharpStatus(status, file.path),
                ...outputHooks
              })
            : previewSupported
              ? await runActivePreview(this.previewRuntime, project, file, beforeRun, {
                  onStatus: (status) => this.renderPreviewStatus(status, file.path),
                  onNote: (note) => this.appendConsole(`${note}\n`, "status"),
                  ...outputHooks
                })
              : await runActiveScript(this.javaScriptRuntime, file, beforeRun, {
                  onStatus: (status) => this.renderJavaScriptStatus(status, file.path),
                  ...outputHooks
                });

    if (this.consoleOutput.textContent && !this.consoleOutput.textContent.endsWith("\n")) {
      this.appendConsole("\n");
    }
    // C# is the only runtime with a compile phase, so it is the only one whose
    // primary output can be diagnostics rather than stdout. They are rendered
    // before the verdict so the reason appears above "finished with errors",
    // and on success too, because warnings are worth seeing.
    const compilerDiagnostics =
      result.result && "diagnostics" in result.result
        ? ((result.result as { diagnostics?: readonly CSharpDiagnostic[] }).diagnostics ?? [])
        : [];
    if (compilerDiagnostics.length > 0) {
      this.renderCSharpDiagnostics(compilerDiagnostics, file.path);
    }

    // A preview ends when it is closed, not when it finishes — it never
    // "finishes" — so its ending is reported in those words instead.
    if (this.runningLanguage === "preview" && result.outcome !== "error") {
      const errorCount =
        result.result && "errorCount" in result.result
          ? ((result.result as { errorCount?: number }).errorCount ?? 0)
          : 0;
      if (errorCount > 0) {
        this.appendConsole(
          `\nPreview closed after ${errorCount} error${errorCount === 1 ? "" : "s"}.\n`,
          "error"
        );
        this.consoleStatus.textContent = "Error";
      } else {
        this.appendConsole("\nPreview closed.\n", "status");
        this.consoleStatus.textContent = "Closed";
      }
    } else if (result.outcome === "success") {
      this.appendConsole("\nProcess finished successfully.\n", "success");
      this.consoleStatus.textContent = "Finished";
    } else if (result.outcome === "stopped") {
      this.appendConsole("\nProcess stopped.\n", "status");
      this.consoleStatus.textContent = "Stopped";
    } else if (result.outcome === "error") {
      if (result.result?.error) {
        this.appendFailure(result.result.error);
      }
      this.appendConsole("\nProcess finished with errors.\n", "error");
      this.consoleStatus.textContent = "Error";
      this.revealFailure();
    }

    this.executionRunning = false;
    this.executionStopping = false;
    this.renderRunAvailability();
  }

  private renderPythonStatus(status: PythonRuntimeStatus, filePath: string): void {
    const labels: Record<PythonRuntimeStatus, string> = {
      loading: "Loading Python…",
      ready: "Python ready",
      running: "Running…"
    };
    this.consoleStatus.textContent = labels[status];
    if (status === "loading") {
      this.appendConsole("Loading Python…\n", "status");
    } else if (status === "ready") {
      this.appendConsole("Python ready\n", "status");
    } else {
      this.appendConsole(`\n> Running ${filePath}\n\n`, "status");
    }
  }

  private renderPhpStatus(status: PhpRuntimeStatus, filePath: string): void {
    if (status === "loading") {
      this.consoleStatus.textContent = "Loading PHP…";
      this.appendConsole("Loading PHP…\n", "status");
      return;
    }
    this.consoleStatus.textContent = "Running…";
    this.appendConsole(`\n> Running ${filePath}\n\n`, "status");
  }

  /**
   * C# is the only runtime with three states rather than two: it can be
   * loading, compiling, or running, and compiling is long enough to be worth
   * naming — Roslyn's first compile carries the JIT warm-up.
   */
  private renderCSharpStatus(status: CSharpRuntimeStatus, filePath: string): void {
    if (status === "loading") {
      this.consoleStatus.textContent = "Loading C#…";
      this.appendConsole("Loading the C# runtime…\n", "status");
      return;
    }
    if (status === "compiling") {
      this.consoleStatus.textContent = "Compiling…";
      this.appendConsole(`\n> Compiling ${filePath}\n`, "status");
      return;
    }
    this.consoleStatus.textContent = "Running…";
    this.appendConsole(`\n> Running ${filePath}\n\n`, "status");
  }

  /**
   * Compiler diagnostics, formatted the way a compiler formats them:
   * `file(line,col): severity CSxxxx: message`. Errors are the reason a run
   * produced nothing, so they use the error channel; warnings use the status
   * channel so they read as commentary rather than failure.
   */
  private renderCSharpDiagnostics(
    diagnostics: readonly CSharpDiagnostic[],
    filePath: string
  ): void {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      this.appendConsole(
        `\n${errors.length} compile ${errors.length === 1 ? "error" : "errors"}:\n`,
        "error"
      );
    }
    for (const diagnostic of diagnostics) {
      this.appendConsole(
        `${filePath}(${diagnostic.line},${diagnostic.column}): ` +
          `${diagnostic.severity} ${diagnostic.id}: ${diagnostic.message}\n`,
        diagnostic.severity === "error" ? "error" : "status"
      );
    }
  }

  private renderSqlStatus(status: SqlRuntimeStatus, filePath: string): void {
    if (status === "loading") {
      this.consoleStatus.textContent = "Loading SQLite…";
      this.appendConsole("Loading SQLite…\n", "status");
      return;
    }
    this.consoleStatus.textContent = "Running…";
    this.appendConsole(`\n> Running ${filePath}\n\n`, "status");
  }

  private renderJavaScriptStatus(status: JavaScriptRuntimeStatus, filePath: string): void {
    if (status === "compiling") {
      this.consoleStatus.textContent = "Compiling TypeScript…";
      this.appendConsole(`\n> Compiling ${filePath}\n`, "status");
      return;
    }
    this.consoleStatus.textContent = "Running…";
    this.appendConsole(`\n> Running ${filePath}\n\n`, "status");
  }

  /**
   * How many frames are shown before the middle is folded away. A short trace
   * is more useful whole; a long one is the wall of text this task exists to
   * remove, and its ends carry the signal — where it started and where it blew
   * up.
   */
  private static readonly VISIBLE_FRAME_LIMIT = 8;
  private static readonly FRAMES_KEPT_EACH_END = 3;

  /**
   * Renders a run failure as a block: the exception first and prominent, the
   * frames beneath it as secondary detail. Everything the runtime reported is
   * present — the parser reorders and labels, it never discards.
   */
  private appendFailure(rawError: string): void {
    const report = parseErrorReport(rawError);

    const block = document.createElement("div");
    block.className = "console-failure";
    block.setAttribute("role", "group");

    const heading = document.createElement("p");
    heading.className = "console-failure-heading";
    const badge = document.createElement("span");
    badge.className = "console-failure-badge";
    // A word, not just a colour: the failure has to be obvious without relying
    // on being able to tell red from grey.
    badge.textContent = "Error";
    const title = document.createElement("span");
    title.className = "console-failure-title";
    title.textContent = report.headline;
    heading.append(badge, title);
    block.append(heading);

    // Altitude's own frames — the Pyodide harness, the Worker bundle — are not
    // the user's code and are pure noise in their traceback.
    const frames = presentableFrames(report);
    const shown = new Set<object>(frames);
    const foldable = frames.length > App.VISIBLE_FRAME_LIMIT;
    let framesSeen = 0;

    const list = document.createElement("ol");
    list.className = "console-trace";
    const hidden: HTMLElement[] = [];

    for (const entry of report.body) {
      if (entry.kind === "text") {
        const note = document.createElement("li");
        note.className = "console-trace-note";
        note.textContent = entry.text;
        list.append(note);
        continue;
      }
      if (!shown.has(entry)) {
        continue;
      }

      const index = framesSeen;
      framesSeen += 1;
      const item = document.createElement("li");
      item.className = "console-trace-frame";
      const where = document.createElement("span");
      where.className = "console-frame-where";
      where.textContent = entry.location;
      item.append(where);
      if (entry.source) {
        const source = document.createElement("code");
        source.className = "console-frame-source";
        source.textContent = entry.source;
        item.append(source);
      }
      if (
        foldable &&
        index >= App.FRAMES_KEPT_EACH_END &&
        index < frames.length - App.FRAMES_KEPT_EACH_END
      ) {
        item.hidden = true;
        hidden.push(item);
      }
      list.append(item);
    }

    if (list.childElementCount > 0) {
      block.append(list);
    }

    if (hidden.length > 0) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "console-trace-toggle";
      toggle.textContent = `Show ${hidden.length} more frames`;
      toggle.addEventListener("click", () => {
        const nowHidden = hidden[0]?.hidden ?? false;
        for (const item of hidden) {
          item.hidden = !nowHidden;
        }
        toggle.textContent = nowHidden ? `Hide ${hidden.length} frames` : `Show ${hidden.length} more frames`;
      });
      block.append(toggle);
    }

    this.consoleOutput.append(block);
    this.failureBlock = block;
    this.consoleOutput.scrollTop = this.consoleOutput.scrollHeight;
  }

  /**
   * The console otherwise scrolls to the very bottom, which on a tall traceback
   * pushes the exception message — the point of the whole block — off the top.
   * Bring the heading back into view once the run's closing line is written.
   */
  private revealFailure(): void {
    const block = this.failureBlock;
    if (!block) {
      return;
    }
    const offset =
      block.getBoundingClientRect().top -
      this.consoleOutput.getBoundingClientRect().top +
      this.consoleOutput.scrollTop;
    this.consoleOutput.scrollTop = Math.max(0, offset - 8);
  }

  private appendConsole(text: string, kind: "stdout" | "stderr" | "status" | "success" | "error" = "status"): void {
    const chunk = document.createElement("span");
    chunk.className = `console-output-${kind}`;
    chunk.textContent = text;
    this.consoleOutput.append(chunk);
    this.consoleOutput.scrollTop = this.consoleOutput.scrollHeight;
  }

  private setConsoleOpen(open: boolean): void {
    this.consolePanel.hidden = !open;
    const editorPane = this.consolePanel.closest<HTMLElement>(".editor-pane");
    if (editorPane) {
      editorPane.dataset.console = open ? "open" : "closed";
    }
  }

  private renderPreviewStatus(status: PreviewRuntimeStatus, filePath: string): void {
    if (status === "building") {
      this.consoleStatus.textContent = "Building the preview…";
      this.appendConsole(`\n> Previewing ${filePath}\n\n`, "status");
      return;
    }
    if (status === "loading") {
      this.consoleStatus.textContent = "Rendering…";
      this.previewTitle.textContent = filePath;
      return;
    }
    this.consoleStatus.textContent = "Preview is live";
    this.appendConsole("Preview is live. Press Close, or the × in the preview header, to end it.\n", "status");
  }

  private setPreviewOpen(open: boolean): void {
    this.previewPanel.hidden = !open;
    const editorPane = this.previewPanel.closest<HTMLElement>(".editor-pane");
    if (editorPane) {
      editorPane.dataset.preview = open ? "open" : "closed";
    }
    if (!open) {
      this.previewTitle.textContent = "";
    }
  }

  private renderRunAvailability(): void {
    const file = this.activeFile();
    const pythonSupported = canRunPython(file);
    const sqlSupported = canRunSql(file);
    const phpSupported = canRunPhp(file);
    const cSharpSupported = canRunCSharp(file);
    const previewSupported = canRunPreview(file);
    const supported =
      pythonSupported ||
      sqlSupported ||
      phpSupported ||
      cSharpSupported ||
      previewSupported ||
      canRunScript(file);

    if (this.executionRunning) {
      // Disabled only while a stop is already on its way, so the control never
      // reads as available when pressing it again would do nothing.
      this.runButton.disabled = this.executionStopping;
      this.runButton.dataset.mode = "stop";
      const preview = this.runningLanguage === "preview";
      this.runButton.textContent = this.executionStopping
        ? "■ Stopping…"
        : preview
          ? "■ Close"
          : "■ Stop";
      this.runButton.title = this.executionStopping
        ? "Stopping the run"
        : preview
          ? "Close the preview (Cmd/Ctrl+Enter)"
          : "Stop the run (Cmd/Ctrl+Enter)";
      return;
    }

    this.runButton.disabled = !supported;
    this.runButton.dataset.mode = "run";
    this.runButton.textContent = "▶ Run";
    if (!file) {
      this.runButton.title = "Create a file to run something";
      return;
    }
    // A preview renders rather than runs, and the button says which it is
    // about to do — pressing Run on an .html file opening a preview is a
    // different promise from pressing it on a .py file.
    if (previewSupported) {
      this.runButton.textContent = "▶ Preview";
    }
    this.runButton.title = pythonSupported
      ? "Run Python (Cmd/Ctrl+Enter)"
      : sqlSupported
        ? "Run SQL (Cmd/Ctrl+Enter)"
        : phpSupported
          ? "Run PHP (Cmd/Ctrl+Enter)"
          : cSharpSupported
            ? "Run C# (Cmd/Ctrl+Enter)"
            : previewSupported
              ? file.language === "css"
                ? "Preview this stylesheet (Cmd/Ctrl+Enter)"
                : "Preview this page (Cmd/Ctrl+Enter)"
              : canRunTypeScript(file)
                ? "Run TypeScript (Cmd/Ctrl+Enter)"
                : supported
                  ? "Run JavaScript (Cmd/Ctrl+Enter)"
                  : "Run is available for Python, JavaScript .js/.mjs, TypeScript .ts/.mts, SQL .sql, PHP .php and C# .cs files, and HTML .html and CSS .css files can be previewed";
  }

  private selectFile(fileId: string): void {
    const project = this.currentProject;
    const file = project?.files.find((candidate) => candidate.id === fileId);
    if (!project || !file || file.id === project.activeFileId) {
      this.editor.focus();
      return;
    }

    project.activeFileId = file.id;
    project.updatedAt = Date.now();
    this.saveCoordinator.schedule(project, file);
    this.renderFiles();
    this.openActiveFile();
    if (window.matchMedia("(max-width: 760px)").matches) {
      this.shell.dataset.sidebar = "closed";
    }
  }

  private newFile(): void {
    const project = this.currentProject;
    if (!project) {
      return;
    }

    // No suggested name and no default extension: the old one was Untitled.cs,
    // which pre-filled the single language Altitude cannot run.
    const input = window.prompt("File name (folders are supported, e.g. src/helpers.py):", "");
    if (input === null) {
      return;
    }

    const path = normalizedFilePath(input);
    if (!this.isValidNewPath(path)) {
      return;
    }

    const file = createFile(path);
    project.files.push(file);
    project.activeFileId = file.id;
    project.updatedAt = Date.now();
    this.saveCoordinator.schedule(project, file);
    this.renderFiles();
    this.openActiveFile();
  }

  private async importSelectedFile(): Promise<void> {
    const source = this.fileImportInput.files?.item(0);
    this.fileImportInput.value = "";
    const project = this.currentProject;
    if (!source || !project) {
      return;
    }

    try {
      const importedFile = await createImportedProjectFile(
        source,
        project.files.map((file) => file.path)
      );
      await this.saveCoordinator.flush();

      const nextProject = structuredClone(project);
      nextProject.files.push(importedFile);
      nextProject.activeFileId = importedFile.id;
      nextProject.updatedAt = Date.now();

      this.setSaveState("saving");
      await this.repository.saveProject(nextProject);
      this.journal.clearIfSaved(nextProject.id, nextProject.updatedAt);

      const projectIndex = this.projects.findIndex((candidate) => candidate.id === nextProject.id);
      if (projectIndex >= 0) {
        this.projects[projectIndex] = nextProject;
      }
      if (this.currentProject?.id === nextProject.id) {
        this.currentProject = nextProject;
        this.renderFiles();
        this.openActiveFile();
        if (window.matchMedia("(max-width: 760px)").matches) {
          this.shell.dataset.sidebar = "closed";
        }
      }
      this.setSaveState("saved");
    } catch (error) {
      console.error("Failed to import file", error);
      if (error instanceof ImportFileError) {
        window.alert(error.message);
      } else {
        this.setSaveState("error");
        window.alert("The file could not be saved. The current project was not changed.");
      }
    }
  }

  private renameFile(): void {
    const project = this.currentProject;
    const file = this.activeFile();
    if (!project || !file) {
      return;
    }

    const input = window.prompt("New file name:", file.path);
    if (input === null) {
      return;
    }

    const path = normalizedFilePath(input);
    if (path.toLowerCase() !== file.path.toLowerCase() && !this.isValidNewPath(path)) {
      return;
    }
    if (!path) {
      window.alert("File name cannot be empty.");
      return;
    }

    file.path = path;
    file.language = languageFromPath(path);
    file.updatedAt = Date.now();
    project.updatedAt = file.updatedAt;
    this.saveCoordinator.schedule(project, file);
    this.renderFiles();
    this.openActiveFile();
  }

  private deleteFile(): void {
    const project = this.currentProject;
    const file = this.activeFile();
    if (!project || !file || !window.confirm(`Delete ${file.path}?`)) {
      return;
    }

    project.files = project.files.filter((candidate) => candidate.id !== file.id);
    project.updatedAt = Date.now();
    const nextFile = project.files[0];
    project.activeFileId = nextFile?.id ?? "";
    // Clear the view before forgetting, so the outgoing document is not cached
    // back under the id that was just dropped.
    if (!nextFile) {
      this.editor.clear();
    }
    this.editor.forget(file.id);
    this.saveCoordinator.schedule(project, nextFile);
    this.renderFiles();
    this.openActiveFile();
  }

  private async newProject(): Promise<void> {
    const input = window.prompt("Project name:", "New Project");
    const name = input?.trim();
    if (!name) {
      return;
    }

    await this.saveCoordinator.flush();
    const project = createProject(name);
    await this.repository.saveProject(project);
    this.projects.unshift(project);
    this.currentProject = project;
    await this.rememberCurrentProject();
    this.renderAll();
  }

  /**
   * `projectId` lets the project list act on a row that is not the open
   * project. Omitted, it means the open one, which is what the header control
   * has always done.
   */
  private renameProject(projectId?: string): void {
    const project = this.projectById(projectId);
    if (!project) {
      return;
    }

    const input = window.prompt("New project name:", project.name);
    const name = input?.trim();
    if (!name) {
      return;
    }

    project.name = name;
    project.updatedAt = Date.now();
    // The recovery journal entry has to belong to the project being written, so
    // the active file is only supplied when the two match.
    const isCurrent = project.id === this.currentProject?.id;
    this.saveCoordinator.schedule(project, isCurrent ? this.activeFile() : undefined);
    this.renderProjects();
  }

  private async deleteProject(projectId?: string): Promise<void> {
    const project = this.projectById(projectId);
    if (!project) {
      return;
    }
    if (this.projects.length === 1) {
      window.alert("Create another project before deleting this one.");
      return;
    }
    if (!window.confirm(`Delete project “${project.name}” and all its files?`)) {
      return;
    }

    await this.saveCoordinator.flush();
    await this.repository.deleteProject(project.id);
    const wasCurrent = project.id === this.currentProject?.id;
    this.projects = this.projects.filter((candidate) => candidate.id !== project.id);
    if (!wasCurrent) {
      // Deleting some other project must not move the user out of the file
      // they are editing.
      this.renderProjects();
      return;
    }

    this.currentProject = this.projects[0];
    this.ensureActiveFile();
    await this.rememberCurrentProject();
    this.renderAll();
  }

  private projectById(projectId: string | undefined): Project | undefined {
    if (projectId === undefined) {
      return this.currentProject;
    }
    return this.projects.find((candidate) => candidate.id === projectId);
  }

  private async switchProject(projectId: string): Promise<void> {
    if (projectId === this.currentProject?.id) {
      return;
    }

    await this.saveCoordinator.flush();
    // The live preview was built from the project being left, so it goes with
    // it rather than lingering over a project whose files it does not contain.
    this.previewRuntime.stop();
    this.currentProject = this.projects.find((project) => project.id === projectId) ?? this.projects[0];
    this.ensureActiveFile();
    await this.rememberCurrentProject();
    this.renderAll();
  }

  /**
   * Export is a choice, not one fixed action: "the whole project" is rarely
   * what someone wants when they are looking at a single file, and unpacking a
   * zip to reach one file is work they did not ask for.
   */
  private async openExportDialog(): Promise<void> {
    const project = this.currentProject;
    if (!project) {
      return;
    }
    if (project.files.length === 0) {
      window.alert("This project has no files to export yet.");
      return;
    }

    // Export what is on screen, not the last thing that happened to be saved.
    const openFile = this.activeFile();
    if (openFile) {
      this.handleEditorChange(openFile.id, this.editor.content());
    }
    await this.saveCoordinator.flush();

    const fileCount = project.files.length;
    this.exportSummary.textContent =
      fileCount === 1
        ? `“${project.name}” has one file.`
        : `“${project.name}” has ${fileCount} files.`;

    const file = this.activeFile();
    this.exportFileButton.disabled = !file;
    this.exportFileDetail.textContent = file ? file.path : "No file is open";
    this.exportProjectDetail.textContent = `${formatFileCount(fileCount)}, as a .zip`;

    if (!this.exportDialog.open) {
      this.exportDialog.showModal();
    }
    window.setTimeout(() => {
      const target = file ? this.exportFileButton : this.exportDialog.querySelector<HTMLButtonElement>('[data-action="export-whole-project"]');
      target?.focus();
    }, 0);
  }

  private closeExportDialog(): void {
    if (this.exportDialog.open) {
      this.exportDialog.close();
    }
    this.editor.focus();
  }

  private exportActiveFile(): void {
    const file = this.activeFile();
    if (!file) {
      return;
    }
    exportFile(file);
    this.closeExportDialog();
  }

  private exportWholeProject(): void {
    if (!this.currentProject) {
      return;
    }
    exportProject(this.currentProject);
    this.closeExportDialog();
  }

  private activeFile(): ProjectFile | undefined {
    const project = this.currentProject;
    return project?.files.find((file) => file.id === project.activeFileId) ?? project?.files[0];
  }

  private ensureActiveFile(): void {
    const project = this.currentProject;
    if (!project) {
      return;
    }
    if (project.files.length === 0) {
      // Nothing is invented to fill an empty project. The editor says so
      // instead, and offers the one action that makes sense.
      project.activeFileId = "";
    } else if (!project.files.some((file) => file.id === project.activeFileId)) {
      const firstFile = project.files[0];
      if (firstFile) {
        project.activeFileId = firstFile.id;
      }
    }
  }

  private isValidNewPath(path: string): boolean {
    if (!path || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      window.alert("Enter a valid relative file path.");
      return false;
    }
    if (this.currentProject?.files.some((file) => file.path.toLowerCase() === path.toLowerCase())) {
      window.alert("A file with this name already exists.");
      return false;
    }
    return true;
  }

  private setSaveState(state: SaveState): void {
    // In session-only mode the write really did succeed — into memory — so the
    // coordinator reports "saved" and would have the top bar say so. It is the
    // one place in the app that could still tell the user their work is safe
    // while the banner two rows above says it is not.
    if (this.repository.mode === "session-only") {
      this.saveStatus.textContent = state === "saving" ? "Not saving…" : "Not saved";
      this.saveStatus.dataset.state = "session-only";
      return;
    }

    const labels: Record<SaveState, string> = {
      idle: "Saved",
      saving: "Saving…",
      saved: "Saved",
      error: "Save failed"
    };
    this.saveStatus.textContent = labels[state];
    this.saveStatus.dataset.state = state;
  }

  /**
   * One notice at a time, and a persistent one is never replaced by a
   * dismissible one: "nothing is being saved" outranks "a project could not be
   * read", and a user who is shown the second in place of the first has been
   * told the less important half of the truth.
   */
  private showStorageNotice(notice: StorageNotice): void {
    if (this.currentNotice?.persistent && !notice.persistent) {
      return;
    }
    this.currentNotice = notice;
    this.noticeTitle.textContent = notice.title;
    this.noticeDetail.textContent = notice.detail;
    this.noticeBar.dataset.severity = notice.severity;
    this.noticeExport.hidden = !notice.offerExport;
    this.noticeDismiss.hidden = notice.persistent;
    this.noticeBar.hidden = false;
    this.renderStorageState();
  }

  private dismissNotice(): void {
    if (this.currentNotice?.persistent) {
      return;
    }
    this.currentNotice = undefined;
    this.noticeBar.hidden = true;
  }

  /**
   * The single owner of the status bar's storage line. Three different places
   * used to write to it — persistence, the recovery journal, and nothing at
   * all for a failed save — so whichever ran last won, and a real problem could
   * be overwritten by a routine message. It states a standing fact rather than
   * an event, so it stays correct after a notice has been dismissed.
   */
  private renderStorageState(): void {
    const [label, warning, title] = this.storageStateLabel();
    this.storageStatus.textContent = label;
    this.storageStatus.title = title;
    if (warning) {
      this.storageStatus.dataset.warning = "true";
    } else {
      delete this.storageStatus.dataset.warning;
    }
  }

  private storageStateLabel(): [string, boolean, string] {
    if (this.repository.mode === "session-only") {
      return [
        "Not saving",
        true,
        "Storage is unavailable on this device, so this session keeps nothing. Export to keep your work."
      ];
    }
    if (this.currentNotice?.severity === "danger") {
      return ["Save failing", true, this.currentNotice.detail];
    }
    if (!this.recoveryJournalAvailable) {
      return [
        "Reduced recovery",
        true,
        "Autosave is working, but the optional emergency recovery journal is unavailable."
      ];
    }
    const base = this.persistentStorageGranted ? "Persistent IndexedDB" : "IndexedDB storage";
    const baseTitle = this.persistentStorageGranted
      ? "This device has granted Altitude persistent storage."
      : "Saved on this device. Safari can still clear website data — export anything you cannot lose.";
    if (!this.storageQuotaLabel) {
      return [base, false, baseTitle];
    }
    // Temporary, for the R2 follow-up: makes the quota visible without dev
    // tools, so a number can be read straight off the iPad in a private tab.
    return [`${base} (${this.storageQuotaLabel})`, false, `${baseTitle} ${this.storageQuotaLabel}.`];
  }

  private renderNetworkState(): void {
    if (!navigator.onLine) {
      this.networkStatus.textContent = this.offlineReady ? "Offline ready" : "Offline unavailable";
    } else {
      this.networkStatus.textContent = this.offlineReady ? "Offline cached" : "Preparing offline…";
    }
    this.networkStatus.dataset.online = String(navigator.onLine);
  }

  private watchOfflineCache(): void {
    if (!("serviceWorker" in navigator)) {
      this.networkStatus.textContent = "HTTPS required";
      return;
    }

    void navigator.serviceWorker.ready.then(() => {
      this.offlineReady = true;
      this.renderNetworkState();
    });
  }

  private async rememberCurrentProject(): Promise<void> {
    if (this.currentProject) {
      await this.repository.saveSession({ activeProjectId: this.currentProject.id });
    }
  }

  private async requestPersistentStorage(): Promise<void> {
    if (!navigator.storage?.persist) {
      return;
    }
    try {
      this.persistentStorageGranted = await navigator.storage.persist();
    } catch {
      this.persistentStorageGranted = false;
    }
    this.renderStorageState();
  }

  /**
   * Reads the quota Safari is actually reporting and puts it in the status
   * line. Diagnostic only, and only worth asking for when real IndexedDB is in
   * use — session-only mode already explains itself, and the number would only
   * confuse that message.
   */
  private async reportStorageQuota(): Promise<void> {
    if (this.repository.mode !== "indexeddb" || !navigator.storage?.estimate) {
      return;
    }
    try {
      const { quota, usage } = await navigator.storage.estimate();
      if (typeof quota !== "number") {
        return;
      }
      const usageText = typeof usage === "number" ? `${formatByteSize(usage)} used of ` : "";
      this.storageQuotaLabel = `${usageText}${formatByteSize(quota)} quota`;
    } catch {
      // No diagnostic if the browser will not answer; nothing else depends on it.
    }
    this.renderStorageState();
  }

  private showRecoveryWarning(): void {
    this.recoveryJournalAvailable = false;
    // Called from the journal's constructor, which runs before the status
    // element exists as a field. The render is safe to skip then: start() ends
    // with one.
    if (this.storageStatus) {
      this.renderStorageState();
    }
  }
}
