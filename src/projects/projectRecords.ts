import { createId, languageFromPath, type Project, type ProjectFile } from "./models";

/**
 * Records read back out of storage are untrusted, in exactly the way settings
 * are: they survive app upgrades, an older build may have written a shape this
 * one does not know, and a write interrupted by the tab being killed can leave
 * a half-record behind.
 *
 * Before this existed, `ProjectRepository.listProjects()` cast whatever
 * IndexedDB returned straight to `Project[]`. A record missing its `files`
 * array threw on the first property access and took the whole app down through
 * `showFatalError` — one bad record, and every *good* project became
 * unreachable too.
 *
 * The rule here is repair what can be repaired and skip what cannot, never
 * throw. A project with one unreadable file should open with its other files,
 * not disappear.
 */

export interface NormalizedProjects {
  projects: Project[];
  /** How many records had to be discarded outright, for reporting. */
  discarded: number;
  /** True when any record was changed on the way in, repair included. */
  repaired: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * A file needs a path and content to be worth anything; everything else can be
 * rebuilt. A missing language is re-derived from the path rather than dropped,
 * which is also how a project written before a language existed picks up its
 * new mode.
 */
export function normalizeStoredFile(value: unknown, now: number): ProjectFile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const path = readString(value.path);
  const content = readString(value.content);
  if (path === undefined || content === undefined) {
    return undefined;
  }
  const createdAt = readTimestamp(value.createdAt, now);
  return {
    id: readString(value.id) ?? createId(),
    path,
    content,
    language: languageFromPath(path),
    createdAt,
    updatedAt: readTimestamp(value.updatedAt, createdAt)
  };
}

export function normalizeStoredProject(value: unknown, now = Date.now()): Project | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = readString(value.id);
  if (id === undefined) {
    // Without an identity the record cannot be saved back, switched to, or
    // deleted. Repairing it would silently fork the project on the next write.
    return undefined;
  }

  const rawFiles = Array.isArray(value.files) ? value.files : [];
  const files: ProjectFile[] = [];
  for (const rawFile of rawFiles) {
    const file = normalizeStoredFile(rawFile, now);
    if (file) {
      files.push(file);
    }
  }

  const createdAt = readTimestamp(value.createdAt, now);
  const activeFileId = readString(value.activeFileId) ?? "";
  return {
    id,
    name: readString(value.name) || "Untitled project",
    files,
    // An active file that is no longer in the list would leave the editor
    // pointing at nothing; App.ensureActiveFile handles an empty string.
    activeFileId: files.some((file) => file.id === activeFileId) ? activeFileId : (files[0]?.id ?? ""),
    createdAt,
    updatedAt: readTimestamp(value.updatedAt, createdAt)
  };
}

export function normalizeStoredProjects(values: readonly unknown[]): NormalizedProjects {
  const now = Date.now();
  const projects: Project[] = [];
  let discarded = 0;
  let repaired = false;

  for (const value of values) {
    const project = normalizeStoredProject(value, now);
    if (!project) {
      discarded += 1;
      continue;
    }
    if (!repaired && differsFromStored(value, project)) {
      repaired = true;
    }
    projects.push(project);
  }

  return { projects, discarded, repaired };
}

/**
 * Only used to decide whether the user is told anything, so a shallow shape
 * comparison is enough — it does not need to say *what* changed.
 */
function differsFromStored(value: unknown, project: Project): boolean {
  if (!isRecord(value)) {
    return true;
  }
  const storedFiles = Array.isArray(value.files) ? value.files : undefined;
  return (
    storedFiles === undefined ||
    storedFiles.length !== project.files.length ||
    readString(value.name) !== project.name ||
    readString(value.activeFileId) !== project.activeFileId
  );
}
