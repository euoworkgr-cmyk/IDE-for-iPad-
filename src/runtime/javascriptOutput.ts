// Console values are formatted inside the Worker, before they cross the
// postMessage boundary, so the main thread only ever receives plain strings.
//
// This deliberately does not use JSON.stringify: JSON has no representation
// for NaN, Infinity, undefined, Map, or Set, and silently turns each of them
// into null or drops them. Console output that quietly rewrites NaN as null is
// worse than no output at all, so the values are walked directly.

const MAX_DEPTH = 4;

export function formatJavaScriptError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || "Error";
    const headline = error.message ? `${name}: ${error.message}` : name;
    const stack = typeof error.stack === "string" ? error.stack.trim() : "";
    if (stack === "") {
      return headline;
    }
    // V8 begins `stack` with "Name: message"; JavaScriptCore begins it with the
    // first frame and drops the message entirely, so a Safari stack would
    // otherwise reach the console with nothing saying what went wrong.
    return stack.startsWith(name) ? stack : `${headline}\n${stack}`;
  }
  return formatValue(error, new Set<object>(), 0, false);
}

export function formatJavaScriptConsoleArguments(values: readonly unknown[]): string {
  const rendered = values.map((value) => formatValue(value, new Set<object>(), 0, false));
  return `${rendered.join(" ")}\n`;
}

function formatNumber(value: number): string {
  // String() already yields NaN, Infinity, and -Infinity correctly; only
  // negative zero needs help, since String(-0) is "0".
  return Object.is(value, -0) ? "-0" : String(value);
}

function formatFunction(value: Function): string {
  return value.name ? `[Function: ${value.name}]` : "[Function (anonymous)]";
}

/**
 * `ancestors` holds only the objects on the current path from the root, and
 * entries are removed on the way back out. A plain "already seen" set would
 * report every repeated reference as circular, which is wrong for a value
 * referenced twice from the same parent.
 */
function formatValue(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  nested: boolean
): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      // Top-level strings print bare, the way a console shows them; nested
      // strings are quoted so structure stays readable.
      return nested ? JSON.stringify(value) : value;
    case "number":
      return formatNumber(value);
    case "bigint":
      return `${value.toString()}n`;
    case "boolean":
      return String(value);
    case "undefined":
      return "undefined";
    case "symbol":
      return String(value);
    case "function":
      return formatFunction(value);
    default:
      break;
  }

  const object = value as object;

  if (ancestors.has(object)) {
    return "[Circular]";
  }
  if (object instanceof Error) {
    return object.stack || `${object.name}: ${object.message}`;
  }
  if (object instanceof Date) {
    return Number.isNaN(object.getTime()) ? "Invalid Date" : object.toISOString();
  }
  if (object instanceof RegExp) {
    return String(object);
  }
  if (depth >= MAX_DEPTH) {
    return Array.isArray(object) ? "[Array]" : "[Object]";
  }

  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      const entries = object.map((entry) => formatValue(entry, ancestors, depth + 1, true));
      return `[${entries.join(",")}]`;
    }
    if (object instanceof Map) {
      const entries = Array.from(object, ([key, entry]) => {
        const renderedKey = formatValue(key, ancestors, depth + 1, true);
        return `${renderedKey} => ${formatValue(entry, ancestors, depth + 1, true)}`;
      });
      return `Map(${object.size}) {${entries.join(", ")}}`;
    }
    if (object instanceof Set) {
      const entries = Array.from(object, (entry) =>
        formatValue(entry, ancestors, depth + 1, true)
      );
      return `Set(${object.size}) {${entries.join(", ")}}`;
    }
    return formatPlainObject(object, ancestors, depth);
  } finally {
    ancestors.delete(object);
  }
}

function formatPlainObject(object: object, ancestors: Set<object>, depth: number): string {
  const entries = Object.keys(object).map((key) => {
    const renderedKey = JSON.stringify(key);
    let entry: unknown;
    try {
      entry = (object as Record<string, unknown>)[key];
    } catch {
      // A getter that throws must not take down the whole run.
      return `${renderedKey}:[Throws]`;
    }
    return `${renderedKey}:${formatValue(entry, ancestors, depth + 1, true)}`;
  });
  return `{${entries.join(",")}}`;
}
