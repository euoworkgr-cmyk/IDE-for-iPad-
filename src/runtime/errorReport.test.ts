import { describe, expect, it } from "vitest";
import { parseErrorReport, presentableFrames, type ErrorFrame } from "./errorReport";

function frames(report: ReturnType<typeof parseErrorReport>): ErrorFrame[] {
  return report.body.filter((entry): entry is ErrorFrame => entry.kind === "frame");
}

function texts(report: ReturnType<typeof parseErrorReport>): string[] {
  return report.body.filter((entry) => entry.kind === "text").map((entry) => entry.text);
}

describe("parseErrorReport — Python", () => {
  const traceback = [
    "Traceback (most recent call last):",
    '  File "/home/pyodide/altitude-project/main.py", line 7, in <module>',
    "    print(divide(1, 0))",
    "          ^^^^^^^^^^^^",
    '  File "/home/pyodide/altitude-project/main.py", line 3, in divide',
    "    return a / b",
    "           ~~^~~",
    "ZeroDivisionError: division by zero"
  ].join("\n");

  it("leads with the exception, which Python prints last", () => {
    expect(parseErrorReport(traceback).headline).toBe("ZeroDivisionError: division by zero");
  });

  it("keeps the frames in order and names the function", () => {
    expect(frames(parseErrorReport(traceback)).map((frame) => frame.location)).toEqual([
      "main.py, line 7",
      "main.py, line 3, in divide"
    ]);
  });

  it("attaches the echoed source and its caret line to the frame", () => {
    expect(frames(parseErrorReport(traceback))[1]?.source).toBe("return a / b\n~~^~~");
  });

  it("does not repeat the headline in the body", () => {
    expect(texts(parseErrorReport(traceback))).toEqual([]);
  });

  it("drops only the traceback header, which the view replaces with a label", () => {
    expect(JSON.stringify(parseErrorReport(traceback))).not.toContain("most recent call last");
  });

  it("shows frames using the same paths as the file list", () => {
    const nested = [
      "Traceback (most recent call last):",
      '  File "/home/pyodide/altitude-project/src/main.py", line 1, in <module>',
      "ValueError: nope"
    ].join("\n");
    expect(frames(parseErrorReport(nested))[0]?.location).toBe("src/main.py, line 1");
  });

  it("leaves a stdlib frame's path alone, since the path is what identifies it", () => {
    const stdlib = [
      "Traceback (most recent call last):",
      '  File "/lib/python3.13/json/decoder.py", line 355, in raw_decode',
      "JSONDecodeError: Expecting value"
    ].join("\n");
    expect(frames(parseErrorReport(stdlib))[0]?.location).toBe(
      "/lib/python3.13/json/decoder.py, line 355, in raw_decode"
    );
  });

  it("preserves a chained-exception separator rather than discarding it", () => {
    const chained = [
      "Traceback (most recent call last):",
      '  File "/home/pyodide/altitude-project/main.py", line 2, in <module>',
      "KeyError: 'a'",
      "",
      "During handling of the above exception, another exception occurred:",
      "",
      "Traceback (most recent call last):",
      '  File "/home/pyodide/altitude-project/main.py", line 4, in <module>',
      "RuntimeError: boom"
    ].join("\n");
    const report = parseErrorReport(chained);
    expect(report.headline).toBe("RuntimeError: boom");
    expect(texts(report)).toContain("During handling of the above exception, another exception occurred:");
    expect(texts(report)).toContain("KeyError: 'a'");
  });

  it("keeps Python's own repeated-frame note", () => {
    const recursive = [
      "Traceback (most recent call last):",
      '  File "/home/pyodide/altitude-project/main.py", line 2, in loop',
      "    loop()",
      "  [Previous line repeated 996 more times]",
      "RecursionError: maximum recursion depth exceeded"
    ].join("\n");
    const report = parseErrorReport(recursive);
    expect(report.headline).toBe("RecursionError: maximum recursion depth exceeded");
    expect(JSON.stringify(report)).toContain("Previous line repeated 996 more times");
  });
});

describe("parseErrorReport — JavaScript", () => {
  const stack = [
    "TypeError: Cannot read properties of undefined (reading 'x')",
    "    at foo (main.js:3:15)",
    "    at main.js:6:1"
  ].join("\n");

  it("leads with the exception, which JavaScript prints first", () => {
    expect(parseErrorReport(stack).headline).toBe(
      "TypeError: Cannot read properties of undefined (reading 'x')"
    );
  });

  it("keeps the frames in order", () => {
    expect(frames(parseErrorReport(stack)).map((frame) => frame.location)).toEqual([
      "foo (main.js:3:15)",
      "main.js:6:1"
    ]);
  });
});

describe("parseErrorReport — messages with no stack at all", () => {
  it("treats a compile error as a headline on its own", () => {
    const report = parseErrorReport("src/broken.ts: Unexpected token (1:10)");
    expect(report.headline).toBe("src/broken.ts: Unexpected token (1:10)");
    expect(report.body).toEqual([]);
  });

  it("treats the run time limit message as a headline on its own", () => {
    const message = "Execution stopped: it exceeded the 5 second run time limit. Change the limit in Settings.";
    expect(parseErrorReport(message)).toEqual({ headline: message, body: [] });
  });

  it("never renders an empty headline", () => {
    expect(parseErrorReport("").headline).toBe("Run failed");
    expect(parseErrorReport("   \n  \n").headline).toBe("Run failed");
  });

  it("falls back to the first line when there is nothing but frames", () => {
    const report = parseErrorReport("    at foo (main.js:1:1)");
    expect(report.headline).toBe("at foo (main.js:1:1)");
    expect(frames(report)).toHaveLength(1);
  });
});

describe("parseErrorReport — nothing is lost", () => {
  it("keeps every non-blank line somewhere in the result", () => {
    const raw = [
      "Traceback (most recent call last):",
      '  File "/home/pyodide/altitude-project/main.py", line 7, in <module>',
      "    print(divide(1, 0))",
      "SomeWeirdLineNobodyExpected",
      "ZeroDivisionError: division by zero"
    ].join("\n");
    const report = parseErrorReport(raw);
    const rendered = [report.headline, JSON.stringify(report.body)].join("\n");
    for (const line of ["print(divide(1, 0))", "SomeWeirdLineNobodyExpected", "ZeroDivisionError"]) {
      expect(rendered).toContain(line);
    }
  });

  it("handles Windows line endings", () => {
    const report = parseErrorReport("Error: boom\r\n    at foo (main.js:1:1)\r\n");
    expect(report.headline).toBe("Error: boom");
    expect(frames(report)).toHaveLength(1);
  });
});

describe("presentableFrames — Altitude's own frames are not the user's code", () => {
  const pyodideTraceback = [
    "Traceback (most recent call last):",
    '  File "/lib/python314.zip/_pyodide/_base.py", line 597, in eval_code_async',
    "    await CodeRunner().run_async()",
    '  File "/lib/python314.zip/_pyodide/_base.py", line 411, in run_async',
    "    coroutine = eval(self.code)",
    '  File "<exec>", line 19, in <module>',
    '  File "/home/pyodide/altitude-project/crash.py", line 9, in <module>',
    "    print(compute())",
    '  File "/home/pyodide/altitude-project/crash.py", line 6, in compute',
    "    return divide(1, 0)",
    "ZeroDivisionError: division by zero"
  ].join("\n");

  it("hides the Pyodide harness and the wrapper, keeping only the user's frames", () => {
    expect(presentableFrames(parseErrorReport(pyodideTraceback)).map((f) => f.location)).toEqual([
      "crash.py, line 9",
      "crash.py, line 6, in compute"
    ]);
  });

  it("flags rather than deletes them, so the data still holds everything", () => {
    const all = parseErrorReport(pyodideTraceback).body.filter(
      (entry): entry is ErrorFrame => entry.kind === "frame"
    );
    expect(all).toHaveLength(5);
    expect(all.filter((frame) => frame.internal)).toHaveLength(3);
  });

  it("hides the Worker bundle from a JavaScript stack", () => {
    const stack = [
      "TypeError: undefined is not an object",
      "    at inner (crash.js:3:37)",
      "    at f (http://127.0.0.1:4173/assets/javascriptWorker-1WlJ2H2i.js:1:2584)"
    ].join("\n");
    expect(presentableFrames(parseErrorReport(stack)).map((f) => f.location)).toEqual([
      "inner (crash.js:3:37)"
    ]);
  });

  it("shows internal frames when they are the only ones, so an Altitude bug is not hidden", () => {
    const internalOnly = [
      "RuntimeError: the harness itself broke",
      "    at f (http://127.0.0.1:4173/assets/javascriptWorker-abc.js:1:10)"
    ].join("\n");
    const report = parseErrorReport(internalOnly);
    expect(presentableFrames(report)).toHaveLength(1);
    expect(presentableFrames(report)[0]?.internal).toBe(true);
  });

  it("keeps stdlib frames, which are the user's problem to read", () => {
    const stdlib = [
      "Traceback (most recent call last):",
      '  File "/home/pyodide/altitude-project/main.py", line 2, in <module>',
      '  File "/lib/python314.zip/json/decoder.py", line 355, in raw_decode',
      "JSONDecodeError: Expecting value"
    ].join("\n");
    expect(presentableFrames(parseErrorReport(stdlib)).map((f) => f.location)).toEqual([
      "main.py, line 2",
      "/lib/python314.zip/json/decoder.py, line 355, in raw_decode"
    ]);
  });
});

describe("parseErrorReport — Safari's stack format", () => {
  // JavaScriptCore writes `name@url:line:col`, with no message line, and for
  // Function-constructed code often no location at all. Measured on WebKit.
  it("reads JavaScriptCore frames, which have no 'at' prefix", () => {
    const report = parseErrorReport(
      [
        "TypeError: undefined is not an object (evaluating 'undefined.x')",
        "inner@crash.js:3:37",
        "outer@crash.js:4:27",
        "global code@crash.js:5:1"
      ].join("\n")
    );
    expect(report.headline).toBe("TypeError: undefined is not an object (evaluating 'undefined.x')");
    expect(presentableFrames(report).map((f) => f.location)).toEqual([
      "inner (crash.js:3:37)",
      "outer (crash.js:4:27)",
      "global code (crash.js:5:1)"
    ]);
  });

  it("keeps the function name when Safari gives no location", () => {
    const report = parseErrorReport("TypeError: boom\ninner@\nouter@");
    expect(presentableFrames(report).map((f) => f.location)).toEqual(["inner", "outer"]);
  });

  it("hides frames that carry neither a name nor a place", () => {
    const report = parseErrorReport("TypeError: boom\ninner@\n@\n@");
    expect(presentableFrames(report).map((f) => f.location)).toEqual(["inner"]);
  });

  it("does not mistake an email address in a message for a frame", () => {
    const report = parseErrorReport("Error: could not reach support@example.com right now");
    expect(report.headline).toBe("Error: could not reach support@example.com right now");
    expect(presentableFrames(report)).toEqual([]);
  });
});
