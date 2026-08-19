/**
 * Turns a raw traceback or stack into something a console can present (L3).
 *
 * Both runtimes hand failures over as one string: Pyodide gives the Python
 * traceback, the JavaScript Worker gives `error.stack`. Printed verbatim they
 * are a wall of text whose most important line is the hardest to find — Python
 * puts the exception message last, JavaScript puts it first and buries it above
 * the frames.
 *
 * The parser pulls out that headline and splits the rest into frames, so the
 * view can lead with what went wrong and treat "where" as secondary.
 *
 * The one rule that matters: **nothing is ever dropped.** Any line that is not
 * recognised is kept, in order, as a text line. A parser that silently eats
 * output would be worse than no parser at all.
 */

import { VIRTUAL_PROJECT_ROOT } from "./PythonRuntime";

export interface ErrorFrame {
  kind: "frame";
  /** "main.py, line 3, in divide" or "foo (main.js:3:15)" */
  location: string;
  /** The echoed source, plus any caret line Python emits under it. */
  source?: string;
  /**
   * A frame inside Altitude's own machinery rather than the user's code — the
   * Pyodide harness, the wrapper this app compiles user source into, or the
   * JavaScript Worker bundle. Flagged rather than deleted: the view hides
   * these, but if a failure is genuinely inside Altitude they are the only
   * frames there are, and hiding them would leave nothing to report.
   */
  internal?: true;
}

export interface ErrorText {
  kind: "text";
  text: string;
}

export type ErrorLine = ErrorFrame | ErrorText;

export interface ErrorReport {
  /** The line worth reading first: "ZeroDivisionError: division by zero". */
  headline: string;
  /** Everything else, in the order it arrived, with the headline removed. */
  body: ErrorLine[];
}

const PYTHON_FRAME = /^\s*File "(?<file>.*)", line (?<line>\d+)(?:, in (?<name>.*))?\s*$/;
/** Pyodide's own `eval_code_async` harness, and the wrapper Altitude compiles. */
const PYTHON_INTERNAL_FILE = /(?:\/_pyodide\/)|^<exec>$/;
/**
 * User code is compiled with `//# sourceURL=<entry path>`, so its frames carry
 * a bare project path. Anything with a URL scheme is a bundled Altitude file.
 */
const JS_INTERNAL_LOCATION = /[a-z]+:\/\//i;
/**
 * JavaScriptCore writes frames as `name@url:line:column` rather than `at
 * name (url:line:column)`, and for code built with the Function constructor it
 * often has no location at all, leaving bare `inner@` or `@`.
 */
const JSC_FRAME = /^(?<fn>[^@]*)@(?<loc>\S*)$/;
/** JavaScriptCore's names for code that is not inside a named function. */
const JSC_PSEUDO_FUNCTION = /^(?:global|eval|module) code$/;
const JS_FRAME = /^\s*at\s+(?<location>\S.*)$/;
const TRACEBACK_HEADER = /^\s*Traceback \(most recent call last\):\s*$/;

/**
 * Project files are mapped under a virtual root before execution, so a
 * traceback names `/home/pyodide/altitude-project/main.py` for what the user
 * knows as `main.py`. Strip that prefix so frames match the file list.
 *
 * Anything outside the project — a stdlib or site-packages frame — keeps its
 * full path, because there the path is the only thing identifying it.
 */
function shortenPythonFile(file: string): string {
  const prefix = `${VIRTUAL_PROJECT_ROOT}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

function pythonFrameLocation(match: RegExpMatchArray): string {
  const groups = match.groups ?? {};
  const file = shortenPythonFile(groups.file ?? "");
  const line = groups.line ?? "";
  const name = groups.name?.trim();
  const where = `${file}, line ${line}`;
  return name && name !== "<module>" ? `${where}, in ${name}` : where;
}

/**
 * A JavaScriptCore frame, or undefined. Guarded so an ordinary sentence that
 * happens to contain "@" — an email address in an error message, say — is not
 * mistaken for a frame: a real frame either has no spaces at all, or names one
 * of JavaScriptCore's pseudo-functions.
 */
function matchJavaScriptCoreFrame(line: string): { fn: string; loc: string } | undefined {
  const trimmed = line.trim();
  const match = trimmed.match(JSC_FRAME);
  if (!match) {
    return undefined;
  }
  const fn = (match.groups?.fn ?? "").trim();
  const loc = match.groups?.loc ?? "";
  if (/\s/.test(trimmed) && !JSC_PSEUDO_FUNCTION.test(fn)) {
    return undefined;
  }
  return { fn, loc };
}

export function parseErrorReport(raw: string): ErrorReport {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  // Trailing blank lines are formatting, not content.
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }

  const body: ErrorLine[] = [];
  let sawPythonFrame = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (TRACEBACK_HEADER.test(line)) {
      // The block is labelled as a failure by the view; this header adds nothing.
      continue;
    }

    const pythonMatch = line.match(PYTHON_FRAME);
    if (pythonMatch) {
      sawPythonFrame = true;
      // Python echoes the offending source under the frame, sometimes with a
      // caret line beneath it. Both belong to this frame.
      const sourceLines: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1]!;
        if (next.trim() === "" || !/^\s/.test(next) || PYTHON_FRAME.test(next)) {
          break;
        }
        sourceLines.push(next.replace(/^\s+/, ""));
        index += 1;
      }
      body.push({
        kind: "frame",
        location: pythonFrameLocation(pythonMatch),
        ...(sourceLines.length > 0 ? { source: sourceLines.join("\n") } : {}),
        ...(PYTHON_INTERNAL_FILE.test(pythonMatch.groups?.file ?? "") ? { internal: true as const } : {})
      });
      continue;
    }

    const jscMatch = matchJavaScriptCoreFrame(line);
    if (jscMatch) {
      const { fn, loc } = jscMatch;
      if (fn === "" && loc === "") {
        // Neither a name nor a place: nothing to tell the user.
        body.push({ kind: "frame", location: "(anonymous)", internal: true });
        continue;
      }
      const location = loc === "" ? fn : fn === "" ? loc : `${fn} (${loc})`;
      body.push({
        kind: "frame",
        location,
        ...(JS_INTERNAL_LOCATION.test(loc) ? { internal: true as const } : {})
      });
      continue;
    }

    const jsMatch = line.match(JS_FRAME);
    if (jsMatch) {
      const location = jsMatch.groups?.location ?? line.trim();
      body.push({
        kind: "frame",
        location,
        ...(JS_INTERNAL_LOCATION.test(location) ? { internal: true as const } : {})
      });
      continue;
    }

    if (line.trim() === "") {
      continue;
    }
    body.push({ kind: "text", text: line.trimEnd() });
  }

  // Python reports the exception last, after the frames; JavaScript reports it
  // first, before them. Pick accordingly, and take the headline out of the body
  // so it is not shown twice.
  const textIndexes = body
    .map((entry, index) => (entry.kind === "text" ? index : -1))
    .filter((index) => index >= 0);

  let headline = "";
  if (textIndexes.length > 0) {
    const chosen = sawPythonFrame ? textIndexes[textIndexes.length - 1]! : textIndexes[0]!;
    headline = (body[chosen] as ErrorText).text.trim();
    body.splice(chosen, 1);
  }

  if (headline === "") {
    // Nothing but frames, or nothing at all. Say something true rather than
    // rendering an empty heading.
    headline = raw.trim() === "" ? "Run failed" : raw.trim().split("\n")[0]!.trim();
  }

  return { headline, body };
}

/**
 * The frames worth showing: the user's own. If a failure happened entirely
 * inside Altitude there are no user frames, and showing the internal ones is
 * far better than showing an empty trace.
 */
export function presentableFrames(report: ErrorReport): ErrorFrame[] {
  const all = report.body.filter((entry): entry is ErrorFrame => entry.kind === "frame");
  const own = all.filter((frame) => !frame.internal);
  return own.length > 0 ? own : all;
}
