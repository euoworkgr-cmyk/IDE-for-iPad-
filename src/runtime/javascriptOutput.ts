export function formatJavaScriptError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }
  return formatJavaScriptConsoleValue(error);
}

function formatJavaScriptConsoleValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "undefined") {
    return "undefined";
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (value instanceof Error) {
    return formatJavaScriptError(value);
  }

  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (typeof nestedValue === "bigint") {
        return `${nestedValue.toString()}n`;
      }
      if (typeof nestedValue === "symbol" || typeof nestedValue === "function") {
        return String(nestedValue);
      }
      if (nestedValue instanceof Error) {
        return nestedValue.stack || `${nestedValue.name}: ${nestedValue.message}`;
      }
      if (nestedValue && typeof nestedValue === "object") {
        if (seen.has(nestedValue)) {
          return "[Circular]";
        }
        seen.add(nestedValue);
      }
      return nestedValue;
    });
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

export function formatJavaScriptConsoleArguments(values: readonly unknown[]): string {
  return `${values.map((value) => formatJavaScriptConsoleValue(value)).join(" ")}\n`;
}
