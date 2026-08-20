import { strToU8, zipSync } from "fflate";
import type { Project, ProjectFile } from "../projects/models";

export interface Download {
  fileName: string;
  mimeType: string;
  // Pinned to ArrayBuffer rather than ArrayBufferLike: a Blob part cannot be
  // backed by a SharedArrayBuffer, which the looser type allows.
  bytes: Uint8Array<ArrayBuffer>;
}

function safePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function safeArchiveName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "project";
}

/**
 * The file's own name without the folders it sits in. A single file is saved
 * as itself, so `src/utils/math.py` arrives as `math.py` rather than dragging
 * an empty folder tree along with it.
 */
export function exportFileName(path: string): string {
  const safe = safePath(path);
  const name = safe.slice(safe.lastIndexOf("/") + 1);
  return name || "file.txt";
}

export function buildProjectArchive(project: Project): Download {
  const entries: Record<string, Uint8Array> = {};
  for (const file of project.files) {
    const path = safePath(file.path);
    if (path) {
      entries[path] = strToU8(file.content);
    }
  }

  return {
    fileName: `${safeArchiveName(project.name)}.zip`,
    mimeType: "application/zip",
    bytes: zipSync(entries, { level: 6 })
  };
}

/**
 * One file, saved as itself rather than wrapped in an archive: unpacking a zip
 * to reach a single file is work the user did not ask for, and iPadOS Files
 * makes it more work than it is on a desktop.
 */
export function buildFileDownload(file: Pick<ProjectFile, "path" | "content">): Download {
  return {
    fileName: exportFileName(file.path),
    // Deliberately not a per-language type: text/plain is what every browser
    // agrees to save rather than try to display or run.
    mimeType: "text/plain;charset=utf-8",
    bytes: strToU8(file.content)
  };
}

export function saveDownload(download: Download): void {
  const blob = new Blob([download.bytes], { type: download.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = download.fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function exportProject(project: Project): void {
  saveDownload(buildProjectArchive(project));
}

export function exportFile(file: Pick<ProjectFile, "path" | "content">): void {
  saveDownload(buildFileDownload(file));
}
