import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useShortcutSettingsStore, SHORTCUT_STORAGE_KEY } from "@/features/settings/shortcut-store";
import { findPhraseConflict } from "@/features/dictation/phrase-conflicts";
import { normalizeCustomVoiceCommands } from "@/features/dictation/voice-commands";
import {
  DEFAULT_SHORTCUT_SETTINGS,
  effectiveShortcuts,
  findConflicts,
  findResetConflicts,
  inactiveBindings,
  normalizeShortcuts,
  parseShortcutFile,
  serializeShortcutFile,
  type CustomShortcuts,
} from "@/lib/shortcut-resolve";
import { registerPluginCommands, type PluginRegistration } from "@/lib/shortcut-registry";

const unregisters: Array<() => void> = [];
afterEach(() => {
  while (unregisters.length > 0) unregisters.pop()?.();
});

function register(pluginId: string, registration: PluginRegistration) {
  const unregister = registerPluginCommands(pluginId, registration);
  unregisters.push(unregister);
  return unregister;
}

const echoesId = "plugin.echoes.showReport" as const;

function echoesRegistration(
  overrides: Partial<PluginRegistration["commands"][number]> = {}
): PluginRegistration {
  return {
    defaultLanguage: "en",
    commands: [
      {
        id: "showReport",
        label: "Show report",
        contexts: ["global"],
        defaults: [["Mod+Alt+r"]],
        ...overrides,
      },
    ],
  };
}

const custom = () => useShortcutSettingsStore.getState().shortcuts.custom;
const voice = () => useShortcutSettingsStore.getState().shortcuts.voice;

beforeEach(() => {
  localStorage.clear();
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
});

describe("retained Plugin preferences", () => {
  it("keeps an unknown id under plugin. and drops unknown ids outside it", () => {
    const settings = normalizeShortcuts({
      version: 2,
      custom: {
        "plugin.echoes.showReport": [["Mod+Alt+r"]],
        "nope.nope": [["Mod+q"]],
      },
      voice: {
        "plugin.echoes.showReport": { es: ["mostrar informe"] },
        "nope.nope": { es: ["no existe"] },
      },
      singleKeyEnabled: true,
    });
    expect(settings.custom).toEqual({ "plugin.echoes.showReport": [["Mod+Alt+r"]] });
    expect(settings.voice).toEqual({ "plugin.echoes.showReport": { es: ["mostrar informe"] } });
  });

  it("keeps a retained preference inactive while the Plugin is absent and active again when it returns", () => {
    useShortcutSettingsStore.setState({
      shortcuts: normalizeShortcuts({
        version: 2,
        custom: { "plugin.echoes.showReport": [["Mod+Alt+9"]] },
        singleKeyEnabled: true,
      }),
    });
    // Absent: the preference is stored but no Command exists to run.
    expect(custom()["plugin.echoes.showReport"]).toEqual([["Mod+Alt+9"]]);

    register("echoes", echoesRegistration());
    expect(effectiveShortcuts(echoesId, custom(), false)).toEqual([["Mod+Alt+9"]]);

    unregisters.pop()?.();
    expect(custom()["plugin.echoes.showReport"]).toEqual([["Mod+Alt+9"]]);
  });

  it("migrates a retained preference through a same-Plugin rename on registration", () => {
    useShortcutSettingsStore.setState({
      shortcuts: normalizeShortcuts({
        version: 2,
        custom: { "plugin.echoes.oldReport": [["Mod+Alt+9"]] },
        voice: { "plugin.echoes.oldReport": { en: ["show the old report"] } },
        singleKeyEnabled: true,
      }),
    });

    register("echoes", {
      ...echoesRegistration(),
      commandRenames: { oldReport: "showReport" },
    });

    expect(custom()["plugin.echoes.showReport"]).toEqual([["Mod+Alt+9"]]);
    expect(custom()["plugin.echoes.oldReport"]).toBeUndefined();
    expect(voice()["plugin.echoes.showReport"]).toEqual({ en: ["show the old report"] });
    expect(voice()["plugin.echoes.oldReport"]).toBeUndefined();
  });

  it("applies a registered Plugin's renames while loading settings", () => {
    register("echoes", { ...echoesRegistration(), commandRenames: { oldReport: "showReport" } });
    const settings = normalizeShortcuts({
      version: 2,
      custom: { "plugin.echoes.oldReport": [["Mod+Alt+9"]] },
      singleKeyEnabled: true,
    });
    expect(settings.custom).toEqual({ "plugin.echoes.showReport": [["Mod+Alt+9"]] });
  });

  it("prefers the declared id's own preference over a renamed old entry", () => {
    register("echoes", { ...echoesRegistration(), commandRenames: { oldReport: "showReport" } });
    const settings = normalizeShortcuts({
      version: 2,
      custom: {
        "plugin.echoes.oldReport": [["Mod+Alt+9"]],
        "plugin.echoes.showReport": [["Mod+Alt+8"]],
      },
      singleKeyEnabled: true,
    });
    expect(settings.custom).toEqual({ "plugin.echoes.showReport": [["Mod+Alt+8"]] });
  });

  it("erases one Plugin's preferences explicitly and leaves the rest", () => {
    useShortcutSettingsStore.setState({
      shortcuts: normalizeShortcuts({
        version: 2,
        custom: {
          "plugin.echoes.showReport": [["Mod+Alt+9"]],
          "plugin.other.cmd": [["Mod+Alt+8"]],
          "common.save": [["Mod+Alt+k"]],
        },
        voice: {
          "plugin.echoes.showReport": { en: ["show report now"] },
          "plugin.other.cmd": { en: ["other command now"] },
        },
        singleKeyEnabled: true,
      }),
    });

    useShortcutSettingsStore.getState().erasePluginPreferences("echoes");

    expect(custom()).toEqual({
      "plugin.other.cmd": [["Mod+Alt+8"]],
      "common.save": [["Mod+Alt+k"]],
    });
    expect(voice()).toEqual({ "plugin.other.cmd": { en: ["other command now"] } });
  });

  it("erases retained Plugin preferences on Reset all", () => {
    useShortcutSettingsStore.setState({
      shortcuts: normalizeShortcuts({
        version: 2,
        custom: { "plugin.echoes.showReport": [["Mod+Alt+9"]] },
        voice: { "plugin.echoes.showReport": { en: ["show report now"] } },
        singleKeyEnabled: true,
      }),
    });

    useShortcutSettingsStore.getState().resetAllShortcuts();

    expect(custom()).toEqual({});
    expect(voice()).toEqual({});
  });

  it("carries retained Plugin preferences through a Shortcut File", () => {
    const file = serializeShortcutFile(
      { "plugin.echoes.showReport": [["Mod+Alt+9"]] },
      { "plugin.echoes.showReport": { es: ["mostrar informe"] } }
    );
    const result = parseShortcutFile(file, false);
    expect(result).toEqual({
      ok: true,
      custom: { "plugin.echoes.showReport": [["Mod+Alt+9"]] },
      voice: { "plugin.echoes.showReport": { es: ["mostrar informe"] } },
      dropped: [],
    });
  });

  it("loads retained Plugin Voice Commands through the live conflict check", () => {
    const file = serializeShortcutFile(
      {},
      { "plugin.echoes.showReport": { es: ["mostrar informe"] } }
    );
    const result = parseShortcutFile(
      file,
      false,
      ({ id, language, phrase, accepted }) =>
        findPhraseConflict({
          language,
          phrase,
          candidate: { kind: "voice", id },
          voice: accepted,
        }) !== null
    );
    expect(result).toEqual({
      ok: true,
      custom: {},
      voice: { "plugin.echoes.showReport": { es: ["mostrar informe"] } },
      dropped: [],
    });
  });

  it("keeps a Plugin binding that conflicts with a live Command, inactive, while loading", () => {
    register("echoes", echoesRegistration());
    const file = serializeShortcutFile({ "plugin.echoes.showReport": [["Mod+s"]] });
    const result = parseShortcutFile(file, false);
    expect(result).toMatchObject({
      ok: true,
      custom: { "plugin.echoes.showReport": [["Mod+s"]] },
      dropped: [],
    });
    if (!result.ok) throw new Error("expected the file to load");
    expect(effectiveShortcuts(echoesId, result.custom, false)).toEqual([]);
    expect(inactiveBindings(result.custom, false)).toContainEqual({
      kind: "shortcut",
      id: echoesId,
      shortcut: ["Mod+s"],
      collision: "same",
      withId: "common.save",
    });
  });

  it("keeps a conflicting Plugin Voice phrase, inactive, while loading", () => {
    register("echoes", echoesRegistration({ label: "Dark theme" }));
    const file = serializeShortcutFile({}, { "plugin.echoes.showReport": { en: ["dark theme"] } });
    const result = parseShortcutFile(
      file,
      false,
      ({ id, language, phrase, accepted }) =>
        findPhraseConflict({
          language,
          phrase,
          candidate: { kind: "voice", id },
          voice: accepted,
        }) !== null
    );
    expect(result).toMatchObject({
      ok: true,
      voice: { "plugin.echoes.showReport": { en: ["dark theme"] } },
      dropped: [],
    });
    if (!result.ok) throw new Error("expected the file to load");
    expect(inactiveBindings(result.custom, false, result.voice)).toContainEqual({
      kind: "phrase",
      id: echoesId,
      language: "en",
      phrase: "dark theme",
      withId: "global.themeDark",
    });
  });

  it("normalizes retained Plugin Voice Commands but not other unknown ids", () => {
    expect(
      normalizeCustomVoiceCommands({
        "plugin.echoes.showReport": { es: ["mostrar informe"] },
        "nope.nope": { es: ["no existe"] },
      })
    ).toEqual({ "plugin.echoes.showReport": { es: ["mostrar informe"] } });
  });
});

describe("Plugin Shortcut conflicts", () => {
  it("keeps an existing active binding and shows the new Plugin binding as inactive", () => {
    register("echoes", echoesRegistration({ defaults: [["Mod+s"]] }));

    expect(effectiveShortcuts(echoesId, {}, false)).toEqual([]);
    expect(inactiveBindings({}, false)).toEqual([
      {
        kind: "shortcut",
        id: echoesId,
        shortcut: ["Mod+s"],
        collision: "same",
        withId: "common.save",
      },
    ]);
  });

  it("treats a sequence that starts another active binding as a conflict", () => {
    register("echoes", echoesRegistration({ defaults: [["g"]] }));

    expect(effectiveShortcuts(echoesId, {}, false)).toEqual([]);
    expect(inactiveBindings({}, false)).toContainEqual({
      kind: "shortcut",
      id: echoesId,
      shortcut: ["g"],
      collision: "prefix",
      withId: "global.gotoProjects",
    });
  });

  it("keeps a Plugin binding whose Contexts never share a screen", () => {
    register("echoes", echoesRegistration({ contexts: ["canvas"], defaults: [["Mod+Alt+q"]] }));

    expect(effectiveShortcuts(echoesId, {}, false)).toEqual([["Mod+Alt+q"]]);
    expect(inactiveBindings({}, false)).toEqual([]);
  });

  it("lets the other Plugin win the key while one is away, and keeps the returning binding inactive", () => {
    register("echoes", echoesRegistration());
    unregisters.pop()?.();

    register("other", {
      defaultLanguage: "en",
      commands: [
        {
          id: "twin",
          label: "Other twin",
          contexts: ["global"],
          defaults: [["Mod+Alt+r"]],
        },
      ],
    });
    const otherId = "plugin.other.twin" as const;
    expect(effectiveShortcuts(otherId, {}, false)).toEqual([["Mod+Alt+r"]]);

    register("echoes", echoesRegistration());
    expect(effectiveShortcuts(otherId, {}, false)).toEqual([["Mod+Alt+r"]]);
    expect(effectiveShortcuts(echoesId, {}, false)).toEqual([]);
    expect(inactiveBindings({}, false)).toContainEqual({
      kind: "shortcut",
      id: echoesId,
      shortcut: ["Mod+Alt+r"],
      collision: "same",
      withId: otherId,
    });
  });

  it("keeps a Plugin's place in the conflict order across an update", () => {
    register("echoes", echoesRegistration());
    register("other", {
      defaultLanguage: "en",
      commands: [
        { id: "twin", label: "Other twin", contexts: ["global"], defaults: [["Mod+Alt+r"]] },
      ],
    });
    const otherId = "plugin.other.twin" as const;
    expect(effectiveShortcuts(otherId, {}, false)).toEqual([]);

    register("echoes", echoesRegistration({ label: "Show echoes" }));

    expect(effectiveShortcuts(echoesId, {}, false)).toEqual([["Mod+Alt+r"]]);
    expect(effectiveShortcuts(otherId, {}, false)).toEqual([]);
  });

  it("makes a binding new in an update lose to an already active binding", () => {
    register("echoes", echoesRegistration());
    register("other", {
      defaultLanguage: "en",
      commands: [
        { id: "twin", label: "Other twin", contexts: ["global"], defaults: [["Mod+Alt+k"]] },
      ],
    });
    const otherId = "plugin.other.twin" as const;
    expect(effectiveShortcuts(otherId, {}, false)).toEqual([["Mod+Alt+k"]]);

    // The update adds Ctrl+K: the key is new, so the held binding wins.
    register("echoes", echoesRegistration({ defaults: [["Mod+Alt+r"], ["Mod+Alt+k"]] }));

    expect(effectiveShortcuts(otherId, {}, false)).toEqual([["Mod+Alt+k"]]);
    expect(effectiveShortcuts(echoesId, {}, false)).toEqual([["Mod+Alt+r"]]);
    expect(inactiveBindings({}, false)).toContainEqual({
      kind: "shortcut",
      id: echoesId,
      shortcut: ["Mod+Alt+k"],
      collision: "same",
      withId: otherId,
    });
  });

  it("re-checks conflicts when the settings change", () => {
    register("echoes", echoesRegistration());
    const conflicting: CustomShortcuts = { [echoesId]: [["Mod+s"]] };

    expect(effectiveShortcuts(echoesId, conflicting, false)).toEqual([]);

    const free: CustomShortcuts = { [echoesId]: [["Mod+Alt+9"]] };
    expect(effectiveShortcuts(echoesId, free, false)).toEqual([["Mod+Alt+9"]]);
  });

  it("never lets an inactive binding reserve its key against a later Plugin", () => {
    const unregisterEchoes = register("echoes", echoesRegistration());
    unregisterEchoes();
    register("other", {
      defaultLanguage: "en",
      commands: [
        { id: "twin", label: "Other twin", contexts: ["global"], defaults: [["Mod+Alt+r"]] },
      ],
    });
    const otherId = "plugin.other.twin" as const;
    register("echoes", echoesRegistration());
    register("third", {
      defaultLanguage: "en",
      commands: [
        { id: "twin", label: "Third twin", contexts: ["global"], defaults: [["Mod+Alt+r"]] },
      ],
    });
    const thirdId = "plugin.third.twin" as const;

    // echoes' returning binding lost to other and never reserved the key; third
    // loses to the one active binding too, not to echoes' inactive one.
    expect(effectiveShortcuts(thirdId, {}, false)).toEqual([]);
    expect(inactiveBindings({}, false)).toContainEqual({
      kind: "shortcut",
      id: thirdId,
      shortcut: ["Mod+Alt+r"],
      collision: "same",
      withId: otherId,
    });
    expect(effectiveShortcuts(echoesId, {}, false)).toEqual([]);
  });
});

describe("a core Default is an existing binding", () => {
  const pluginId = "plugin.echoes.showReport" as const;
  // editor.insertLink ships Mod+K as an untouched core Default.

  it("never strips an untouched core Default for a Plugin", () => {
    register("echoes", echoesRegistration({ defaults: [["Mod+k"]] }));

    expect(custom()["editor.insertLink"]).toBeUndefined();
    expect(effectiveShortcuts("editor.insertLink", custom(), false)).toEqual([["Mod+k"]]);
    expect(inactiveBindings(custom(), false)).toContainEqual({
      kind: "shortcut",
      id: pluginId,
      shortcut: ["Mod+k"],
      collision: "same",
      withId: "editor.insertLink",
    });
  });

  it("does not strip it at store hydration either", async () => {
    register("echoes", echoesRegistration({ defaults: [["Mod+k"]] }));
    localStorage.setItem(
      SHORTCUT_STORAGE_KEY,
      JSON.stringify({
        state: {
          shortcuts: { version: 2, custom: {}, voice: {}, singleKeyEnabled: true },
        },
        version: 0,
      })
    );

    await useShortcutSettingsStore.persist.rehydrate();
    const { custom } = useShortcutSettingsStore.getState().shortcuts;
    expect(custom["editor.insertLink"]).toBeUndefined();
    expect(effectiveShortcuts("editor.insertLink", custom, false)).toEqual([["Mod+k"]]);
  });

  it("leaves the stored Custom Shortcuts unchanged when the Plugin unregisters", () => {
    const before = structuredClone(custom());
    const unregister = register("echoes", echoesRegistration({ defaults: [["Mod+k"]] }));
    unregister();

    expect(custom()).toEqual(before);
    expect(effectiveShortcuts("editor.insertLink", custom(), false)).toEqual([["Mod+k"]]);
  });
});

describe("no write path lets a core binding take an active Plugin key", () => {
  it("Change and Add report the active Plugin binding through findConflicts", () => {
    register("echoes", echoesRegistration({ defaults: [["Mod+Alt+k"]] }));

    expect(findConflicts("common.save", ["Mod+Alt+k"], {}, false)).toContainEqual({
      id: echoesId,
      shortcut: ["Mod+Alt+k"],
      kind: "same",
      locked: false,
    });
  });

  it("Reset reports the active Plugin binding its Defaults would take", () => {
    register("echoes", echoesRegistration({ defaults: [["Mod+s"]] }));
    const custom: CustomShortcuts = { "common.save": [["Mod+Alt+s"]] };

    expect(findResetConflicts("common.save", custom, false)).toContainEqual({
      id: echoesId,
      shortcut: ["Mod+s"],
      kind: "same",
      locked: false,
    });
  });

  it("Shortcut File load drops a core key an active Plugin holds", () => {
    register("echoes", echoesRegistration({ defaults: [["Mod+Alt+k"]] }));
    const file = serializeShortcutFile({ "common.save": [["Mod+Alt+k"]] });

    expect(parseShortcutFile(file, false)).toMatchObject({
      ok: true,
      custom: {},
      dropped: [{ id: "common.save", shortcut: ["Mod+Alt+k"], reason: "conflict" }],
    });
  });

  it("a core Default always counts as existing, never a newcomer", () => {
    register("echoes", echoesRegistration({ defaults: [["Mod+k"]] }));

    expect(effectiveShortcuts("editor.insertLink", {}, false)).toEqual([["Mod+k"]]);
    expect(inactiveBindings({}, false)).toContainEqual({
      kind: "shortcut",
      id: echoesId,
      shortcut: ["Mod+k"],
      collision: "same",
      withId: "editor.insertLink",
    });
  });
});
