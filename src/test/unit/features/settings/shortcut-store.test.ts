import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultVoicePhrases } from "@/features/dictation/voice-commands";
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
      version: 2,
      voice: {},
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
      version: 2,
      voice: {},
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

  it("setCommandVoicePhrases stores a language's list and the defaults again delete it", () => {
    const store = useShortcutSettingsStore.getState();
    store.setCommandVoicePhrases("editor.bold", "es", ["pon esto fuerte", "negrita", " "]);
    expect(useShortcutSettingsStore.getState().shortcuts.voice).toEqual({
      "editor.bold": { es: ["pon esto fuerte"] },
    });
    store.setCommandVoicePhrases("editor.bold", "en", []);
    expect(useShortcutSettingsStore.getState().shortcuts.voice["editor.bold"]).toEqual({
      es: ["pon esto fuerte"],
      en: [],
    });
    store.setCommandVoicePhrases("editor.bold", "es", defaultVoicePhrases("editor.bold", "es"));
    expect(useShortcutSettingsStore.getState().shortcuts.voice).toEqual({
      "editor.bold": { en: [] },
    });
  });

  it("ignores Commands that take no Voice Commands", () => {
    const before = useShortcutSettingsStore.getState().shortcuts;
    useShortcutSettingsStore.getState().setCommandVoicePhrases("common.save", "en", ["save it"]);
    expect(useShortcutSettingsStore.getState().shortcuts).toBe(before);
  });

  it("resetCommandVoicePhrases deletes one language's entry", () => {
    const store = useShortcutSettingsStore.getState();
    store.setCommandVoicePhrases("editor.bold", "es", ["pon esto fuerte"]);
    store.setCommandVoicePhrases("editor.bold", "en", ["make it heavy"]);
    store.resetCommandVoicePhrases("editor.bold", "es");
    expect(useShortcutSettingsStore.getState().shortcuts.voice).toEqual({
      "editor.bold": { en: ["make it heavy"] },
    });
    store.resetCommandVoicePhrases("editor.bold", "en");
    expect(useShortcutSettingsStore.getState().shortcuts.voice).toEqual({});
  });

  it("reset all and loading a file replace the Voice Commands too", () => {
    const store = useShortcutSettingsStore.getState();
    store.setCommandShortcuts("common.save", [["Mod+k"]]);
    store.setCommandVoicePhrases("editor.bold", "es", ["pon esto fuerte"]);
    store.replaceCustomShortcuts({}, { "editor.italic": { es: ["letra inclinada", "x"] } });
    expect(useShortcutSettingsStore.getState().shortcuts.custom).toEqual({});
    expect(useShortcutSettingsStore.getState().shortcuts.voice).toEqual({
      "editor.italic": { es: ["letra inclinada"] },
    });
    store.resetAllShortcuts();
    expect(useShortcutSettingsStore.getState().shortcuts.voice).toEqual({});
  });

  it("rehydrates a version 1 record into version 2 and keeps its Custom Shortcuts", async () => {
    localStorage.setItem(
      "maibuk-shortcuts",
      JSON.stringify({
        state: {
          shortcuts: {
            version: 1,
            custom: { "common.save": [["Mod+k"]] },
            singleKeyEnabled: false,
          },
        },
        version: 0,
      })
    );
    await useShortcutSettingsStore.persist.rehydrate();
    expect(useShortcutSettingsStore.getState().shortcuts).toEqual({
      version: 2,
      custom: { "common.save": [["Mod+k"]] },
      voice: {},
      singleKeyEnabled: false,
    });
  });

  it("persists custom Voice Commands and reads them back after a reload", async () => {
    useShortcutSettingsStore
      .getState()
      .setCommandVoicePhrases("editor.bold", "en", ["make bold", "heavy words"]);
    const stored = JSON.parse(localStorage.getItem("maibuk-shortcuts") ?? "{}");
    expect(stored.state.shortcuts.voice).toEqual({
      "editor.bold": { en: ["make bold", "heavy words"] },
    });
    // A fresh page load: the in-memory state is gone, storage is not.
    const saved = localStorage.getItem("maibuk-shortcuts") ?? "";
    useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
    localStorage.setItem("maibuk-shortcuts", saved);
    await useShortcutSettingsStore.persist.rehydrate();
    expect(useShortcutSettingsStore.getState().shortcuts.voice).toEqual({
      "editor.bold": { en: ["make bold", "heavy words"] },
    });
  });
});
