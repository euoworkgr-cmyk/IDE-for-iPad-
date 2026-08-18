import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadPyodide, type PyodideAPI } from "pyodide";
import { configureLineStdin } from "./PythonRuntime";

let pyodide: PyodideAPI;

beforeAll(async () => {
  const indexURL = decodeURIComponent(new URL("../../public/pyodide/", import.meta.url).pathname);
  pyodide = await loadPyodide({
    indexURL,
    packageBaseUrl: indexURL,
    cdnUrl: indexURL,
    stdout: () => undefined,
    stderr: () => undefined
  });
});

async function runWithAnswers(code: string, answers: Array<string | null>) {
  const stdout: string[] = [];
  const readInput = vi.fn(() => answers.shift() ?? null);
  pyodide.setStdout({ batched: (output) => stdout.push(output) });
  pyodide.setStderr({ batched: () => undefined });
  configureLineStdin(pyodide, readInput);
  await pyodide.runPythonAsync(code);
  return { stdout: stdout.join("\n"), readInput };
}

describe.sequential("Python line stdin regression", () => {
  it("uses Pyodide line mode instead of disabling autoEOF", () => {
    const setStdin = vi.fn();
    configureLineStdin({ setStdin } as Pick<PyodideAPI, "setStdin">, () => "Alice");

    expect(setStdin).toHaveBeenCalledTimes(1);
    const options = setStdin.mock.calls[0]?.[0];
    expect(options).toMatchObject({ stdin: expect.any(Function), isatty: false });
    expect(options).not.toHaveProperty("autoEOF");
  });

  it("calls stdin once for one input", async () => {
    const result = await runWithAnswers('name = input("Name: ")\nprint(name)', ["Alice"]);

    expect(result.readInput).toHaveBeenCalledTimes(1);
    expect(result.stdout).toContain("Alice");
  });

  it("calls stdin exactly three times for three inputs", async () => {
    const result = await runWithAnswers(
      'a = input("A: ")\nb = input("B: ")\nc = input("C: ")\nprint(a, b, c)',
      ["1", "2", "3"]
    );

    expect(result.readInput).toHaveBeenCalledTimes(3);
    expect(result.stdout).toContain("1 2 3");
  });

  it("supports consecutive int(input()) calls", async () => {
    const result = await runWithAnswers(
      'a = int(input("A: "))\nb = int(input("B: "))\nprint(a + b)',
      ["10", "20"]
    );

    expect(result.readInput).toHaveBeenCalledTimes(2);
    expect(result.stdout).toContain("30");
  });

  it("maps Cancel to one empty input line without retrying", async () => {
    const result = await runWithAnswers('value = input("Value: ")\nprint(f"[{value}]")', [null]);

    expect(result.readInput).toHaveBeenCalledTimes(1);
    expect(result.stdout).toContain("[]");
  });

  it("preserves Unicode input", async () => {
    const result = await runWithAnswers('value = input("Text: ")\nprint(value)', ["Привет"]);

    expect(result.readInput).toHaveBeenCalledTimes(1);
    expect(result.stdout).toContain("Привет");
  });

  it("runs the real calculator flow with exactly three input lines", async () => {
    const result = await runWithAnswers(
      `print("Калькулятор")
a = int(input("Введите первое число: "))
b = int(input("Введите второе число: "))
choice = input("Введите операцию (+, -, *, /): ")
if choice == "+":
    print(a + b)
elif choice == "-":
    print(a - b)
elif choice == "*":
    print(a * b)
elif choice == "/":
    print(a / b)`,
      ["10", "20", "+"]
    );

    expect(result.readInput).toHaveBeenCalledTimes(3);
    expect(result.stdout).toContain("Калькулятор");
    expect(result.stdout).toContain("30");
  });
});
