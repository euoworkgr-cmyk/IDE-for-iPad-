import { describe, expect, it, vi } from "vitest";
import { createFile } from "../projects/models";
import type {
  JavaScriptExecutionHooks,
  JavaScriptExecutor
} from "./JavaScriptRuntime";
import { canRunJavaScript, runActiveJavaScript } from "./runJavaScript";

function hooks(): JavaScriptExecutionHooks {
  return {
    onStatus: () => undefined,
    onStdout: () => undefined,
    onStderr: () => undefined
  };
}

describe("runActiveJavaScript", () => {
  it("supports only .js and .mjs JavaScript files", () => {
    expect(canRunJavaScript(createFile("main.js"))).toBe(true);
    expect(canRunJavaScript(createFile("module.mjs"))).toBe(true);
    expect(canRunJavaScript(createFile("common.cjs"))).toBe(false);
    expect(canRunJavaScript(createFile("main.ts"))).toBe(false);
  });

  it("flushes current editor state and passes only the active file", async () => {
    const activeFile = createFile("src/main.js", "console.log('current')");
    const order: string[] = [];
    const runtime: JavaScriptExecutor = {
      execute: async (request, output) => {
        order.push("execute");
        expect(request).toEqual({
          entryPath: "src/main.js",
          source: "console.log('current')"
        });
        output.onStdout("current\n");
        return { ok: true };
      }
    };

    const result = await runActiveJavaScript(
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

  it("does not execute unsupported files", async () => {
    const execute = vi.fn();
    const runtime: JavaScriptExecutor = { execute };

    await expect(
      runActiveJavaScript(runtime, createFile("main.ts"), vi.fn(), hooks())
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(execute).not.toHaveBeenCalled();
  });
});
