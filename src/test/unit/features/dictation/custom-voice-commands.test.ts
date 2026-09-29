import { describe, expect, it } from "vitest";
import { buildPhraseTable, interpret } from "@/features/dictation/interpreter";
import { normalizePhrase } from "@/features/dictation/normalize";
import { findPhraseConflict } from "@/features/dictation/phrase-conflicts";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  buildVoiceCommandTable,
  defaultVoicePhrases,
  matchVoiceCommand,
  normalizeCustomVoiceCommands,
  voiceEligibleCommands,
  voicePhrasePolarity,
  voicePhrases,
  type CustomVoiceCommands,
} from "@/features/dictation/voice-commands";

const match = (language: DictationLanguage, custom: CustomVoiceCommands, line: string) =>
  matchVoiceCommand(buildVoiceCommandTable(language, custom), normalizePhrase(line).split(" "));

describe("custom Voice Commands in the table", () => {
  it("replaces that language's defaults and leaves the other language alone", () => {
    const custom: CustomVoiceCommands = { "editor.bold": { es: ["pon esto fuerte"] } };
    expect(match("es", custom, "pon esto fuerte")).toEqual({ id: "editor.bold", polarity: "on" });
    expect(match("es", custom, "activar negrita")).toBeNull();
    expect(match("en", custom, "make bold")).toEqual({ id: "editor.bold", polarity: "on" });
    // Other Commands keep their defaults.
    expect(match("es", custom, "poner cursiva")).toEqual({ id: "editor.italic", polarity: "on" });
  });

  it("matches an author's phrase only as the whole line", () => {
    const custom: CustomVoiceCommands = { "editor.bold": { es: ["pon esto fuerte"] } };
    expect(match("es", custom, "Pon esto fuerte.")).toEqual({ id: "editor.bold", polarity: "on" });
    expect(match("es", custom, "pon esto fuerte ahora")).toBeNull();
    expect(match("es", custom, "luego pon esto fuerte")).toBeNull();
  });

  it("keeps filler matching for a default phrase the author kept", () => {
    const custom: CustomVoiceCommands = { "editor.bold": { es: ["poner negrita"] } };
    expect(match("es", custom, "poner en negrita")).toEqual({ id: "editor.bold", polarity: "on" });
    expect(match("es", custom, "activar negrita")).toBeNull();
    expect(match("es", custom, "quitar negrita")).toBeNull();
  });

  it("an empty list leaves the Command with no Voice Command in that language", () => {
    const custom: CustomVoiceCommands = { "common.undo": { en: [] } };
    expect(match("en", custom, "undo that")).toBeNull();
    expect(match("es", custom, "deshacer eso")).toEqual({ id: "common.undo", polarity: null });
  });

  it("reaches the Interpreter's phrase table", () => {
    const table = buildPhraseTable("es", {
      voice: { "editor.italic": { es: ["letra inclinada"] } },
    });
    const output = interpret({
      line: "Letra inclinada.",
      before: "",
      capabilities: { casing: false, punctuation: false, streaming: true },
      table,
      state: { capitalizeNext: false, noSpaceNext: false },
    });
    expect(output.result).toEqual({ kind: "voice_command", id: "editor.italic", polarity: "on" });
  });
});

describe("voicePhrasePolarity()", () => {
  it("keeps a default verb's polarity and never toggles an author's phrase", () => {
    expect(voicePhrasePolarity("editor.bold", "es", "quitar negrita")).toBe("off");
    expect(voicePhrasePolarity("editor.bold", "es", "quitar la negrita")).toBe("off");
    expect(voicePhrasePolarity("editor.bold", "es", "quitar lo gordo")).toBe("off");
    expect(voicePhrasePolarity("editor.bold", "es", "pon esto fuerte")).toBe("on");
    expect(voicePhrasePolarity("editor.bulletList", "en", "end the bullets")).toBe("off");
    expect(voicePhrasePolarity("editor.heading1", "en", "big title")).toBeNull();
  });

  it("runs an off phrase with the off polarity", () => {
    const custom: CustomVoiceCommands = { "editor.bold": { es: ["quitar lo gordo"] } };
    expect(match("es", custom, "quitar lo gordo")).toEqual({ id: "editor.bold", polarity: "off" });
  });
});

describe("defaultVoicePhrases() / voicePhrases()", () => {
  it("lists a Command's defaults as verb and target, once each", () => {
    const phrases = defaultVoicePhrases("editor.bold", "es");
    expect(phrases).toContain("poner negrita");
    expect(phrases).toContain("quitar negritas");
    expect(new Set(phrases.map(normalizePhrase)).size).toBe(phrases.length);
    expect(defaultVoicePhrases("common.undo", "en")).toEqual(["undo that"]);
  });

  it("prefers the author's list, empty included", () => {
    expect(voicePhrases("common.undo", "en", { "common.undo": { en: [] } })).toEqual([]);
    expect(voicePhrases("common.undo", "en", { "common.undo": { es: ["x y"] } })).toEqual([
      "undo that",
    ]);
  });
});

describe("normalizeCustomVoiceCommands()", () => {
  it("drops unknown Commands, Commands that take no Voice Commands, and unknown languages", () => {
    expect(
      normalizeCustomVoiceCommands({
        "bogus.command": { es: ["poner algo"] },
        "common.save": { en: ["save it now"] },
        "editor.bold": { fr: ["mettre gras"], es: ["pon esto fuerte"] },
      })
    ).toEqual({ "editor.bold": { es: ["pon esto fuerte"] } });
  });

  it("drops phrases under two words or empty after normalizing, and duplicates", () => {
    expect(
      normalizeCustomVoiceCommands({
        "editor.bold": { es: ["negrita", "  ", "¿?", 7, "Pon  esto fuerte ", "pon esto fuerte"] },
        "editor.italic": { es: ["cursiva"] },
      })
    ).toEqual({ "editor.bold": { es: ["Pon esto fuerte"] } });
  });

  it("keeps an explicit empty list and tolerates garbage", () => {
    expect(normalizeCustomVoiceCommands({ "common.undo": { en: [] } })).toEqual({
      "common.undo": { en: [] },
    });
    expect(normalizeCustomVoiceCommands("garbage")).toEqual({});
    expect(normalizeCustomVoiceCommands(["x"])).toEqual({});
    expect(normalizeCustomVoiceCommands({ "editor.bold": "poner negrita" })).toEqual({});
  });
});

describe("findPhraseConflict()", () => {
  const voice = (
    id: Parameters<typeof voicePhrases>[0],
    phrase: string,
    custom: CustomVoiceCommands = {},
    language: DictationLanguage = "es",
    replacing?: string
  ) =>
    findPhraseConflict({
      language,
      phrase,
      candidate: { kind: "voice", id, replacing },
      voice: custom,
    });

  it("accepts a new phrase that means one thing", () => {
    expect(voice("editor.bold", "pon esto fuerte")).toBeNull();
  });

  it("refuses empty and one-word phrases", () => {
    expect(voice("editor.bold", "  ")).toEqual({ kind: "empty" });
    expect(voice("editor.bold", "negrita")).toEqual({ kind: "tooShort" });
    expect(voice("editor.bold", "¡negrita!")).toEqual({ kind: "tooShort" });
  });

  it("refuses another Command's Voice Command, default or custom", () => {
    expect(voice("editor.bold", "poner cursiva")).toEqual({
      kind: "voiceCommand",
      commandId: "editor.italic",
      phrase: "poner cursiva",
    });
    expect(voice("editor.bold", "Activar la cursiva")).toMatchObject({
      kind: "voiceCommand",
      commandId: "editor.italic",
    });
    expect(
      voice("editor.bold", "letra inclinada", { "editor.italic": { es: ["letra inclinada"] } })
    ).toMatchObject({ kind: "voiceCommand", commandId: "editor.italic" });
  });

  it("refuses a phrase whose filler matching covers another Command's phrase", () => {
    // "poner cursiva" belongs to Italic; a Bold phrase that is a default verb
    // and target of Bold cannot cover it, but an author phrase of Italic can
    // be covered by a Bold default kept with its fillers.
    expect(
      voice("editor.bold", "poner negrita", {
        "editor.bold": { es: [] },
        "editor.italic": { es: ["poner en negrita"] },
      })
    ).toMatchObject({ kind: "voiceCommand", commandId: "editor.italic" });
  });

  it("refuses a phrase the Command already answers to, but not the one being edited", () => {
    expect(voice("editor.bold", "poner en negrita")).toEqual({
      kind: "voiceDuplicate",
      phrase: "poner en negrita",
    });
    expect(voice("editor.bold", "poner negrita", {}, "es", "poner negrita")).toBeNull();
  });

  it("refuses Spoken Punctuation phrases and aliases, switched off or not", () => {
    expect(voice("editor.bold", "Punto y coma")).toEqual({
      kind: "duplicate",
      entryId: "puntoYComa",
    });
    expect(
      findPhraseConflict({
        language: "es",
        phrase: "punto y la parte",
        candidate: { kind: "voice", id: "editor.bold" },
        voice: {},
        spokenPunctuation: {
          enabled: false,
          entries: {},
          aliases: { puntoYAparte: ["punto y la parte"] },
        },
      })
    ).toEqual({ kind: "duplicate", entryId: "puntoYAparte" });
  });

  it("refuses a phrase that starts with the escape word or one of its aliases", () => {
    expect(voice("editor.bold", "literal negrita")).toEqual({
      kind: "escape",
      entryId: "literal",
      word: "literal",
    });
    expect(
      findPhraseConflict({
        language: "es",
        phrase: "textual negrita",
        candidate: { kind: "voice", id: "editor.bold" },
        voice: {},
        spokenPunctuation: { enabled: true, entries: {}, aliases: { literal: ["textual"] } },
      })
    ).toEqual({ kind: "escape", entryId: "literal", word: "textual" });
  });

  it("refuses an alias that is a Voice Command, default or custom", () => {
    const alias = (phrase: string, custom: CustomVoiceCommands = {}, entryId = "coma") =>
      findPhraseConflict({
        language: "es",
        phrase,
        candidate: { kind: "alias", entryId },
        voice: custom,
      });
    expect(alias("poner en negrita")).toEqual({
      kind: "voiceCommand",
      commandId: "editor.bold",
      phrase: "poner en negrita",
    });
    expect(alias("pon esto fuerte", { "editor.bold": { es: ["pon esto fuerte"] } })).toMatchObject({
      kind: "voiceCommand",
      commandId: "editor.bold",
    });
    // An escape word that starts a Voice Command would type it as text.
    expect(alias("poner", {}, "literal")).toMatchObject({
      kind: "voiceCommand",
      commandId: "editor.bold",
    });
    // The Spoken Punctuation rules still apply first.
    expect(alias("punto")).toEqual({ kind: "duplicate", entryId: "punto" });
    expect(alias("la coma")).toBeNull();
  });

  it("keeps every default phrase clear of every other phrase (registry gate)", () => {
    for (const language of ["en", "es"] as const) {
      for (const id of voiceEligibleCommands()) {
        for (const phrase of defaultVoicePhrases(id, language)) {
          expect(
            voice(id, phrase, {}, language, phrase),
            `${language} ${id}: ${phrase}`
          ).toBeNull();
        }
      }
    }
  });
});
