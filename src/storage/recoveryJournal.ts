import type { Project, ProjectFile } from "../projects/models";

const JOURNAL_KEY = "altitude-code:recovery";

interface RecoveryEntry {
  projectId: string;
  projectName: string;
  projectUpdatedAt: number;
  activeFileId: string;
  file: ProjectFile;
}

export class RecoveryJournal {
  private storage: Storage | undefined;
  private unavailableNotified = false;

  constructor(storage?: Storage, private readonly onUnavailable: () => void = () => undefined) {
    this.storage = this.detectStorage(storage);
    if (!this.storage) {
      this.notifyUnavailable();
    }
  }

  get available(): boolean {
    return this.storage !== undefined;
  }

  write(project: Project, file: ProjectFile): void {
    const storage = this.storage;
    if (!storage) {
      return;
    }

    try {
      const entry: RecoveryEntry = {
        projectId: project.id,
        projectName: project.name,
        projectUpdatedAt: project.updatedAt,
        activeFileId: project.activeFileId,
        file: { ...file }
      };
      const entries = this.read();
      const entryKey = this.entryKey(entry);
      const nextEntries = entries.filter((candidate) => this.entryKey(candidate) !== entryKey);
      nextEntries.push(entry);
      storage.setItem(JOURNAL_KEY, JSON.stringify(nextEntries));
    } catch {
      this.disable();
    }
  }

  recover(projects: Project[]): Project[] {
    try {
      const recoveredProjects = new Set<Project>();
      for (const entry of this.read()) {
        const project = projects.find((candidate) => candidate.id === entry.projectId);
        if (!project) {
          continue;
        }

        const existingFile = project.files.find((candidate) => candidate.id === entry.file.id);
        if (
          existingFile &&
          entry.file.updatedAt <= existingFile.updatedAt &&
          entry.projectUpdatedAt <= project.updatedAt
        ) {
          continue;
        }

        if (existingFile) {
          Object.assign(existingFile, entry.file);
        } else {
          project.files.push({ ...entry.file });
        }
        if (entry.projectUpdatedAt >= project.updatedAt) {
          project.name = entry.projectName;
          project.activeFileId = entry.activeFileId;
        }
        project.updatedAt = Math.max(project.updatedAt, entry.projectUpdatedAt);
        recoveredProjects.add(project);
      }

      return [...recoveredProjects];
    } catch {
      this.disable();
      return [];
    }
  }

  clearIfSaved(projectId: string, savedAt: number): void {
    const storage = this.storage;
    if (!storage) {
      return;
    }

    try {
      const remaining = this.read().filter(
        (entry) => entry.projectId !== projectId || entry.projectUpdatedAt > savedAt
      );
      if (remaining.length === 0) {
        this.clear();
      } else {
        storage.setItem(JOURNAL_KEY, JSON.stringify(remaining));
      }
    } catch {
      this.disable();
    }
  }

  private read(): RecoveryEntry[] {
    const storage = this.storage;
    if (!storage) {
      return [];
    }

    try {
      const serialized = storage.getItem(JOURNAL_KEY);
      if (!serialized) {
        return [];
      }
      const parsed: unknown = JSON.parse(serialized);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      return entries.filter((entry): entry is RecoveryEntry => this.isRecoveryEntry(entry));
    } catch {
      this.disable();
      return [];
    }
  }

  private entryKey(entry: RecoveryEntry): string {
    return `${entry.projectId}:${entry.file.id}`;
  }

  private clear(): void {
    const storage = this.storage;
    if (!storage) {
      return;
    }

    try {
      storage.removeItem(JOURNAL_KEY);
    } catch {
      this.disable();
    }
  }

  private detectStorage(candidate?: Storage): Storage | undefined {
    try {
      const storage = candidate ?? window.localStorage;
      const probeKey = `${JOURNAL_KEY}:probe`;
      storage.setItem(probeKey, "1");
      if (storage.getItem(probeKey) !== "1") {
        return undefined;
      }
      storage.removeItem(probeKey);
      return storage;
    } catch {
      return undefined;
    }
  }

  private isRecoveryEntry(value: unknown): value is RecoveryEntry {
    if (!value || typeof value !== "object") {
      return false;
    }
    const entry = value as Partial<RecoveryEntry>;
    return (
      typeof entry.projectId === "string" &&
      typeof entry.projectName === "string" &&
      typeof entry.projectUpdatedAt === "number" &&
      typeof entry.activeFileId === "string" &&
      !!entry.file &&
      typeof entry.file.id === "string" &&
      typeof entry.file.path === "string" &&
      typeof entry.file.content === "string" &&
      typeof entry.file.updatedAt === "number"
    );
  }

  private disable(): void {
    this.storage = undefined;
    this.notifyUnavailable();
  }

  private notifyUnavailable(): void {
    if (!this.unavailableNotified) {
      this.unavailableNotified = true;
      this.onUnavailable();
    }
  }
}
