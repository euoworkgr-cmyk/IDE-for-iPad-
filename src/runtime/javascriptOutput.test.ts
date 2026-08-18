import { describe, expect, it } from "vitest";
import {
  formatJavaScriptConsoleArguments,
  formatJavaScriptError
} from "./javascriptOutput";

describe("JavaScript Worker output formatting", () => {
  it("preserves multi-argument console output", () => {
    expect(formatJavaScriptConsoleArguments(["answer", 42, { ok: true }])).toBe(
      'answer 42 {"ok":true}\n'
    );
  });

  it("formats values that JSON.stringify cannot normally represent", () => {
    const circular: { self?: unknown; value: bigint } = { value: 7n };
    circular.self = circular;

    expect(formatJavaScriptConsoleArguments([undefined, circular])).toBe(
      'undefined {"value":"7n","self":"[Circular]"}\n'
    );
  });

  it("includes an Error message for uncaught failures", () => {
    expect(formatJavaScriptError(new Error("boom"))).toContain("Error: boom");
  });
});
