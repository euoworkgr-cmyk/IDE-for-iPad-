import type { Project, ProjectFile } from "../projects/models";
import { ProjectRepository } from "./database";
import { RecoveryJournal } from "./recoveryJournal";

export type SaveState = "idle" | "saving" | "saved" | "error";

export class SaveCoordinator {
  private readonly pending = new Map<string, Project>();
  private readonly timers = new Map<string, number>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: ProjectRepository,
    private readonly journal: RecoveryJournal,
    private readonly onStateChange: (state: SaveState) => void
  ) {}

  schedule(project: Project, activeFile?: ProjectFile): void {
    this.pending.set(project.id, structuredClone(project));
    if (activeFile) {
      this.journal.write(project, activeFile);
    }

    const existingTimer = this.timers.get(project.id);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    this.onStateChange("saving");
    this.timers.set(
      project.id,
      window.setTimeout(() => this.queueWrite(project.id), 350)
    );
  }

  async flush(): Promise<void> {
    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
    }
    this.timers.clear();

    for (const projectId of [...this.pending.keys()]) {
      this.queueWrite(projectId);
    }

    await this.writeChain;
  }

  private queueWrite(projectId: string): void {
    const project = this.pending.get(projectId);
    if (!project) {
      return;
    }

    this.pending.delete(projectId);
    const timer = this.timers.get(projectId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(projectId);
    }

    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await this.repository.saveProject(project);
        this.journal.clearIfSaved(project.id, project.updatedAt);
        this.onStateChange(this.pending.size > 0 ? "saving" : "saved");
      })
      .catch((error: unknown) => {
        console.error("Failed to save project", error);
        this.onStateChange("error");
      });
  }
}
