import { strToU8, zipSync } from "fflate";
import type { Project } from "../projects/models";

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

export function exportProject(project: Project): void {
  const entries: Record<string, Uint8Array> = {};
  for (const file of project.files) {
    const path = safePath(file.path);
    if (path) {
      entries[path] = strToU8(file.content);
    }
  }

  const archive = zipSync(entries, { level: 6 });
  const blob = new Blob([archive], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeArchiveName(project.name)}.zip`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
