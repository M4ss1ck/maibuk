import { afterEach, describe, expect, it } from "vitest";
import { labelPhrase } from "@/features/dictation/label-phrases";
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
} from "@/features/dictation/interpreter";
import { phraseWords } from "@/features/dictation/normalize";
import {
  buildVoiceCommandTable,
  defaultVoicePhrases,
  matchVoiceCommand,
  voiceEligibleCommands,
  voicePhrases,
} from "@/features/dictation/voice-commands";
import { inactiveBindings } from "@/lib/shortcut-resolve";
import {
  commandLabel,
  registerPluginCommands,
  type PluginRegistration,
} from "@/lib/shortcut-registry";

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

const englishOnly: PluginRegistration = {
  defaultLanguage: "en",
  commands: [
    {
      id: "showReport",
      label: "Show report",
      contexts: ["global"],
      defaults: [],
    },
  ],
};

describe("Plugin Command Voice Commands", () => {
  it("derives a default phrase only for the languages the declaration supplies", () => {
    register("echoes", englishOnly);

    expect(defaultVoicePhrases(echoesId, "en")).toEqual(["Show report"]);
    expect(defaultVoicePhrases(echoesId, "es")).toEqual([]);
    expect(labelPhrase(echoesId, "en")).toBe("Show report");
    expect(labelPhrase(echoesId, "es")).toBeNull();
  });

  it("uses supplied labels per language and falls back only for the UI", () => {
    register("echoes", {
      defaultLanguage: "en",
      commands: [
        {
          id: "showReport",
          label: "Show report",
          labels: { es: "Mostrar informe" },
          contexts: ["global"],
          defaults: [],
        },
      ],
    });

    expect(defaultVoicePhrases(echoesId, "en")).toEqual(["Show report"]);
    expect(defaultVoicePhrases(echoesId, "es")).toEqual(["Mostrar informe"]);
    expect(commandLabel(echoesId, (key) => key, "es")).toBe("Mostrar informe");
  });

  it("keeps explicit phrases per language and the label-derived phrase elsewhere", () => {
    register("echoes", {
      defaultLanguage: "en",
      commands: [
        {
          id: "showReport",
          label: "Show report",
          contexts: ["global"],
          defaults: [],
          voice: { phrases: { es: ["mostrar informe"] } },
        },
      ],
    });

    expect(defaultVoicePhrases(echoesId, "en")).toEqual(["Show report"]);
    expect(defaultVoicePhrases(echoesId, "es")).toEqual(["mostrar informe"]);
  });

  it("routes an English-only Command with a custom Spanish phrase through Dictation", () => {
    register("echoes", englishOnly);
    const custom = { [echoesId]: { es: ["mostrar informe"] } };
    const table = buildVoiceCommandTable("es", custom);

    expect(matchVoiceCommand(table, phraseWords("mostrar informe"))).toEqual({
      id: echoesId,
      polarity: null,
    });
    expect(voicePhrases(echoesId, "es", custom)).toEqual(["mostrar informe"]);
  });

  it("runs the plugin Command through the interpreter for a custom phrase", () => {
    register("echoes", englishOnly);
    const table = buildPhraseTable("es", { voice: { [echoesId]: { es: ["mostrar informe"] } } });
    const output = interpret({
      line: "mostrar informe",
      before: "",
      capabilities: { casing: false, punctuation: false, streaming: true },
      table,
      state: INITIAL_INTERPRETER_STATE,
    });

    expect(output.result).toMatchObject({ kind: "voice_command", id: echoesId });
  });

  it("lists the Command as voice-eligible only while registered", () => {
    register("echoes", englishOnly);
    expect(voiceEligibleCommands()).toContain(echoesId);

    unregisters.pop()?.();
    expect(voiceEligibleCommands()).not.toContain(echoesId);
    expect(matchVoiceCommand(buildVoiceCommandTable("en"), phraseWords("show report"))).toBeNull();
  });
});

describe("Plugin Voice phrase conflicts", () => {
  it("keeps a Plugin label phrase inactive when a core phrase already owns it", () => {
    register("echoes", {
      defaultLanguage: "en",
      commands: [{ id: "showReport", label: "Dark theme", contexts: ["global"], defaults: [] }],
    });

    expect(matchVoiceCommand(buildVoiceCommandTable("en"), phraseWords("dark theme"))).toEqual({
      id: "global.themeDark",
      polarity: null,
    });
    expect(inactiveBindings({}, false)).toContainEqual({
      kind: "phrase",
      id: echoesId,
      language: "en",
      phrase: "Dark theme",
      withId: "global.themeDark",
    });
  });

  it("does not let a Plugin phrase take a core Command's verb and target line", () => {
    register("echoes", {
      defaultLanguage: "en",
      commands: [{ id: "showReport", label: "Undo that", contexts: ["global"], defaults: [] }],
    });

    expect(matchVoiceCommand(buildVoiceCommandTable("en"), phraseWords("undo that"))).toEqual({
      id: "common.undo",
      polarity: null,
    });
    expect(inactiveBindings({}, false)).toContainEqual({
      kind: "phrase",
      id: echoesId,
      language: "en",
      phrase: "Undo that",
      withId: "common.undo",
    });
  });

  it("keeps the earlier Plugin's phrase active and the later one inactive", () => {
    register("first", {
      defaultLanguage: "en",
      commands: [{ id: "repeat", label: "Repeat words", contexts: ["global"], defaults: [] }],
    });
    register("second", {
      defaultLanguage: "en",
      commands: [{ id: "repeat", label: "Repeat words", contexts: ["global"], defaults: [] }],
    });
    const firstId = "plugin.first.repeat" as const;
    const secondId = "plugin.second.repeat" as const;

    expect(matchVoiceCommand(buildVoiceCommandTable("en"), phraseWords("repeat words"))).toEqual({
      id: firstId,
      polarity: null,
    });
    expect(inactiveBindings({}, false)).toContainEqual({
      kind: "phrase",
      id: secondId,
      language: "en",
      phrase: "Repeat words",
      withId: firstId,
    });
  });

  it("keeps a conflicting custom phrase inactive in the interpreter", () => {
    register("echoes", englishOnly);
    const custom = { [echoesId]: { en: ["dark theme"] } };
    const table = buildPhraseTable("en", { voice: custom });
    const output = interpret({
      line: "dark theme",
      before: "",
      capabilities: { casing: false, punctuation: false, streaming: true },
      table,
      state: INITIAL_INTERPRETER_STATE,
    });

    expect(output.result).toMatchObject({ kind: "voice_command", id: "global.themeDark" });
    expect(inactiveBindings({}, false, custom)).toContainEqual({
      kind: "phrase",
      id: echoesId,
      language: "en",
      phrase: "dark theme",
      withId: "global.themeDark",
    });
  });
});
