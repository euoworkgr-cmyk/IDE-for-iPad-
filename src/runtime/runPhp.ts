import type { Project, ProjectFile } from "../projects/models";
import type { PhpExecutionHooks, PhpExecutionResult, PhpExecutor } from "./PhpRuntime";

export type PhpRunOutcome = "success" | "error" | "stopped" | "unsupported";

export function canRunPhp(file: ProjectFile | undefined): boolean {
  return file?.language === "php" && /\.(php|phtml)$/i.test(file.path);
}

function phpRunOutcome(result: PhpExecutionResult): PhpRunOutcome {
  if (result.stopped) {
    return "stopped";
  }
  return result.ok ? "success" : "error";
}

/**
 * The whole project is handed over, not just the open file: `require` and
 * `include` of a sibling are ordinary PHP, so the files have to be there. The
 * entry is still the file the user pressed Run on.
 */
export async function runActivePhp(
  runtime: PhpExecutor,
  project: Project,
  activeFile: ProjectFile,
  beforeRun: () => Promise<void>,
  hooks: PhpExecutionHooks
): Promise<{ outcome: PhpRunOutcome; result?: PhpExecutionResult }> {
  if (!canRunPhp(activeFile)) {
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
  return { outcome: phpRunOutcome(result), result };
}
