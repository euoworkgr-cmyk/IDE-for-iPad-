import { describe, expect, it } from "vitest";
import {
  STDIN_CHANNEL_CAPACITY,
  createStdinChannel,
  createStdinResponder,
  readStdinLine,
  viewStdinChannel
} from "./pythonWorkerProtocol";

/**
 * The Worker side of the channel blocks in Atomics.wait. These tests stand in
 * for the Worker on this thread, so the responder has to answer *inside* the
 * request callback — synchronously — or the wait would never be released.
 * Atomics.wait then returns "not-equal" immediately, which is the same value
 * it returns when a real main thread wins the race, so the code path under
 * test is the real one.
 */
function readWithAnswers(buffer: SharedArrayBuffer, answers: Array<string | null>): string {
  const responder = createStdinResponder(buffer);
  let answer: string | null = null;
  return readStdinLine(buffer, (continuation) => {
    if (!continuation) {
      answer = answers.shift() ?? null;
    }
    responder.respond(answer, continuation);
  });
}

describe("Python stdin channel", () => {
  it("allocates control slots on top of the requested capacity", () => {
    const buffer = createStdinChannel(64);
    expect(buffer).not.toBeNull();
    const { control, data } = viewStdinChannel(buffer!);
    expect(control.length).toBe(3);
    expect(data.length).toBe(64);
  });

  it("defaults to a capacity that covers any realistic prompt answer", () => {
    const { data } = viewStdinChannel(createStdinChannel()!);
    expect(data.length).toBe(STDIN_CHANNEL_CAPACITY);
  });

  it("carries one line across the channel", () => {
    expect(readWithAnswers(createStdinChannel(1024)!, ["Alice"])).toBe("Alice");
  });

  it("maps a cancelled prompt to an empty line", () => {
    expect(readWithAnswers(createStdinChannel(1024)!, [null])).toBe("");
  });

  it("preserves Unicode, including a character split across a chunk boundary", () => {
    // The capacity deliberately falls inside the rocket's four UTF-8 bytes, so
    // a decoder that ran per chunk instead of over the joined bytes would
    // produce replacement characters here.
    const sample = "Grüße Привет 日本語 🚀";
    expect(readWithAnswers(createStdinChannel(9)!, [sample])).toBe(sample);
  });

  it("reassembles an answer far larger than the data region", () => {
    const sample = "x".repeat(5_000);
    expect(readWithAnswers(createStdinChannel(16)!, [sample])).toBe(sample);
  });

  it("asks for continuation chunks only while more bytes remain", () => {
    const buffer = createStdinChannel(4)!;
    const responder = createStdinResponder(buffer);
    const requests: boolean[] = [];
    const value = readStdinLine(buffer, (continuation) => {
      requests.push(continuation);
      responder.respond(continuation ? null : "abcdefghij", continuation);
    });

    expect(value).toBe("abcdefghij");
    expect(requests).toEqual([false, true, true]);
  });

  it("starts a fresh answer rather than resuming a stale remainder", () => {
    const buffer = createStdinChannel(4)!;
    const responder = createStdinResponder(buffer);
    // Abandon the first answer after its first chunk, exactly as a run that
    // fails mid-input would, then read a second, short answer.
    readStdinLine(buffer, (continuation) => {
      responder.respond(continuation ? null : "abcdefgh", continuation);
      if (!continuation) {
        // Pretend the remainder never arrives: clear the "more" flag by hand.
        viewStdinChannel(buffer).control[2] = 0;
      }
    });

    const second = readStdinLine(buffer, (continuation) => {
      responder.respond(continuation ? null : "ok", continuation);
    });
    expect(second).toBe("ok");
  });
});
