import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createFile, createProject } from "../projects/models";
import {
  buildFileDownload,
  buildProjectArchive,
  exportFileName
} from "./exportProject";

function archiveEntries(project: Parameters<typeof buildProjectArchive>[0]) {
  const archive = buildProjectArchive(project);
  const unpacked = unzipSync(archive.bytes);
  return Object.fromEntries(
    Object.entries(unpacked).map(([path, bytes]) => [path, strFromU8(bytes)])
  );
}

describe("exporting the whole project", () => {
  it("packs every file, keeping the folder structure", () => {
    const project = createProject("Sensor logger");
    project.files = [
      createFile("main.py", "print(1)"),
      createFile("utils/math.py", "def add(a, b): return a + b")
    ];

    expect(archiveEntries(project)).toEqual({
      "main.py": "print(1)",
      "utils/math.py": "def add(a, b): return a + b"
    });
  });

  it("names the archive after the project, without characters a filesystem rejects", () => {
    const project = createProject('Logger: v2 <draft>/notes');
    expect(buildProjectArchive(project).fileName).toBe("Logger- v2 -draft--notes.zip");
  });

  it("falls back to a usable name when nothing of the project name survives", () => {
    expect(buildProjectArchive(createProject("   ")).fileName).toBe("project.zip");
    // Separators become dashes rather than vanishing, so this keeps a name.
    expect(buildProjectArchive(createProject("///")).fileName).toBe("---.zip");
  });

  it("drops path segments that could escape the archive root", () => {
    const project = createProject("Escapes");
    project.files = [createFile("../../etc/passwd", "root")];

    expect(Object.keys(archiveEntries(project))).toEqual(["etc/passwd"]);
  });

  it("produces a valid empty archive for a project with no files", () => {
    const project = createProject("Empty");
    project.files = [];

    expect(archiveEntries(project)).toEqual({});
  });
});

describe("exporting one file", () => {
  it("saves the file as itself, not wrapped in an archive", () => {
    const download = buildFileDownload({ path: "main.py", content: "print('hi')" });

    expect(download.fileName).toBe("main.py");
    expect(download.mimeType).toBe("text/plain;charset=utf-8");
    expect(strFromU8(download.bytes)).toBe("print('hi')");
  });

  it("drops the folders a nested file sits in", () => {
    expect(exportFileName("src/utils/math.py")).toBe("math.py");
    expect(exportFileName("main.py")).toBe("main.py");
  });

  it("does not let a path escape into a name of its own", () => {
    expect(exportFileName("../../secret.py")).toBe("secret.py");
    expect(exportFileName("/absolute.py")).toBe("absolute.py");
  });

  it("still yields a name when the path is nothing usable", () => {
    expect(exportFileName("///")).toBe("file.txt");
  });

  it("preserves Unicode content exactly", () => {
    const sample = "print('Grüße 日本語 🚀')";
    expect(strFromU8(buildFileDownload({ path: "u.py", content: sample }).bytes)).toBe(sample);
  });
});
