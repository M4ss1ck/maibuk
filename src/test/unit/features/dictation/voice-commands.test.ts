import { describe, expect, it } from "vitest";
import { EDITOR_COMMANDS, VOICE_RUNNERS } from "@/components/editor/editor-commands";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
} from "@/features/dictation/interpreter";
import { labelPhrase } from "@/features/dictation/label-phrases";
import { normalizePhrase, phraseWords } from "@/features/dictation/normalize";
import { defaultTriggers, entriesFor } from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  VOICE_VOCABULARY,
  buildVoiceCommandTable,
  defaultWholeLinePhrases,
  heardForms,
  matchVoiceCommand,
  rewriteHeard,
  voiceCommandPhrases,
  voiceEligibleCommands,
  voiceThatPhrases,
  type CustomVoiceCommands,
  type VoiceCommandTable,
  type VoiceVerbClass,
} from "@/features/dictation/voice-commands";
import { COMMAND_IDS, COMMANDS, type CommandDef } from "@/lib/shortcut-registry";

/** Every language the model catalog can dictate, so a new one cannot ship without a vocabulary. */
const LANGUAGES = [
  ...new Set(MODEL_CATALOG.flatMap((spec) => spec.languages)),
] as DictationLanguage[];

const VERB_CLASSES: VoiceVerbClass[] = [
  "formatOn",
  "formatOff",
  "block",
  "listOn",
  "listOff",
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

  it("gives every verb Command targets in every language", () => {
    const verbCommands = COMMAND_IDS.filter(
      (id) => (COMMANDS[id] as CommandDef).voice?.verbs !== undefined
    );
    expect(verbCommands.length).toBeGreaterThan(0);
    for (const id of verbCommands) {
      const voice = (COMMANDS[id] as CommandDef).voice;
      expect(voice, id).toBeDefined();
      for (const language of LANGUAGES) {
        const targets = voice?.targets?.[language] ?? [];
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

  it("resolves every filler-inserted verb phrase to its own Command", () => {
    for (const language of LANGUAGES) {
      const table = buildVoiceCommandTable(language);
      const vocabulary = VOICE_VOCABULARY[language];
      for (const id of voiceEligibleCommands()) {
        const voice = (COMMANDS[id] as CommandDef).voice;
        const verbs = voice?.verbs;
        if (!verbs) continue;
        for (const cls of verbs) {
          for (const verb of vocabulary.verbs[cls].phrases) {
            for (const target of voice?.targets?.[language] ?? []) {
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

  it("gives every verb Command an event-free runner", () => {
    for (const id of voiceEligibleCommands()) {
      const voice = (COMMANDS[id] as CommandDef).voice;
      if (!voice?.verbs) continue;
      const runners = VOICE_RUNNERS[id];
      const polarities = new Set(
        LANGUAGES.flatMap((language) =>
          (voice?.verbs ?? []).map((cls) => VOICE_VOCABULARY[language].verbs[cls].polarity)
        )
      );
      if (polarities.has("on") || polarities.has("off")) {
        expect(runners?.on, `${id} on`).toBeTypeOf("function");
        expect(runners?.off, `${id} off`).toBeTypeOf("function");
      } else {
        expect(runners?.on ?? EDITOR_COMMANDS[id], `${id} on`).toBeTypeOf("function");
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
    expect(match("es", "empezar lista")).toEqual({ id: "editor.bulletList", polarity: "on" });
    expect(match("es", "empezar lista numerada")).toEqual({
      id: "editor.numberedList",
      polarity: "on",
    });
    expect(match("es", "salir de la lista")).toEqual({ id: "editor.bulletList", polarity: "off" });
    expect(match("es", "terminar lista numerada")).toEqual({
      id: "editor.numberedList",
      polarity: "off",
    });
    expect(match("es", "alinear a la izquierda")).toEqual({
      id: "editor.alignLeft",
      polarity: null,
    });
    expect(match("es", "centrar el texto")).toEqual({ id: "editor.alignCenter", polarity: null });
    expect(match("en", "undo that")).toEqual({ id: "common.undo", polarity: null });
    expect(match("en", "stop dictation")).toEqual({ id: "dictation.stop", polarity: null });
    expect(match("es", "parar dictado")).toEqual({ id: "dictation.stop", polarity: null });
  });

  it("keeps the verb's polarity for marks and lists", () => {
    expect(match("es", "quitar negrita")).toEqual({ id: "editor.bold", polarity: "off" });
    expect(match("es", "desactivar las cursivas")).toEqual({
      id: "editor.italic",
      polarity: "off",
    });
    expect(match("en", "remove bold")).toEqual({ id: "editor.bold", polarity: "off" });
    expect(match("en", "turn off underline")).toEqual({ id: "editor.underline", polarity: "off" });
    expect(match("en", "make bold")).toEqual({ id: "editor.bold", polarity: "on" });
    expect(match("en", "apply heading two")).toEqual({ id: "editor.heading2", polarity: null });
    expect(match("en", "start bullet list")).toEqual({ id: "editor.bulletList", polarity: "on" });
    expect(match("en", "end list")).toEqual({ id: "editor.bulletList", polarity: "off" });
    expect(match("en", "start numbered list")).toEqual({
      id: "editor.numberedList",
      polarity: "on",
    });
    expect(match("en", "stop list")).toEqual({ id: "editor.bulletList", polarity: "off" });
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
    // The articles "the"/"a" are not English fillers: these are prose, not
    // Commands (the short shapes without them stay in the #285 prose set).
    expect(match("en", "Use the code.")).toBeNull();
    expect(match("en", "Center the text.")).toBeNull();
    expect(match("en", "Stop the list.")).toBeNull();
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

describe("matchVoiceCommand() demonstratives", () => {
  const tables: Record<DictationLanguage, VoiceCommandTable> = {
    en: buildVoiceCommandTable("en"),
    es: buildVoiceCommandTable("es"),
  };
  const match = (language: DictationLanguage, line: string) =>
    matchVoiceCommand(tables[language], normalizePhrase(line).split(" "));

  it("runs a mark verb and target with the demonstrative on the last span", () => {
    expect(match("en", "make bold that")).toEqual({ id: "editor.bold", polarity: "on", that: true });
    expect(match("en", "remove bold that")).toEqual({
      id: "editor.bold",
      polarity: "off",
      that: true,
    });
    expect(match("en", "turn off italics that")).toEqual({
      id: "editor.italic",
      polarity: "off",
      that: true,
    });
    expect(match("en", "set in italics that")).toEqual({
      id: "editor.italic",
      polarity: "on",
      that: true,
    });
    expect(match("es", "poner en negrita eso")).toEqual({
      id: "editor.bold",
      polarity: "on",
      that: true,
    });
    expect(match("es", "quitar la negrita esto")).toEqual({
      id: "editor.bold",
      polarity: "off",
      that: true,
    });
  });

  it("runs a bare mark target with the demonstrative", () => {
    expect(match("en", "bold that")).toEqual({ id: "editor.bold", polarity: "on", that: true });
    expect(match("en", "underline that")).toEqual({
      id: "editor.underline",
      polarity: "on",
      that: true,
    });
    expect(match("es", "negrita eso")).toEqual({ id: "editor.bold", polarity: "on", that: true });
    expect(match("es", "cursiva esto")).toEqual({
      id: "editor.italic",
      polarity: "on",
      that: true,
    });
  });

  it("reads the demonstrative through the heard rewrite", () => {
    const esTable = buildVoiceCommandTable("es");
    expect(matchVoiceCommand(esTable, phraseWords("una grita eso"))).toEqual({
      id: "editor.bold",
      polarity: "on",
      that: true,
    });
    expect(matchVoiceCommand(esTable, phraseWords("quitad negrita eso"))).toEqual({
      id: "editor.bold",
      polarity: "off",
      that: true,
    });
  });

  it("leaves plain phrases without the demonstrative flag", () => {
    expect(match("en", "undo that")).toEqual({ id: "common.undo", polarity: null });
    expect(match("es", "deshacer eso")).toEqual({ id: "common.undo", polarity: null });
    expect(match("en", "make bold")).toEqual({ id: "editor.bold", polarity: "on" });
  });

  it("never runs a non-mark Command with the demonstrative", () => {
    expect(match("en", "make heading one that")).toBeNull();
    expect(match("en", "start list that")).toBeNull();
    expect(match("en", "heading one that")).toBeNull();
    expect(match("en", "center text that")).toBeNull();
    expect(match("en", "that")).toBeNull();
    expect(match("en", "bold that now")).toBeNull();
    expect(match("en", "make bold that that")).toBeNull();
  });

  it("follows the author's list for the bare form", () => {
    const custom: CustomVoiceCommands = { "editor.bold": { en: ["embolden text"] } };
    const table = buildVoiceCommandTable("en", custom);
    const run = (line: string) => matchVoiceCommand(table, normalizePhrase(line).split(" "));
    expect(run("bold that")).toBeNull();
    expect(run("make bold that")).toBeNull();
    expect(run("embolden text that")).toEqual({ id: "editor.bold", polarity: "on", that: true });
  });
});

describe("voiceThatPhrases()", () => {
  it("matches every demonstrative phrase on its own mark with that set", () => {
    for (const language of ["en", "es"] as const) {
      const table = buildVoiceCommandTable(language);
      const punctuation = new Set(
        entriesFor(language).flatMap((entry) => defaultTriggers(entry).map(normalizePhrase))
      );
      const owner = new Map<string, string>();
      const phrases = voiceThatPhrases(language);
      expect(phrases.length).toBeGreaterThan(0);
      for (const { id, phrase } of phrases) {
        const normalized = normalizePhrase(phrase);
        expect(wordsOf(phrase).length, `${id}: ${phrase}`).toBeGreaterThanOrEqual(2);
        expect(matchVoiceCommand(table, normalized.split(" ")), `${id}: ${phrase}`).toMatchObject(
          { id, that: true }
        );
        expect(punctuation.has(normalized), `${id}: ${phrase}`).toBe(false);
        const previous = owner.get(normalized);
        expect(
          previous === undefined || previous === id,
          `${normalized}: ${previous} and ${id}`
        ).toBe(true);
        owner.set(normalized, id);
      }
    }
  });
});

describe("Voice Command heard forms", () => {
  const esTable = buildVoiceCommandTable("es");
  const matchEs = (line: string) => matchVoiceCommand(esTable, phraseWords(line));

  it("runs the Command a misheard default still means", () => {
    expect(matchEs("quitad negrita")).toEqual({ id: "editor.bold", polarity: "off" });
    expect(matchEs("poner una grita")).toEqual({ id: "editor.bold", polarity: "on" });
    expect(matchEs("poner su brallado")).toEqual({ id: "editor.underline", polarity: "on" });
    expect(matchEs("central izquierda")).toEqual({ id: "editor.alignLeft", polarity: null });
    expect(matchEs("detened dictado")).toEqual({ id: "dictation.stop", polarity: null });
    expect(matchEs("pulsar tap")).toEqual({ id: "focus.next", polarity: null });
    expect(matchEs("pulsar la tecla tap")).toEqual({ id: "focus.next", polarity: null });
  });

  it("keeps prose prose", () => {
    expect(matchEs("estación central")).toBeNull();
    expect(matchEs("una grita fuerte")).toBeNull();
    expect(matchEs("el tap de la cerveza")).toBeNull();
  });

  it("lets the raw line win over a rewrite", () => {
    // Rewritten, "quitad negrita" is bold's "quitar negrita"; as said, it is
    // the author's own italic phrase, and that runs first.
    const table = buildVoiceCommandTable("es", { "editor.italic": { es: ["quitad negrita"] } });
    expect(matchVoiceCommand(table, phraseWords("quitad negrita"))?.id).toBe("editor.italic");
  });

  it("rewriteHeard prefers the longest form and leaves other words alone", () => {
    const forms = heardForms("es");
    const lengths = forms.map((form) => form.from.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    expect(rewriteHeard(forms, phraseWords("hola su brallado mundo"))).toEqual([
      "hola",
      "subrayado",
      "mundo",
    ]);
    // The two-word form is taken before a shorter form that starts it.
    const overlapping = [
      { from: ["su", "brallado"], to: ["subrayado"] },
      { from: ["su"], to: ["suyo"] },
    ];
    expect(rewriteHeard(overlapping, ["su", "brallado"])).toEqual(["subrayado"]);
  });

  it("keeps every heard key clear of a default, a target, a filler, and Spoken Punctuation", () => {
    // A heard form may also stand for a word of a whole-line default, like
    // the focus key in "pulsar tab" (issue #324).
    for (const language of LANGUAGES) {
      const vocabulary = VOICE_VOCABULARY[language];
      const verbs = new Set(
        VERB_CLASSES.flatMap((cls) => vocabulary.verbs[cls].phrases.map(normalizePhrase))
      );
      const fillers = new Set(vocabulary.fillers.map(normalizePhrase));
      const targets = new Set(
        voiceEligibleCommands().flatMap((id) =>
          ((COMMANDS[id] as CommandDef).voice?.targets?.[language] ?? []).map(normalizePhrase)
        )
      );
      const punctuation = new Set(
        entriesFor(language).flatMap((entry) => defaultTriggers(entry).map(normalizePhrase))
      );
      const wholeLineWords = new Set(
        voiceEligibleCommands().flatMap((id) =>
          defaultWholeLinePhrases(id, language).flatMap((phrase) => phraseWords(phrase))
        )
      );
      for (const [heard, meant] of Object.entries(vocabulary.heard)) {
        const key = normalizePhrase(heard);
        expect(wholeLineWords.has(key), `${language}: ${heard}`).toBe(false);
        expect(verbs.has(key), `${language}: ${heard}`).toBe(false);
        expect(fillers.has(key), `${language}: ${heard}`).toBe(false);
        expect(targets.has(key), `${language}: ${heard}`).toBe(false);
        expect(punctuation.has(key), `${language}: ${heard}`).toBe(false);
        const value = normalizePhrase(meant);
        expect(
          verbs.has(value) || targets.has(value) || wholeLineWords.has(value),
          `${language}: ${heard} -> ${meant}`
        ).toBe(true);
      }
    }
  });
});

describe("label-derived whole-line phrases (ADR 0016)", () => {
  const tables: Record<DictationLanguage, VoiceCommandTable> = {
    en: buildVoiceCommandTable("en"),
    es: buildVoiceCommandTable("es"),
  };
  const match = (language: DictationLanguage, line: string) =>
    matchVoiceCommand(tables[language], phraseWords(line));

  it("runs an explicit phrase with the label's words, whatever the casing", () => {
    expect(match("en", "Dark theme.")).toEqual({ id: "global.themeDark", polarity: null });
    expect(match("en", "dark THEME")).toEqual({ id: "global.themeDark", polarity: null });
    expect(match("es", "Tema oscuro.")).toEqual({ id: "global.themeDark", polarity: null });
  });

  it("derives the phrase from the Dictation Language's label, not the UI language", () => {
    expect(labelPhrase("global.gotoNotes", "es")).toBe("Ir a Notas");
    expect(defaultWholeLinePhrases("global.gotoNotes", "es")).toEqual(["Ir a Notas"]);
    expect(match("es", "Ir a Notas.")).toEqual({ id: "global.gotoNotes", polarity: null });
    expect(match("en", "Ir a Notas.")).toBeNull();
    expect(match("en", "Go to Notes.")).toEqual({ id: "global.gotoNotes", polarity: null });
  });

  it("leaves the phrase as text mid-sentence", () => {
    const output = interpret({
      line: "I like the dark theme a lot.",
      before: "",
      capabilities: { casing: false, punctuation: false, streaming: true },
      table: buildPhraseTable("en"),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result.kind).toBe("edits");
  });

  it("lets an explicit phrase win over the label", () => {
    expect(match("en", "open dictionary")).toEqual({ id: "editor.dictionary", polarity: null });
    // "Look up word" is the Dictionary's label, but it answers to its
    // explicit phrase; the line runs Word Lookup instead.
    expect(match("en", "Look up word.")).toEqual({ id: "editor.lookUp", polarity: null });
  });

  it("runs the shortcut help from its explicit phrases, label first", () => {
    expect(defaultWholeLinePhrases("global.showHelp", "en")).toEqual([
      "show shortcuts help",
      "show voice commands",
    ]);
    expect(defaultWholeLinePhrases("global.showHelp", "es")).toEqual([
      "mostrar ayuda de atajos",
      "mostrar comandos de voz",
    ]);
    expect(match("en", "Show voice commands.")).toEqual({ id: "global.showHelp", polarity: null });
    expect(match("es", "Mostrar comandos de voz.")).toEqual({
      id: "global.showHelp",
      polarity: null,
    });
    expect(match("en", "Show shortcuts help.")).toEqual({ id: "global.showHelp", polarity: null });
    expect(match("es", "Mostrar ayuda de atajos.")).toEqual({
      id: "global.showHelp",
      polarity: null,
    });
  });

  it("replaces the derived phrase for that Command and language only", () => {
    const custom: CustomVoiceCommands = { "global.gotoNotes": { en: ["open notes list"] } };
    const enTable = buildVoiceCommandTable("en", custom);
    const esTable = buildVoiceCommandTable("es", custom);
    const runEn = (line: string) => matchVoiceCommand(enTable, phraseWords(line));
    const runEs = (line: string) => matchVoiceCommand(esTable, phraseWords(line));
    expect(runEn("open notes list")).toEqual({ id: "global.gotoNotes", polarity: null });
    expect(runEn("Go to Notes.")).toBeNull();
    expect(runEs("Ir a Notas.")).toEqual({ id: "global.gotoNotes", polarity: null });
    expect(runEs("open notes list")).toBeNull();
  });
});
