import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createFile, createProject } from "../projects/models";
import { ProjectRepository } from "./database";
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
