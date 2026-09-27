import { describe, expect, it } from "vitest";

import {
  recordedStepFromEvent,
  formatShortcut,
  isIgnoredKeyEvent,
  isRecordableStep,
  isReservedOnWeb,
  isSingleKey,
  normalizeShortcut,
  normalizeStep,
  parseStep,
  shortcutKey,
  stepsFromEvent,
  toAriaKeyShortcuts,
} from "@/lib/shortcut-keys";

function keyEvent(
  partial: Partial<
    Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">
  >
): Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe("parseStep", () => {
  it("splits modifiers from the key", () => {
    expect(parseStep("Mod+s")).toEqual({
      mod: true,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
      key: "s",
    });
    expect(parseStep("Ctrl+Alt+S")).toEqual({
      mod: false,
      ctrl: true,
      meta: false,
      alt: true,
      shift: false,
      key: "s",
    });
    expect(parseStep("mod+SHIFT+?")).toEqual({
      mod: true,
      ctrl: false,
      meta: false,
      alt: false,
      shift: true,
      key: "?",
    });
  });

  it("treats a trailing plus as the key", () => {
    expect(parseStep("Mod++")?.key).toBe("+");
    expect(parseStep("+")?.key).toBe("+");
    expect(parseStep("Mod+Shift++")).toEqual({
      mod: true,
      ctrl: false,
      meta: false,
      alt: false,
      shift: true,
      key: "+",
    });
  });

  it("accepts modifier aliases case-insensitively", () => {
    expect(parseStep("cmd+s")?.meta).toBe(true);
    expect(parseStep("Command+s")?.meta).toBe(true);
    expect(parseStep("Option+s")?.alt).toBe(true);
    expect(parseStep("Control+s")?.ctrl).toBe(true);
  });

  it.each([
    ["Esc", "Escape"],
    ["escape", "Escape"],
    ["return", "Enter"],
    ["Space", "Space"],
    [" ", "Space"],
    ["up", "ArrowUp"],
    ["ArrowDown", "ArrowDown"],
    ["left", "ArrowLeft"],
    ["right", "ArrowRight"],
    ["del", "Delete"],
    ["PageUp", "PageUp"],
    ["pagedown", "PageDown"],
    ["f6", "F6"],
    ["F24", "F24"],
    ["Home", "Home"],
    ["Insert", "Insert"],
    ["backspace", "Backspace"],
  ])("canonicalizes %s to %s", (raw, canonical) => {
    expect(parseStep(raw)?.key).toBe(canonical);
  });

  it.each([
    "",
    "Foo",
    "Shift",
    "Control",
    "Meta",
    "Alt",
    "AltGraph",
    "OS",
    "Dead",
    "Process",
    "Unidentified",
    "Mod+Mod+s",
    "Ctrl+Control+s",
    "mod+shift",
    "+s",
  ])("rejects %j", (raw) => {
    expect(parseStep(raw)).toBeNull();
  });
});

describe("normalizeStep", () => {
  it("orders modifiers Mod, Ctrl, Meta, Alt, Shift", () => {
    expect(normalizeStep("Shift+Ctrl+s")).toBe("Ctrl+Shift+s");
    expect(normalizeStep("cmd+option+k")).toBe("Meta+Alt+k");
    expect(normalizeStep("MOD+s")).toBe("Mod+s");
  });

  it("keeps Shift as written, so a physical-position Shortcut survives", () => {
    expect(normalizeStep("Shift+?")).toBe("Shift+?");
    expect(normalizeStep("shift+mod+,")).toBe("Mod+Shift+,");
  });

  it("keeps Shift on letters, digits and named keys", () => {
    expect(normalizeStep("Mod+Shift+S")).toBe("Mod+Shift+s");
    expect(normalizeStep("Shift+1")).toBe("Shift+1");
    expect(normalizeStep("Shift+F6")).toBe("Shift+F6");
  });

  it("passes null through", () => {
    expect(normalizeStep("Foo")).toBeNull();
  });
});

describe("normalizeShortcut", () => {
  it("normalizes one or two steps", () => {
    expect(normalizeShortcut(["Mod+s"])).toEqual(["Mod+s"]);
    expect(normalizeShortcut(["g", "p"])).toEqual(["g", "p"]);
    expect(normalizeShortcut(["alt+Shift+?"])).toEqual(["Alt+Shift+?"]);
  });

  it("rejects wrong lengths and invalid steps", () => {
    expect(normalizeShortcut([])).toBeNull();
    expect(normalizeShortcut(["g", "p", "x"])).toBeNull();
    expect(normalizeShortcut(["Mod+s", "Foo"])).toBeNull();
  });
});

describe("shortcutKey", () => {
  it("joins normalized steps", () => {
    expect(shortcutKey(["g", "p"])).toBe("g p");
    expect(shortcutKey(["Mod+s"])).toBe("Mod+s");
  });
});

describe("stepsFromEvent", () => {
  it("maps Ctrl to Mod off Mac and Meta to Mod on Mac", () => {
    expect(stepsFromEvent(keyEvent({ key: "s", code: "KeyS", ctrlKey: true }), false)).toEqual([
      "Mod+s",
    ]);
    expect(stepsFromEvent(keyEvent({ key: "s", code: "KeyS", metaKey: true }), true)).toEqual([
      "Mod+s",
    ]);
  });

  it("keeps Ctrl as Ctrl on Mac and Meta as Meta elsewhere", () => {
    expect(stepsFromEvent(keyEvent({ key: "s", code: "KeyS", ctrlKey: true }), true)).toEqual([
      "Ctrl+s",
    ]);
    expect(stepsFromEvent(keyEvent({ key: "s", code: "KeyS", metaKey: true }), false)).toEqual([
      "Meta+s",
    ]);
  });

  it("tries the exact combo, then the typed symbol, then the physical key", () => {
    expect(stepsFromEvent(keyEvent({ key: "!", code: "Digit1", shiftKey: true }), false)).toEqual([
      "Shift+!",
      "!",
      "Shift+1",
    ]);
    // A US keyboard types "<" for Ctrl+Shift+,.
    expect(
      stepsFromEvent(keyEvent({ key: "<", code: "Comma", ctrlKey: true, shiftKey: true }), false)
    ).toEqual(["Mod+Shift+<", "Mod+<", "Mod+Shift+,"]);
  });

  it("matches what a test driver sends for a shifted symbol", () => {
    // Playwright reports the unshifted key with shiftKey set.
    expect(
      stepsFromEvent(keyEvent({ key: ",", code: "Comma", ctrlKey: true, shiftKey: true }), false)
    ).toEqual(["Mod+Shift+,", "Mod+,"]);
    expect(stepsFromEvent(keyEvent({ key: "1", code: "Digit1", shiftKey: true }), false)).toEqual([
      "Shift+1",
    ]);
  });

  it("adds the physical fallback for a non-Latin letter", () => {
    expect(stepsFromEvent(keyEvent({ key: "ы", code: "KeyS", ctrlKey: true }), false)).toEqual([
      "Mod+ы",
      "Mod+s",
    ]);
  });

  it("does not fall back when the key is already a Latin letter", () => {
    expect(stepsFromEvent(keyEvent({ key: "x", code: "KeyB", ctrlKey: true }), false)).toEqual([
      "Mod+x",
    ]);
  });

  it("returns nothing for a bare modifier, Dead or Process", () => {
    expect(stepsFromEvent(keyEvent({ key: "Shift" }), false)).toEqual([]);
    expect(stepsFromEvent(keyEvent({ key: "Dead" }), false)).toEqual([]);
    expect(stepsFromEvent(keyEvent({ key: "Process" }), false)).toEqual([]);
    expect(stepsFromEvent(keyEvent({ key: "Unidentified" }), false)).toEqual([]);
  });

  it("keeps a named key and applies Shift", () => {
    expect(
      stepsFromEvent(keyEvent({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }), false)
    ).toEqual(["Alt+ArrowLeft"]);
    expect(
      stepsFromEvent(keyEvent({ key: "Z", code: "KeyZ", metaKey: true, shiftKey: true }), true)
    ).toEqual(["Mod+Shift+z"]);
  });
});

describe("isIgnoredKeyEvent", () => {
  it("ignores composing, keyCode 229 and dead keys", () => {
    expect(isIgnoredKeyEvent({ isComposing: true, key: "a", keyCode: 0 })).toBe(true);
    expect(isIgnoredKeyEvent({ isComposing: false, key: "a", keyCode: 229 })).toBe(true);
    expect(isIgnoredKeyEvent({ isComposing: false, key: "Dead", keyCode: 0 })).toBe(true);
    expect(isIgnoredKeyEvent({ isComposing: false, key: "Process", keyCode: 0 })).toBe(true);
    expect(isIgnoredKeyEvent({ isComposing: false, key: "a", keyCode: 65 })).toBe(false);
  });
});

describe("isRecordableStep", () => {
  it("refuses unmodified navigation exits", () => {
    expect(isRecordableStep("Enter")).toBe(false);
    expect(isRecordableStep("Escape")).toBe(false);
    expect(isRecordableStep("Tab")).toBe(false);
    expect(isRecordableStep("Shift+Tab")).toBe(false);
  });

  it("accepts modified versions and ordinary keys", () => {
    expect(isRecordableStep("Mod+Enter")).toBe(true);
    expect(isRecordableStep("Shift+Enter")).toBe(true);
    expect(isRecordableStep("Alt+Escape")).toBe(true);
    expect(isRecordableStep("a")).toBe(true);
  });

  it("refuses an invalid step", () => {
    expect(isRecordableStep("Foo")).toBe(false);
  });
});

describe("isReservedOnWeb", () => {
  it.each([
    "Mod+n",
    "mod+N",
    "Mod+t",
    "Mod+w",
    "Mod+Shift+n",
    "Mod+Shift+t",
    "Mod+Shift+w",
    "Mod+Tab",
    "Mod+Shift+Tab",
    "Ctrl+Tab",
    "Ctrl+Shift+Tab",
  ])("reserves %s", (step) => {
    expect(isReservedOnWeb(step)).toBe(true);
  });

  it.each(["Mod+s", "Ctrl+n", "Alt+n", "Mod+f"])("leaves %s free", (step) => {
    expect(isReservedOnWeb(step)).toBe(false);
  });
});

describe("isSingleKey", () => {
  it("is true only without Mod, Ctrl, Meta or Alt", () => {
    expect(isSingleKey(["g", "p"])).toBe(true);
    expect(isSingleKey(["Shift+1"])).toBe(true);
    expect(isSingleKey(["Mod+s"])).toBe(false);
    expect(isSingleKey(["Alt+s"])).toBe(false);
    expect(isSingleKey(["Ctrl+s"])).toBe(false);
    expect(isSingleKey(["Meta+s"])).toBe(false);
  });
});

describe("formatShortcut", () => {
  it("returns one group per step", () => {
    expect(formatShortcut(["Mod+s"], false)).toEqual({
      groups: [["Ctrl", "S"]],
      isSequence: false,
    });
    expect(formatShortcut(["g", "p"], false)).toEqual({ groups: [["G"], ["P"]], isSequence: true });
    expect(formatShortcut(["Mod+Alt+s"], true)).toEqual({
      groups: [["⌘", "⌥", "S"]],
      isSequence: false,
    });
    expect(formatShortcut(["Mod++"], false)).toEqual({
      groups: [["Ctrl", "+"]],
      isSequence: false,
    });
    expect(formatShortcut(["F11"], false)).toEqual({ groups: [["F11"]], isSequence: false });
    expect(formatShortcut(["Mod+Shift+b"], false)).toEqual({
      groups: [["Ctrl", "Shift", "B"]],
      isSequence: false,
    });
  });

  it("uses Mac glyphs and short key names", () => {
    expect(formatShortcut(["Ctrl+Shift+Tab"], true)).toEqual({
      groups: [["⌃", "⇧", "Tab"]],
      isSequence: false,
    });
    expect(formatShortcut(["Escape"], false)).toEqual({ groups: [["Esc"]], isSequence: false });
    expect(formatShortcut(["ArrowUp"], false)).toEqual({ groups: [["↑"]], isSequence: false });
  });
});

describe("toAriaKeyShortcuts", () => {
  it("renders a single chord", () => {
    expect(toAriaKeyShortcuts(["Mod+Shift+b"], false)).toBe("Control+Shift+B");
    expect(toAriaKeyShortcuts(["Mod+Shift+b"], true)).toBe("Meta+Shift+B");
    expect(toAriaKeyShortcuts(["Ctrl+Tab"], false)).toBe("Control+Tab");
    expect(toAriaKeyShortcuts(["Mod+ArrowUp"], false)).toBe("Control+ArrowUp");
    expect(toAriaKeyShortcuts([" "], false)).toBe("Space");
  });

  it("returns null for sequences and the plus key", () => {
    expect(toAriaKeyShortcuts(["g", "p"], false)).toBeNull();
    expect(toAriaKeyShortcuts(["Mod++"], false)).toBeNull();
  });
});

describe("recordedStepFromEvent", () => {
  it("records the symbol the author typed, without the Shift that produced it", () => {
    expect(
      recordedStepFromEvent(keyEvent({ key: "?", code: "Slash", shiftKey: true }), false)
    ).toBe("?");
    expect(
      recordedStepFromEvent(
        keyEvent({ key: "<", code: "Comma", ctrlKey: true, shiftKey: true }),
        false
      )
    ).toBe("Mod+<");
  });

  it("keeps Shift on letters and named keys, and Mod per platform", () => {
    expect(
      recordedStepFromEvent(
        keyEvent({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }),
        false
      )
    ).toBe("Mod+Shift+k");
    expect(recordedStepFromEvent(keyEvent({ key: "F6", code: "F6", shiftKey: true }), false)).toBe(
      "Shift+F6"
    );
    expect(recordedStepFromEvent(keyEvent({ key: "s", code: "KeyS", metaKey: true }), true)).toBe(
      "Mod+s"
    );
  });

  it("records nothing for a lone modifier or a dead key", () => {
    expect(
      recordedStepFromEvent(keyEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true }), false)
    ).toBeNull();
    expect(recordedStepFromEvent(keyEvent({ key: "Dead", code: "BracketLeft" }), false)).toBeNull();
  });
});
