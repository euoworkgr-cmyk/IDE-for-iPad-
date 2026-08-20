import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../settings/appSettings";

/**
 * The pieces every Worker-backed runtime needs and none of them own: a
 * correlation id, the run time limit read per run, and the two bits of message
 * formatting. Extracted when SQL became the second such runtime, so the two do
 * not drift apart on details that are supposed to be identical.
 */

/** A fixed limit, or a function read once per run so settings changes apply. */
export type ExecutionTimeoutSource = number | (() => number);

export function createExecutionId(prefix: string): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-cryptographic correlation identifier.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Resolved once per run, so a caller that passes a function gets the limit the
 * user has configured now rather than the one in force when the runtime was
 * constructed. The user-facing bounds are enforced by the settings layer; this
 * only refuses a value that would disable the limit altogether.
 */
export function resolveTimeoutMs(source: ExecutionTimeoutSource): number {
  const raw = typeof source === "function" ? source() : source;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_EXECUTION_TIMEOUT_MS;
}

export function formatTimeout(milliseconds: number): string {
  const seconds = milliseconds / 1_000;
  const rendered = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return `${rendered} second${rendered === "1" ? "" : "s"}`;
}

export function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}
