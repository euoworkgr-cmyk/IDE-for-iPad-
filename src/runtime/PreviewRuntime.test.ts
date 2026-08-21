import { describe, expect, it } from "vitest";
import { createFile, type Project } from "../projects/models";
import { PREVIEW_MESSAGE_KEY, type PreviewMessageKind } from "./htmlPreview";
import {
  PreviewRuntime,
  type PreviewExecutionHooks,
  type PreviewMessageSource,
  type PreviewRuntimeStatus,
  type PreviewSurface
} from "./PreviewRuntime";
import { canRunPreview, runActivePreview } from "./runPreview";

class FakeSurface implements PreviewSurface {
  mounted: { html: string; label: string } | undefined;
  mounts = 0;
  unmounts = 0;
  failOnMount: Error | undefined;

  mount(html: string, label: string): void {
    if (this.failOnMount) {
      throw this.failOnMount;
    }
    this.mounts += 1;
    this.mounted = { html, label };
  }

  unmount(): void {
    this.unmounts += 1;
    this.mounted = undefined;
  }
}

class FakeMessageSource implements PreviewMessageSource {
  private listeners = new Set<(event: MessageEvent) => void>();

  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Posts what the frame's bootstrap posts, with the id read off the document. */
  emit(kind: PreviewMessageKind, text: string, executionId: string): void {
    this.post({ [PREVIEW_MESSAGE_KEY]: executionId, kind, text });
  }

  post(data: unknown): void {
    for (const listener of [...this.listeners]) {
      listener({ data } as MessageEvent);
    }
  }
}

function hooks(record: {
  stdout: string[];
  stderr: string[];
  statuses: PreviewRuntimeStatus[];
  notes: string[];
}): PreviewExecutionHooks {
  return {
    onStatus: (status) => record.statuses.push(status),
    onStdout: (chunk) => record.stdout.push(chunk),
    onStderr: (chunk) => record.stderr.push(chunk),
    onNote: (note) => record.notes.push(note)
  };
}

function record() {
  return { stdout: [] as string[], stderr: [] as string[], statuses: [] as PreviewRuntimeStatus[], notes: [] as string[] };
}

/** The id the bootstrap was built with, read back out of the mounted document. */
function executionIdOf(surface: FakeSurface): string {
  const match = /var id = "([^"]+)"/.exec(surface.mounted?.html ?? "");
  if (!match?.[1]) {
    throw new Error("The mounted document carries no execution id.");
  }
  return match[1];
}

const files = [
  {
    path: "index.html",
    content: `<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><p>Hi</p></body></html>`
  },
  { path: "styles.css", content: "p { color: teal; }" }
];

describe("PreviewRuntime", () => {
  it("mounts the built document and stays live until it is stopped", async () => {
    const surface = new FakeSurface();
    const messages = new FakeMessageSource();
    const runtime = new PreviewRuntime(surface, messages);
    const log = record();

    const running = runtime.execute({ entryPath: "index.html", files }, hooks(log));
    await Promise.resolve();

    expect(surface.mounts).toBe(1);
    expect(surface.mounted?.html).toContain("<p>Hi</p>");
    expect(log.statuses).toEqual(["building", "loading"]);

    messages.emit("ready", "", executionIdOf(surface));
    expect(log.statuses).toEqual(["building", "loading", "live"]);

    runtime.stop();
    const result = await running;

    expect(result).toMatchObject({ ok: true, stopped: true, errorCount: 0, hostPath: "index.html" });
    expect(surface.unmounts).toBeGreaterThanOrEqual(1);
    expect(messages.listenerCount).toBe(0);
  });

  it("streams the page's console output and counts its uncaught errors", async () => {
    const surface = new FakeSurface();
    const messages = new FakeMessageSource();
    const runtime = new PreviewRuntime(surface, messages);
    const log = record();

    const running = runtime.execute({ entryPath: "index.html", files }, hooks(log));
    await Promise.resolve();
    const executionId = executionIdOf(surface);

    messages.emit("stdout", "hello\n", executionId);
    messages.emit("stderr", "careful\n", executionId);
    messages.emit("error", "TypeError: x is not a function (line 3)\n", executionId);

    runtime.stop();
    const result = await running;

    expect(log.stdout).toEqual(["hello\n"]);
    expect(log.stderr).toEqual(["careful\n", "TypeError: x is not a function (line 3)\n"]);
    expect(result.errorCount).toBe(1);
  });

  it("ignores a message from anything but this run", async () => {
    const surface = new FakeSurface();
    const messages = new FakeMessageSource();
    const runtime = new PreviewRuntime(surface, messages);
    const log = record();

    const running = runtime.execute({ entryPath: "index.html", files }, hooks(log));
    await Promise.resolve();

    messages.emit("stdout", "from somewhere else\n", "preview-not-this-run");
    messages.post({ kind: "stdout", text: "no envelope\n" });
    messages.post("a string");
    messages.post({ [PREVIEW_MESSAGE_KEY]: executionIdOf(surface), kind: "nonsense", text: "x" });

    runtime.stop();
    await running;

    expect(log.stdout).toEqual([]);
    expect(log.stderr).toEqual([]);
  });

  it("reports the build's decisions as notes before mounting", async () => {
    const surface = new FakeSurface();
    const runtime = new PreviewRuntime(surface, new FakeMessageSource());
    const log = record();

    const running = runtime.execute({ entryPath: "styles.css", files }, hooks(log));
    await Promise.resolve();
    runtime.stop();
    await running;

    expect(log.notes).toContain("Previewing index.html, which links styles.css.");
  });

  it("fails without mounting when the document cannot be built", async () => {
    const surface = new FakeSurface();
    const runtime = new PreviewRuntime(surface, new FakeMessageSource());
    const log = record();

    const result = await runtime.execute({ entryPath: "missing.html", files }, hooks(log));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing.html is not in this project");
    expect(surface.mounts).toBe(0);
  });

  it("fails cleanly when the surface refuses to mount", async () => {
    const surface = new FakeSurface();
    surface.failOnMount = new Error("No preview host is attached.");
    const messages = new FakeMessageSource();
    const runtime = new PreviewRuntime(surface, messages);

    const result = await runtime.execute({ entryPath: "index.html", files }, hooks(record()));

    expect(result).toMatchObject({ ok: false, error: "No preview host is attached." });
    expect(messages.listenerCount).toBe(0);
  });

  it("replaces the previous preview rather than stacking two frames", async () => {
    const surface = new FakeSurface();
    const messages = new FakeMessageSource();
    const runtime = new PreviewRuntime(surface, messages);

    const first = runtime.execute({ entryPath: "index.html", files }, hooks(record()));
    await Promise.resolve();
    const second = runtime.execute({ entryPath: "index.html", files }, hooks(record()));
    await Promise.resolve();

    expect(await first).toMatchObject({ stopped: true });
    expect(messages.listenerCount).toBe(1);

    runtime.stop();
    await second;
    expect(messages.listenerCount).toBe(0);
  });

  it("does nothing when stopped with no preview open", () => {
    const surface = new FakeSurface();
    const runtime = new PreviewRuntime(surface, new FakeMessageSource());

    expect(() => runtime.stop()).not.toThrow();
    expect(surface.unmounts).toBe(0);
  });
});

describe("canRunPreview", () => {
  it("accepts .html, .htm and .css files", () => {
    expect(canRunPreview(createFile("index.html", ""))).toBe(true);
    expect(canRunPreview(createFile("about.htm", ""))).toBe(true);
    expect(canRunPreview(createFile("styles.css", ""))).toBe(true);
  });

  it("refuses everything else, including a mislabelled file", () => {
    expect(canRunPreview(undefined)).toBe(false);
    expect(canRunPreview(createFile("main.py", ""))).toBe(false);
    expect(canRunPreview({ ...createFile("notes.txt", ""), language: "html" })).toBe(false);
  });
});

describe("runActivePreview", () => {
  function projectWith(paths: readonly string[]): Project {
    const projectFiles = paths.map((path) => createFile(path, "<p>Hi</p>"));
    return {
      id: "project",
      name: "Preview",
      files: projectFiles,
      activeFileId: projectFiles[0]?.id ?? "",
      createdAt: 0,
      updatedAt: 0
    };
  }

  it("saves first, then hands the whole project to the runtime", async () => {
    const surface = new FakeSurface();
    const messages = new FakeMessageSource();
    const runtime = new PreviewRuntime(surface, messages);
    const project = projectWith(["index.html", "styles.css"]);
    const order: string[] = [];

    const running = runActivePreview(
      runtime,
      project,
      project.files[0]!,
      async () => {
        order.push("saved");
      },
      hooks(record())
    );
    await Promise.resolve();
    await Promise.resolve();
    order.push("mounted");
    runtime.stop();
    const { outcome } = await running;

    expect(order).toEqual(["saved", "mounted"]);
    expect(outcome).toBe("stopped");
  });

  it("reports an unrunnable file as unsupported without touching the runtime", async () => {
    const surface = new FakeSurface();
    const runtime = new PreviewRuntime(surface, new FakeMessageSource());
    const project = projectWith(["main.py"]);

    const result = await runActivePreview(
      runtime,
      project,
      project.files[0]!,
      async () => {
        throw new Error("beforeRun must not be called");
      },
      hooks(record())
    );

    expect(result).toEqual({ outcome: "unsupported" });
    expect(surface.mounts).toBe(0);
  });

  it("reports a build failure as an error outcome", async () => {
    const surface = new FakeSurface();
    const runtime = new PreviewRuntime(surface, new FakeMessageSource());
    const project = projectWith(["index.html"]);
    const orphan = createFile("gone.html", "");

    const result = await runActivePreview(runtime, project, orphan, async () => {}, hooks(record()));

    expect(result.outcome).toBe("error");
    expect(result.result?.error).toContain("gone.html is not in this project");
  });
});
