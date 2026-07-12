import { describe, expect, it } from "vitest";

import {
  formatKeys,
  matchKeys,
  SHORTCUTS,
  type ShortcutDef,
} from "@/lib/shortcut-registry";

describe("shortcut registry", () => {
  it("contains only valid shortcut definitions", () => {
    for (const [id, definition] of Object.entries(SHORTCUTS)) {
      expect(id).toMatch(/^(global|home|editor|canvas|cover)\./);
      expect(definition.labelKey).not.toBe("");

      if ("sequence" in definition) {
        expect(definition.sequence).toHaveLength(2);
        expect(definition.sequence.every(Boolean)).toBe(true);
      } else {
        expect(definition.keys.length).toBeGreaterThan(0);
        expect(definition.keys.every(Boolean)).toBe(true);
      }
    }
  });

  it("splits modifier combinations into display groups", () => {
    expect(formatKeys(SHORTCUTS["editor.save"], false)).toEqual({
      groups: [["Ctrl", "S"]],
      isSequence: false,
    });
  });

  it("retains terminal plus and minus keys", () => {
    expect(formatKeys(SHORTCUTS["editor.zoomIn"], false).groups).toEqual([
      ["Ctrl", "+"],
    ]);
    expect(formatKeys(SHORTCUTS["editor.zoomOut"], false).groups).toEqual([
      ["Ctrl", "-"],
    ]);
  });

  it.each([
    ["editor.focusMode", "F11"],
    ["home.jumpBooks", "1-9"],
    ["global.showHelp", "?"],
  ] as const)("keeps %s as a whole key", (id, key) => {
    expect(formatKeys(SHORTCUTS[id], false).groups).toEqual([[key]]);
  });

  it("preserves alternative keys as separate groups", () => {
    expect(formatKeys(SHORTCUTS["home.moveSelection"], false)).toEqual({
      groups: [["↑/↓"], ["j/k"]],
      isSequence: false,
    });
  });

  it("uppercases sequence keys and marks them as a sequence", () => {
    expect(formatKeys(SHORTCUTS["global.gotoProjects"], false)).toEqual({
      groups: [["G"], ["P"]],
      isSequence: true,
    });
  });

  it("maps Ctrl and Alt to macOS symbols", () => {
    const definition: ShortcutDef = {
      labelKey: "shortcuts.saveVersion",
      keys: ["Ctrl+Alt+S"],
    };

    expect(formatKeys(definition, true).groups).toEqual([["⌘", "⌥", "S"]]);
  });

  it("normalizes match keys and expands Ctrl to Meta", () => {
    expect(matchKeys("editor.save")).toEqual(["ctrl+s", "meta+s"]);
    expect(matchKeys("global.syncNow")).toEqual([
      "ctrl+shift+y",
      "meta+shift+y",
    ]);
    expect(matchKeys("home.moveSelection")).toEqual(["↑/↓", "j/k"]);
  });

  it("normalizes the toolbar settings shortcut and expands Ctrl to Meta", () => {
    expect(matchKeys("editor.toolbarSettings")).toEqual([
      "ctrl+shift+,",
      "meta+shift+,",
    ]);
  });

  it("rejects sequence shortcuts for direct key matching", () => {
    expect(() => matchKeys("global.gotoProjects")).toThrow(
      "Sequence shortcuts cannot be matched as key combinations",
    );
  });

  it.each([
    ["editor.strikethrough", [["Ctrl", "Shift", "S"]]],
    ["editor.highlight", [["Ctrl", "Shift", "H"]]],
    ["editor.subscript", [["Ctrl", ","]]],
    ["editor.superscript", [["Ctrl", "."]]],
    ["editor.code", [["Ctrl", "E"]]],
    ["editor.codeBlock", [["Ctrl", "Alt", "C"]]],
    ["editor.heading1", [["Ctrl", "Alt", "1"]]],
    ["editor.heading2", [["Ctrl", "Alt", "2"]]],
    ["editor.heading3", [["Ctrl", "Alt", "3"]]],
    ["editor.bulletList", [["Ctrl", "Shift", "8"]]],
    ["editor.numberedList", [["Ctrl", "Shift", "7"]]],
    ["editor.taskList", [["Ctrl", "Shift", "9"]]],
    ["editor.quote", [["Ctrl", "Shift", "B"]]],
    ["editor.alignLeft", [["Ctrl", "Shift", "L"]]],
    ["editor.alignCenter", [["Ctrl", "Shift", "E"]]],
    ["editor.alignRight", [["Ctrl", "Shift", "R"]]],
  ] as const)("formats the %s formatting shortcut", (id, groups) => {
    expect(formatKeys(SHORTCUTS[id], false).groups).toEqual(groups);
  });
});
