import type { Appearance, ThemePreference } from "./appSettings";

/** The `theme-color` each palette wants in the iPad's status bar. */
export const APPEARANCE_THEME_COLOR: Record<Appearance, string> = {
  dark: "#0b1017",
  light: "#e9edf2"
};

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function resolveAppearance(theme: ThemePreference, systemPrefersDark: boolean): Appearance {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  return systemPrefersDark ? "dark" : "light";
}

/**
 * The subset of `Document` this needs, so the controller can be tested without
 * a DOM: everything it does to the page is these two writes.
 */
export interface AppearanceDocument {
  documentElement: { dataset: Record<string, string | undefined> };
  querySelector(selectors: string): { setAttribute(name: string, value: string): void } | null;
}

/**
 * The subset of `MediaQueryList` this needs. Safari only gained the
 * `EventTarget` methods in 14, and `addListener` is what older WebKit has, so
 * both are accepted and neither is required.
 */
export interface SchemeQuery {
  matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

/**
 * Owns the one place the resolved appearance is written to the document.
 *
 * The stylesheet already follows `prefers-color-scheme` on its own, so nothing
 * here is needed for the first paint — which is the point: a cold start cannot
 * flash the wrong palette while IndexedDB is still answering, because the
 * attribute is only set once there is a stored preference to honour.
 */
export class AppearanceController {
  private theme: ThemePreference = "system";
  private applied: Appearance | undefined;
  private readonly onSchemeChange = () => {
    if (this.theme === "system") {
      this.apply();
    }
  };

  constructor(
    private readonly documentRef: AppearanceDocument,
    private readonly schemeQuery: SchemeQuery | undefined,
    /**
     * Called for every resolved appearance, including the ones the system
     * changes under a "System" preference. CodeMirror's own `dark` flag is not
     * a custom property, so something has to reconfigure the editor when the
     * iPad switches to Dark Mode on its own.
     */
    private readonly onApply: (appearance: Appearance) => void = () => {}
  ) {
    if (schemeQuery?.addEventListener) {
      schemeQuery.addEventListener("change", this.onSchemeChange);
    } else if (schemeQuery?.addListener) {
      schemeQuery.addListener(this.onSchemeChange);
    }
  }

  /** The appearance currently written to the document, if any. */
  get appearance(): Appearance | undefined {
    return this.applied;
  }

  setTheme(theme: ThemePreference): Appearance {
    this.theme = theme;
    return this.apply();
  }

  dispose(): void {
    if (this.schemeQuery?.removeEventListener) {
      this.schemeQuery.removeEventListener("change", this.onSchemeChange);
    } else if (this.schemeQuery?.removeListener) {
      this.schemeQuery.removeListener(this.onSchemeChange);
    }
  }

  private apply(): Appearance {
    const appearance = resolveAppearance(this.theme, this.schemeQuery?.matches ?? true);
    this.applied = appearance;
    this.documentRef.documentElement.dataset.theme = appearance;
    this.documentRef
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", APPEARANCE_THEME_COLOR[appearance]);
    this.onApply(appearance);
    return appearance;
  }
}
