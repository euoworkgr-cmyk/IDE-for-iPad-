import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_THEME_COLOR,
  AppearanceController,
  resolveAppearance,
  type AppearanceDocument,
  type SchemeQuery
} from "./appearance";

function fakeDocument(): AppearanceDocument & { themeColor: string } {
  const meta = {
    setAttribute(_name: string, value: string) {
      state.themeColor = value;
    }
  };
  const state = {
    themeColor: "",
    documentElement: { dataset: {} as Record<string, string | undefined> },
    querySelector: () => meta
  };
  return state;
}

/** A media query whose match can be flipped, with listeners it actually calls. */
function fakeQuery(matches: boolean) {
  const listeners = new Set<() => void>();
  return {
    query: {
      matches,
      addEventListener: (_type: "change", listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: "change", listener: () => void) => {
        listeners.delete(listener);
      }
    } as SchemeQuery,
    set(next: boolean) {
      (this.query as { matches: boolean }).matches = next;
      for (const listener of listeners) {
        listener();
      }
    },
    get listenerCount() {
      return listeners.size;
    }
  };
}

describe("resolveAppearance", () => {
  it("takes an explicit choice over the system's", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });

  it("follows the system when asked to", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });
});

describe("AppearanceController", () => {
  it("writes the resolved appearance and its status-bar colour to the page", () => {
    const documentRef = fakeDocument();
    const controller = new AppearanceController(documentRef, fakeQuery(true).query);

    expect(controller.setTheme("light")).toBe("light");
    expect(documentRef.documentElement.dataset.theme).toBe("light");
    expect(documentRef.themeColor).toBe(APPEARANCE_THEME_COLOR.light);

    controller.setTheme("dark");
    expect(documentRef.documentElement.dataset.theme).toBe("dark");
    expect(documentRef.themeColor).toBe(APPEARANCE_THEME_COLOR.dark);
  });

  it("re-resolves when the system changes under a System preference", () => {
    const documentRef = fakeDocument();
    const scheme = fakeQuery(false);
    const onApply = vi.fn();
    const controller = new AppearanceController(documentRef, scheme.query, onApply);

    controller.setTheme("system");
    expect(controller.appearance).toBe("light");

    scheme.set(true);
    expect(controller.appearance).toBe("dark");
    expect(documentRef.documentElement.dataset.theme).toBe("dark");
    expect(onApply).toHaveBeenLastCalledWith("dark");
  });

  it("ignores the system once a palette has been chosen explicitly", () => {
    const documentRef = fakeDocument();
    const scheme = fakeQuery(false);
    const controller = new AppearanceController(documentRef, scheme.query);

    controller.setTheme("light");
    scheme.set(true);
    expect(controller.appearance).toBe("light");
    expect(documentRef.documentElement.dataset.theme).toBe("light");
  });

  it("touches nothing until it is told a preference", () => {
    const documentRef = fakeDocument();
    new AppearanceController(documentRef, fakeQuery(true).query);

    // The stylesheet already follows prefers-color-scheme, so a controller
    // that has not heard from IndexedDB yet must leave the page alone rather
    // than assert a palette it has no basis for.
    expect(documentRef.documentElement.dataset.theme).toBeUndefined();
    expect(documentRef.themeColor).toBe("");
  });

  it("assumes dark where the browser cannot be asked", () => {
    const documentRef = fakeDocument();
    const controller = new AppearanceController(documentRef, undefined);
    expect(controller.setTheme("system")).toBe("dark");
  });

  it("releases its listener when disposed", () => {
    const scheme = fakeQuery(true);
    const controller = new AppearanceController(fakeDocument(), scheme.query);
    expect(scheme.listenerCount).toBe(1);
    controller.dispose();
    expect(scheme.listenerCount).toBe(0);
  });
});
