import type { Project } from "./models";

/**
 * Display helpers for the project switcher (L1).
 *
 * The switcher's whole job is to say "you have other projects" without being
 * opened, so the counts and timestamps it shows are the feature. They live here
 * as pure functions — `now` is a parameter rather than a call to `Date.now()`
 * so the wording can be tested directly.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function formatProjectCount(count: number): string {
  return plural(count, "project");
}

export function formatFileCount(count: number): string {
  return plural(count, "file");
}

/**
 * Deliberately coarse. The point is "which of these did I touch last", not a
 * precise clock, and a coarse answer stays correct for longer without a timer
 * re-rendering the list.
 */
export function formatRelativeTime(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return "just now";
  }
  if (elapsed < MINUTE) {
    return "just now";
  }
  if (elapsed < HOUR) {
    return `${plural(Math.floor(elapsed / MINUTE), "minute")} ago`;
  }
  if (elapsed < DAY) {
    return `${plural(Math.floor(elapsed / HOUR), "hour")} ago`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days === 1) {
    return "yesterday";
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export interface ProjectSummary {
  id: string;
  name: string;
  /** "3 files · 2 hours ago" — one line, because the row has room for one. */
  detail: string;
  isCurrent: boolean;
}

export function summarizeProject(
  project: Project,
  currentProjectId: string | undefined,
  now: number
): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    detail: `${formatFileCount(project.files.length)} · ${formatRelativeTime(project.updatedAt, now)}`,
    isCurrent: project.id === currentProjectId
  };
}

/**
 * Most recently edited first, matching the order `ProjectRepository` already
 * returns, so the list does not reorder itself for reasons the user cannot see.
 * The current project is not floated to the top: a list whose first row moves
 * as you switch is harder to navigate, not easier.
 */
export function summarizeProjects(
  projects: readonly Project[],
  currentProjectId: string | undefined,
  now: number
): ProjectSummary[] {
  return [...projects]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((project) => summarizeProject(project, currentProjectId, now));
}
