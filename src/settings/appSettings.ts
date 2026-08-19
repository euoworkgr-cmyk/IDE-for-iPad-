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
}

export const DEFAULT_EXECUTION_TIMEOUT_MS = 5_000;
export const MIN_EXECUTION_TIMEOUT_MS = 1_000;
export const MAX_EXECUTION_TIMEOUT_MS = 120_000;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS
};

export function normalizeExecutionTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EXECUTION_TIMEOUT_MS;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_EXECUTION_TIMEOUT_MS, Math.max(MIN_EXECUTION_TIMEOUT_MS, rounded));
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_APP_SETTINGS };
  }
  const candidate = value as Partial<Record<keyof AppSettings, unknown>>;
  return {
    executionTimeoutMs: normalizeExecutionTimeoutMs(candidate.executionTimeoutMs)
  };
}

/** Seconds are the unit the settings form works in; milliseconds are stored. */
export function timeoutSecondsFromMs(milliseconds: number): number {
  return Math.round(milliseconds / 100) / 10;
}

export function timeoutMsFromSeconds(seconds: number): number {
  return normalizeExecutionTimeoutMs(seconds * 1_000);
}
