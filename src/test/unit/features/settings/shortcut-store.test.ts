import { beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS, type CustomShortcuts } from "@/lib/shortcut-resolve";

vi.mock("@/lib/platform/target", () => ({ IS_WEB: false }));

describe("useShortcutSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useShortcutSettingsStore.setState({
      shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS),
    });
  });

  it("defaults to the shipped shortcuts settings", () => {
    expect(useShortcutSettingsStore.getState().shortcuts).toEqual({
      version: 1,
      custom: {},
      singleKeyEnabled: true,
    });
  });

  it("setCommandShortcuts stores a custom list for a command", () => {
    useShortcutSettingsStore.getState().setCommandShortcuts("common.save", [["Mod+k"]]);
    expect(useShortcutSettingsStore.getState().shortcuts.custom["common.save"]).toEqual([
      ["Mod+k"],
    ]);
  });

  it("storing the command's defaults again deletes the custom entry", () => {
    useShortcutSettingsStore.getState().setCommandShortcuts("common.save", [["Mod+k"]]);
    useShortcutSettingsStore.getState().setCommandShortcuts("common.save", [["Mod+s"]]);
    expect(useShortcutSettingsStore.getState().shortcuts.custom["common.save"]).toBeUndefined();
  });

  it("keeps an empty list as an explicit No shortcut", () => {
    useShortcutSettingsStore.getState().setCommandShortcuts("common.save", []);
    expect(useShortcutSettingsStore.getState().shortcuts.custom["common.save"]).toEqual([]);
  });

  it("ignores sealed commands", () => {
    const before = useShortcutSettingsStore.getState().shortcuts;
    useShortcutSettingsStore.getState().setCommandShortcuts("bookList.openSelected", [["Mod+o"]]);
    const after = useShortcutSettingsStore.getState().shortcuts;
    expect(after).toBe(before);
    expect(after.custom["bookList.openSelected"]).toBeUndefined();
  });

  it("drops invalid steps and de-duplicates shortcuts", () => {
    useShortcutSettingsStore
      .getState()
      .setCommandShortcuts("common.save", [
        ["Mod+NotAKey"],
        ["Mod+q"],
        ["Mod+q"],
        ["Mod+q", "x", "y"],
      ]);
    expect(useShortcutSettingsStore.getState().shortcuts.custom["common.save"]).toEqual([
      ["Mod+q"],
    ]);
  });

  it("resetCommandShortcuts removes one custom entry", () => {
    useShortcutSettingsStore.getState().setCommandShortcuts("common.save", [["Mod+k"]]);
    useShortcutSettingsStore.getState().setCommandShortcuts("global.toggleTheme", [["Mod+l"]]);
    useShortcutSettingsStore.getState().resetCommandShortcuts("common.save");
    expect(useShortcutSettingsStore.getState().shortcuts.custom["common.save"]).toBeUndefined();
    expect(useShortcutSettingsStore.getState().shortcuts.custom["global.toggleTheme"]).toEqual([
      ["Mod+l"],
    ]);
  });

  it("resetAllShortcuts clears custom but keeps singleKeyEnabled", () => {
    useShortcutSettingsStore.getState().setCommandShortcuts("common.save", [["Mod+k"]]);
    useShortcutSettingsStore.getState().setSingleKeyShortcutsEnabled(false);
    useShortcutSettingsStore.getState().resetAllShortcuts();
    const { shortcuts } = useShortcutSettingsStore.getState();
    expect(shortcuts.custom).toEqual({});
    expect(shortcuts.singleKeyEnabled).toBe(false);
  });

  it("replaceCustomShortcuts normalizes and drops unknown ids", () => {
    useShortcutSettingsStore.getState().replaceCustomShortcuts({
      "bogus.command": [["Mod+q"]],
      "common.save": [["Mod+k"]],
    } as CustomShortcuts);
    expect(useShortcutSettingsStore.getState().shortcuts.custom).toEqual({
      "common.save": [["Mod+k"]],
    });
  });

  it("setSingleKeyShortcutsEnabled toggles the flag without touching custom", () => {
    useShortcutSettingsStore.getState().setSingleKeyShortcutsEnabled(false);
    expect(useShortcutSettingsStore.getState().shortcuts.singleKeyEnabled).toBe(false);
    expect(useShortcutSettingsStore.getState().shortcuts.custom).toEqual({});
  });

  it("merge normalizes a corrupt persisted shortcuts blob", async () => {
    localStorage.setItem(
      "maibuk-shortcuts",
      JSON.stringify({
        state: { shortcuts: "garbage" },
        version: 0,
      })
    );
    await useShortcutSettingsStore.persist.rehydrate();
    expect(useShortcutSettingsStore.getState().shortcuts).toEqual({
      version: 1,
      custom: {},
      singleKeyEnabled: true,
    });
  });

  it("merge drops a persisted custom entry with an unknown id", async () => {
    localStorage.setItem(
      "maibuk-shortcuts",
      JSON.stringify({
        state: {
          shortcuts: {
            version: 1,
            custom: { "bogus.command": [["Mod+q"]] },
            singleKeyEnabled: true,
          },
        },
        version: 0,
      })
    );
    await useShortcutSettingsStore.persist.rehydrate();
    expect(useShortcutSettingsStore.getState().shortcuts.custom).toEqual({});
  });
});
