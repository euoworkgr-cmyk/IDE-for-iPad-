import type { Project, ProjectFile } from "../projects/models";
import type {
  PreviewExecutionHooks,
  PreviewExecutionResult,
  PreviewExecutor
} from "./PreviewRuntime";

export type PreviewRunOutcome = "success" | "error" | "stopped" | "unsupported";

/**
 * HTML and CSS are the two languages whose Run renders rather than executes.
 * The extension is checked as well as the language id, exactly as the other
 * runtimes do, so a mislabelled file cannot take this path.
 */
export function canRunPreview(file: ProjectFile | undefined): boolean {
  if (!file) {
    return false;
  }
  if (file.language === "html") {
    return /\.(html|htm)$/i.test(file.path);
  }
  return file.language === "css" && /\.css$/i.test(file.path);
}

function previewRunOutcome(result: PreviewExecutionResult): PreviewRunOutcome {
  if (!result.ok) {
    return "error";
  }
  return result.stopped ? "stopped" : "success";
}

/**
 * The whole project goes across, not just the open file: a page's stylesheets
 * and scripts are siblings of it, and the preview inlines them from here.
 */
export async function runActivePreview(
  runtime: PreviewExecutor,
  project: Project,
  activeFile: ProjectFile,
  beforeRun: () => Promise<void>,
  hooks: PreviewExecutionHooks
): Promise<{ outcome: PreviewRunOutcome; result?: PreviewExecutionResult }> {
  if (!canRunPreview(activeFile)) {
    return { outcome: "unsupported" };
  }

  await beforeRun();
  const result = await runtime.execute(
    {
      entryPath: activeFile.path,
      files: project.files.map((file) => ({ path: file.path, content: file.content }))
    },
    hooks
  );
  return { outcome: previewRunOutcome(result), result };
}
