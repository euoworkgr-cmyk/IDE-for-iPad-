import type { ProjectFile } from "../projects/models";
import type {
  JavaScriptExecutionHooks,
  JavaScriptExecutionResult,
  JavaScriptExecutor
} from "./JavaScriptRuntime";

export type JavaScriptRunOutcome = "success" | "error" | "unsupported";

export function canRunJavaScript(file: ProjectFile | undefined): boolean {
  return file?.language === "javascript" && /\.m?js$/i.test(file.path);
}

export async function runActiveJavaScript(
  runtime: JavaScriptExecutor,
  activeFile: ProjectFile,
  beforeRun: () => Promise<void>,
  hooks: JavaScriptExecutionHooks
): Promise<{ outcome: JavaScriptRunOutcome; result?: JavaScriptExecutionResult }> {
  if (!canRunJavaScript(activeFile)) {
    return { outcome: "unsupported" };
  }

  await beforeRun();
  const result = await runtime.execute(
    {
      entryPath: activeFile.path,
      source: activeFile.content
    },
    hooks
  );
  return { outcome: result.ok ? "success" : "error", result };
}
