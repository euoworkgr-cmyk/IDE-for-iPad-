/**
 * Turns a runtime that would not load into something a user can act on.
 *
 * Every heavy language ships its interpreter or compiler as bundled assets that
 * the Service Worker precaches. When that precache is incomplete — a first
 * visit that was interrupted, an update that has not finished downloading — the
 * load fails, and what reached the Run console was the browser's raw wording:
 * "Failed to fetch" on Chromium, "Load failed" on Safari. Both are true and
 * neither says what happened or what to do.
 *
 * Kept out of `workerExecution.ts` on purpose: this is imported by the Workers
 * themselves, and that module pulls in the settings layer.
 */

/**
 * Matched case-insensitively against the failure message. These are the shapes
 * a missing or unreachable asset takes across engines; anything else is passed
 * through as-is rather than guessed at.
 */
const ASSET_FAILURE_SIGNATURES = [
  "failed to fetch",
  "load failed",
  "networkerror",
  "network error",
  "importing a module script failed",
  "failed to import",
  "importscripts",
  "failed to load",
  "both async and sync fetching of the wasm failed",
  "wasm streaming compile failed",
  "unexpected response",
  "404"
];

export function formatFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

export function looksLikeAssetFailure(message: string): boolean {
  const haystack = message.toLowerCase();
  return ASSET_FAILURE_SIGNATURES.some((signature) => haystack.includes(signature));
}

/**
 * `runtime` names the thing that would not start, in the words the user sees
 * elsewhere in the app — "Python", "PHP", "The C# runtime".
 */
export function describeRuntimeStartFailure(runtime: string, error: unknown): string {
  const message = formatFailureMessage(error);
  if (!looksLikeAssetFailure(message)) {
    return `${runtime} failed to start: ${message}`;
  }
  return (
    `${runtime} could not start because its runtime files could not be loaded. ` +
    "They ship with Altitude and are stored for offline use, so this usually means the download " +
    "never finished — go online once, reload the app, and try again. " +
    `(${message})`
  );
}
