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
