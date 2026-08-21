import {
  buildPreviewDocument,
  PREVIEW_MESSAGE_KEY,
  type PreviewMessageKind,
  type PreviewSourceFile
} from "./htmlPreview";
import { createExecutionId, formatRuntimeError } from "./workerExecution";

/**
 * The HTML/CSS counterpart to the Worker-backed runtimes. It differs from them
 * in the one way the platform forces: a document has to be rendered by a
 * browsing context, and a Worker has no DOM, so the sandbox here is an iframe
 * rather than a Worker. Everything else is deliberately the same shape —
 * one throwaway context per run, output streamed to the console, and a Stop
 * that tears the context down.
 *
 * The frame is sandboxed *without* `allow-same-origin`, so the rendered
 * document runs on an opaque origin: it cannot read the app's storage, its
 * IndexedDB, or its DOM. Since every stylesheet and script it needs has already
 * been inlined by `htmlPreview`, it never asks the network for anything either.
 *
 * A preview stays live until it is stopped, which is what makes it a preview:
 * unlike a script, a page is not finished when it has loaded. The Run control
 * therefore reads Stop for as long as the preview is on screen.
 */
export type PreviewRuntimeStatus = "building" | "loading" | "live";

export interface PreviewExecutionHooks {
  onStatus: (status: PreviewRuntimeStatus) => void;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  /** What the build decided on the user's behalf — inlined files, missing ones. */
  onNote: (note: string) => void;
}

export interface PreviewExecutionRequest {
  entryPath: string;
  files: readonly PreviewSourceFile[];
}

export interface PreviewExecutionResult {
  ok: boolean;
  error?: string;
  /** The preview ended because the user closed it, which is the normal ending. */
  stopped?: boolean;
  /** Uncaught errors the page reported while it was live. */
  errorCount?: number;
  /** The `.html` file that was rendered, when one was. */
  hostPath?: string;
}

export interface PreviewExecutor {
  execute(
    request: PreviewExecutionRequest,
    hooks: PreviewExecutionHooks
  ): Promise<PreviewExecutionResult>;
  /** Closes the live preview, if there is one. Safe to call when there is not. */
  stop(): void;
}

/** The DOM half, kept behind an interface so the runtime is testable in Node. */
export interface PreviewSurface {
  /** Mounts a document, replacing whatever was mounted before. */
  mount(html: string, label: string): void;
  /** Removes the document. This is the only thing that stops its scripts. */
  unmount(): void;
}

export interface PreviewMessageSource {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

interface IncomingPreviewMessage {
  kind: PreviewMessageKind;
  text: string;
}

/**
 * The frame has an opaque origin, so `event.origin` is the string "null" and
 * proves nothing. The correlation id does the work instead: it is generated per
 * run and only the document this run mounted has ever seen it.
 */
function readPreviewMessage(data: unknown, executionId: string): IncomingPreviewMessage | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const candidate = data as Record<string, unknown>;
  if (candidate[PREVIEW_MESSAGE_KEY] !== executionId) {
    return undefined;
  }
  const kind = candidate.kind;
  if (kind !== "stdout" && kind !== "stderr" && kind !== "error" && kind !== "ready") {
    return undefined;
  }
  return { kind, text: typeof candidate.text === "string" ? candidate.text : "" };
}

export class PreviewRuntime implements PreviewExecutor {
  private stopActiveRun: (() => void) | undefined;

  constructor(
    private readonly surface: PreviewSurface,
    private readonly messages: PreviewMessageSource
  ) {}

  stop(): void {
    this.stopActiveRun?.();
  }

  async execute(
    request: PreviewExecutionRequest,
    hooks: PreviewExecutionHooks
  ): Promise<PreviewExecutionResult> {
    // A second Run replaces the preview rather than stacking two frames.
    this.stop();

    const executionId = createExecutionId("preview");
    hooks.onStatus("building");

    let document: ReturnType<typeof buildPreviewDocument>;
    try {
      document = buildPreviewDocument({
        files: request.files,
        entryPath: request.entryPath,
        executionId
      });
    } catch (error) {
      return { ok: false, error: formatRuntimeError(error) };
    }

    for (const note of document.notes) {
      hooks.onNote(note);
    }

    return new Promise<PreviewExecutionResult>((resolve) => {
      let settled = false;
      let errorCount = 0;

      const listener = (event: MessageEvent): void => {
        const message = readPreviewMessage(event.data, executionId);
        if (!message || settled) {
          return;
        }
        if (message.kind === "ready") {
          hooks.onStatus("live");
        } else if (message.kind === "stdout") {
          hooks.onStdout(message.text);
        } else if (message.kind === "stderr") {
          hooks.onStderr(message.text);
        } else {
          errorCount += 1;
          hooks.onStderr(message.text);
        }
      };

      const finish = (result: PreviewExecutionResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.stopActiveRun = undefined;
        this.messages.removeEventListener("message", listener);
        try {
          this.surface.unmount();
        } catch {
          // A surface that is already gone is the state this wants anyway.
        }
        resolve(result);
      };

      this.stopActiveRun = () =>
        finish({ ok: true, stopped: true, errorCount, hostPath: document.hostPath });

      this.messages.addEventListener("message", listener);
      hooks.onStatus("loading");
      try {
        this.surface.mount(document.html, document.hostPath ?? request.entryPath);
      } catch (error) {
        finish({ ok: false, error: formatRuntimeError(error) });
      }
    });
  }
}
