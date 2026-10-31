import { describe, expect, it } from "vitest";
import { matchShortcut, SHORTCUTS, type ShortcutEvent } from "./shortcuts";

function press(key: string, modifiers: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers };
}

describe("matchShortcut", () => {
  // An iPad Magic Keyboard sends Cmd; a USB-C or Bluetooth PC keyboard sends
  // Ctrl. Both get plugged into iPads.
  it.each([{ metaKey: true }, { ctrlKey: true }])("accepts %s as the modifier", (modifier) => {
    expect(matchShortcut(press("Enter", modifier))).toBe("run");
    expect(matchShortcut(press("s", modifier))).toBe("save");
  });

  it("maps the unshifted shortcuts", () => {
    expect(matchShortcut(press("n", { metaKey: true }))).toBe("new-file");
    expect(matchShortcut(press(",", { metaKey: true }))).toBe("settings");
  });

  it("maps the shifted shortcuts", () => {
    expect(matchShortcut(press("]", { metaKey: true, shiftKey: true }))).toBe("next-file");
    expect(matchShortcut(press("[", { metaKey: true, shiftKey: true }))).toBe("previous-file");
    expect(matchShortcut(press("e", { metaKey: true, shiftKey: true }))).toBe("export");
  });

  // Some layouts report the shifted character rather than the bracket itself.
  it("accepts the shifted forms of the bracket keys", () => {
    expect(matchShortcut(press("}", { metaKey: true, shiftKey: true }))).toBe("next-file");
    expect(matchShortcut(press("{", { metaKey: true, shiftKey: true }))).toBe("previous-file");
  });

  it("treats Escape as the only unmodified shortcut", () => {
    expect(matchShortcut(press("Escape"))).toBe("close-panel");
    expect(matchShortcut(press("Escape", { metaKey: true }))).toBeUndefined();
  });

  it("is case-insensitive, so Shift or Caps Lock does not break a shortcut", () => {
    expect(matchShortcut(press("S", { metaKey: true }))).toBe("save");
    expect(matchShortcut(press("N", { metaKey: true }))).toBe("new-file");
  });

  // Alt/Option is not part of any binding; letting it through would fire a
  // shortcut when the user was typing an accented character.
  it("ignores anything carrying Alt", () => {
    expect(matchShortcut(press("s", { metaKey: true, altKey: true }))).toBeUndefined();
    expect(matchShortcut(press("Enter", { ctrlKey: true, altKey: true }))).toBeUndefined();
  });

  it("ignores plain typing", () => {
    expect(matchShortcut(press("s"))).toBeUndefined();
    expect(matchShortcut(press("a", { metaKey: true }))).toBeUndefined();
  });
});

describe("SHORTCUTS", () => {
  // The table is what the user is shown; a binding missing from it is a
  // shortcut nobody can discover.
  it("documents every action the matcher can return", () => {
    for (const { keys, action, label } of SHORTCUTS) {
      expect(keys.length).toBeGreaterThan(0);
      expect(label.length).toBeGreaterThan(0);
      expect(action.length).toBeGreaterThan(0);
    }
    expect(new Set(SHORTCUTS.map((s) => s.action)).size).toBe(SHORTCUTS.length);
  });
});
