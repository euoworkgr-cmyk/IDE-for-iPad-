import { describe, expect, it } from "vitest";
import { bottomInset, hasMeaningfulChange, ViewportFitController, type VisualViewportLike } from "./viewportFit";

describe("bottomInset", () => {
  it("reports the height the software keyboard is covering", () => {
    expect(bottomInset(1024, 700, 0)).toBe(324);
  });

  it("is zero when nothing is covering the page", () => {
    expect(bottomInset(1024, 1024, 0)).toBe(0);
  });

  // Safari briefly reports a visual viewport taller than the layout one during
  // rubber-band scrolling; a negative inset would shove the status bar off.
  it("never goes negative", () => {
    expect(bottomInset(1024, 1100, 0)).toBe(0);
    expect(bottomInset(1024, 700, 400)).toBe(0);
  });

  it("accounts for the viewport being scrolled rather than resized", () => {
    expect(bottomInset(1024, 700, 100)).toBe(224);
  });

  it("copes with a browser reporting nonsense", () => {
    expect(bottomInset(Number.NaN, 700, 0)).toBe(0);
  });
});

describe("hasMeaningfulChange", () => {
  it("ignores sub-pixel jitter", () => {
    expect(hasMeaningfulChange(700, 700.4)).toBe(false);
  });

  it("accepts a real change", () => {
    expect(hasMeaningfulChange(700, 699)).toBe(true);
  });
});

describe("ViewportFitController", () => {
  function fakeDocument() {
    const root = { style: new Map<string, string>(), dataset: {} as Record<string, string> };
    return {
      documentElement: {
        style: { setProperty: (k: string, v: string) => root.style.set(k, v) },
        dataset: root.dataset
      },
      read: (key: string) => root.style.get(key),
      dataset: root.dataset
    } as unknown as Document & { read: (key: string) => string | undefined; dataset: Record<string, string> };
  }

  function fakeViewport(height: number, offsetTop = 0) {
    const listeners: (() => void)[] = [];
    return {
      viewport: {
        height,
        offsetTop,
        addEventListener: (_t: "resize" | "scroll", listener: () => void) => listeners.push(listener)
      } as VisualViewportLike,
      resizeTo(next: number) {
        (this.viewport as { height: number }).height = next;
        for (const listener of listeners) listener();
      }
    };
  }

  it("sizes the app to the visible viewport and marks the keyboard closed", () => {
    const documentRef = fakeDocument();
    const vp = fakeViewport(1024);
    new ViewportFitController(documentRef, { innerHeight: 1024 }, vp.viewport).start();

    expect(documentRef.read("--app-height")).toBe("1024px");
    expect(documentRef.read("--keyboard-inset")).toBe("0px");
    expect(documentRef.dataset.keyboard).toBe("closed");
  });

  it("shrinks the app and flags the keyboard when it opens", () => {
    const documentRef = fakeDocument();
    const vp = fakeViewport(1024);
    new ViewportFitController(documentRef, { innerHeight: 1024 }, vp.viewport).start();

    vp.resizeTo(700);

    expect(documentRef.read("--app-height")).toBe("700px");
    expect(documentRef.read("--keyboard-inset")).toBe("324px");
    expect(documentRef.dataset.keyboard).toBe("open");
  });

  // Every desktop browser without visualViewport must fall through to the
  // stylesheet's 100dvh rather than get a height of "undefinedpx".
  it("does nothing at all where visualViewport is unavailable", () => {
    const documentRef = fakeDocument();
    new ViewportFitController(documentRef, { innerHeight: 800 }, undefined).start();
    expect(documentRef.read("--app-height")).toBeUndefined();
    expect(documentRef.dataset.keyboard).toBeUndefined();
  });
});
