import { describe, expect, it } from "vitest";
import { PrimaryStorageError } from "./database";
import {
  classifyStorageError,
  describeStorageNotice,
  noticeKindForSaveFailure,
  type StorageNoticeKind
} from "./storageFailure";

describe("classifyStorageError", () => {
  it("recognises a full device", () => {
    expect(classifyStorageError(new DOMException("no room", "QuotaExceededError"))).toBe("full");
  });

  // Safari raises UnknownError from IndexedDB transactions when storage is
  // restricted, which is the likeliest way this is reached on an iPad.
  it.each(["SecurityError", "InvalidStateError", "UnknownError", "AbortError", "NotAllowedError"])(
    "treats %s as storage being unavailable",
    (name) => {
      expect(classifyStorageError(new DOMException("nope", name))).toBe("unavailable");
    }
  );

  it.each(["DataError", "DataCloneError", "VersionError"])("treats %s as damaged data", (name) => {
    expect(classifyStorageError(new DOMException("bad record", name))).toBe("damaged");
  });

  // The repository wraps open() failures, so the DOMException that says what
  // happened is one level down. Reading only the wrapper lost the reason.
  it("looks through the repository's own wrapper to the cause", () => {
    const wrapped = new PrimaryStorageError("IndexedDB could not be opened", {
      cause: new DOMException("no room", "QuotaExceededError")
    });
    expect(classifyStorageError(wrapped)).toBe("full");
  });

  it("falls back to unknown for anything it cannot place", () => {
    expect(classifyStorageError(new Error("something else"))).toBe("unknown");
    expect(classifyStorageError("a string")).toBe("unknown");
    expect(classifyStorageError(undefined)).toBe("unknown");
    expect(classifyStorageError(new PrimaryStorageError("IndexedDB is not available"))).toBe(
      "unknown"
    );
  });
});

describe("noticeKindForSaveFailure", () => {
  // A full device leaves everything already stored exactly where it was, so it
  // is a different message from a write that failed for any other reason.
  it("separates a full device from any other failed write", () => {
    expect(noticeKindForSaveFailure("full")).toBe("full");
    expect(noticeKindForSaveFailure("unknown")).toBe("write-failed");
    expect(noticeKindForSaveFailure("damaged")).toBe("write-failed");
  });
});

describe("describeStorageNotice", () => {
  const kinds: StorageNoticeKind[] = [
    "session-only",
    "full",
    "write-failed",
    "damaged",
    "evicted"
  ];

  it.each(kinds)("gives %s a title and a detail that says what to do", (kind) => {
    const notice = describeStorageNotice(kind);
    expect(notice.title.length).toBeGreaterThan(0);
    expect(notice.detail.length).toBeGreaterThan(0);
    expect(notice.kind).toBe(kind);
  });

  // A condition that is still true must not be dismissible: hiding it would
  // only hide the fact that nothing is being saved.
  it("makes the still-true conditions persistent and offers the way out", () => {
    for (const kind of ["session-only", "full", "write-failed"] as const) {
      const notice = describeStorageNotice(kind);
      expect(notice.persistent).toBe(true);
      expect(notice.offerExport).toBe(true);
      expect(notice.severity).toBe("danger");
    }
  });

  it("makes the after-the-fact ones dismissible", () => {
    for (const kind of ["damaged", "evicted"] as const) {
      expect(describeStorageNotice(kind).persistent).toBe(false);
      expect(describeStorageNotice(kind).severity).toBe("warning");
    }
  });

  it("counts the damaged records it is reporting", () => {
    expect(describeStorageNotice("damaged", { damagedCount: 1 }).title).toContain("One");
    expect(describeStorageNotice("damaged", { damagedCount: 3 }).title).toContain("3");
  });
});
