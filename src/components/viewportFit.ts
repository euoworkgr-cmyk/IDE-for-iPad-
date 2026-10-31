/**
 * Keeps the app the size of the *visible* viewport (M3's iPad-native UX item).
 *
 * The classic iPad web-app failure: the software keyboard slides up over the
 * page without changing `100dvh`, so the bottom of the layout — here the status
 * bar, the console, and whatever line is being typed — ends up underneath it.
 * `visualViewport` is the only API that reports the area actually left visible,
 * so the shell is sized from that rather than from the layout viewport.
 *
 * Everything is a no-op where `visualViewport` is unavailable, and the CSS
 * falls back to `100dvh`, so nothing regresses on a desktop browser.
 */

export interface VisualViewportLike {
  height: number;
  offsetTop: number;
  addEventListener(type: "resize" | "scroll", listener: () => void): void;
  removeEventListener?(type: "resize" | "scroll", listener: () => void): void;
}

/**
 * How much of the layout viewport is covered from the bottom — the software
 * keyboard, essentially. Clamped at zero because Safari briefly reports a
 * visual viewport *taller* than the layout one during rubber-band scrolling,
 * and a negative inset would push the status bar off-screen.
 */
export function bottomInset(
  layoutHeight: number,
  viewportHeight: number,
  offsetTop: number
): number {
  const inset = layoutHeight - viewportHeight - offsetTop;
  return Number.isFinite(inset) && inset > 0 ? Math.round(inset) : 0;
}

/** Sub-pixel jitter would otherwise re-layout the whole app on every scroll. */
export function hasMeaningfulChange(previous: number, next: number): boolean {
  return Math.abs(previous - next) >= 1;
}

export class ViewportFitController {
  private appliedHeight = 0;
  private appliedInset = -1;

  constructor(
    private readonly documentRef: Document,
    private readonly windowRef: Pick<Window, "innerHeight">,
    private readonly viewport: VisualViewportLike | undefined
  ) {}

  start(): void {
    if (!this.viewport) {
      return;
    }
    const apply = () => this.apply();
    this.viewport.addEventListener("resize", apply);
    // Scroll matters too: focusing a field near the bottom makes Safari scroll
    // the visual viewport rather than resize it.
    this.viewport.addEventListener("scroll", apply);
    this.apply();
  }

  /** Exposed for tests and for a caller that knows the layout just changed. */
  apply(): void {
    const viewport = this.viewport;
    if (!viewport) {
      return;
    }
    const height = Math.round(viewport.height);
    const inset = bottomInset(this.windowRef.innerHeight, viewport.height, viewport.offsetTop);

    if (hasMeaningfulChange(this.appliedHeight, height)) {
      this.appliedHeight = height;
      this.documentRef.documentElement.style.setProperty("--app-height", `${height}px`);
    }
    if (this.appliedInset !== inset) {
      this.appliedInset = inset;
      this.documentRef.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
      // Lets anything that cares style itself differently while the keyboard
      // is up, without having to listen for the event itself.
      this.documentRef.documentElement.dataset.keyboard = inset > 0 ? "open" : "closed";
    }
  }
}
