import { describe, expect, it } from "vitest";
import { describeRuntimeStartFailure, looksLikeAssetFailure } from "./runtimeStartFailure";

describe("looksLikeAssetFailure", () => {
  // The same failure has different wording per engine, and neither the
  // Chromium nor the Safari phrasing says anything a user can act on.
  it.each([
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource.",
    "Importing a module script failed",
    "abort(both async and sync fetching of the wasm failed)",
    "Unexpected response, status 404"
  ])("recognises %s", (message) => {
    expect(looksLikeAssetFailure(message)).toBe(true);
  });

  it("leaves an ordinary program failure alone", () => {
    expect(looksLikeAssetFailure("NameError: name 'foo' is not defined")).toBe(false);
    expect(looksLikeAssetFailure("division by zero")).toBe(false);
  });
});

describe("describeRuntimeStartFailure", () => {
  it("explains an asset failure and keeps the original wording", () => {
    const message = describeRuntimeStartFailure("Python", new Error("Failed to fetch"));
    expect(message).toContain("Python could not start");
    expect(message).toContain("stored for offline use");
    // The raw text stays, so a bug report still carries what the browser said.
    expect(message).toContain("Failed to fetch");
  });

  it("passes anything else through, named but not reinterpreted", () => {
    expect(describeRuntimeStartFailure("PHP", new Error("out of memory"))).toBe(
      "PHP failed to start: out of memory"
    );
  });

  it("copes with something that is not an Error", () => {
    expect(describeRuntimeStartFailure("SQLite", "nope")).toBe("SQLite failed to start: nope");
  });
});
