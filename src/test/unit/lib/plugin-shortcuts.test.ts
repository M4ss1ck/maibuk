import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { findPhraseConflict } from "@/features/dictation/phrase-conflicts";
import { normalizeCustomVoiceCommands } from "@/features/dictation/voice-commands";
import {
  DEFAULT_SHORTCUT_SETTINGS,
  effectiveShortcuts,
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
          "common.save": [["Mod+k"]],
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
      "common.save": [["Mod+k"]],
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

  it("drops a Plugin binding that conflicts with a live Command while loading", () => {
    register("echoes", echoesRegistration());
    const file = serializeShortcutFile({ "plugin.echoes.showReport": [["Mod+s"]] });
    const result = parseShortcutFile(file, false);
    expect(result).toMatchObject({
      ok: true,
      custom: {},
      dropped: [{ id: "plugin.echoes.showReport", shortcut: ["Mod+s"], reason: "conflict" }],
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
      { id: echoesId, shortcut: ["Mod+s"], kind: "same", withId: "common.save" },
    ]);
  });

  it("treats a sequence that starts another active binding as a conflict", () => {
    register("echoes", echoesRegistration({ defaults: [["g"]] }));

    expect(effectiveShortcuts(echoesId, {}, false)).toEqual([]);
    expect(inactiveBindings({}, false)).toContainEqual({
      id: echoesId,
      shortcut: ["g"],
      kind: "prefix",
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
      id: echoesId,
      shortcut: ["Mod+Alt+r"],
      kind: "same",
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
      id: thirdId,
      shortcut: ["Mod+Alt+r"],
      kind: "same",
      withId: otherId,
    });
    expect(effectiveShortcuts(echoesId, {}, false)).toEqual([]);
  });
});
