import type { ProjectFile } from "../projects/models";

/**
 * Where a project is mounted inside Pyodide's virtual filesystem. Kept here,
 * next to the validation, because both the Worker that writes files there and
 * the main thread that reads paths back out of a traceback need it.
 */
export const VIRTUAL_PROJECT_ROOT = "/home/pyodide/altitude-project";

export interface VirtualProjectFile {
  relativePath: string;
  virtualPath: string;
  content: string;
}

/**
 * Defensive path validation for every execution path: a project-relative path
 * may not be absolute, empty, or contain a segment that could climb out of the
 * virtual project root.
 */
export function normalizeProjectPath(path: string): string {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    normalized.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid project-relative path: ${path}`);
  }
  return segments.join("/");
}

export function mapProjectFiles(
  files: readonly Pick<ProjectFile, "path" | "content">[]
): VirtualProjectFile[] {
  const seen = new Set<string>();
  return files.map((file) => {
    const relativePath = normalizeProjectPath(file.path);
    if (seen.has(relativePath)) {
      throw new Error(`Duplicate project path: ${relativePath}`);
    }
    seen.add(relativePath);
    return {
      relativePath,
      virtualPath: `${VIRTUAL_PROJECT_ROOT}/${relativePath}`,
      content: file.content
    };
  });
}
