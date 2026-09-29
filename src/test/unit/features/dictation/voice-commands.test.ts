import { describe, expect, it } from "vitest";
import { EDITOR_COMMANDS, VOICE_MARK_RUNNERS } from "@/components/editor/editor-commands";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import { normalizePhrase } from "@/features/dictation/normalize";
import { entriesFor } from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  VOICE_VOCABULARY,
  buildVoiceCommandTable,
  matchVoiceCommand,
  voiceCommandPhrases,
  voiceEligibleCommands,
  type VoiceCommandTable,
  type VoiceVerbClass,
} from "@/features/dictation/voice-commands";
import { COMMANDS, type CommandDef } from "@/lib/shortcut-registry";

/** Every language the model catalog can dictate, so a new one cannot ship without a vocabulary. */
const LANGUAGES = [
  ...new Set(MODEL_CATALOG.flatMap((spec) => spec.languages)),
] as DictationLanguage[];

const VERB_CLASSES: VoiceVerbClass[] = [
  "formatOn",
  "formatOff",
  "block",
  "list",
  "align",
  "undo",
  "redo",
  "dictation",
];

const wordsOf = (phrase: string) => normalizePhrase(phrase).split(" ");

describe("Voice Command defaults", () => {
  it("gives every catalog language a full vocabulary", () => {
    for (const language of LANGUAGES) {
      const vocabulary = VOICE_VOCABULARY[language];
      expect(vocabulary, language).toBeDefined();
      for (const cls of VERB_CLASSES) {
        const spec = vocabulary.verbs[cls];
        expect(spec, `${language}.${cls}`).toBeDefined();
        expect(spec.phrases.length, `${language}.${cls}`).toBeGreaterThan(0);
        for (const phrase of spec.phrases)
          expect(wordsOf(phrase).length, phrase).toBeGreaterThan(0);
      }
      expect(vocabulary.fillers.length).toBeGreaterThan(0);
      for (const filler of vocabulary.fillers) {
        // The matcher skips fillers one word at a time, so none may be a phrase.
        expect(wordsOf(filler), `${language}: ${filler}`).toHaveLength(1);
      }
    }
  });

  it("gives every voice-eligible Command targets in every language", () => {
    expect(voiceEligibleCommands().length).toBeGreaterThan(0);
    for (const id of voiceEligibleCommands()) {
      const voice = (COMMANDS[id] as CommandDef).voice;
      expect(voice, id).toBeDefined();
      for (const language of LANGUAGES) {
        const targets = voice?.targets[language] ?? [];
        expect(targets.length, `${id}.${language}`).toBeGreaterThan(0);
        for (const target of targets) expect(wordsOf(target).length, target).toBeGreaterThan(0);
      }
    }
  });

  it("expands no default phrase to two Commands", () => {
    for (const language of LANGUAGES) {
      const owner = new Map<string, string>();
      const phrases = voiceCommandPhrases(language);
      expect(phrases.length).toBeGreaterThan(0);
      for (const { id, phrase } of phrases) {
        expect(wordsOf(phrase).length, `${id}: ${phrase}`).toBeGreaterThanOrEqual(2);
        const normalized = normalizePhrase(phrase);
        const previous = owner.get(normalized);
        expect(
          previous === undefined || previous === id,
          `${normalized}: ${previous} and ${id}`
        ).toBe(true);
        owner.set(normalized, id);
      }
    }
  });

  it("resolves every filler-inserted default phrase to its own Command", () => {
    for (const language of LANGUAGES) {
      const table = buildVoiceCommandTable(language);
      const vocabulary = VOICE_VOCABULARY[language];
      for (const id of voiceEligibleCommands()) {
        const voice = (COMMANDS[id] as CommandDef).voice;
        if (!voice) continue;
        for (const cls of voice.verbs) {
          for (const verb of vocabulary.verbs[cls].phrases) {
            for (const target of voice.targets[language] ?? []) {
              for (const filler of vocabulary.fillers) {
                const words = normalizePhrase(`${verb} ${filler} ${target}`).split(" ");
                expect(matchVoiceCommand(table, words), `${id}: ${verb} ${filler} ${target}`).toEqual({
                  id,
                  polarity: vocabulary.verbs[cls].polarity,
                });
              }
            }
          }
        }
      }
    }
  });

  it("keeps every default phrase clear of the Spoken Punctuation defaults", () => {
    for (const language of LANGUAGES) {
      const punctuation = new Set(
        entriesFor(language).flatMap((entry) => entry.phrases.map(normalizePhrase))
      );
      for (const { id, phrase } of voiceCommandPhrases(language)) {
        expect(punctuation.has(normalizePhrase(phrase)), `${id}: ${phrase}`).toBe(false);
      }
    }
  });

  it("gives every voice-eligible Command an event-free runner", () => {
    for (const id of voiceEligibleCommands()) {
      const voice = (COMMANDS[id] as CommandDef).voice;
      expect(EDITOR_COMMANDS[id], id).toBeTypeOf("function");
      const polarities = new Set(
        (voice?.verbs ?? []).map((cls) => VOICE_VOCABULARY.en.verbs[cls].polarity)
      );
      if (polarities.has("on") || polarities.has("off")) {
        const runners = VOICE_MARK_RUNNERS[id];
        expect(runners?.on, `${id} on`).toBeTypeOf("function");
        expect(runners?.off, `${id} off`).toBeTypeOf("function");
      }
    }
  });
});

describe("matchVoiceCommand()", () => {
  const tables: Record<DictationLanguage, VoiceCommandTable> = {
    en: buildVoiceCommandTable("en"),
    es: buildVoiceCommandTable("es"),
  };
  const match = (language: DictationLanguage, line: string) =>
    matchVoiceCommand(tables[language], normalizePhrase(line).split(" "));

  it("matches verb [fillers] target as the whole line", () => {
    expect(match("es", "poner negrita")).toEqual({ id: "editor.bold", polarity: "on" });
    expect(match("es", "poner en negrita")).toEqual({ id: "editor.bold", polarity: "on" });
    expect(match("es", "Poner en negritas.")).toEqual({ id: "editor.bold", polarity: "on" });
    expect(match("es", "activar la cursiva")).toEqual({ id: "editor.italic", polarity: "on" });
    expect(match("es", "convertir en el título uno")).toEqual({
      id: "editor.heading1",
      polarity: null,
    });
    expect(match("es", "empezar lista")).toEqual({ id: "editor.bulletList", polarity: null });
    expect(match("es", "empezar lista numerada")).toEqual({
      id: "editor.numberedList",
      polarity: null,
    });
    expect(match("es", "salir de la lista")).toEqual({ id: "editor.bulletList", polarity: null });
    expect(match("es", "alinear a la izquierda")).toEqual({
      id: "editor.alignLeft",
      polarity: null,
    });
    expect(match("es", "centrar el texto")).toEqual({ id: "editor.alignCenter", polarity: null });
    expect(match("en", "undo that")).toEqual({ id: "common.undo", polarity: null });
    expect(match("en", "stop dictation")).toEqual({ id: "dictation.stop", polarity: null });
    expect(match("es", "parar dictado")).toEqual({ id: "dictation.stop", polarity: null });
  });

  it("keeps the verb's polarity for marks", () => {
    expect(match("es", "quitar negrita")).toEqual({ id: "editor.bold", polarity: "off" });
    expect(match("es", "desactivar las cursivas")).toEqual({
      id: "editor.italic",
      polarity: "off",
    });
    expect(match("en", "remove bold")).toEqual({ id: "editor.bold", polarity: "off" });
    expect(match("en", "turn off underline")).toEqual({ id: "editor.underline", polarity: "off" });
    expect(match("en", "make bold")).toEqual({ id: "editor.bold", polarity: "on" });
    expect(match("en", "apply heading two")).toEqual({ id: "editor.heading2", polarity: null });
  });

  it("refuses a one-word line", () => {
    expect(match("es", "negrita")).toBeNull();
    expect(match("en", "bold")).toBeNull();
  });

  it("never matches inside prose", () => {
    expect(match("es", "puso la negrita en el título")).toBeNull();
    expect(match("es", "quiero poner negrita")).toBeNull();
    expect(match("es", "el título uno")).toBeNull();
    expect(match("en", "he waited for a period of time")).toBeNull();
    expect(match("en", "make the sentence bold")).toBeNull();
  });

  it("does not cross languages", () => {
    expect(match("en", "poner negrita")).toBeNull();
    expect(match("es", "make bold")).toBeNull();
  });

  it("never matches a Spoken Punctuation phrase", () => {
    expect(match("es", "borra eso")).toBeNull();
    expect(match("es", "nuevo párrafo")).toBeNull();
    expect(match("en", "new paragraph")).toBeNull();
    expect(match("en", "scratch that")).toBeNull();
  });
});
