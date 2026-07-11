import { isMac } from "@/lib/platform";

export type ShortcutDef = { labelKey: string } & (
  | { keys: readonly string[] }
  | { sequence: readonly [string, string] }
);

export const SHORTCUTS = {
  "global.gotoProjects": {
    labelKey: "shortcuts.gotoProjects",
    sequence: ["g", "p"],
  },
  "global.gotoNotes": {
    labelKey: "shortcuts.gotoNotes",
    sequence: ["g", "n"],
  },
  "global.gotoCanvas": {
    labelKey: "shortcuts.gotoCanvas",
    sequence: ["g", "c"],
  },
  "global.gotoMetrics": {
    labelKey: "shortcuts.gotoMetrics",
    sequence: ["g", "m"],
  },
  "global.gotoSettings": {
    labelKey: "shortcuts.gotoSettings",
    sequence: ["g", "s"],
  },
  "global.toggleTheme": {
    labelKey: "shortcuts.toggleTheme",
    sequence: ["g", "t"],
  },
  "global.toggleShortcutHints": {
    labelKey: "shortcuts.toggleShortcutHints",
    sequence: ["g", "h"],
  },
  "global.syncNow": {
    labelKey: "shortcuts.syncNow",
    keys: ["Ctrl+Shift+Y"],
  },
  "global.showHelp": { labelKey: "shortcuts.showHelp", keys: ["?"] },
  "global.toggleAlwaysOnTop": {
    labelKey: "shortcuts.toggleAlwaysOnTop",
    keys: ["Ctrl+Shift+P"],
  },

  "home.newBook": { labelKey: "shortcuts.newBook", keys: ["Ctrl+N"] },
  "home.jumpBooks": { labelKey: "shortcuts.jumpBooks", keys: ["1-9"] },
  "home.moveSelection": {
    labelKey: "shortcuts.moveSelection",
    keys: ["↑/↓", "j/k"],
  },
  "home.openSelected": {
    labelKey: "shortcuts.openSelected",
    keys: ["Enter"],
  },

  "editor.save": { labelKey: "shortcuts.save", keys: ["Ctrl+S"] },
  "editor.saveVersion": {
    labelKey: "shortcuts.saveVersion",
    keys: ["Ctrl+Alt+S"],
  },
  "editor.versionHistory": {
    labelKey: "shortcuts.versionHistory",
    sequence: ["g", "v"],
  },
  "editor.focusMode": {
    labelKey: "shortcuts.toggleFocusMode",
    keys: ["F11"],
  },
  "editor.toggleSidebar": {
    labelKey: "shortcuts.toggleSidebar",
    keys: ["Ctrl+\\"],
  },
  "editor.back": {
    labelKey: "shortcuts.backFromEditor",
    keys: ["Backspace"],
  },
  "editor.zoomIn": { labelKey: "shortcuts.zoomIn", keys: ["Ctrl++"] },
  "editor.zoomOut": { labelKey: "shortcuts.zoomOut", keys: ["Ctrl+-"] },
  "editor.zoomReset": {
    labelKey: "shortcuts.zoomReset",
    keys: ["Ctrl+0"],
  },
  "editor.bold": { labelKey: "editor.bold", keys: ["Ctrl+B"] },
  "editor.italic": { labelKey: "editor.italic", keys: ["Ctrl+I"] },
  "editor.underline": { labelKey: "editor.underline", keys: ["Ctrl+U"] },
  "editor.insertLink": { labelKey: "editor.insertLink", keys: ["Ctrl+K"] },
  "editor.undo": { labelKey: "editor.undo", keys: ["Ctrl+Z"] },
  "editor.redo": { labelKey: "editor.redo", keys: ["Ctrl+Shift+Z"] },
  "editor.findReplace": {
    labelKey: "editor.findReplace",
    keys: ["Ctrl+F"],
  },
  "editor.toolbarSettings": {
    labelKey: "toolbar.settings.open",
    keys: ["Ctrl+Shift+,"],
  },
  "editor.increaseIndent": {
    labelKey: "editor.increaseIndent",
    keys: ["Tab"],
  },
  "editor.decreaseIndent": {
    labelKey: "editor.decreaseIndent",
    keys: ["Shift+Tab"],
  },
  "editor.findNext": { labelKey: "editor.findNext", keys: ["Enter"] },
  "editor.findPrevious": {
    labelKey: "editor.findPrevious",
    keys: ["Shift+Enter"],
  },
  "editor.closeFindReplace": {
    labelKey: "editor.closeFindReplace",
    keys: ["Esc"],
  },

  "canvas.toolSelect": { labelKey: "canvas.toolSelect", keys: ["V"] },
  "canvas.toolPen": { labelKey: "canvas.toolPen", keys: ["P"] },
  "canvas.toolEraser": { labelKey: "canvas.toolEraser", keys: ["E"] },
  "canvas.addTextNode": { labelKey: "canvas.addTextNode", keys: ["T"] },
  "canvas.addNoteRef": { labelKey: "canvas.addNoteRef", keys: ["N"] },
  "canvas.zoomIn": { labelKey: "canvas.zoomIn", keys: ["Ctrl++"] },
  "canvas.zoomOut": { labelKey: "canvas.zoomOut", keys: ["Ctrl+-"] },
  "canvas.fitView": { labelKey: "canvas.fitView", keys: ["Shift+1"] },
  "canvas.lock": { labelKey: "canvas.lockInteractivity", keys: ["L"] },

  "cover.save": { labelKey: "shortcuts.save", keys: ["Ctrl+S"] },
  "cover.delete": { labelKey: "shortcuts.deleteSelection", keys: ["Delete"] },
  "cover.undo": { labelKey: "cover.undo", keys: ["Ctrl+Z"] },
  "cover.redo": { labelKey: "cover.redo", keys: ["Ctrl+Shift+Z"] },
  "cover.duplicate": { labelKey: "cover.duplicate", keys: ["Ctrl+D"] },
} as const satisfies Record<string, ShortcutDef>;

export type ShortcutId = keyof typeof SHORTCUTS;

export type FormattedShortcut = {
  groups: string[][];
  isSequence: boolean;
};

function splitCombination(combination: string): string[] {
  const parts = combination.split("+").filter(Boolean);
  if (combination.endsWith("+")) parts.push("+");
  return parts;
}

export function formatKeys(
  definition: ShortcutDef,
  mac = isMac(),
): FormattedShortcut {
  if ("sequence" in definition) {
    return {
      groups: definition.sequence.map((key) => [key.toUpperCase()]),
      isSequence: true,
    };
  }

  return {
    groups: definition.keys.map((combination) =>
      splitCombination(combination).map((key) => {
        if (!mac) return key;
        if (key === "Ctrl") return "⌘";
        if (key === "Alt") return "⌥";
        return key;
      }),
    ),
    isSequence: false,
  };
}

export function matchKeys(id: ShortcutId): string[] {
  const definition: ShortcutDef = SHORTCUTS[id];
  if ("sequence" in definition) {
    throw new Error("Sequence shortcuts cannot be matched as key combinations");
  }

  return definition.keys.flatMap((key) => {
    const normalized = key.toLowerCase();
    return normalized.startsWith("ctrl+")
      ? [normalized, `meta+${normalized.slice("ctrl+".length)}`]
      : [normalized];
  });
}
