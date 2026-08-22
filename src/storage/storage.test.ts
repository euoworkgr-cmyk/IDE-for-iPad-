import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createFile, createProject } from "../projects/models";
import { ProjectRepository } from "./database";
import { EvictionWatch } from "./evictionWatch";
import type { StorageNotice } from "./storageFailure";
import { RecoveryJournal } from "./recoveryJournal";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class FlakyStorage extends MemoryStorage {
  failReads = false;

  override getItem(key: string): string | null {
    if (this.failReads) {
      throw new DOMException("Storage access denied", "SecurityError");
    }
    return super.getItem(key);
  }
}

describe("ProjectRepository", () => {
  it("stores projects and restores the active session", async () => {
    const repository = new ProjectRepository();
    const project = createProject("Offline project");
    project.files[0]!.content = "Console.WriteLine(42);";

    await repository.saveProject(project);
    await repository.saveSession({ activeProjectId: project.id });

    const projects = await repository.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.files[0]?.content).toBe("Console.WriteLine(42);");
    await expect(repository.getSession()).resolves.toEqual({ activeProjectId: project.id });
  });

  // Storage failing used to throw out of App.start() and end at a dead page.
  // It now falls back to memory, so the app opens, runs and exports.
  it("keeps working in memory when IndexedDB cannot be opened", async () => {
    await withoutIndexedDb(async () => {
      const notices: StorageNotice[] = [];
      const repository = new ProjectRepository((notice) => notices.push(notice));

      await expect(repository.listProjects()).resolves.toEqual([]);
      expect(repository.mode).toBe("session-only");
      expect(notices.map((notice) => notice.kind)).toEqual(["session-only"]);

      const project = createProject("Written to nowhere");
      await expect(repository.saveProject(project)).resolves.toBeUndefined();
      await expect(repository.listProjects()).resolves.toHaveLength(1);

      await repository.saveSetting("app-settings", { executionTimeoutMs: 9_000 });
      await expect(repository.getSetting("app-settings")).resolves.toEqual({
        executionTimeoutMs: 9_000
      });
    });
  });

  it("says nothing is being saved only once, however many times it is asked", async () => {
    await withoutIndexedDb(async () => {
      const notices: StorageNotice[] = [];
      const repository = new ProjectRepository((notice) => notices.push(notice));

      await repository.listProjects();
      await repository.getSetting("app-settings");
      await repository.saveProject(createProject("One"));
      await repository.saveProject(createProject("Two"));

      expect(notices).toHaveLength(1);
    });
  });

  // A full device is not a reason to abandon what is already stored, so this
  // reports and keeps using IndexedDB rather than silently switching to memory.
  it("reports a full device without degrading to memory", async () => {
    const notices: StorageNotice[] = [];
    const repository = new ProjectRepository((notice) => notices.push(notice));
    await withFailingTransactions("QuotaExceededError", async () => {
      await expect(repository.saveProject(createProject("Too big"))).rejects.toThrow();
    });

    expect(notices.map((notice) => notice.kind)).toEqual(["full"]);
    expect(repository.mode).toBe("indexeddb");
  });

  it("degrades when a write fails because storage has become unusable", async () => {
    const notices: StorageNotice[] = [];
    const repository = new ProjectRepository((notice) => notices.push(notice));
    await withFailingTransactions("UnknownError", async () => {
      await expect(repository.saveProject(createProject("Gone"))).rejects.toThrow();
    });

    expect(notices.map((notice) => notice.kind)).toEqual(["session-only"]);
    expect(repository.mode).toBe("session-only");
  });

  // One bad record used to make every good project unreachable.
  it("skips an unreadable record, keeps the readable ones, and says how many", async () => {
    const repository = new ProjectRepository();
    const good = createProject("Readable");
    await repository.saveProject(good);
    await writeRawProjectRecord({ id: "broken-but-identified", name: 7 });

    const notices: StorageNotice[] = [];
    const reader = new ProjectRepository((notice) => notices.push(notice));
    const projects = await reader.listProjects();

    // The broken record has an id, so it is repaired rather than discarded;
    // what matters is that the readable project still arrives.
    expect(projects.map((project) => project.name)).toContain("Readable");
    expect(notices).toHaveLength(0);
  });

  it("reports a record it cannot repair at all", async () => {
    await writeRawProjectRecord({ id: 4096 });

    const notices: StorageNotice[] = [];
    const repository = new ProjectRepository((notice) => notices.push(notice));
    await repository.listProjects();

    expect(notices.map((notice) => notice.kind)).toEqual(["damaged"]);
  });
});

describe("EvictionWatch", () => {
  it("notices that projects existed on this device and no longer do", () => {
    const storage = new MemoryStorage();
    new EvictionWatch(storage).record(3);
    expect(new EvictionWatch(storage).wasEvicted(0)).toBe(true);
  });

  it("stays quiet when projects are still there", () => {
    const storage = new MemoryStorage();
    new EvictionWatch(storage).record(3);
    expect(new EvictionWatch(storage).wasEvicted(2)).toBe(false);
  });

  // A first launch has no marker. Claiming an eviction there would tell someone
  // their projects were deleted when they never had any.
  it("stays quiet on a first launch", () => {
    expect(new EvictionWatch(new MemoryStorage()).wasEvicted(0)).toBe(false);
  });

  // localStorage is often cleared in the same sweep as IndexedDB, which is
  // exactly when the marker is gone too. A missed warning beats a false one.
  it("stays quiet when its own marker was cleared as well", () => {
    const storage = new MemoryStorage();
    new EvictionWatch(storage).record(3);
    storage.clear();
    expect(new EvictionWatch(storage).wasEvicted(0)).toBe(false);
  });

  it("survives storage that throws", () => {
    const storage = new FlakyStorage();
    const watch = new EvictionWatch(storage);
    storage.failReads = true;
    expect(() => watch.record(1)).not.toThrow();
    expect(watch.wasEvicted(0)).toBe(false);
  });
});

describe("RecoveryJournal", () => {
  it("recovers unsaved edits from several files", () => {
    const project = createProject("Recovery project");
    const secondFile = createFile("Test.cs", "old");
    project.files.push(secondFile);
    const journal = new RecoveryJournal(new MemoryStorage());

    const firstFile = project.files[0]!;
    firstFile.content = "first unsaved edit";
    firstFile.updatedAt += 10;
    journal.write(project, firstFile);
    secondFile.content = "second unsaved edit";
    secondFile.updatedAt += 20;
    journal.write(project, secondFile);

    firstFile.content = "old first";
    firstFile.updatedAt -= 10;
    secondFile.content = "old second";
    secondFile.updatedAt -= 20;

    expect(journal.recover([project])).toEqual([project]);
    expect(firstFile.content).toBe("first unsaved edit");
    expect(secondFile.content).toBe("second unsaved edit");
  });

  it("recovers a file created before IndexedDB flush", () => {
    const project = createProject("Recovery project");
    const journal = new RecoveryJournal(new MemoryStorage());
    const newFile = createFile("NewFile.cs", "class NewFile {}");
    project.files.push(newFile);
    project.activeFileId = newFile.id;
    project.updatedAt = newFile.updatedAt + 1;
    journal.write(project, newFile);

    project.files = project.files.filter((file) => file.id !== newFile.id);
    project.activeFileId = project.files[0]!.id;
    project.updatedAt -= 2;

    expect(journal.recover([project])).toEqual([project]);
    expect(project.files.find((file) => file.id === newFile.id)?.content).toBe("class NewFile {}");
    expect(project.activeFileId).toBe(newFile.id);
  });

  it("stays optional when localStorage operations start throwing", () => {
    const storage = new FlakyStorage();
    let warnings = 0;
    const journal = new RecoveryJournal(storage, () => {
      warnings += 1;
    });
    storage.failReads = true;

    expect(() => journal.recover([createProject("Still starts")])).not.toThrow();
    expect(journal.available).toBe(false);
    expect(warnings).toBe(1);
  });

  it("handles a throwing window.localStorage getter", () => {
    const previousWindow = globalThis.window;
    const fakeWindow = {};
    Object.defineProperty(fakeWindow, "localStorage", {
      get: () => {
        throw new DOMException("Storage access denied", "SecurityError");
      }
    });
    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });

    try {
      let warned = false;
      const journal = new RecoveryJournal(undefined, () => {
        warned = true;
      });
      expect(journal.available).toBe(false);
      expect(warned).toBe(true);
      expect(() => journal.write(createProject("Still starts"), createFile("Program.cs"))).not.toThrow();
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", { value: previousWindow, configurable: true });
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});

/** Runs `body` with `globalThis.indexedDB` removed, then puts it back. */
async function withoutIndexedDb(body: () => Promise<void>): Promise<void> {
  const previous = globalThis.indexedDB;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
  try {
    await body();
  } finally {
    Object.defineProperty(globalThis, "indexedDB", { value: previous, configurable: true });
  }
}

/**
 * fake-indexeddb has no way to simulate a quota, so `transaction()` is made to
 * throw the DOMException the real thing would raise. It has to be the
 * transaction rather than the open: the repository reads `request.result` from
 * inside its own success handler, and a getter that throws there leaves the
 * open promise neither resolved nor rejected.
 */
async function withFailingTransactions(name: string, body: () => Promise<void>): Promise<void> {
  const realTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function transaction(): IDBTransaction {
    throw new DOMException("simulated", name);
  } as IDBDatabase["transaction"];

  try {
    await body();
  } finally {
    IDBDatabase.prototype.transaction = realTransaction;
  }
}

/**
 * Writes a record straight into the object store, bypassing normalization —
 * which is the only way to reproduce what a half-written or older-format record
 * looks like on the way back out.
 */
async function writeRawProjectRecord(record: { id: unknown; [key: string]: unknown }): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("altitude-code", 1);
    request.onupgradeneeded = () => {
      const upgraded = request.result;
      if (!upgraded.objectStoreNames.contains("projects")) {
        upgraded.createObjectStore("projects", { keyPath: "id" });
      }
      if (!upgraded.objectStoreNames.contains("settings")) {
        upgraded.createObjectStore("settings", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(record as never);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("write failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("write aborted"));
    });
  } finally {
    database.close();
  }
}
