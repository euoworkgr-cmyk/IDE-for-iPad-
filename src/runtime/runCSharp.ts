import type { Project, ProjectFile } from "../projects/models";
import type {
  CSharpExecutionHooks,
  CSharpExecutionResult,
  CSharpExecutor
} from "./CSharpRuntime";

export type CSharpRunOutcome = "success" | "error" | "stopped" | "unsupported";

export function canRunCSharp(file: ProjectFile | undefined): boolean {
  return file?.language === "csharp" && /\.cs$/i.test(file.path);
}

function cSharpRunOutcome(result: CSharpExecutionResult): CSharpRunOutcome {
  if (result.stopped) {
    return "stopped";
  }
  return result.ok ? "success" : "error";
}

/**
 * Single file, unlike PHP and Python. C#'s multi-file story is a project
 * system — `.csproj`, assembly references, namespaces across files — and that
 * is a feature of its own rather than something to approximate by throwing
 * every `.cs` in the project at one compilation. The `project` argument is
 * accepted so the signature matches the other runtimes and so multi-file has
 * somewhere to go later.
 */
export async function runActiveCSharp(
  runtime: CSharpExecutor,
  _project: Project,
  activeFile: ProjectFile,
  beforeRun: () => Promise<void>,
  hooks: CSharpExecutionHooks
): Promise<{ outcome: CSharpRunOutcome; result?: CSharpExecutionResult }> {
  if (!canRunCSharp(activeFile)) {
    return { outcome: "unsupported" };
  }

  await beforeRun();
  const result = await runtime.execute(
    { entryPath: activeFile.path, source: activeFile.content },
    hooks
  );
  return { outcome: cSharpRunOutcome(result), result };
}
