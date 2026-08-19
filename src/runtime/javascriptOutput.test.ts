import { describe, expect, it } from "vitest";
import {
  formatJavaScriptConsoleArguments,
  formatJavaScriptError
} from "./javascriptOutput";

const format = (...values: unknown[]): string =>
  formatJavaScriptConsoleArguments(values).trimEnd();

describe("JavaScript Worker output formatting", () => {
  it("preserves multi-argument console output", () => {
    expect(formatJavaScriptConsoleArguments(["answer", 42, { ok: true }])).toBe(
      'answer 42 {"ok":true}\n'
    );
  });

  it("includes an Error message for uncaught failures", () => {
    expect(formatJavaScriptError(new Error("boom"))).toContain("Error: boom");
  });

  describe("non-finite numbers", () => {
    // JSON.stringify turns every one of these into null, which silently
    // reports a numeric error as an absent value.
    it("renders NaN and the infinities rather than null", () => {
      expect(format(NaN)).toBe("NaN");
      expect(format(Infinity)).toBe("Infinity");
      expect(format(-Infinity)).toBe("-Infinity");
    });

    it("renders them inside objects and arrays too", () => {
      expect(format({ x: NaN })).toBe('{"x":NaN}');
      expect(format([1, Infinity])).toBe("[1,Infinity]");
    });

    it("distinguishes negative zero", () => {
      expect(format(-0)).toBe("-0");
      expect(format(0)).toBe("0");
    });
  });

  describe("circularity", () => {
    it("marks a genuine cycle", () => {
      const cycle: Record<string, unknown> = { value: 7n };
      cycle.self = cycle;
      expect(format(cycle)).toBe('{"value":7n,"self":[Circular]}');
    });

    it("marks a cycle through an array", () => {
      const cycle: unknown[] = [];
      cycle.push(cycle);
      expect(format(cycle)).toBe("[[Circular]]");
    });

    it("does NOT mark a value merely referenced twice", () => {
      // A diamond reference is not a cycle. Tracking every object ever seen,
      // instead of only the current path, reports the second reference as
      // circular and hides real data.
      const shared = { a: 1 };
      expect(format({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
      expect(format([shared, shared])).toBe('[{"a":1},{"a":1}]');
    });
  });

  describe("collections", () => {
    it("renders Map and Set instead of empty objects", () => {
      expect(format(new Map([[1, 2]]))).toBe("Map(1) {1 => 2}");
      expect(format(new Set([1, 2]))).toBe("Set(2) {1, 2}");
      expect(format(new Map())).toBe("Map(0) {}");
    });

    it("renders nested values inside collections", () => {
      expect(format(new Map([["k", { a: 1 }]]))).toBe('Map(1) {"k" => {"a":1}}');
    });
  });

  describe("values JSON cannot represent", () => {
    it("keeps undefined properties instead of dropping them", () => {
      expect(format({ a: undefined })).toBe('{"a":undefined}');
    });

    it("renders bigint consistently at top level and nested", () => {
      expect(format(7n)).toBe("7n");
      expect(format({ value: 7n })).toBe('{"value":7n}');
    });

    it("renders functions by name rather than dumping their source", () => {
      expect(format(function named() {})).toBe("[Function: named]");
      expect(format({ fn: () => undefined })).toContain("[Function");
    });

    it("renders dates and regexes readably", () => {
      expect(format(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
      expect(format(new Date(NaN))).toBe("Invalid Date");
      expect(format(/ab+c/gi)).toBe("/ab+c/gi");
    });

    it("quotes nested strings but not top-level ones", () => {
      expect(format("plain")).toBe("plain");
      expect(format({ s: "quoted" })).toBe('{"s":"quoted"}');
    });
  });

  describe("robustness", () => {
    it("survives a getter that throws", () => {
      const hostile = {
        get boom(): unknown {
          throw new Error("nope");
        }
      };
      expect(format(hostile)).toBe('{"boom":[Throws]}');
    });

    it("stops descending at a depth limit rather than recursing forever", () => {
      const deep = { a: { b: { c: { d: { e: 1 } } } } };
      expect(format(deep)).toContain("[Object]");
    });
  });
});

describe("formatJavaScriptError across engines", () => {
  it("uses a V8 stack as-is, since it already leads with the message", () => {
    const error = new TypeError("nope");
    error.stack = "TypeError: nope\n    at foo (main.js:1:1)";
    expect(formatJavaScriptError(error)).toBe("TypeError: nope\n    at foo (main.js:1:1)");
  });

  it("prepends the message to a JavaScriptCore stack, which omits it", () => {
    // Safari reports `error.stack` as frames only. Without this the console
    // showed a stack with nothing saying what actually went wrong.
    const error = new TypeError("undefined is not an object");
    error.stack = "inner@\nouter@";
    expect(formatJavaScriptError(error)).toBe(
      "TypeError: undefined is not an object\ninner@\nouter@"
    );
  });

  it("falls back to the message when there is no stack at all", () => {
    const error = new Error("bare");
    error.stack = "";
    expect(formatJavaScriptError(error)).toBe("Error: bare");
  });

  it("does not render a trailing colon for an error with no message", () => {
    const error = new Error("");
    error.stack = "";
    expect(formatJavaScriptError(error)).toBe("Error");
  });
});
