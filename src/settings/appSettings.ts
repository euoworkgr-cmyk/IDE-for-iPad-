/**
 * The minimal settings model. L4 needs somewhere to keep the run time limit,
 * and every later setting needs the same thing, so the shape is a plain record
 * with a normalizer rather than a single stored number.
 *
 * Persisted values are untrusted: they survive app upgrades, they can be edited
 * through developer tools, and an older build may have written a shape this one
 * does not know. `normalizeAppSettings` is the only way settings enter the app.
 */
export interface AppSettings {
  /** Wall-clock limit for a single Worker-backed run, in milliseconds. */
  executionTimeoutMs: number;
  /** Which palette to use, or to follow the system's. */
  theme: ThemePreference;
  /** Editor text size in CSS pixels. */
  editorFontSize: number;
  /** How many spaces one indent level is, for Tab and for auto-indent. */
  indentWidth: number;
}

export type ThemePreference = "system" | "light" | "dark";

/** What a `ThemePreference` resolves to once the system has been consulted. */
export type Appearance = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export const DEFAULT_EXECUTION_TIMEOUT_MS = 5_000;
export const MIN_EXECUTION_TIMEOUT_MS = 1_000;
export const MAX_EXECUTION_TIMEOUT_MS = 120_000;

export const DEFAULT_THEME: ThemePreference = "system";

/**
 * 15 px is what the editor theme hard-coded before this setting existed, so it
 * stays the default: nobody's editor changes size because they upgraded.
 */
export const DEFAULT_EDITOR_FONT_SIZE = 15;
export const MIN_EDITOR_FONT_SIZE = 11;
export const MAX_EDITOR_FONT_SIZE = 24;

/**
 * 4 is what the status bar has always claimed and what `tabSize` was set to.
 * `indentUnit` was never configured, so CodeMirror's default of 2 is what Tab
 * actually inserted — this setting is also the fix for that.
 */
export const DEFAULT_INDENT_WIDTH = 4;
export const INDENT_WIDTHS: readonly number[] = [2, 4, 8];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,
  theme: DEFAULT_THEME,
  editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
  indentWidth: DEFAULT_INDENT_WIDTH
};

export function normalizeExecutionTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EXECUTION_TIMEOUT_MS;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_EXECUTION_TIMEOUT_MS, Math.max(MIN_EXECUTION_TIMEOUT_MS, rounded));
}

export function normalizeTheme(value: unknown): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : DEFAULT_THEME;
}

export function normalizeEditorFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, rounded));
}

/**
 * Unlike the other two numbers this is a choice from a list, not a range: an
 * indent of 3 or 7 is not a setting anyone wants, and clamping would silently
 * turn a stored 3 into something the form cannot show.
 */
export function normalizeIndentWidth(value: unknown): number {
  return typeof value === "number" && INDENT_WIDTHS.includes(value) ? value : DEFAULT_INDENT_WIDTH;
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_APP_SETTINGS };
  }
  const candidate = value as Partial<Record<keyof AppSettings, unknown>>;
  return {
    executionTimeoutMs: normalizeExecutionTimeoutMs(candidate.executionTimeoutMs),
    theme: normalizeTheme(candidate.theme),
    editorFontSize: normalizeEditorFontSize(candidate.editorFontSize),
    indentWidth: normalizeIndentWidth(candidate.indentWidth)
  };
}

/** Seconds are the unit the settings form works in; milliseconds are stored. */
export function timeoutSecondsFromMs(milliseconds: number): number {
  return Math.round(milliseconds / 100) / 10;
}

export function timeoutMsFromSeconds(seconds: number): number {
  return normalizeExecutionTimeoutMs(seconds * 1_000);
}
