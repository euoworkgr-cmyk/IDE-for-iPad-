import { strToU8 } from "fflate";
import { createId, type Project } from "../projects/models";
import { normalizeStoredProjects } from "../projects/projectRecords";
import type { Download } from "./exportProject";

/**
 * Whole-device backup and restore (M4's data-safety item).
 *
 * Export already covered one file or one project. Neither is a backup: Safari
 * can clear Website Data and take *every* project at once, and R2's eviction
 * detection can only tell the user it happened, never undo it. This is the
 * undo — one file holding everything, and a way back in.
 *
 * JSON rather than a zip of zips. A backup has to survive being opened by
 * something that is not Altitude, and a person looking at it in Files should
 * be able to see their code is really in there.
 */

/** Bumped only for a change old builds could not read. */
export const BACKUP_FORMAT = 1;

/** Identifies the file as ours before anything tries to interpret it. */
export const BACKUP_MARKER = "altitude-backup";

export interface BackupPayload {
  marker: typeof BACKUP_MARKER;
  format: number;
  createdAt: number;
  appVersion: string;
  projects: Project[];
}

export type BackupErrorCode = "not_json" | "not_a_backup" | "too_new" | "empty";

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string
  ) {
    super(message);
    this.name = "BackupError";
  }
}

export function backupFileName(now: Date): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  return `altitude-backup-${stamp}.json`;
}

export function buildBackup(
  projects: readonly Project[],
  appVersion: string,
  now = new Date()
): Download {
  const payload: BackupPayload = {
    marker: BACKUP_MARKER,
    format: BACKUP_FORMAT,
    createdAt: now.getTime(),
    appVersion,
    projects: [...projects]
  };
  return {
    fileName: backupFileName(now),
    mimeType: "application/json;charset=utf-8",
    // Indented: a backup is a file a person may well open and read.
    bytes: strToU8(JSON.stringify(payload, null, 2))
  };
}

export interface RestoredBackup {
  projects: Project[];
  /** Records the file held but could not be read, so the user can be told. */
  discarded: number;
  createdAt: number | undefined;
}

/**
 * Every field is checked before use. A backup is a file from outside the app —
 * possibly hand-edited, possibly truncated by whatever copied it — so it gets
 * the same treatment as a record read back from storage.
 */
export function parseBackup(text: string): RestoredBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError("not_json", "That file is not a backup — it is not even JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BackupError("not_a_backup", "That file is not an Altitude backup.");
  }
  const candidate = parsed as Partial<BackupPayload>;
  if (candidate.marker !== BACKUP_MARKER) {
    throw new BackupError("not_a_backup", "That file is not an Altitude backup.");
  }
  if (typeof candidate.format === "number" && candidate.format > BACKUP_FORMAT) {
    throw new BackupError(
      "too_new",
      "That backup was made by a newer version of Altitude. Update the app, then try again."
    );
  }

  const raw = Array.isArray(candidate.projects) ? candidate.projects : [];
  const { projects, discarded } = normalizeStoredProjects(raw);
  if (projects.length === 0) {
    throw new BackupError("empty", "That backup does not contain any projects that can be read.");
  }

  return {
    projects,
    discarded,
    createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : undefined
  };
}

/**
 * Restoring never overwrites. A project whose id is already here is brought in
 * as a copy with a fresh id and a marked name, so restoring onto a device that
 * still has work cannot destroy it — and restoring the same file twice is
 * merely untidy rather than dangerous.
 */
export function reconcileRestoredProjects(
  restored: readonly Project[],
  existing: readonly Project[]
): Project[] {
  const takenIds = new Set(existing.map((project) => project.id));
  return restored.map((project) => {
    if (!takenIds.has(project.id)) {
      takenIds.add(project.id);
      return project;
    }
    const copy: Project = { ...project, id: createId(), name: `${project.name} (restored)` };
    takenIds.add(copy.id);
    return copy;
  });
}
