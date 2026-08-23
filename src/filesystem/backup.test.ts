import { describe, expect, it } from "vitest";
import { createFile, createProject } from "../projects/models";
import {
  BACKUP_FORMAT,
  BACKUP_MARKER,
  BackupError,
  backupFileName,
  buildBackup,
  parseBackup,
  reconcileRestoredProjects
} from "./backup";

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("buildBackup", () => {
  it("round-trips every project and its files", () => {
    const first = createProject("First");
    first.files.push(createFile("extra.py", "print('hi')"));
    const second = createProject("Second");

    const restored = parseBackup(decode(buildBackup([first, second], "1.2.3").bytes));

    expect(restored.projects).toHaveLength(2);
    expect(restored.projects[0]?.name).toBe("First");
    expect(restored.projects[0]?.files.map((f) => f.path)).toContain("extra.py");
    expect(restored.projects[0]?.files.find((f) => f.path === "extra.py")?.content).toBe("print('hi')");
    expect(restored.discarded).toBe(0);
  });

  it("stamps the file with a date so backups sort and do not collide", () => {
    expect(backupFileName(new Date(2026, 7, 22))).toBe("altitude-backup-2026-08-22.json");
  });

  it("records what made it", () => {
    const payload = JSON.parse(decode(buildBackup([createProject("A")], "9.9.9").bytes));
    expect(payload.marker).toBe(BACKUP_MARKER);
    expect(payload.format).toBe(BACKUP_FORMAT);
    expect(payload.appVersion).toBe("9.9.9");
  });
});

describe("parseBackup", () => {
  it.each([
    ["not JSON at all", "not_json"],
    ["{}", "not_a_backup"],
    ['{"marker":"something-else"}', "not_a_backup"],
    ['[]', "not_a_backup"]
  ])("refuses %s", (text, code) => {
    expect(() => parseBackup(text)).toThrow(BackupError);
    try {
      parseBackup(text);
    } catch (error) {
      expect((error as BackupError).code).toBe(code);
    }
  });

  // Reading a newer format with older code would silently drop whatever it
  // does not understand, which for a backup is the worst possible failure.
  it("refuses a backup from a newer build rather than guessing", () => {
    const text = JSON.stringify({ marker: BACKUP_MARKER, format: BACKUP_FORMAT + 1, projects: [] });
    expect(() => parseBackup(text)).toThrow(/newer version/);
  });

  it("refuses a backup with nothing readable in it", () => {
    const text = JSON.stringify({ marker: BACKUP_MARKER, format: 1, projects: [{ nope: true }] });
    expect(() => parseBackup(text)).toThrow(/does not contain any projects/);
  });

  it("keeps the readable projects and counts the rest", () => {
    const text = JSON.stringify({
      marker: BACKUP_MARKER,
      format: 1,
      projects: [createProject("Good"), { no: "id" }, 42]
    });
    const restored = parseBackup(text);
    expect(restored.projects).toHaveLength(1);
    expect(restored.discarded).toBe(2);
  });
});

describe("reconcileRestoredProjects", () => {
  // Restoring must never destroy work that is already on the device.
  it("keeps ids that are free, so a clean restore is exact", () => {
    const project = createProject("Only copy");
    const [result] = reconcileRestoredProjects([project], []);
    expect(result?.id).toBe(project.id);
    expect(result?.name).toBe("Only copy");
  });

  it("brings a colliding project in as a marked copy instead of overwriting", () => {
    const existing = createProject("Live work");
    const incoming = { ...createProject("Backed up"), id: existing.id };

    const [result] = reconcileRestoredProjects([incoming], [existing]);

    expect(result?.id).not.toBe(existing.id);
    expect(result?.name).toBe("Backed up (restored)");
  });

  it("does not collide restored copies with each other", () => {
    const existing = createProject("Live");
    const a = { ...createProject("A"), id: existing.id };
    const b = { ...createProject("B"), id: existing.id };
    const result = reconcileRestoredProjects([a, b], [existing]);
    expect(new Set(result.map((p) => p.id)).size).toBe(2);
  });
});
