import { transform } from "sucrase";

/**
 * TypeScript execution (L5) is type stripping plus the JavaScript Worker that
 * already exists — there is deliberately no second execution path. This module
 * is the strip step and nothing else.
 *
 * Sucrase was chosen over the full `typescript` package after measuring both:
 * see `reports/TypeScript execution - transpiler spike.md`. It does no type
 * checking, which is the right trade here — a run must not be blocked by a type
 * error, and Altitude has no type-checking UI to report one in.
 *
 * The module is imported dynamically from the Worker so its weight lands in a
 * chunk that only a TypeScript run pulls in.
 */
export class TypeScriptCompileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TypeScriptCompileError";
  }
}

/**
 * Sucrase reports syntax errors with its own internal file name and a trailing
 * position; rewrite the message so it names the file the user is looking at.
 */
function compileErrorMessage(error: unknown, entryPath: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw
    .replace(/^Error:\s*/, "")
    .replace(/^sucrase:\s*/i, "")
    // Sucrase already names the file ("Error transforming main.ts: ..."), so
    // prefixing the path again read as "main.ts: Error transforming main.ts:".
    .replace(/^Error transforming [^:]*:\s*/i, "");
  return `${entryPath}: ${cleaned}`;
}

export function transpileTypeScript(source: string, entryPath: string): string {
  try {
    return transform(source, {
      transforms: ["typescript"],
      // Sucrase rewrites tokens in place and keeps line breaks, so a runtime
      // stack still points at the line the user wrote.
      filePath: entryPath
    }).code;
  } catch (error) {
    throw new TypeScriptCompileError(compileErrorMessage(error, entryPath), { cause: error });
  }
}
