/**
 * Dynamic Type support (M3's accessibility item).
 *
 * iPad users routinely change the system text size, and a web app that ignores
 * it is unreadable for anyone who has turned it up — Altitude assumed a fixed
 * text size on the one platform where that assumption is least safe.
 *
 * The web has no direct "what is the system text size" API. What iOS *does*
 * expose is the `-apple-system-body` font shorthand, which resolves to the
 * user's current Dynamic Type body size. Measuring an offscreen probe styled
 * with it is the only reliable way to read that number, so that is what this
 * does: measure once, divide by the 17px default, and publish the ratio as a
 * custom property every UI font size is multiplied by.
 *
 * The editor's own text size is deliberately *not* scaled by this — it has its
 * own explicit setting (R1), and a user who set 15px meant 15px.
 */

/** iOS's default Dynamic Type body size, and so the scale's 1.0 point. */
const BASE_BODY_SIZE_PX = 17;

/**
 * Clamped rather than trusted outright. The largest accessibility sizes would
 * otherwise triple the chrome and leave no room for the editor, and a probe
 * that fails to resolve the font must not collapse the interface to nothing.
 */
export const MIN_UI_SCALE = 1;
export const MAX_UI_SCALE = 1.6;

export function clampUiScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return 1;
  }
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, scale));
}

/** Rounded to hundredths so a sub-pixel measurement change is not a re-layout. */
export function uiScaleFromBodySize(bodySizePx: number): number {
  return clampUiScale(Math.round((bodySizePx / BASE_BODY_SIZE_PX) * 100) / 100);
}

export interface ProbeHost {
  createElement(tag: "span"): HTMLSpanElement;
  body: { appendChild(node: Node): void };
}

/**
 * Measures the system body size, or returns undefined where it cannot be read
 * — every non-Apple browser, and any context without layout. Undefined means
 * "leave the scale alone", never "assume something".
 */
export function measureSystemBodySize(
  documentRef: ProbeHost,
  computeStyle: (element: Element) => { fontSize: string }
): number | undefined {
  try {
    const probe = documentRef.createElement("span");
    // `font` shorthand, not `font-family`: the size only comes through when the
    // whole shorthand is used, which is the entire point of the probe.
    probe.style.font = "-apple-system-body";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.setAttribute("aria-hidden", "true");
    documentRef.body.appendChild(probe);

    const size = Number.parseFloat(computeStyle(probe).fontSize);
    probe.remove();
    return Number.isFinite(size) && size > 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Applies the measured scale to the document, and re-measures when the app
 * comes back to the foreground — changing the system text size sends the user
 * out to Settings and back, so that is exactly when the old value goes stale.
 */
export class DynamicTypeController {
  private applied = 1;

  constructor(
    private readonly documentRef: Document,
    private readonly windowRef: Pick<Window, "addEventListener" | "getComputedStyle">
  ) {}

  get scale(): number {
    return this.applied;
  }

  start(): void {
    this.refresh();
    this.documentRef.addEventListener("visibilitychange", () => {
      if (this.documentRef.visibilityState === "visible") {
        this.refresh();
      }
    });
    // Rotation and Split View resizes are also cheap moments to re-check.
    this.windowRef.addEventListener("resize", () => this.refresh());
  }

  refresh(): number {
    const bodySize = measureSystemBodySize(this.documentRef, (element) =>
      this.windowRef.getComputedStyle(element)
    );
    if (bodySize === undefined) {
      return this.applied;
    }
    const scale = uiScaleFromBodySize(bodySize);
    if (scale !== this.applied) {
      this.applied = scale;
      this.documentRef.documentElement.style.setProperty("--ui-scale", String(scale));
    }
    return this.applied;
  }
}
