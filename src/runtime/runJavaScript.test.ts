import { describe, expect, it, vi } from "vitest";
import { createFile } from "../projects/models";
import type {
  JavaScriptExecutionHooks,
  JavaScriptExecutor
} from "./JavaScriptRuntime";
import {
  canRunJavaScript,
  canRunScript,
  canRunTypeScript,
  runActiveScript,
  scriptLanguageOf
} from "./runJavaScript";

function hooks(): JavaScriptExecutionHooks {
  return {
    onStatus: () => undefined,
    onStdout: () => undefined,
    onStderr: () => undefined
  };
}

describe("runActiveScript", () => {
  it("supports only .js and .mjs JavaScript files", () => {
    expect(canRunJavaScript(createFile("main.js"))).toBe(true);
    expect(canRunJavaScript(createFile("module.mjs"))).toBe(true);
    expect(canRunJavaScript(createFile("common.cjs"))).toBe(false);
    expect(canRunJavaScript(createFile("main.ts"))).toBe(false);
  });

  it("supports only .ts and .mts TypeScript files", () => {
    expect(canRunTypeScript(createFile("main.ts"))).toBe(true);
    expect(canRunTypeScript(createFile("module.mts"))).toBe(true);
    expect(canRunTypeScript(createFile("common.cts"))).toBe(false);
    expect(canRunTypeScript(createFile("view.tsx"))).toBe(false);
    expect(canRunTypeScript(createFile("main.js"))).toBe(false);
  });

  it("reports the runnable script languages", () => {
    expect(canRunScript(createFile("main.ts"))).toBe(true);
    expect(canRunScript(createFile("main.js"))).toBe(true);
    expect(canRunScript(createFile("main.py"))).toBe(false);
    expect(scriptLanguageOf(createFile("main.ts"))).toBe("typescript");
    expect(scriptLanguageOf(createFile("main.js"))).toBe("javascript");
    expect(scriptLanguageOf(createFile("main.py"))).toBeUndefined();
  });

  it("flushes current editor state and passes only the active file", async () => {
    const activeFile = createFile("src/main.js", "console.log('current')");
    const order: string[] = [];
    const runtime: JavaScriptExecutor = {
      stop: () => undefined,
      execute: async (request, output) => {
        order.push("execute");
        expect(request).toEqual({
          entryPath: "src/main.js",
          source: "console.log('current')",
          language: "javascript"
        });
        output.onStdout("current\n");
        return { ok: true };
      }
    };

    const result = await runActiveScript(
      runtime,
      activeFile,
      async () => {
        order.push("flush");
      },
      hooks()
    );

    expect(order).toEqual(["flush", "execute"]);
    expect(result).toEqual({ outcome: "success", result: { ok: true } });
  });

  it("routes TypeScript through the same executor, tagged as TypeScript", async () => {
    const activeFile = createFile("src/main.ts", "const n: number = 1;");
    const runtime: JavaScriptExecutor = {
      stop: () => undefined,
      execute: async (request) => {
        expect(request).toEqual({
          entryPath: "src/main.ts",
          source: "const n: number = 1;",
          language: "typescript"
        });
        return { ok: true };
      }
    };

    await expect(runActiveScript(runtime, activeFile, async () => undefined, hooks())).resolves.toEqual({
      outcome: "success",
      result: { ok: true }
    });
  });

  it("does not execute unsupported files", async () => {
    const execute = vi.fn();
    const runtime: JavaScriptExecutor = { execute, stop: () => undefined };

    await expect(
      runActiveScript(runtime, createFile("main.py"), vi.fn(), hooks())
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("script run outcomes", () => {
  it("reports a stopped run as stopped rather than as an error", async () => {
    const file = createFile("main.js", "while (true) {}");
    const runtime: JavaScriptExecutor = {
      execute: () => Promise.resolve({ ok: false, stopped: true }),
      stop: () => undefined
    };

    const result = await runActiveScript(runtime, file, vi.fn(), hooks());
    expect(result.outcome).toBe("stopped");
  });
});

