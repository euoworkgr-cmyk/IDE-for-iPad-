import { describe, expect, it, vi } from "vitest";
import { languageFromPath } from "../projects/models";
import {
  createImportedProjectFile,
  MAX_IMPORT_FILE_BYTES,
  uniqueImportedPath
} from "./importFile";

describe("import language detection", () => {
  it.each([
    ["script.py", "python"],
    ["source.c", "c"],
    ["source.cpp", "cpp"],
    ["legacy.cp", "cpp"],
    ["Program.cs", "csharp"],
    ["unknown.custom", "text"]
  ] as const)("maps %s to %s", (path, language) => {
    expect(languageFromPath(path)).toBe(language);
  });
});

describe("createImportedProjectFile", () => {
  it("creates a regular ProjectFile from a browser File", async () => {
    const source = new File(["print('Imported Python works')\n"], "calculator.py", {
      type: "text/x-python"
    });

    const imported = await createImportedProjectFile(source, []);

    expect(imported.path).toBe("calculator.py");
    expect(imported.language).toBe("python");
    expect(imported.content).toBe("print('Imported Python works')\n");
    expect(imported.id).toBeTruthy();
  });

  it("accepts an empty text file", async () => {
    const imported = await createImportedProjectFile(new File([], "empty.txt"), []);
    expect(imported.content).toBe("");
    expect(imported.language).toBe("text");
  });

  it("uses deterministic duplicate filenames without replacing existing files", async () => {
    expect(uniqueImportedPath("main.py", ["main.py"])).toBe("main (1).py");
    expect(uniqueImportedPath("main.py", ["MAIN.PY", "main (1).py"])).toBe("main (2).py");

    const imported = await createImportedProjectFile(new File(["print(2)"], "main.py"), [
      "main.py",
      "main (1).py"
    ]);
    expect(imported.path).toBe("main (2).py");
  });

  it("rejects oversized files before reading them", async () => {
    const text = vi.fn(async () => "not read");
    const oversized = {
      name: "large.py",
      size: MAX_IMPORT_FILE_BYTES + 1,
      text
    };

    await expect(createImportedProjectFile(oversized, [])).rejects.toMatchObject({
      code: "too_large"
    });
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects binary content", async () => {
    await expect(
      createImportedProjectFile(new File(["PNG\0\u0001\u0002"], "image.png"), [])
    ).rejects.toMatchObject({ code: "binary" });
  });

  it("reports file read failures", async () => {
    const unreadable = {
      name: "broken.py",
      size: 12,
      text: vi.fn(async () => {
        throw new DOMException("Read failed", "NotReadableError");
      })
    };

    await expect(createImportedProjectFile(unreadable, [])).rejects.toMatchObject({
      code: "read_failed"
    });
  });
});
