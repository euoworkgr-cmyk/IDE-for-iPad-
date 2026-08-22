import type { PreviewSurface } from "./PreviewRuntime";

/**
 * The one piece of the preview that must touch the DOM: a sandboxed iframe,
 * created per run and destroyed on Stop.
 *
 * `allow-same-origin` is deliberately absent. Without it the document runs on
 * an opaque origin — no access to Altitude's storage or DOM, and no way back
 * into the app except the `postMessage` the bootstrap uses. `allow-forms` and
 * `allow-modals` are present because a page that cannot submit a form or call
 * `alert()` is not a faithful preview of itself.
 */
const SANDBOX = "allow-scripts allow-forms allow-modals allow-popups";

export class IframePreviewSurface implements PreviewSurface {
  private frame: HTMLIFrameElement | undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly onVisibilityChange?: (visible: boolean) => void
  ) {}

  mount(html: string, label: string): void {
    // Not `unmount()`: replacing one preview with another is not a close, and
    // reporting it as one would tell the app to tear down its own header.
    this.teardown();
    const frame = document.createElement("iframe");
    frame.className = "preview-frame";
    frame.title = `Preview of ${label}`;
    frame.setAttribute("sandbox", SANDBOX);
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.srcdoc = html;
    this.host.append(frame);
    this.frame = frame;
    this.onVisibilityChange?.(true);
  }

  unmount(): void {
    this.teardown();
    this.onVisibilityChange?.(false);
  }

  /** Removing the element is what ends the document: its timers, its listeners,
   * and anything still running inside it go with it. */
  private teardown(): void {
    this.frame?.remove();
    this.frame = undefined;
    this.host.replaceChildren();
  }
}
