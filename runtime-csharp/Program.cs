using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Loader;
using System.Text;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Emit;

// Nothing runs on load. The Worker drives everything through the [JSExport]
// entry points below, which is what lets this sit inside a Worker with no page
// of its own.
await Task.CompletedTask;

/// <summary>
/// Compiles and runs a single C# file with Roslyn, entirely in the browser.
/// </summary>
public partial class CSharpRunner
{
    private static readonly List<MetadataReference> References = new();

    /// <summary>
    /// Console output is pushed to JS as it is written rather than returned at
    /// the end, so a long-running program shows progress and a program killed
    /// by the run time limit still shows what it managed to print.
    /// </summary>
    [JSImport("console.stdout", "runner")]
    internal static partial void EmitStdout(string text);

    [JSImport("console.stderr", "runner")]
    internal static partial void EmitStderr(string text);

    /// <summary>
    /// Reference assemblies are fetched by the Worker and handed over one at a
    /// time. Doing the fetch on the JS side keeps System.Net.Http out of the
    /// payload and leaves all I/O with the Worker, which is where it belongs.
    /// </summary>
    [JSExport]
    internal static string AddReference(byte[] image)
    {
        try
        {
            References.Add(MetadataReference.CreateFromImage(image));
            return "ok";
        }
        catch (Exception error)
        {
            return "error: " + error.Message;
        }
    }

    [JSExport]
    internal static int ReferenceCount() => References.Count;

    /// <summary>
    /// Holds the assembly emitted by <see cref="Compile"/> until
    /// <see cref="Run"/> invokes it. Compiling and running are two calls so the
    /// Worker can report "compiling" and "running" as separate states — a
    /// program that runs for ten seconds must not sit there claiming to still
    /// be compiling.
    /// </summary>
    private static byte[]? compiledAssembly;

    /// <summary>
    /// Compiles <paramref name="source"/> and returns a JSON envelope of
    /// diagnostics. Nothing is executed here.
    /// </summary>
    [JSExport]
    internal static string Compile(string source, string fileName)
    {
        try
        {
            compiledAssembly = null;

            // DocumentationMode.None keeps Roslyn off the XML doc-comment path,
            // which is what pulled System.Private.Xml to 3.10 MiB in spike v1.
            var syntaxTree = CSharpSyntaxTree.ParseText(
                source,
                new CSharpParseOptions(documentationMode: DocumentationMode.None),
                path: fileName);

            // concurrentBuild:false is mandatory, not an optimisation: the
            // browser sandbox cannot wait on monitors, and Roslyn's default
            // throws PlatformNotSupportedException on the first compile.
            var compilation = CSharpCompilation.Create(
                "UserCode",
                new[] { syntaxTree },
                References,
                new CSharpCompilationOptions(
                    OutputKind.ConsoleApplication,
                    concurrentBuild: false,
                    optimizationLevel: OptimizationLevel.Release));

            using var peStream = new MemoryStream();
            EmitResult emitResult = compilation.Emit(peStream);

            var diagnostics = emitResult.Diagnostics
                .Where(d => d.Severity is DiagnosticSeverity.Error or DiagnosticSeverity.Warning)
                .Select(ToDiagnosticPayload)
                .ToArray();

            if (emitResult.Success)
            {
                compiledAssembly = peStream.ToArray();
            }
            return Envelope(diagnostics, exitCode: null, runtimeError: null);
        }
        catch (Exception error)
        {
            // A failure here is Altitude's bug, not the user's.
            return Envelope(Array.Empty<string>(), exitCode: null,
                runtimeError: "Internal C# compiler failure: " + error);
        }
    }

    /// <summary>
    /// Runs whatever <see cref="Compile"/> last produced. Output goes out
    /// through EmitStdout/EmitStderr as it happens rather than being returned,
    /// so a long-running program shows progress and one cut short by the run
    /// time limit still shows what it printed.
    /// </summary>
    [JSExport]
    internal static string Run()
    {
        if (compiledAssembly is null)
        {
            return Envelope(Array.Empty<string>(), exitCode: null,
                runtimeError: "Nothing to run: compilation did not produce an assembly.");
        }

        var previousOut = Console.Out;
        var previousError = Console.Error;
        Console.SetOut(new CallbackWriter(EmitStdout));
        Console.SetError(new CallbackWriter(EmitStderr));
        try
        {
            var assembly = AssemblyLoadContext.Default.LoadFromStream(
                new MemoryStream(compiledAssembly));
            var entryPoint = assembly.EntryPoint;
            if (entryPoint is null)
            {
                return Envelope(Array.Empty<string>(), exitCode: null,
                    runtimeError: "No entry point: add a Main method.");
            }

            // `static int Main()` and `static void Main(string[])` are both
            // ordinary; accept every shape rather than only the common one.
            var parameters = entryPoint.GetParameters().Length == 0
                ? null
                : new object?[] { Array.Empty<string>() };
            var returned = entryPoint.Invoke(null, parameters);
            return Envelope(Array.Empty<string>(), returned is int code ? code : 0, null);
        }
        catch (TargetInvocationException invocation)
        {
            // The user's exception, not the reflection wrapper around it.
            return Envelope(Array.Empty<string>(), exitCode: null,
                runtimeError: (invocation.InnerException ?? invocation).ToString());
        }
        catch (Exception error)
        {
            return Envelope(Array.Empty<string>(), exitCode: null,
                runtimeError: "Internal C# runtime failure: " + error);
        }
        finally
        {
            Console.Out.Flush();
            Console.Error.Flush();
            Console.SetOut(previousOut);
            Console.SetError(previousError);
            compiledAssembly = null;
        }
    }

    private static string ToDiagnosticPayload(Diagnostic diagnostic)
    {
        var span = diagnostic.Location.GetLineSpan();
        // Roslyn counts lines and characters from zero; editors and humans
        // count from one.
        return "{\"id\":" + Quote(diagnostic.Id)
            + ",\"severity\":" + Quote(diagnostic.Severity == DiagnosticSeverity.Error ? "error" : "warning")
            + ",\"message\":" + Quote(diagnostic.GetMessage())
            + ",\"line\":" + (span.StartLinePosition.Line + 1).ToString(CultureInfo.InvariantCulture)
            + ",\"column\":" + (span.StartLinePosition.Character + 1).ToString(CultureInfo.InvariantCulture)
            + "}";
    }

    /// <summary>
    /// The envelope is written by hand rather than serialized. JsonSerializer
    /// needs reflection, which PublishTrimmed disables outright
    /// (JsonSerializerIsReflectionDisabled at runtime), and the alternative —
    /// a source-generated serializer context — is more machinery than three
    /// fields deserve. Hand-writing also keeps System.Text.Json out of the
    /// payload entirely.
    /// </summary>
    private static string Envelope(IReadOnlyList<string> diagnostics, int? exitCode, string? runtimeError)
    {
        var json = new StringBuilder("{\"diagnostics\":[");
        for (var index = 0; index < diagnostics.Count; index++)
        {
            if (index > 0)
            {
                json.Append(',');
            }
            json.Append(diagnostics[index]);
        }
        json.Append("],\"exitCode\":")
            .Append(exitCode.HasValue ? exitCode.Value.ToString(CultureInfo.InvariantCulture) : "null")
            .Append(",\"runtimeError\":")
            .Append(runtimeError is null ? "null" : Quote(runtimeError))
            .Append('}');
        return json.ToString();
    }

    /// <summary>JSON string literal, escaped per RFC 8259.</summary>
    private static string Quote(string value)
    {
        var quoted = new StringBuilder(value.Length + 2);
        quoted.Append('"');
        foreach (var character in value)
        {
            switch (character)
            {
                case '"': quoted.Append("\\\""); break;
                case '\\': quoted.Append("\\\\"); break;
                case '\n': quoted.Append("\\n"); break;
                case '\r': quoted.Append("\\r"); break;
                case '\t': quoted.Append("\\t"); break;
                case '\b': quoted.Append("\\b"); break;
                case '\f': quoted.Append("\\f"); break;
                default:
                    if (character < 0x20)
                    {
                        quoted.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        quoted.Append(character);
                    }
                    break;
            }
        }
        quoted.Append('"');
        return quoted.ToString();
    }

    /// <summary>
    /// A TextWriter that forwards straight to JS. Writing per call rather than
    /// buffering is what makes output appear while the program is still
    /// running, which matches how every other Altitude runtime behaves.
    /// </summary>
    private sealed class CallbackWriter : TextWriter
    {
        private readonly Action<string> emit;

        public CallbackWriter(Action<string> emit) => this.emit = emit;

        public override Encoding Encoding => Encoding.UTF8;

        public override void Write(char value) => emit(value.ToString());

        public override void Write(string? value)
        {
            if (!string.IsNullOrEmpty(value))
            {
                emit(value);
            }
        }

        public override void WriteLine(string? value) => emit((value ?? string.Empty) + "\n");

        public override void WriteLine() => emit("\n");
    }
}
