import { describe, expect, it } from "vitest";
import { createProject, type Project } from "./models";
import {
  formatFileCount,
  formatProjectCount,
  formatRelativeTime,
  summarizeProject,
  summarizeProjects
} from "./projectSummary";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);

function projectAt(name: string, updatedAt: number, fileCount = 1): Project {
  const project = createProject(name);
  project.updatedAt = updatedAt;
  while (project.files.length < fileCount) {
    project.files.push({ ...project.files[0]!, id: `file-${project.files.length}` });
  }
  return project;
}

describe("counts", () => {
  it("uses the singular for one, so a lone project does not read as a bug", () => {
    expect(formatProjectCount(1)).toBe("1 project");
    expect(formatFileCount(1)).toBe("1 file");
  });

  it("pluralizes everything else", () => {
    expect(formatProjectCount(0)).toBe("0 projects");
    expect(formatProjectCount(4)).toBe("4 projects");
    expect(formatFileCount(12)).toBe("12 files");
  });
});

describe("formatRelativeTime", () => {
  it.each([
    [0, "just now"],
    [30_000, "just now"],
    [MINUTE, "1 minute ago"],
    [5 * MINUTE, "5 minutes ago"],
    [HOUR, "1 hour ago"],
    [3 * HOUR, "3 hours ago"],
    [DAY, "yesterday"],
    [2 * DAY, "2 days ago"],
    [6 * DAY, "6 days ago"]
  ])("renders an age of %i ms as %s", (elapsed, expected) => {
    expect(formatRelativeTime(NOW - elapsed, NOW)).toBe(expected);
  });

  it("falls back to a date once relative wording stops helping", () => {
    const rendered = formatRelativeTime(NOW - 30 * DAY, NOW);
    expect(rendered).not.toContain("ago");
    expect(rendered).toContain("2026");
  });

  it("treats a clock that has moved backwards as just now rather than negative", () => {
    expect(formatRelativeTime(NOW + 5 * MINUTE, NOW)).toBe("just now");
    expect(formatRelativeTime(Number.NaN, NOW)).toBe("just now");
  });
});

describe("summarizeProject", () => {
  it("describes a project in one line and marks the open one", () => {
    const project = projectAt("Alpha", NOW - 2 * HOUR, 3);

    expect(summarizeProject(project, project.id, NOW)).toEqual({
      id: project.id,
      name: "Alpha",
      detail: "3 files · 2 hours ago",
      isCurrent: true
    });
  });

  it("marks a project that is not open", () => {
    const project = projectAt("Beta", NOW);
    expect(summarizeProject(project, "another-id", NOW).isCurrent).toBe(false);
  });
});

describe("summarizeProjects", () => {
  it("orders by most recently edited, not by name or by which is open", () => {
    const oldest = projectAt("Aaa oldest", NOW - 5 * DAY);
    const newest = projectAt("Zzz newest", NOW - MINUTE);
    const middle = projectAt("Mmm middle", NOW - 2 * HOUR);

    const summaries = summarizeProjects([oldest, newest, middle], oldest.id, NOW);

    expect(summaries.map((summary) => summary.name)).toEqual([
      "Zzz newest",
      "Mmm middle",
      "Aaa oldest"
    ]);
    // The open project keeps its place in the order rather than jumping to the top.
    expect(summaries[2]?.isCurrent).toBe(true);
  });

  it("does not mutate the array it was given", () => {
    const first = projectAt("First", NOW - DAY);
    const second = projectAt("Second", NOW);
    const projects = [first, second];

    summarizeProjects(projects, first.id, NOW);

    expect(projects[0]).toBe(first);
  });

  it("marks exactly one project as current", () => {
    const projects = [projectAt("A", NOW), projectAt("B", NOW - HOUR), projectAt("C", NOW - DAY)];

    const summaries = summarizeProjects(projects, projects[1]!.id, NOW);

    expect(summaries.filter((summary) => summary.isCurrent)).toHaveLength(1);
  });
});
