import type { PyodideAPI } from "pyodide";

export type PythonRuntimeStatus = "loading" | "ready" | "running";

export interface PythonWorkerFile {
  path: string;
  content: string;
}

export interface PythonWorkerExecuteRequest {
  type: "execute";
  executionId: string;
  /** Absolute URL of the bundled Pyodide assets; the Worker cannot derive it. */
  indexURL: string;
  entryPath: string;
  files: readonly PythonWorkerFile[];
  /**
   * The stdin channel, or `null` when the page is not cross-origin isolated
   * and `SharedArrayBuffer` is therefore unavailable.
   */
  stdin: SharedArrayBuffer | null;
}

export type PythonWorkerRequest = PythonWorkerExecuteRequest;

export type PythonWorkerResponse =
  | { type: "stdout" | "stderr"; executionId: string; chunk: string }
  | { type: "status"; executionId: string; status: PythonRuntimeStatus }
  | { type: "stdin-request"; executionId: string; continuation: boolean }
  | { type: "complete"; executionId: string }
  | { type: "failure"; executionId: string; error: string };

export function isPythonWorkerRequest(value: unknown): value is PythonWorkerRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PythonWorkerExecuteRequest>;
  return (
    candidate.type === "execute" &&
    typeof candidate.executionId === "string" &&
    typeof candidate.indexURL === "string" &&
    typeof candidate.entryPath === "string" &&
    Array.isArray(candidate.files)
  );
}

export function isPythonWorkerResponse(value: unknown): value is PythonWorkerResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PythonWorkerResponse> & { chunk?: unknown };
  if (typeof candidate.executionId !== "string" || typeof candidate.type !== "string") {
    return false;
  }
  if (candidate.type === "stdout" || candidate.type === "stderr") {
    return typeof candidate.chunk === "string";
  }
  if (candidate.type === "failure") {
    return typeof (candidate as { error?: unknown }).error === "string";
  }
  if (candidate.type === "status") {
    const status = (candidate as { status?: unknown }).status;
    return status === "loading" || status === "ready" || status === "running";
  }
  if (candidate.type === "stdin-request") {
    return typeof (candidate as { continuation?: unknown }).continuation === "boolean";
  }
  return candidate.type === "complete";
}

/*
 * The stdin channel.
 *
 * Python's `input()` must block until a line arrives, and a Worker has no
 * `window.prompt`. So the Worker parks on a `SharedArrayBuffer` with
 * `Atomics.wait` while the main thread — which is free, that being the whole
 * point of L6 — collects the line and writes it back.
 *
 * Layout: three Int32 control slots followed by a byte region.
 *   [0] status  0 = the Worker is waiting, 1 = a chunk is ready
 *   [1] length  bytes written into the data region for this chunk
 *   [2] more    1 = the answer did not fit and another chunk follows
 *
 * The chunking keeps an answer longer than the data region correct rather than
 * truncated. A multi-byte character may be split across a chunk boundary, so
 * the bytes are joined before they are decoded, never chunk by chunk.
 */
const STATUS_SLOT = 0;
const LENGTH_SLOT = 1;
const MORE_SLOT = 2;
const CONTROL_SLOTS = 3;
const CONTROL_BYTES = CONTROL_SLOTS * Int32Array.BYTES_PER_ELEMENT;

export const STDIN_CHANNEL_CAPACITY = 64 * 1024;

export interface StdinChannelView {
  control: Int32Array;
  data: Uint8Array;
}

export function isStdinChannelSupported(): boolean {
  return typeof SharedArrayBuffer === "function" && typeof Atomics === "object";
}

export function createStdinChannel(capacity: number = STDIN_CHANNEL_CAPACITY): SharedArrayBuffer | null {
  if (!isStdinChannelSupported()) {
    return null;
  }
  return new SharedArrayBuffer(CONTROL_BYTES + Math.max(capacity, 1));
}

export function viewStdinChannel(buffer: SharedArrayBuffer): StdinChannelView {
  return {
    control: new Int32Array(buffer, 0, CONTROL_SLOTS),
    data: new Uint8Array(buffer, CONTROL_BYTES)
  };
}

/**
 * Worker side. Blocks until the main thread has written the whole answer.
 * `requestChunk` posts the request that wakes the main thread; it must not
 * itself block, and the wait below is what makes `input()` synchronous.
 */
export function readStdinLine(
  buffer: SharedArrayBuffer,
  requestChunk: (continuation: boolean) => void
): string {
  const { control, data } = viewStdinChannel(buffer);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let continuation = false;

  for (;;) {
    Atomics.store(control, LENGTH_SLOT, 0);
    Atomics.store(control, MORE_SLOT, 0);
    Atomics.store(control, STATUS_SLOT, 0);
    requestChunk(continuation);
    Atomics.wait(control, STATUS_SLOT, 0);

    const length = Math.max(0, Math.min(Atomics.load(control, LENGTH_SLOT), data.length));
    // slice() copies out of shared memory: TextDecoder rejects a shared view.
    const chunk = data.slice(0, length);
    chunks.push(chunk);
    total += chunk.length;
    if (Atomics.load(control, MORE_SLOT) !== 1) {
      break;
    }
    continuation = true;
  }

  const answer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    answer.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(answer);
}

export interface StdinResponder {
  /**
   * Writes the next chunk of the answer and wakes the Worker. `continuation`
   * comes from the Worker's request: `false` starts a new answer, `true` asks
   * for the remainder of the one already in flight.
   */
  respond(line: string | null, continuation: boolean): void;
}

/** Main-thread side. */
export function createStdinResponder(buffer: SharedArrayBuffer): StdinResponder {
  const { control, data } = viewStdinChannel(buffer);
  const encoder = new TextEncoder();
  let pending: Uint8Array | null = null;

  const write = (bytes: Uint8Array): void => {
    const chunk = bytes.subarray(0, data.length);
    data.set(chunk);
    pending = bytes.length > chunk.length ? bytes.subarray(chunk.length) : null;
    Atomics.store(control, LENGTH_SLOT, chunk.length);
    Atomics.store(control, MORE_SLOT, pending ? 1 : 0);
    Atomics.store(control, STATUS_SLOT, 1);
    Atomics.notify(control, STATUS_SLOT);
  };

  return {
    respond(line: string | null, continuation: boolean): void {
      try {
        const bytes = continuation
          ? (pending ?? new Uint8Array(0))
          : encoder.encode(line ?? "");
        write(bytes);
      } catch {
        // A Worker blocked in Atomics.wait is a hung run, so failing to build
        // the answer still has to release it — with an empty line.
        pending = null;
        Atomics.store(control, LENGTH_SLOT, 0);
        Atomics.store(control, MORE_SLOT, 0);
        Atomics.store(control, STATUS_SLOT, 1);
        Atomics.notify(control, STATUS_SLOT);
      }
    }
  };
}

type StdinController = Pick<PyodideAPI, "setStdin">;

/**
 * Pyodide line mode: `stdin` returns one line per call. Regression-guarded —
 * an earlier fix (Patch 3) established that `autoEOF` must not be set here.
 */
export function configureLineStdin(
  pyodide: StdinController,
  readInput: () => string | null
): void {
  pyodide.setStdin({
    stdin: () => readInput() ?? "",
    isatty: false
  });
}
