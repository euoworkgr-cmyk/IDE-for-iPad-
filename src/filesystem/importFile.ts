import { createFile, type ProjectFile } from "../projects/models";

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

export const IMPORT_FILE_ACCEPT = [
  ".py",
  ".c",
  ".cc",
  ".cp",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".cs",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".html",
  ".htm",
  ".css",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".txt",
  ".md",
  ".csv",
  "text/*"
].join(",");

export type ImportFileErrorCode = "invalid_name" | "too_large" | "read_failed" | "binary";

export class ImportFileError extends Error {
  constructor(
    readonly code: ImportFileErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ImportFileError";
  }
}

export interface BrowserTextFile {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
}

function importedFileName(name: string): string {
  const normalized = name.trim().replaceAll("\\", "/");
  const filename = normalized.split("/").pop() ?? "";
  if (!filename || filename === "." || filename === "..") {
    throw new ImportFileError("invalid_name", "The selected file does not have a valid filename.");
  }
  return filename;
}

export function uniqueImportedPath(filename: string, existingPaths: readonly string[]): string {
  const existing = new Set(existingPaths.map((path) => path.toLowerCase()));
  if (!existing.has(filename.toLowerCase())) {
    return filename;
  }

  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  let index = 1;
  let candidate = `${stem} (${index})${extension}`;
  while (existing.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${stem} (${index})${extension}`;
  }
  return candidate;
}

function appearsBinary(content: string): boolean {
  const sample = content.slice(0, 16_384);
  if (sample.includes("\0")) {
    return true;
  }

  let suspiciousCharacters = 0;
  for (const character of sample) {
    const code = character.charCodeAt(0);
    if (character === "\uFFFD" || (code < 32 && character !== "\n" && character !== "\r" && character !== "\t")) {
      suspiciousCharacters += 1;
    }
  }
  return sample.length > 0 && suspiciousCharacters / sample.length > 0.05;
}

function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export async function createImportedProjectFile(
  source: BrowserTextFile,
  existingPaths: readonly string[]
): Promise<ProjectFile> {
  const filename = importedFileName(source.name);
  if (source.size > MAX_IMPORT_FILE_BYTES) {
    throw new ImportFileError(
      "too_large",
      `“${filename}” is ${formatMiB(source.size)} MiB. Altitude imports files up to 5 MiB.`
    );
  }

  let content: string;
  try {
    content = await source.text();
  } catch (error) {
    throw new ImportFileError("read_failed", `Altitude could not read “${filename}”.`, { cause: error });
  }

  if (appearsBinary(content)) {
    throw new ImportFileError("binary", `“${filename}” does not appear to be a text file.`);
  }

  return createFile(uniqueImportedPath(filename, existingPaths), content);
}
