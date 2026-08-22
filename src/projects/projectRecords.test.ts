import { describe, expect, it } from "vitest";
import { createProject } from "./models";
import { normalizeStoredFile, normalizeStoredProject, normalizeStoredProjects } from "./projectRecords";

describe("normalizeStoredProject", () => {
  it("passes a well-formed record through unchanged", () => {
    const project = createProject("Round trip");
    expect(normalizeStoredProject(structuredClone(project))).toEqual(project);
  });

  // This is the case that used to take the whole app down: listProjects() cast
  // straight to Project[], and the first property access threw.
  it("survives a record with no files array", () => {
    const normalized = normalizeStoredProject({ id: "p1", name: "Half written" });
    expect(normalized).toEqual({
      id: "p1",
      name: "Half written",
      files: [],
      activeFileId: "",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number)
    });
  });

  it("drops only the unreadable files, keeping the rest of the project", () => {
    const normalized = normalizeStoredProject({
      id: "p1",
      name: "Mixed",
      activeFileId: "f1",
      files: [
        { id: "f1", path: "main.py", content: "print(1)", createdAt: 1, updatedAt: 2 },
        { id: "f2", path: "broken.py" },
        null,
        "not a file"
      ]
    });
    expect(normalized?.files).toHaveLength(1);
    expect(normalized?.files[0]?.path).toBe("main.py");
    expect(normalized?.activeFileId).toBe("f1");
  });

  it("re-derives a missing or stale language from the path", () => {
    const file = normalizeStoredFile(
      { id: "f1", path: "query.sql", content: "select 1", language: "text" },
      0
    );
    expect(file?.language).toBe("sql");
  });

  // An active file that is no longer in the list would leave the editor
  // pointing at nothing.
  it("repoints an active file that is no longer there", () => {
    const normalized = normalizeStoredProject({
      id: "p1",
      name: "Stale pointer",
      activeFileId: "gone",
      files: [{ id: "f1", path: "main.py", content: "" }]
    });
    expect(normalized?.activeFileId).toBe("f1");
  });

  // Without an identity the record cannot be saved back, switched to or
  // deleted, and inventing one would fork the project on the next write.
  it("refuses a record with no id", () => {
    expect(normalizeStoredProject({ name: "No id", files: [] })).toBeUndefined();
    expect(normalizeStoredProject(null)).toBeUndefined();
    expect(normalizeStoredProject("nonsense")).toBeUndefined();
  });

  it("names a project that lost its name rather than dropping it", () => {
    expect(normalizeStoredProject({ id: "p1", files: [] })?.name).toBe("Untitled project");
  });
});

describe("normalizeStoredProjects", () => {
  it("counts what it had to discard so the user can be told", () => {
    const good = createProject("Readable");
    const result = normalizeStoredProjects([good, { name: "no id" }, undefined, 42]);
    expect(result.projects).toHaveLength(1);
    expect(result.discarded).toBe(3);
  });

  it("reports nothing when every record was already sound", () => {
    const result = normalizeStoredProjects([createProject("A"), createProject("B")]);
    expect(result.discarded).toBe(0);
    expect(result.repaired).toBe(false);
  });

  it("notices that a record had to be repaired", () => {
    const result = normalizeStoredProjects([{ id: "p1", name: "Half written" }]);
    expect(result.discarded).toBe(0);
    expect(result.repaired).toBe(true);
  });
});
