import { describe, expect, it } from "vitest";
import {
  clampUiScale,
  MAX_UI_SCALE,
  MIN_UI_SCALE,
  measureSystemBodySize,
  uiScaleFromBodySize,
  type ProbeHost
} from "./dynamicType";

describe("uiScaleFromBodySize", () => {
  it("treats the default 17px body size as no scaling", () => {
    expect(uiScaleFromBodySize(17)).toBe(1);
  });

  it("scales up with the system text size", () => {
    expect(uiScaleFromBodySize(20)).toBeCloseTo(1.18, 2);
    expect(uiScaleFromBodySize(23)).toBeCloseTo(1.35, 2);
  });

  // The largest accessibility sizes would otherwise triple the chrome and
  // leave no room for the editor on an iPad.
  it("clamps the largest accessibility sizes", () => {
    expect(uiScaleFromBodySize(53)).toBe(MAX_UI_SCALE);
  });

  // Below the default the app already has its own text-size setting; shrinking
  // the chrome further only makes targets harder to hit.
  it("never scales below 1", () => {
    expect(uiScaleFromBodySize(12)).toBe(MIN_UI_SCALE);
  });
});

describe("clampUiScale", () => {
  it.each([Number.NaN, 0, -3, Number.POSITIVE_INFINITY])(
    "falls back to 1 for %s rather than collapsing the interface",
    (value) => {
      expect(clampUiScale(value)).toBe(1);
    }
  );
});

describe("measureSystemBodySize", () => {
  function fakeHost(): ProbeHost & { appended: number } {
    const state = {
      appended: 0,
      createElement: () => {
        const element = { style: {} as Record<string, string>, setAttribute: () => {}, remove: () => {} };
        return element as unknown as HTMLSpanElement;
      },
      body: {
        appendChild: () => {
          state.appended += 1;
        }
      }
    };
    return state;
  }

  it("reads the resolved -apple-system-body size", () => {
    const host = fakeHost();
    expect(measureSystemBodySize(host, () => ({ fontSize: "23px" }))).toBe(23);
    expect(host.appended).toBe(1);
  });

  // Every non-Apple browser resolves the shorthand to something meaningless.
  // Undefined means "leave the scale alone", never "assume something".
  it.each([{ fontSize: "" }, { fontSize: "normal" }, { fontSize: "0px" }])(
    "returns undefined when the probe resolves to %s",
    (style) => {
      expect(measureSystemBodySize(fakeHost(), () => style)).toBeUndefined();
    }
  );

  it("returns undefined rather than throwing when there is no layout", () => {
    const throwingHost = {
      createElement: () => {
        throw new Error("no document");
      },
      body: { appendChild: () => undefined }
    } as unknown as ProbeHost;
    expect(measureSystemBodySize(throwingHost, () => ({ fontSize: "17px" }))).toBeUndefined();
  });
});
