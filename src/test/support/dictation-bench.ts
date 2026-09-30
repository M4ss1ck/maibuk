// Worst-case inputs for the Dictation Command Interpreter bench (ADR 0015
// budget, issue #284). The bench measures them in the periodic lane; the gate
// lane only checks that they still exercise every path, never their timings.
//
// Worst case means: every Spoken Punctuation entry acts (a model with no
// punctuation), 1,000 aliases and 1,000 Vocabulary entries whose first words
// are the line's own prose, so the trie walk at almost every word descends
// several levels before it misses, plus real matches of each kind.
import type { PhraseTableOptions } from "@/features/dictation/interpreter";
import {
  defaultSpokenPunctuationLanguageSettings,
  entriesFor,
} from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";
import type { VocabularyEntry } from "@/features/dictation/vocabulary";

export const BENCH_ALIAS_COUNT = 1_000;
export const BENCH_VOCABULARY_COUNT = 1_000;

export interface InterpreterBenchCase {
  language: DictationLanguage;
  /** One finished line of about 60 words. */
  line: string;
  /** The bounded text before the caret, at its 256-character limit. */
  before: string;
  capabilities: ModelSpec["capabilities"];
  options: PhraseTableOptions;
}

const NO_PUNCTUATION: ModelSpec["capabilities"] = {
  casing: false,
  punctuation: false,
  streaming: true,
};

interface LanguageData {
  /** The prose the synthetic aliases and heard forms start with, in line order. */
  prose: readonly string[];
  /** Vocabulary entries the line really hits. */
  hits: readonly VocabularyEntry[];
  line: string;
  before: string;
}

// Each line starts with a Voice Command verb so the whole-line match gets past
// the verb before it fails, repeats the prose run the synthetic phrases start
// with, and hits every kind of match: marks, layout, cap, numeral, literal, Vocabulary,
// and bare phrase prefixes ("question", "open", "nuevo") that miss, and ends
// with the language's demonstrative, so the match also tries the line without
// it ("bold that").
const DATA: Record<DictationLanguage, LanguageData> = {
  en: {
    prose: ["the", "quiet", "river", "ran", "past", "our", "old", "mill"],
    hits: [
      { heard: "moonshine", written: "Moonshine" },
      { heard: "tip tap", written: "TipTap" },
    ],
    line:
      "make the quiet river ran past our old mill comma numeral nine hundred and ninety nine thousand and one period " +
      "question the quiet river ran past our old mill question mark new paragraph " +
      "capitalize moonshine said tip tap the quiet river ran past literal comma our old mill " +
      "open quote the quiet river ran close quote exclamation point new line open the old mill that",
    before:
      "The mill had stood by the river for longer than anyone in the village could say, and " +
      "every spring the water rose to its lowest window and fell back again. We walked down " +
      "to it most evenings after supper, when the light went gold over the fields and the whe",
  },
  es: {
    prose: ["el", "viejo", "molino", "junto", "al", "río", "que", "corre"],
    hits: [
      { heard: "moonshine", written: "Moonshine" },
      { heard: "tip tap", written: "TipTap" },
    ],
    line:
      "poner el viejo molino junto al río que corre coma numeral novecientos noventa y nueve mil novecientos noventa y nueve punto y coma " +
      "abre el viejo molino junto al río que corre signo de interrogación " +
      "nuevo párrafo mayúscula moonshine dijo tip tap el viejo molino junto al literal coma " +
      "río que corre abre comillas el viejo molino cierra comillas nueva línea nuevo el molino eso",
    before:
      "El molino llevaba junto al río más tiempo del que nadie en el pueblo podía recordar, y " +
      "cada primavera el agua subía hasta su ventana más baja y volvía a bajar. ¿Bajábamos a " +
      "verlo casi todas las tardes después de cenar, cuando la luz se volvía dorada sobre ",
  },
};

function syntheticAliases(language: DictationLanguage): Record<string, string[]> {
  const { prose } = DATA[language];
  const entries = entriesFor(language).filter(
    (entry) => !entry.actions.some((action) => action.kind === "scratch")
  );
  const aliases: Record<string, string[]> = {};
  for (let k = 0; k < BENCH_ALIAS_COUNT; k += 1) {
    const at = k % prose.length;
    const phrase = [
      prose[at],
      prose[(at + 1) % prose.length],
      prose[(at + 2) % prose.length],
      `alias${k}`,
    ].join(" ");
    const id = entries[k % entries.length].id;
    aliases[id] = [...(aliases[id] ?? []), phrase];
  }
  return aliases;
}

function syntheticVocabulary(language: DictationLanguage): VocabularyEntry[] {
  const { prose, hits } = DATA[language];
  const vocabulary: VocabularyEntry[] = [...hits];
  for (let k = 0; vocabulary.length < BENCH_VOCABULARY_COUNT; k += 1) {
    const at = k % prose.length;
    vocabulary.push({
      heard: `${prose[at]} ${prose[(at + 1) % prose.length]} heard${k}`,
      written: `Written${k}`,
    });
  }
  return vocabulary;
}

export function interpreterBenchCase(language: DictationLanguage): InterpreterBenchCase {
  const { line, before } = DATA[language];
  return {
    language,
    line,
    before,
    capabilities: NO_PUNCTUATION,
    options: {
      capabilities: NO_PUNCTUATION,
      settings: {
        ...defaultSpokenPunctuationLanguageSettings(),
        aliases: syntheticAliases(language),
      },
      vocabulary: syntheticVocabulary(language),
    },
  };
}
