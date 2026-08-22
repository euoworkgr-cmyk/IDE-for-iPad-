/**
 * What Altitude can tell the user when storage goes wrong.
 *
 * The five paths M3 lists (quota exceeded, restricted storage, eviction, a
 * corrupt record, a runtime that will not load) all used to end in the same
 * place: a `console.error` nobody reads, or a dead page. They are different
 * problems with different answers, so the first thing needed was a way to tell
 * them apart.
 *
 * Deliberately symptom-based rather than browser-mode-based. "Private
 * Browsing" cannot be detected reliably — modern Safari allows IndexedDB there
 * with a small quota and clears it on close, older versions refuse it outright,
 * and other browsers differ again. What Altitude *can* observe is that a write
 * did not happen, and that is what the user needs told.
 */
export type StorageNoticeKind =
  /** Storage is unusable, so the session runs in memory and keeps nothing. */
  | "session-only"
  /** There is no room left. The data already stored is still there. */
  | "full"
  /** A single write failed for a reason that is not quota. */
  | "write-failed"
  /** A stored record could not be read and was skipped. */
  | "damaged"
  /** Projects existed on this device before and no longer do. */
  | "evicted";

export type StorageNoticeSeverity = "warning" | "danger";

export interface StorageNotice {
  kind: StorageNoticeKind;
  severity: StorageNoticeSeverity;
  title: string;
  detail: string;
  /**
   * A persistent notice describes a condition that is still true — dismissing
   * it would only hide the fact that nothing is being saved. A non-persistent
   * one describes an event that has already happened.
   */
  persistent: boolean;
  /** Whether to offer Export from the notice itself. */
  offerExport: boolean;
}

/** The reasons a storage operation can fail, as far as the user is concerned. */
export type StorageFailureReason = "unavailable" | "full" | "damaged" | "unknown";

const UNAVAILABLE_NAMES = new Set([
  "SecurityError",
  "InvalidAccessError",
  "NotAllowedError",
  "InvalidStateError",
  // Safari raises UnknownError from IndexedDB transactions when storage is
  // restricted, which is the single most likely way this is reached on iPad.
  "UnknownError",
  "AbortError"
]);

const DAMAGED_NAMES = new Set(["DataError", "DataCloneError", "VersionError", "ConstraintError"]);

/**
 * `DOMException.name` is the only part of an IndexedDB failure that is stable
 * across browsers; the messages are not, so nothing here reads them.
 */
export function classifyStorageError(error: unknown): StorageFailureReason {
  // The repository wraps open() failures in PrimaryStorageError, so the
  // DOMException that says what actually went wrong is one level down.
  const name = errorName(error) || errorName(unwrapCause(error));
  if (name === "QuotaExceededError") {
    return "full";
  }
  if (UNAVAILABLE_NAMES.has(name)) {
    return "unavailable";
  }
  if (DAMAGED_NAMES.has(name)) {
    return "damaged";
  }
  return "unknown";
}

function unwrapCause(error: unknown): unknown {
  return error instanceof Error ? error.cause : undefined;
}

function errorName(error: unknown): string {
  if (error instanceof DOMException || error instanceof Error) {
    // A wrapper of our own carries no classification; its cause does.
    return error.name === "PrimaryStorageError" ? "" : error.name;
  }
  if (error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string") {
    return (error as { name: string }).name;
  }
  return "";
}

/**
 * A write that failed while storage is otherwise fine leaves everything already
 * stored exactly where it was, so it is reported as one write that did not
 * happen rather than as the end of persistence. Falling back to memory is a
 * separate decision the repository makes, and it always says "session-only".
 */
export function noticeKindForSaveFailure(reason: StorageFailureReason): StorageNoticeKind {
  return reason === "full" ? "full" : "write-failed";
}

export function describeStorageNotice(
  kind: StorageNoticeKind,
  options: { damagedCount?: number } = {}
): StorageNotice {
  switch (kind) {
    case "session-only":
      return {
        kind,
        severity: "danger",
        title: "Nothing on this page is being saved",
        detail:
          "This browser is not letting Altitude store anything — Private Browsing does that, and so does blocking website data. You can write, run and export code as normal, but everything here is lost when you close the tab.",
        persistent: true,
        offerExport: true
      };
    case "full":
      return {
        kind,
        severity: "danger",
        title: "Storage is full — your last change was not saved",
        detail:
          "There is no room left on this device for Altitude's data. Export this project to keep a copy, then delete files or projects you no longer need.",
        persistent: true,
        offerExport: true
      };
    case "write-failed":
      return {
        kind,
        severity: "danger",
        title: "Your last change was not saved",
        detail:
          "Altitude could not write to this device's storage. Keep a copy by exporting, and reload the app to try again.",
        persistent: true,
        offerExport: true
      };
    case "damaged": {
      const count = options.damagedCount ?? 1;
      return {
        kind,
        severity: "warning",
        title:
          count === 1
            ? "One saved project could not be read"
            : `${count} saved projects could not be read`,
        detail:
          "Altitude found stored data it does not understand and skipped it, rather than refusing to start. Everything else opened normally.",
        persistent: false,
        offerExport: false
      };
    }
    case "evicted":
      return {
        kind,
        severity: "warning",
        title: "This device removed Altitude's saved data",
        detail:
          "Safari clears website data for sites that have not been opened for a while, and it takes saved projects with it. Altitude has started fresh. Adding it to your Home Screen makes this far less likely, and exporting a project keeps a copy that nothing can clear.",
        persistent: false,
        offerExport: false
      };
  }
}
