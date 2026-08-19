import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTION_TIMEOUT_MS,
  MAX_EXECUTION_TIMEOUT_MS,
  MIN_EXECUTION_TIMEOUT_MS,
  normalizeAppSettings,
  normalizeExecutionTimeoutMs,
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

describe("normalizeAppSettings", () => {
  it("returns defaults for anything that is not a settings object", () => {
    expect(normalizeAppSettings(undefined)).toEqual({
      executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS
    });
    expect(normalizeAppSettings("nonsense")).toEqual({
      executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS
    });
  });

  it("repairs a stored record written by an older or tampered build", () => {
    expect(normalizeAppSettings({ executionTimeoutMs: 900_000, extra: true })).toEqual({
      executionTimeoutMs: MAX_EXECUTION_TIMEOUT_MS
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
