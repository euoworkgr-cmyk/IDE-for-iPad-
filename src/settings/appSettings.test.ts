import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXECUTION_TIMEOUT_MS,
  DEFAULT_INDENT_WIDTH,
  DEFAULT_THEME,
  MAX_EDITOR_FONT_SIZE,
  MAX_EXECUTION_TIMEOUT_MS,
  MIN_EDITOR_FONT_SIZE,
  MIN_EXECUTION_TIMEOUT_MS,
  normalizeAppSettings,
  normalizeEditorFontSize,
  normalizeExecutionTimeoutMs,
  normalizeIndentWidth,
  normalizeTheme,
  timeoutMsFromSeconds,
  timeoutSecondsFromMs
} from "./appSettings";

describe("normalizeExecutionTimeoutMs", () => {
  it("keeps a value inside the supported range", () => {
    expect(normalizeExecutionTimeoutMs(12_000)).toBe(12_000);
  });

  it("clamps values outside the supported range", () => {
    expect(normalizeExecutionTimeoutMs(0)).toBe(MIN_EXECUTION_TIMEOUT_MS);
    expect(normalizeExecutionTimeoutMs(-4_000)).toBe(MIN_EXECUTION_TIMEOUT_MS);
    expect(normalizeExecutionTimeoutMs(10 ** 9)).toBe(MAX_EXECUTION_TIMEOUT_MS);
  });

  it.each([undefined, null, "5000", Number.NaN, Number.POSITIVE_INFINITY, {}])(
    "falls back to the default for %s",
    (value) => {
      expect(normalizeExecutionTimeoutMs(value)).toBe(DEFAULT_EXECUTION_TIMEOUT_MS);
    }
  );
});

describe("normalizeTheme", () => {
  it("keeps the three preferences the form offers", () => {
    expect(normalizeTheme("system")).toBe("system");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
  });

  it.each([undefined, null, "sepia", 1, {}])("falls back to the default for %s", (value) => {
    expect(normalizeTheme(value)).toBe(DEFAULT_THEME);
  });
});

describe("normalizeEditorFontSize", () => {
  it("clamps to a size the editor stays usable at", () => {
    expect(normalizeEditorFontSize(18)).toBe(18);
    expect(normalizeEditorFontSize(4)).toBe(MIN_EDITOR_FONT_SIZE);
    expect(normalizeEditorFontSize(400)).toBe(MAX_EDITOR_FONT_SIZE);
  });

  it("rounds, because the property it becomes is a whole number of pixels", () => {
    expect(normalizeEditorFontSize(15.4)).toBe(15);
    expect(normalizeEditorFontSize(15.6)).toBe(16);
  });

  it.each([undefined, "15", Number.NaN])("falls back to the default for %s", (value) => {
    expect(normalizeEditorFontSize(value)).toBe(DEFAULT_EDITOR_FONT_SIZE);
  });
});

describe("normalizeIndentWidth", () => {
  it("keeps the offered widths", () => {
    expect(normalizeIndentWidth(2)).toBe(2);
    expect(normalizeIndentWidth(8)).toBe(8);
  });

  // Clamping would turn a stored 3 into 4 or 2 silently; a width the form
  // cannot show is a value the app should not be honouring at all.
  it.each([3, 0, -4, 16, "4", undefined])("rejects %s rather than clamping it", (value) => {
    expect(normalizeIndentWidth(value)).toBe(DEFAULT_INDENT_WIDTH);
  });
});

describe("normalizeAppSettings", () => {
  it("returns defaults for anything that is not a settings object", () => {
    expect(normalizeAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS);
    expect(normalizeAppSettings("nonsense")).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("repairs a stored record written by an older or tampered build", () => {
    expect(normalizeAppSettings({ executionTimeoutMs: 900_000, extra: true })).toEqual({
      ...DEFAULT_APP_SETTINGS,
      executionTimeoutMs: MAX_EXECUTION_TIMEOUT_MS
    });
  });

  // The record L4 wrote had one key. Reading it back must not throw away the
  // limit the user set, and must not invent values for keys it predates.
  it("keeps what a record from before the display settings did say", () => {
    expect(normalizeAppSettings({ executionTimeoutMs: 12_000 })).toEqual({
      ...DEFAULT_APP_SETTINGS,
      executionTimeoutMs: 12_000
    });
  });

  it("normalizes each display setting independently", () => {
    expect(
      normalizeAppSettings({
        executionTimeoutMs: 5_000,
        theme: "light",
        editorFontSize: 99,
        indentWidth: 3
      })
    ).toEqual({
      executionTimeoutMs: 5_000,
      theme: "light",
      editorFontSize: MAX_EDITOR_FONT_SIZE,
      indentWidth: DEFAULT_INDENT_WIDTH
    });
  });
});

describe("seconds conversion", () => {
  it("round-trips the values the settings form works in", () => {
    expect(timeoutSecondsFromMs(5_000)).toBe(5);
    expect(timeoutSecondsFromMs(2_500)).toBe(2.5);
    expect(timeoutMsFromSeconds(2.5)).toBe(2_500);
    expect(timeoutMsFromSeconds(30)).toBe(30_000);
  });

  it("clamps out-of-range seconds on the way in", () => {
    expect(timeoutMsFromSeconds(0.2)).toBe(MIN_EXECUTION_TIMEOUT_MS);
    expect(timeoutMsFromSeconds(600)).toBe(MAX_EXECUTION_TIMEOUT_MS);
  });
});
