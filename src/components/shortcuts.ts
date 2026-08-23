/**
 * Magic Keyboard shortcuts (M3's iPad-native UX item).
 *
 * Cmd+Enter was the only one Altitude had, which is thin for a device people
 * attach a hardware keyboard to specifically so they can write code on it.
 *
 * Kept as a pure mapping so the decision can be tested without a DOM, and so
 * the whole shortcut table can be read in one place rather than inferred from
 * scattered listeners.
 */
export type ShortcutAction =
  | "run"
  | "save"
  | "new-file"
  | "next-file"
  | "previous-file"
  | "close-panel"
  | "settings"
  | "export";

export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** What each shortcut is, for the keyboard-shortcut help users can read. */
export const SHORTCUTS: readonly { keys: string; action: ShortcutAction; label: string }[] = [
  { keys: "Cmd + Enter", action: "run", label: "Run, or stop what is running" },
  { keys: "Cmd + S", action: "save", label: "Save now, without waiting for autosave" },
  { keys: "Cmd + N", action: "new-file", label: "New file" },
  { keys: "Cmd + Shift + ]", action: "next-file", label: "Next file" },
  { keys: "Cmd + Shift + [", action: "previous-file", label: "Previous file" },
  { keys: "Cmd + ,", action: "settings", label: "Settings" },
  { keys: "Cmd + Shift + E", action: "export", label: "Export" },
  { keys: "Esc", action: "close-panel", label: "Close the output or preview pane" }
];

/**
 * `metaKey || ctrlKey` throughout: an iPad Magic Keyboard sends Cmd, and a
 * USB-C or Bluetooth PC keyboard sends Ctrl, and both are things people plug
 * into an iPad.
 */
export function matchShortcut(event: ShortcutEvent): ShortcutAction | undefined {
  const modifier = event.metaKey || event.ctrlKey;

  // Escape is the one shortcut that carries no modifier, so it is checked
  // first and separately.
  if (event.key === "Escape" && !modifier && !event.altKey && !event.shiftKey) {
    return "close-panel";
  }
  if (!modifier || event.altKey) {
    return undefined;
  }

  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    switch (key) {
      case "]":
      case "}":
        return "next-file";
      case "[":
      case "{":
        return "previous-file";
      case "e":
        return "export";
      default:
        return undefined;
    }
  }

  switch (key) {
    case "enter":
      return "run";
    case "s":
      return "save";
    case "n":
      return "new-file";
    case ",":
      return "settings";
    default:
      return undefined;
  }
}
