import type {
  CSharpDiagnostic,
  CSharpWorkerRequest,
  CSharpWorkerResponse
} from "./CSharpRuntime";

/**
 * Hosts the .NET runtime and Roslyn. The engine itself is built from
 * `runtime-csharp/` by CI and downloaded into `public/dotnet/` — see
 * `scripts/copy-dotnet-assets.mjs`.
 *
 * The Worker is created fresh for every run and terminated after, so nothing
 * here is cached between runs on purpose: an 11.62 MiB WebAssembly heap left
 * resident is exactly the kind of thing iPadOS kills a tab over.
 */

/**
 * Assemblies the user's code may compile against. These are the same files the
 * runtime already loaded in order to *execute* the code, handed back to Roslyn
 * as references — which is why C# costs 11.62 MiB rather than that plus a
 * second copy of the framework's public surface.
 *
 * They are pinned as `TrimmerRootAssembly` in the csproj, so the trimmer cannot
 * remove one and leave this list pointing at a file that is not there.
 */
const REFERENCE_ASSEMBLIES = [
  "System.Private.CoreLib.dll",
  "System.Runtime.dll",
  "System.Console.dll",
  "System.Linq.dll",
  "System.Collections.dll"
] as const;

interface CSharpWorkerScope {
  postMessage(message: CSharpWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
}

/** The exports `runtime-csharp/Program.cs` marks with `[JSExport]`. */
interface RunnerExports {
  CSharpRunner: {
    AddReference(image: Uint8Array): string;
    ReferenceCount(): number;
    Compile(source: string, fileName: string): string;
    Run(): string;
  };
}

interface DotnetHost {
  create(): Promise<{
    setModuleImports(name: string, imports: Record<string, unknown>): void;
    getAssemblyExports(assemblyName: string): Promise<RunnerExports>;
    getConfig(): { mainAssemblyName?: string };
  }>;
}

const workerScope = globalThis as unknown as CSharpWorkerScope;
const send = workerScope.postMessage.bind(workerScope);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}

/** Parses the envelope `CompileAndRun` returns, defensively. */
function parseEnvelope(raw: string): {
  diagnostics: CSharpDiagnostic[];
  exitCode: number | null;
  runtimeError: string | null;
} {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The C# runtime returned an unreadable result.");
  }
  const envelope = parsed as {
    diagnostics?: unknown;
    exitCode?: unknown;
    runtimeError?: unknown;
  };
  return {
    diagnostics: Array.isArray(envelope.diagnostics)
      ? (envelope.diagnostics as CSharpDiagnostic[])
      : [],
    exitCode: typeof envelope.exitCode === "number" ? envelope.exitCode : null,
    runtimeError: typeof envelope.runtimeError === "string" ? envelope.runtimeError : null
  };
}

function isExecutionRequest(value: unknown): value is CSharpWorkerRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CSharpWorkerRequest>;
  return (
    candidate.type === "execute" &&
    typeof candidate.executionId === "string" &&
    typeof candidate.entryPath === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.runtimeBaseUrl === "string"
  );
}

async function execute(request: CSharpWorkerRequest): Promise<void> {
  const { executionId } = request;
  const stdout = (chunk: string): void => send({ type: "stdout", executionId, chunk });
  const stderr = (chunk: string): void => send({ type: "stderr", executionId, chunk });
  const fail = (error: string): void => send({ type: "failure", executionId, error });

  let exports: RunnerExports;
  try {
    // Loaded by URL rather than imported, so the bundler leaves the runtime
    // alone — the same reason Pyodide and PHP are loaded this way.
    const { dotnet } = (await import(
      /* @vite-ignore */ `${request.runtimeBaseUrl}_framework/dotnet.js`
    )) as { dotnet: DotnetHost };

    const runtime = await dotnet.create();

    // Console output is pushed from C# as it is written, so a long-running
    // program shows progress and a program cut short by the run time limit
    // still shows what it printed.
    runtime.setModuleImports("runner", {
      console: { stdout, stderr }
    });

    const mainAssemblyName = runtime.getConfig().mainAssemblyName;
    if (!mainAssemblyName) {
      fail("The C# runtime did not report its main assembly.");
      return;
    }
    exports = await runtime.getAssemblyExports(mainAssemblyName);

    for (const name of REFERENCE_ASSEMBLIES) {
      const response = await fetch(`${request.runtimeBaseUrl}_framework/${name}`);
      if (!response.ok) {
        fail(`Could not load the C# reference assembly ${name} (${response.status}).`);
        return;
      }
      const image = new Uint8Array(await response.arrayBuffer());
      const added = exports.CSharpRunner.AddReference(image);
      if (added !== "ok") {
        fail(`Could not read the C# reference assembly ${name}: ${added}`);
        return;
      }
    }
  } catch (error) {
    fail(`The C# runtime failed to start: ${errorMessage(error)}`);
    return;
  }

  send({ type: "status", executionId, status: "compiling" });

  let compiled: ReturnType<typeof parseEnvelope>;
  try {
    compiled = parseEnvelope(exports.CSharpRunner.Compile(request.source, request.entryPath));
  } catch (error) {
    fail(errorMessage(error));
    return;
  }

  const failedToCompile =
    compiled.runtimeError !== null ||
    compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error");

  if (failedToCompile) {
    // Nothing ran, so there is no exit code to report — only why.
    send({
      type: "complete",
      executionId,
      diagnostics: compiled.diagnostics,
      exitCode: null,
      runtimeError: compiled.runtimeError
    });
    return;
  }

  send({ type: "status", executionId, status: "running" });

  let executed: ReturnType<typeof parseEnvelope>;
  try {
    executed = parseEnvelope(exports.CSharpRunner.Run());
  } catch (error) {
    fail(errorMessage(error));
    return;
  }

  send({
    type: "complete",
    executionId,
    // Compilation warnings survive a successful run and are worth showing.
    diagnostics: compiled.diagnostics,
    exitCode: executed.exitCode,
    runtimeError: executed.runtimeError
  });
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isExecutionRequest(event.data)) {
    return;
  }
  void execute(event.data);
});
