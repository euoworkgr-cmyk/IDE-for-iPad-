import { describe, expect, it } from "vitest";
import { TypeScriptCompileError, transpileTypeScript } from "./typescriptTranspile";

type AsyncFunctionConstructor = new (body: string) => () => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async () => undefined)
  .constructor as AsyncFunctionConstructor;

/**
 * The point of L5 is that stripped TypeScript runs on the existing JavaScript
 * path, so these assert on what the code *does* once executed, not on the exact
 * JavaScript the transpiler happens to emit.
 */
async function runStripped(source: string): Promise<string[]> {
  const logged: string[] = [];
  const code = transpileTypeScript(source, "main.ts");
  const body = `return (async () => { ${code}\n })();`;
  const originalLog = console.log;
  console.log = (...values: unknown[]) => {
    logged.push(values.map(String).join(" "));
  };
  try {
    await new AsyncFunction(`const console = { log: globalThis.console.log }; ${body}`)();
  } finally {
    console.log = originalLog;
  }
  return logged;
}

describe("transpileTypeScript", () => {
  it("strips annotations, interfaces and type aliases", async () => {
    await expect(
      runStripped(
        [
          "interface Point { x: number; y: number }",
          "type Label = string | null;",
          "function describe(point: Point, label: Label): string {",
          "  return `${label ?? 'point'} ${point.x},${point.y}`;",
          "}",
          "const origin: Point = { x: 0, y: 0 };",
          "console.log(describe(origin, null));"
        ].join("\n")
      )
    ).resolves.toEqual(["point 0,0"]);
  });

  it("handles generics, assertions and non-null assertions", async () => {
    await expect(
      runStripped(
        [
          "function identity<T>(value: T): T { return value; }",
          "const raw: unknown = 'ok';",
          "const text = raw as string;",
          "const maybe: string | undefined = text;",
          "console.log(identity<string>(text), maybe!.length);"
        ].join("\n")
      )
    ).resolves.toEqual(["ok 2"]);
  });

  it("compiles enums and constructor parameter properties, which are not erasable", async () => {
    await expect(
      runStripped(
        [
          "enum Level { Low = 1, High }",
          "class Counter {",
          "  constructor(private readonly start: number) {}",
          "  next(): number { return this.start + 1; }",
          "}",
          "console.log(Level.High, new Counter(41).next());"
        ].join("\n")
      )
    ).resolves.toEqual(["2 42"]);
  });

  it("drops type-only imports rather than trying to resolve them", async () => {
    const code = transpileTypeScript(
      'import type { Missing } from "./nowhere";\nconst value: Missing | number = 1;\nexport {};',
      "main.ts"
    );
    expect(code).not.toContain("./nowhere");
  });

  it("keeps line numbers, so a runtime stack still points at the user's line", () => {
    const code = transpileTypeScript(
      ["const a: number = 1;", "", "interface Unused { z: string }", "", "const b: string = 'x';"].join("\n"),
      "main.ts"
    );
    expect(code.split("\n").length).toBe(5);
    expect(code.split("\n")[4]).toContain("const b = 'x'");
  });

  it("reports a syntax error as a compile error naming the file", () => {
    expect(() => transpileTypeScript("const x: = ;", "src/broken.ts")).toThrow(TypeScriptCompileError);
    expect(() => transpileTypeScript("const x: = ;", "src/broken.ts")).toThrow(/src\/broken\.ts/);
  });

  it("names the file once, not twice", () => {
    // Sucrase's own message already begins "Error transforming <file>:", which
    // read as "broken.ts: Error transforming broken.ts: ..." once the console
    // started showing this as the headline of a failure.
    let message = "";
    try {
      transpileTypeScript("const x: = ;", "broken.ts");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("broken.ts: Unexpected token (1:10)");
    expect(message).not.toMatch(/transforming/i);
  });

  it("does not type check, so a type error still runs", async () => {
    await expect(runStripped('const n: number = "not a number" as never;\nconsole.log(typeof n);')).resolves.toEqual([
      "string"
    ]);
  });
});
