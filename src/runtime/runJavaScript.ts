import type { ProjectFile } from "../projects/models";
import type {
  JavaScriptExecutionHooks,
  JavaScriptExecutionResult,
  JavaScriptExecutor,
  ScriptLanguage
} from "./JavaScriptRuntime";

export type JavaScriptRunOutcome = "success" | "error" | "unsupported";

export function canRunJavaScript(file: ProjectFile | undefined): boolean {
  return file?.language === "javascript" && /\.m?js$/i.test(file.path);
}

/**
 * `.cts` and `.tsx` are excluded on purpose. `.cts` is CommonJS, which the
 * Worker's ES-module execution cannot run, and `.tsx` needs the JSX transform
 * and a React-shaped runtime that Altitude does not ship. This mirrors how
 * `.cjs` is already excluded from the JavaScript path.
 */
export function canRunTypeScript(file: ProjectFile | undefined): boolean {
  return file?.language === "typescript" && /\.m?ts$/i.test(file.path);
}

export function canRunScript(file: ProjectFile | undefined): boolean {
  return canRunJavaScript(file) || canRunTypeScript(file);
}

export function scriptLanguageOf(file: ProjectFile | undefined): ScriptLanguage | undefined {
  if (canRunTypeScript(file)) {
    return "typescript";
  }
  return canRunJavaScript(file) ? "javascript" : undefined;
}

/**
 * TypeScript and JavaScript share this one entry point because they share one
 * execution path: the Worker strips types when it has to and then runs the
 * result. Nothing here branches on language beyond naming it in the request.
 */
export async function runActiveScript(
  runtime: JavaScriptExecutor,
  activeFile: ProjectFile,
  beforeRun: () => Promise<void>,
  hooks: JavaScriptExecutionHooks
): Promise<{ outcome: JavaScriptRunOutcome; result?: JavaScriptExecutionResult }> {
  const language = scriptLanguageOf(activeFile);
  if (!language) {
    return { outcome: "unsupported" };
  }

  await beforeRun();
  const result = await runtime.execute(
    {
      entryPath: activeFile.path,
      source: activeFile.content,
      language
    },
    hooks
  );
  return { outcome: result.ok ? "success" : "error", result };
}
