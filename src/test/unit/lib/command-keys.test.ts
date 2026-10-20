import { beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { pressRunsCommand } from "@/lib/command-keys";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";

vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

const press = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, ...init });

beforeEach(() => {
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
});

describe("pressRunsCommand", () => {
  it("matches a Command's Default Shortcut", () => {
    expect(pressRunsCommand(press("c", { ctrlKey: true }), "symbolItem.copy")).toBe(true);
    expect(pressRunsCommand(press("c"), "symbolItem.copy")).toBe(false);
    expect(pressRunsCommand(press("x", { ctrlKey: true }), "symbolItem.copy")).toBe(false);
  });

  it("follows a Custom Shortcut instead of the default", () => {
    useShortcutSettingsStore.setState({
      shortcuts: {
        ...structuredClone(DEFAULT_SHORTCUT_SETTINGS),
        custom: { "symbolItem.copy": [["Mod+Shift+k"]] },
      },
    });
    expect(pressRunsCommand(press("c", { ctrlKey: true }), "symbolItem.copy")).toBe(false);
    expect(
      pressRunsCommand(press("K", { ctrlKey: true, shiftKey: true }), "symbolItem.copy")
    ).toBe(true);
  });

  it("never matches a removed Shortcut or a press during composition", () => {
    useShortcutSettingsStore.setState({
      shortcuts: { ...structuredClone(DEFAULT_SHORTCUT_SETTINGS), custom: { "symbolItem.copy": [] } },
    });
    expect(pressRunsCommand(press("c", { ctrlKey: true }), "symbolItem.copy")).toBe(false);

    useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
    expect(
      pressRunsCommand(press("c", { ctrlKey: true, isComposing: true }), "symbolItem.copy")
    ).toBe(false);
  });

  it("ignores two-step sequences", () => {
    useShortcutSettingsStore.setState({
      shortcuts: {
        ...structuredClone(DEFAULT_SHORTCUT_SETTINGS),
        custom: { "symbolItem.copy": [["g", "c"]] },
      },
    });
    expect(pressRunsCommand(press("g"), "symbolItem.copy")).toBe(false);
  });
});
