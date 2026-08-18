import type { Project, ProjectFile } from "../projects/models";
import type {
  PythonExecutionHooks,
  PythonExecutionResult,
  PythonExecutor
} from "./PythonRuntime";

export type PythonRunOutcome = "success" | "error" | "unsupported";

export function canRunPython(file: ProjectFile | undefined): boolean {
  return file?.language === "python";
}

export async function runActivePython(
  runtime: PythonExecutor,
  project: Project,
  activeFile: ProjectFile,
  beforeRun: () => Promise<void>,
  hooks: PythonExecutionHooks
): Promise<{ outcome: PythonRunOutcome; result?: PythonExecutionResult }> {
  if (!canRunPython(activeFile)) {
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
  return { outcome: result.ok ? "success" : "error", result };
}
