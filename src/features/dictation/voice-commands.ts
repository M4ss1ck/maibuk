// The Voice Commands layer (ADR 0014): a short finished line that is a verb,
// some filler words, and a target runs the same Command as its Shortcut. The
// words are recognizer input, not UI copy, so the vocabulary lives here per
// Dictation Language, never in en.json/es.json. Commands declare their verb
// classes and target nouns in the registry (`CommandDef.voice`); this module is
// the one owner of the rules over them: how the table is built, how a line is
// matched, and which default phrases a Command expands to. A mark said with
// the language's demonstrative ("bold that") acts on the last dictated span.
import { normalizeWord, phraseWords } from "@/features/dictation/normalize";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  COMMAND_IDS,
  COMMAND_RENAMES,
  COMMANDS,
  isCommandId,
  type CommandDef,
  type CommandId,
} from "@/lib/shortcut-registry";

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
  /** The words that point back at the last dictated span, "bold that". */
  demonstratives: readonly string[];
  /**
   * What Dictation Models write for a default verb or target when they mishear
   * it the same way every time, heard → default ("quitad" → "quitar"). A line
   * is tried as heard first, then with these rewritten, so prose is still
   * protected by the whole-line rule (#285). Not phrases: the Shortcut Editor
   * never lists them.
   */
  heard: Readonly<Record<string, string>>;
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
    demonstratives: ["that"],
    heard: {},
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
    demonstratives: ["eso", "esto"],
    // From the phrase conformance recordings (#285): the models turn
    // infinitives into vosotros imperatives and split or bend some targets.
    heard: {
      quitad: "quitar",
      desactivad: "desactivar",
      detened: "detener",
      inicial: "iniciar",
      central: "centrar",
      "una grita": "negrita",
      cursivo: "cursiva",
      "su brallado": "subrayado",
      "su rayada": "subrayada",
    },
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

/** A listed phrase that is a default verb and target of its own Command: fillers still match. */
interface VoicePinnedEntry {
  verb: readonly string[];
  target: readonly string[];
  run: VoiceCommandRun;
}

/** A prebuilt Voice Command matcher for one Dictation Language. Build once, reuse per line. */
export interface VoiceCommandTable {
  language: DictationLanguage;
  verbs: readonly VoiceVerbEntry[];
  fillers: ReadonlySet<string>;
  targets: ReadonlyMap<VoiceVerbClass, readonly VoiceTargetEntry[]>;
  polarity: ReadonlyMap<VoiceVerbClass, VoicePolarity | null>;
  /** The language's demonstratives as normalized words. */
  demonstratives: ReadonlySet<string>;
  /** The author's phrases that match only as the whole line, by normalized words. */
  exact: ReadonlyMap<string, readonly VoiceCommandRun[]>;
  /** The author's phrases that are a default verb and target of their own Command. */
  pinned: readonly VoicePinnedEntry[];
  /** The language's heard forms, longest first. */
  heard: readonly HeardForm[];
}

/** One heard form as normalized words: what the model writes, and the default it means. */
export interface HeardForm {
  from: readonly string[];
  to: readonly string[];
}

/** A language's heard forms as normalized words, longest first so "su rayada" beats a shorter one. */
export function heardForms(language: DictationLanguage): HeardForm[] {
  return Object.entries(VOICE_VOCABULARY[language].heard)
    .map(([from, to]) => ({ from: phraseWords(from), to: phraseWords(to) }))
    .filter((form) => form.from.length > 0 && form.to.length > 0)
    .sort((a, b) => b.from.length - a.from.length);
}

/** The words with every heard form replaced by its default, left to right. */
export function rewriteHeard(forms: readonly HeardForm[], words: readonly string[]): string[] {
  if (forms.length === 0) return [...words];
  const out: string[] = [];
  let at = 0;
  while (at < words.length) {
    const form = forms.find(
      (candidate) =>
        at + candidate.from.length <= words.length &&
        candidate.from.every((word, offset) => words[at + offset] === word)
    );
    if (form) {
      out.push(...form.to);
      at += form.from.length;
    } else {
      out.push(words[at]);
      at += 1;
    }
  }
  return out;
}

/**
 * Custom Voice Commands (ADR 0014): per Command and Dictation Language, the
 * phrases that replace that language's defaults. An empty list means the
 * Command takes no Voice Command in that language.
 */
export type CustomVoiceCommands = Partial<
  Record<CommandId, Partial<Record<DictationLanguage, readonly string[]>>>
>;

/** A Voice Command of one word would fire on ordinary one-word sentences. */
export const MIN_VOICE_PHRASE_WORDS = 2;

export const VOICE_LANGUAGES = Object.keys(VOICE_VOCABULARY) as DictationLanguage[];

/** One resolved Voice Command: the registry Command to run and the verb's polarity. */
export interface VoiceCommandRun {
  id: CommandId;
  polarity: VoicePolarity | null;
  /** A mark said with the language's demonstrative ("bold that"): acts on the last dictated span. */
  that?: true;
}

/**
 * What running one Voice Command did. "empty" is an action with nothing to do
 * ("undo" on an empty history, "bold that" with nothing dictated): the live
 * region says so and it is not counted. "refused" is "bold that" on dictated
 * text the author edited since.
 */
export type VoiceOutcome = "ran" | "empty" | "ignored" | "refused";

/** Commands that declare Voice Commands, in registry order. */
export function voiceEligibleCommands(): CommandId[] {
  return COMMAND_IDS.filter((id) => (COMMANDS[id] as CommandDef).voice !== undefined);
}

export function isVoiceEligible(id: CommandId): boolean {
  return (COMMANDS[id] as CommandDef).voice !== undefined;
}

/** A mark Command: its registry voice verbs include "formatOn". */
export function isMarkCommand(id: CommandId): boolean {
  return (COMMANDS[id] as CommandDef).voice?.verbs.includes("formatOn") ?? false;
}

/**
 * Splits a phrase into one of its Command's default verbs, any fillers, and one
 * of its targets. A phrase that splits keeps the filler matching and the
 * verb's polarity of the default it came from.
 */
function splitDefaultPhrase(
  id: CommandId,
  language: DictationLanguage,
  words: readonly string[]
): { verb: string[]; target: string[]; cls: VoiceVerbClass } | null {
  const voice = (COMMANDS[id] as CommandDef).voice;
  if (!voice) return null;
  const vocabulary = VOICE_VOCABULARY[language];
  const fillers = new Set(vocabulary.fillers.map(normalizeWord));
  for (const cls of voice.verbs) {
    for (const verbPhrase of vocabulary.verbs[cls].phrases) {
      const verb = phraseWords(verbPhrase);
      if (verb.length === 0 || !verb.every((word, at) => words[at] === word)) continue;
      for (const targetPhrase of voice.targets[language] ?? []) {
        const target = phraseWords(targetPhrase);
        const start = words.length - target.length;
        if (target.length === 0 || start < verb.length) continue;
        if (!target.every((word, offset) => words[start + offset] === word)) continue;
        if (words.slice(verb.length, start).every((word) => fillers.has(word))) {
          return { verb, target, cls };
        }
      }
    }
  }
  return null;
}

/**
 * What a listed phrase does to a mark or a list. A default verb keeps its own
 * polarity; any other phrase turns off only when it starts with one of the
 * language's off-verbs ("quitar ..."), so an author's phrase never toggles.
 */
export function voicePhrasePolarity(
  id: CommandId,
  language: DictationLanguage,
  phrase: string
): VoicePolarity | null {
  const voice = (COMMANDS[id] as CommandDef).voice;
  if (!voice) return null;
  const vocabulary = VOICE_VOCABULARY[language];
  const polar = voice.verbs.filter((cls) => vocabulary.verbs[cls].polarity !== null);
  if (polar.length === 0) return null;
  const words = phraseWords(phrase);
  const split = splitDefaultPhrase(id, language, words);
  if (split) return vocabulary.verbs[split.cls].polarity;
  const startsWithOff = polar.some(
    (cls) =>
      vocabulary.verbs[cls].polarity === "off" &&
      vocabulary.verbs[cls].phrases.some((verbPhrase) => {
        const verb = phraseWords(verbPhrase);
        return verb.length < words.length && verb.every((word, at) => words[at] === word);
      })
  );
  return startsWithOff ? "off" : "on";
}

/** A Command's default phrases in one language, `verb target`, as the author sees them. */
export function defaultVoicePhrases(id: CommandId, language: DictationLanguage): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const { id: owner, phrase } of voiceCommandPhrases(language)) {
    if (owner !== id) continue;
    const key = phraseWords(phrase).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  return phrases;
}

/** The phrases a Command answers to in one language: the author's list, else the defaults. */
export function voicePhrases(
  id: CommandId,
  language: DictationLanguage,
  custom: CustomVoiceCommands
): string[] {
  const own = custom[id]?.[language];
  return own !== undefined ? [...own] : defaultVoicePhrases(id, language);
}

/**
 * Cleans a list of phrases the way storage keeps it: trimmed, at least two
 * words once normalized, and each normalized phrase once.
 */
export function normalizeVoicePhraseList(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().replace(/\s+/gu, " ");
    const words = phraseWords(trimmed);
    if (words.length < MIN_VOICE_PHRASE_WORDS) continue;
    const key = words.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(trimmed);
  }
  return phrases;
}

function resolveCommandId(rawId: string): CommandId | null {
  const renamed = COMMAND_RENAMES[rawId] ?? rawId;
  return isCommandId(renamed) ? renamed : null;
}

/**
 * Whatever storage or a Shortcut File holds is made safe before any line is
 * matched: unknown Commands, Commands that take no Voice Commands, unknown
 * languages, and phrases under two words are dropped. An explicit empty list
 * stays: the author removed every phrase.
 */
export function normalizeCustomVoiceCommands(raw: unknown): CustomVoiceCommands {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const custom: CustomVoiceCommands = {};
  for (const [rawId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = resolveCommandId(rawId);
    if (id === null || !isVoiceEligible(id)) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const languages: Partial<Record<DictationLanguage, string[]>> = {};
    for (const language of VOICE_LANGUAGES) {
      const list = (value as Record<string, unknown>)[language];
      if (!Array.isArray(list)) continue;
      const phrases = normalizeVoicePhraseList(list);
      if (list.length === 0 || phrases.length > 0) languages[language] = phrases;
    }
    if (Object.keys(languages).length > 0) custom[id] = languages;
  }
  return custom;
}

export function buildVoiceCommandTable(
  language: DictationLanguage,
  custom: CustomVoiceCommands = {}
): VoiceCommandTable {
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
  const exact = new Map<string, VoiceCommandRun[]>();
  const pinned: VoicePinnedEntry[] = [];
  for (const id of COMMAND_IDS) {
    const voice = (COMMANDS[id] as CommandDef).voice;
    if (!voice) continue;
    // The author's list replaces this language's defaults for the Command.
    const own = custom[id]?.[language];
    if (own !== undefined) {
      for (const phrase of own) {
        const words = phraseWords(phrase);
        if (words.length < MIN_VOICE_PHRASE_WORDS) continue;
        const split = splitDefaultPhrase(id, language, words);
        if (split) {
          const polarity = vocabulary.verbs[split.cls].polarity;
          pinned.push({ verb: split.verb, target: split.target, run: { id, polarity } });
          continue;
        }
        const key = words.join(" ");
        const runs = exact.get(key) ?? [];
        runs.push({ id, polarity: voicePhrasePolarity(id, language, phrase) });
        exact.set(key, runs);
      }
      continue;
    }
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
    exact,
    pinned,
    heard: heardForms(language),
    demonstratives: new Set(vocabulary.demonstratives.map(normalizeWord)),
  };
}

function fillersThenTarget(
  table: VoiceCommandTable,
  words: readonly string[],
  from: number,
  target: readonly string[]
): boolean {
  // Every word between the verb and the target must be a filler, and the
  // target must cover the rest of the line.
  const start = words.length - target.length;
  if (start < from) return false;
  for (let at = from; at < start; at += 1) if (!table.fillers.has(words[at])) return false;
  return target.every((word, offset) => words[start + offset] === word);
}

/**
 * Every Command a whole line runs, the author's phrases first. The runtime
 * takes the first; the conflict check needs them all.
 */
export function* voiceCommandMatches(
  table: VoiceCommandTable,
  words: readonly string[]
): Generator<VoiceCommandRun> {
  if (words.length < MIN_VOICE_PHRASE_WORDS) return;
  yield* matchesOfWords(table, words);
  // The line as the author meant it, when the model misheard a default word.
  const rewritten = rewriteHeard(table.heard, words);
  const changed = rewritten.join(" ") !== words.join(" ");
  if (changed) yield* matchesOfWords(table, rewritten);
  yield* thatMatches(table, words);
  if (changed) yield* thatMatches(table, rewritten);
}

function* thatMatches(
  table: VoiceCommandTable,
  words: readonly string[]
): Generator<VoiceCommandRun> {
  if (words.length < MIN_VOICE_PHRASE_WORDS) return;
  if (!table.demonstratives.has(words[words.length - 1])) return;
  const rest = words.slice(0, -1);
  for (const run of matchesOfWords(table, rest)) {
    if (isMarkCommand(run.id)) yield { ...run, that: true };
  }
  for (const entry of table.targets.get("formatOn") ?? []) {
    if (entry.words.length === rest.length && entry.words.every((word, at) => rest[at] === word)) {
      yield { id: entry.id, polarity: "on", that: true };
    }
  }
}

function* matchesOfWords(
  table: VoiceCommandTable,
  words: readonly string[]
): Generator<VoiceCommandRun> {
  if (words.length < MIN_VOICE_PHRASE_WORDS) return;

  yield* table.exact.get(words.join(" ")) ?? [];

  for (const entry of table.pinned) {
    if (entry.verb.length > words.length) continue;
    if (!entry.verb.every((word, at) => words[at] === word)) continue;
    if (fillersThenTarget(table, words, entry.verb.length, entry.target)) yield entry.run;
  }

  let verb: VoiceVerbEntry | null = null;
  for (const candidate of table.verbs) {
    if (candidate.words.length > words.length) continue;
    if (!candidate.words.every((word, at) => words[at] === word)) continue;
    if (!verb || candidate.words.length > verb.words.length) verb = candidate;
  }
  if (!verb) return;

  for (const cls of verb.classes) {
    for (const target of table.targets.get(cls) ?? []) {
      if (fillersThenTarget(table, words, verb.words.length, target.words)) {
        yield { id: target.id, polarity: table.polarity.get(cls) ?? null };
      }
    }
  }
}

/**
 * The whole-line rule: one verb, any run of fillers, one target, nothing else,
 * or one of the author's phrases. Two words minimum, so an ordinary one-word
 * sentence never fires; `words` are the line's normalized word tokens with the
 * model's punctuation already gone.
 */
export function matchVoiceCommand(
  table: VoiceCommandTable,
  words: readonly string[]
): VoiceCommandRun | null {
  for (const run of voiceCommandMatches(table, words)) return run;
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

/**
 * Every default demonstrative phrase of a mark Command in one language, for
 * the gates only: `verb target dem` for every verb phrase and the bare
 * `target dem`. Never listed in the Shortcut Editor.
 */
export function voiceThatPhrases(language: DictationLanguage): VoiceCommandPhrase[] {
  const vocabulary = VOICE_VOCABULARY[language];
  const phrases: VoiceCommandPhrase[] = [];
  for (const id of COMMAND_IDS) {
    if (!isMarkCommand(id)) continue;
    const voice = (COMMANDS[id] as CommandDef).voice;
    if (!voice) continue;
    for (const cls of voice.verbs) {
      for (const verb of vocabulary.verbs[cls].phrases) {
        for (const target of voice.targets[language] ?? []) {
          for (const dem of vocabulary.demonstratives) {
            phrases.push({ id, phrase: `${verb} ${target} ${dem}` });
          }
        }
      }
    }
    for (const target of voice.targets[language] ?? []) {
      for (const dem of vocabulary.demonstratives) {
        phrases.push({ id, phrase: `${target} ${dem}` });
      }
    }
  }
  return phrases;
}
