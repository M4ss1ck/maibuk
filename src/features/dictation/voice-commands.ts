// The Voice Commands layer (ADR 0014): a short finished line that is a verb,
// some filler words, and a target runs the same Command as its Shortcut. The
// words are recognizer input, not UI copy, so the vocabulary lives here per
// Dictation Language, never in en.json/es.json. Commands declare their verb
// classes and target nouns in the registry (`CommandDef.voice`); this module is
// the one owner of the rules over them: how the table is built, how a line is
// matched, and which default phrases a Command expands to.
import { normalizeWord, phraseWords } from "@/features/dictation/normalize";
import type { DictationLanguage } from "@/features/dictation/types";
import { COMMAND_IDS, COMMANDS, type CommandDef, type CommandId } from "@/lib/shortcut-registry";

/** What an on-verb does to a mark, and what an off-verb undoes: never a toggle. */
export type VoicePolarity = "on" | "off";

/** A class of verbs that act the same way; only marks and lists carry a polarity. */
export type VoiceVerbClass =
  | "formatOn"
  | "formatOff"
  | "block"
  | "listOn"
  | "listOff"
  | "align"
  | "undo"
  | "redo"
  | "dictation";

export interface VoiceVerbClassSpec {
  /** The ways to say this verb in the language. */
  phrases: readonly string[];
  /** "on" sets a mark, "off" unsets it; null for verbs that are their own action. */
  polarity: VoicePolarity | null;
}

/** Everything a Dictation Language contributes to a Voice Command phrase. */
export interface VoiceVocabulary {
  verbs: Readonly<Record<VoiceVerbClass, VoiceVerbClassSpec>>;
  /** Single words the match skips between the verb and the target ("poner en negrita"). */
  fillers: readonly string[];
}

/**
 * The default vocabulary, checked against the vendor pages where they document
 * a phrase: Microsoft voice access "Poner en negrita eso", "Deshacer eso",
 * "Rehacer eso", "Nueva línea", "Nuevo párrafo"; Google Docs "Bold",
 * "Italicize", "Remove bold", "Apply heading 1", "Create bulleted list",
 * "Align center", "Stop listening". The rest is Maibuk's own phrasing. Apple
 * publishes no formatting command list, so nothing here rests on it. See the
 * verification log in docs/research/dictation-command-interpreter.md.
 */
export const VOICE_VOCABULARY: Readonly<Record<DictationLanguage, VoiceVocabulary>> = {
  en: {
    verbs: {
      formatOn: {
        phrases: ["make", "set", "turn on", "use", "apply"],
        polarity: "on",
      },
      formatOff: {
        phrases: ["remove", "turn off"],
        polarity: "off",
      },
      block: {
        phrases: ["make", "turn into", "change to", "apply"],
        polarity: null,
      },
      listOn: {
        phrases: ["start", "begin", "create"],
        polarity: "on",
      },
      listOff: {
        phrases: ["end", "stop"],
        polarity: "off",
      },
      align: {
        phrases: ["align", "center"],
        polarity: null,
      },
      undo: { phrases: ["undo"], polarity: null },
      redo: { phrases: ["redo"], polarity: null },
      dictation: { phrases: ["stop"], polarity: null },
    },
    // "the" and "a" are not fillers: they turned short sentences ("Use the
    // code.", "Center the text.", "Stop the list.") into Commands.
    fillers: ["to", "in"],
  },
  es: {
    verbs: {
      formatOn: {
        phrases: ["poner", "activar", "usar", "aplicar"],
        polarity: "on",
      },
      formatOff: {
        phrases: ["quitar", "desactivar"],
        polarity: "off",
      },
      block: {
        phrases: ["convertir en", "cambiar a", "poner"],
        polarity: null,
      },
      listOn: {
        phrases: ["empezar", "iniciar", "crear"],
        polarity: "on",
      },
      listOff: {
        phrases: ["terminar", "salir de"],
        polarity: "off",
      },
      align: {
        phrases: ["alinear", "centrar"],
        polarity: null,
      },
      undo: { phrases: ["deshacer"], polarity: null },
      redo: { phrases: ["rehacer"], polarity: null },
      dictation: { phrases: ["parar", "detener"], polarity: null },
    },
    fillers: ["la", "el", "las", "los", "en", "a", "al"],
  },
};

/** What a registry Command declares to take Voice Commands. */
export interface VoiceCommandSpec {
  /**
   * The verb classes that can introduce this Command. A mark takes both
   * `formatOn` and `formatOff`, a list both `listOn` and `listOff`; every
   * other Command takes its one class, and the class's polarity picks the
   * runner.
   */
  verbs: readonly VoiceVerbClass[];
  /** Target nouns per Dictation Language; the phrase is `verb [fillers] target`. */
  targets: Readonly<Record<DictationLanguage, readonly string[]>>;
}

interface VoiceVerbEntry {
  words: readonly string[];
  classes: readonly VoiceVerbClass[];
}

interface VoiceTargetEntry {
  words: readonly string[];
  id: CommandId;
}

/** A prebuilt Voice Command matcher for one Dictation Language. Build once, reuse per line. */
export interface VoiceCommandTable {
  language: DictationLanguage;
  verbs: readonly VoiceVerbEntry[];
  fillers: ReadonlySet<string>;
  targets: ReadonlyMap<VoiceVerbClass, readonly VoiceTargetEntry[]>;
  polarity: ReadonlyMap<VoiceVerbClass, VoicePolarity | null>;
}

/** One resolved Voice Command: the registry Command to run and the verb's polarity. */
export interface VoiceCommandRun {
  id: CommandId;
  polarity: VoicePolarity | null;
}

/**
 * What running one Voice Command did. "empty" is an action with nothing to do
 * ("undo" on an empty history): the live region says so and it is not counted.
 */
export type VoiceOutcome = "ran" | "empty" | "ignored";

/** Commands that declare Voice Commands, in registry order. */
export function voiceEligibleCommands(): CommandId[] {
  return COMMAND_IDS.filter((id) => (COMMANDS[id] as CommandDef).voice !== undefined);
}

export function buildVoiceCommandTable(language: DictationLanguage): VoiceCommandTable {
  const vocabulary = VOICE_VOCABULARY[language];
  const verbsByPhrase = new Map<string, VoiceVerbClass[]>();
  for (const [cls, spec] of Object.entries(vocabulary.verbs) as [
    VoiceVerbClass,
    VoiceVerbClassSpec,
  ][]) {
    for (const phrase of spec.phrases) {
      const words = phraseWords(phrase);
      if (words.length === 0) continue;
      const key = words.join(" ");
      const classes = verbsByPhrase.get(key) ?? [];
      if (!classes.includes(cls)) classes.push(cls);
      verbsByPhrase.set(key, classes);
    }
  }

  const targets = new Map<VoiceVerbClass, VoiceTargetEntry[]>();
  for (const id of COMMAND_IDS) {
    const voice = (COMMANDS[id] as CommandDef).voice;
    if (!voice) continue;
    for (const phrase of voice.targets[language] ?? []) {
      const words = phraseWords(phrase);
      if (words.length === 0) continue;
      for (const cls of voice.verbs) {
        const entries = targets.get(cls) ?? [];
        entries.push({ words, id });
        targets.set(cls, entries);
      }
    }
  }
  // Longest target first, so "lista numerada" wins over "lista".
  for (const entries of targets.values()) {
    entries.sort((a, b) => b.words.length - a.words.length);
  }

  return {
    language,
    verbs: [...verbsByPhrase].map(([key, classes]) => ({ words: key.split(" "), classes })),
    fillers: new Set(vocabulary.fillers.map(normalizeWord)),
    targets,
    polarity: new Map(
      (Object.entries(vocabulary.verbs) as [VoiceVerbClass, VoiceVerbClassSpec][]).map(
        ([cls, spec]) => [cls, spec.polarity]
      )
    ),
  };
}

/**
 * The whole-line rule: one verb, any run of fillers, one target, nothing else.
 * Two words minimum, so an ordinary one-word sentence never fires; `words` are
 * the line's normalized word tokens with the model's punctuation already gone.
 */
export function matchVoiceCommand(
  table: VoiceCommandTable,
  words: readonly string[]
): VoiceCommandRun | null {
  if (words.length < 2) return null;

  let verb: VoiceVerbEntry | null = null;
  for (const candidate of table.verbs) {
    if (candidate.words.length > words.length) continue;
    if (!candidate.words.every((word, at) => words[at] === word)) continue;
    if (!verb || candidate.words.length > verb.words.length) verb = candidate;
  }
  if (!verb) return null;

  for (const cls of verb.classes) {
    const targets = table.targets.get(cls);
    if (!targets) continue;
    for (const target of targets) {
      // Every word between the verb and the target must be a filler, and the
      // target must cover the rest of the line.
      for (let at = verb.words.length; at <= words.length; at += 1) {
        if (at > verb.words.length && !table.fillers.has(words[at - 1])) break;
        if (words.length - at !== target.words.length) continue;
        if (target.words.every((word, offset) => words[at + offset] === word)) {
          return { id: target.id, polarity: table.polarity.get(cls) ?? null };
        }
      }
    }
  }
  return null;
}

export interface VoiceCommandPhrase {
  id: CommandId;
  /** The canonical phrase, `verb target` with no fillers. */
  phrase: string;
}

/**
 * Every default phrase a Command expands to, for the gates: two Commands may
 * never share one, and one phrase may never collide with Spoken Punctuation.
 */
export function voiceCommandPhrases(language: DictationLanguage): VoiceCommandPhrase[] {
  const vocabulary = VOICE_VOCABULARY[language];
  const phrases: VoiceCommandPhrase[] = [];
  for (const id of COMMAND_IDS) {
    const voice = (COMMANDS[id] as CommandDef).voice;
    if (!voice) continue;
    for (const cls of voice.verbs) {
      for (const verb of vocabulary.verbs[cls].phrases) {
        for (const target of voice.targets[language] ?? []) {
          phrases.push({ id, phrase: `${verb} ${target}` });
        }
      }
    }
  }
  return phrases;
}
