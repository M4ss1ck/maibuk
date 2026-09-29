// Scoring for the Dictation phrase conformance lane (issue #285): what a
// Dictation Model heard for each recorded clip, run through the production
// Dictation Command Interpreter, turned into a hit rate for every default
// phrase. Pure over transcripts, so the gate lane tests it without a model.
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
  type InterpretResult,
  type PhraseTable,
  type TokenTrieNode,
} from "@/features/dictation/interpreter";
import { phraseWords } from "@/features/dictation/normalize";
import { entriesFor, type SpokenPunctuationEntry } from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";
import { VOICE_VOCABULARY, voiceCommandPhrases } from "@/features/dictation/voice-commands";
import { COMMAND_IDS, COMMANDS, type CommandDef, type CommandId } from "@/lib/shortcut-registry";
import { phraseItems, type PhraseItem } from "@/test/support/dictation-phrase-set";

/** The ship bar (issue #285): Accurate models hear at least this share of default phrases. */
export const SHIP_BAR_HIT_RATE = 0.8;

const NUMBER_WORDS: Record<DictationLanguage, Record<string, string>> = {
  en: { "1": "one", "2": "two", "3": "three" },
  es: { "1": "uno", "2": "dos", "3": "tres" },
};

/** Normalized words, with the digits a target contains spelled the way they are said. */
export function spokenWords(text: string, language: DictationLanguage): string[] {
  return phraseWords(text).map((word) => NUMBER_WORDS[language][word] ?? word);
}

function spokenKey(text: string, language: DictationLanguage): string {
  return spokenWords(text, language).join(" ");
}

export interface VoiceUnits {
  id: CommandId;
  verbs: string[];
  targets: string[];
}

/** Each voice-eligible Command's verb phrases and target nouns in one language. */
export function voiceUnits(language: DictationLanguage): VoiceUnits[] {
  const vocabulary = VOICE_VOCABULARY[language];
  const units: VoiceUnits[] = [];
  for (const id of COMMAND_IDS) {
    const voice = (COMMANDS[id] as CommandDef).voice;
    if (!voice) continue;
    const verbs = [...new Set(voice.verbs.flatMap((cls) => vocabulary.verbs[cls].phrases))];
    units.push({ id, verbs, targets: [...(voice.targets[language] ?? [])] });
  }
  return units;
}

export interface VoiceSplit {
  id: CommandId;
  verb: string;
  /** The spoken form of the target ("heading one" for "heading 1"). */
  target: string;
}

/** Which Command, verb, and target a `verb target` phrase is, or null. */
export function splitVoicePhrase(
  phrase: string,
  language: DictationLanguage,
  id?: CommandId
): VoiceSplit | null {
  const words = spokenKey(phrase, language);
  for (const unit of voiceUnits(language)) {
    if (id && unit.id !== id) continue;
    for (const verb of unit.verbs) {
      for (const target of unit.targets) {
        const spokenTarget = spokenKey(target, language);
        if (words === `${spokenKey(verb, language)} ${spokenTarget}`) {
          return { id: unit.id, verb, target: spokenTarget };
        }
      }
    }
  }
  return null;
}

export type DefaultPhrase =
  | { kind: "voice"; language: DictationLanguage; phrase: string; split: VoiceSplit }
  | {
      kind: "punctuation";
      language: DictationLanguage;
      phrase: string;
      entry: SpokenPunctuationEntry;
    };

/**
 * Every default phrase once by how it sounds: "make heading 1" and "make
 * heading one" are the same recording, so they are one row.
 */
export function defaultPhrases(language: DictationLanguage): DefaultPhrase[] {
  const rows: DefaultPhrase[] = [];
  const seen = new Set<string>();
  for (const { id, phrase } of voiceCommandPhrases(language)) {
    const split = splitVoicePhrase(phrase, language, id);
    if (!split) throw new Error(`cannot split default phrase "${phrase}" of ${id}`);
    const key = `${id}|${spokenKey(phrase, language)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ kind: "voice", language, phrase: `${split.verb} ${split.target}`, split });
  }
  for (const entry of entriesFor(language)) {
    for (const phrase of entry.phrases) rows.push({ kind: "punctuation", language, phrase, entry });
  }
  return rows;
}

/** What ships: the model's capabilities decide which marks act by default. */
export function defaultTable(
  language: DictationLanguage,
  capabilities: ModelSpec["capabilities"]
): PhraseTable {
  return buildPhraseTable(language, { capabilities });
}

function addToTrie(root: TokenTrieNode, phrase: string, entry: SpokenPunctuationEntry) {
  let node = root;
  for (const word of phraseWords(phrase)) {
    let child = node.children.get(word);
    if (!child) {
      child = { children: new Map() };
      node.children.set(word, child);
    }
    node = child;
  }
  node.match = entry;
}

/**
 * A table where only `phrase` acts, so its count is that phrase's alone even
 * when a clip carries several. "literal" only acts when the next words would
 * act, so its table also holds every other phrase of the language.
 */
export function isolatedTable(
  language: DictationLanguage,
  entry: SpokenPunctuationEntry,
  phrase: string
): PhraseTable {
  const base = buildPhraseTable(language, {
    settings: { enabled: false, entries: {}, aliases: {} },
  });
  const trie: TokenTrieNode = { children: new Map() };
  const scratch = new Set<string>();
  if (entry.actions.some((action) => action.kind === "scratch")) {
    scratch.add(phraseWords(phrase).join(" "));
  } else {
    if (entry.actions.some((action) => action.kind === "literal")) {
      for (const other of entriesFor(language)) {
        if (other.actions.some((action) => action.kind === "scratch")) continue;
        for (const otherPhrase of other.phrases) addToTrie(trie, otherPhrase, other);
      }
    }
    addToTrie(trie, phrase, entry);
  }
  return { ...base, trie, scratch };
}

function run(line: string, table: PhraseTable, capabilities: ModelSpec["capabilities"]) {
  return interpret({ line, before: "", capabilities, table, state: INITIAL_INTERPRETER_STATE });
}

function acted(result: InterpretResult): boolean {
  return result.result.kind !== "edits" || result.spokenPunctuationCount > 0;
}

/** How many times `phrase` acts on the lines, isolated from the clip's other phrases. */
export function phraseCount(
  lines: readonly string[],
  language: DictationLanguage,
  entry: SpokenPunctuationEntry,
  phrase: string,
  capabilities: ModelSpec["capabilities"]
): number {
  const table = isolatedTable(language, entry, phrase);
  let count = 0;
  for (const line of lines) {
    const result = run(line, table, capabilities);
    if (result.result.kind === "scratch") count += 1;
    else count += result.spokenPunctuationCount;
  }
  return count;
}

/** Whether a sentence meant as prose ran anything instead of typing. */
export function proseTriggers(
  lines: readonly string[],
  language: DictationLanguage,
  capabilities: ModelSpec["capabilities"]
): boolean {
  const table = defaultTable(language, capabilities);
  return lines.some((line) => acted(run(line, table, capabilities)));
}

/** A command clip is heard when it is one finished line that runs the Command its text runs. */
export function voiceClipHit(
  finals: readonly string[],
  item: PhraseItem,
  capabilities: ModelSpec["capabilities"]
): boolean {
  const table = defaultTable(item.language, capabilities);
  const expected = run(item.say, table, capabilities).result;
  const lines = finals.filter((line) => phraseWords(line).length > 0);
  if (lines.length !== 1 || expected.kind !== "voice_command") return false;
  const got = run(lines[0], table, capabilities).result;
  return (
    got.kind === "voice_command" && got.id === expected.id && got.polarity === expected.polarity
  );
}

export interface Clip {
  itemId: string;
  finals: string[];
}

export interface PhraseScore {
  row: DefaultPhrase;
  /** "recorded": a clip says this phrase; "inferred": its verb and target were heard elsewhere. */
  source: "recorded" | "inferred";
  rate: number;
  /** The clips that decided it, with what the model heard. */
  evidence: { itemId: string; heard: string; hit: boolean }[];
}

export interface ProseScore {
  item: PhraseItem;
  takes: number;
  triggered: number;
  /** Fires on its own text, before any model hears it. */
  firesOnText: boolean;
  heard: string[];
}

export interface ModelScore {
  language: DictationLanguage;
  phrases: PhraseScore[];
  prose: ProseScore[];
  /** Mean phrase rate over every default phrase. */
  hitRate: number;
  proseTriggers: number;
  /** Items with no clip at all; the score is not trusted while any remain. */
  missingItems: string[];
}

interface UnitTally {
  heard: number;
  takes: number;
}

function ratio(tally: UnitTally | undefined): number {
  return tally && tally.takes > 0 ? tally.heard / tally.takes : 0;
}

function tally(map: Map<string, UnitTally>, key: string, heard: boolean) {
  const entry = map.get(key) ?? { heard: 0, takes: 0 };
  entry.takes += 1;
  if (heard) entry.heard += 1;
  map.set(key, entry);
}

function occurrences(haystack: readonly string[], needle: readonly string[]): number {
  let count = 0;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((word, k) => haystack[i + k] === word)) count += 1;
  }
  return count;
}

/**
 * Scores one Dictation Model on the clips of its language. Each clip may
 * appear several times (one per take); every take counts.
 */
export function scoreModel(input: {
  language: DictationLanguage;
  capabilities: ModelSpec["capabilities"];
  clips: readonly Clip[];
}): ModelScore {
  const { language, capabilities } = input;
  const script = phraseItems(language);
  const byItem = new Map<string, Clip[]>();
  for (const clip of input.clips) {
    const list = byItem.get(clip.itemId) ?? [];
    list.push(clip);
    byItem.set(clip.itemId, list);
  }
  const missingItems = script.filter((item) => !byItem.has(item.id)).map((item) => item.id);

  // Voice clips: the whole command, and each unit it carries.
  const phraseTakes = new Map<string, { itemId: string; heard: string; hit: boolean }[]>();
  const verbs = new Map<string, UnitTally>();
  const targets = new Map<string, UnitTally>();
  for (const item of script.filter((entry) => entry.kind === "voice")) {
    const split = splitVoicePhrase(item.say, language);
    if (!split) throw new Error(`script line "${item.say}" is not a default phrase`);
    const key = `${split.id}|${split.verb} ${split.target}`;
    for (const clip of byItem.get(item.id) ?? []) {
      const heard = clip.finals.join(" / ");
      const hit = voiceClipHit(clip.finals, item, capabilities);
      const words = spokenWords(clip.finals.join(" "), language);
      const verbWords = spokenWords(split.verb, language);
      const targetWords = split.target.split(" ");
      const verbHeard = hit || verbWords.every((word, k) => words[k] === word);
      const targetHeard =
        hit ||
        targetWords.every((word, k) => words[words.length - targetWords.length + k] === word);
      tally(verbs, `${split.id}|${split.verb}`, verbHeard);
      tally(targets, `${split.id}|${split.target}`, targetHeard);
      const list = phraseTakes.get(key) ?? [];
      list.push({ itemId: item.id, heard, hit });
      phraseTakes.set(key, list);
    }
  }

  const carriers = script.filter((item) => item.kind === "punctuation");
  const phrases: PhraseScore[] = [];
  for (const row of defaultPhrases(language)) {
    if (row.kind === "voice") {
      const recorded = phraseTakes.get(`${row.split.id}|${row.phrase}`);
      if (recorded) {
        phrases.push({
          row,
          source: "recorded",
          rate: recorded.filter((take) => take.hit).length / recorded.length,
          evidence: recorded,
        });
        continue;
      }
      // A verb is heard as the verb of any Command, a target only as its own.
      const verbTally = [...verbs.entries()]
        .filter(([key]) => key.endsWith(`|${row.split.verb}`))
        .reduce<UnitTally>(
          (sum, [, value]) => ({ heard: sum.heard + value.heard, takes: sum.takes + value.takes }),
          { heard: 0, takes: 0 }
        );
      const rate = ratio(verbTally) * ratio(targets.get(`${row.split.id}|${row.split.target}`));
      phrases.push({ row, source: "inferred", rate, evidence: [] });
      continue;
    }
    const needle = phraseWords(row.phrase);
    const evidence: PhraseScore["evidence"] = [];
    for (const item of carriers) {
      const expected = phraseCount([item.say], language, row.entry, row.phrase, capabilities);
      if (expected === 0 || occurrences(phraseWords(item.say), needle) === 0) continue;
      for (const clip of byItem.get(item.id) ?? []) {
        const got = phraseCount(clip.finals, language, row.entry, row.phrase, capabilities);
        evidence.push({ itemId: item.id, heard: clip.finals.join(" / "), hit: got >= expected });
      }
    }
    const rate = evidence.length ? evidence.filter((take) => take.hit).length / evidence.length : 0;
    phrases.push({ row, source: "recorded", rate, evidence });
  }

  const prose: ProseScore[] = [];
  for (const item of script.filter((entry) => entry.kind === "prose")) {
    const clips = byItem.get(item.id) ?? [];
    prose.push({
      item,
      takes: clips.length,
      triggered: clips.filter((clip) => proseTriggers(clip.finals, language, capabilities)).length,
      firesOnText: proseTriggers([item.say], language, capabilities),
      heard: clips.map((clip) => clip.finals.join(" / ")),
    });
  }

  const hitRate = phrases.length
    ? phrases.reduce((sum, score) => sum + score.rate, 0) / phrases.length
    : 0;
  return {
    language,
    phrases,
    prose,
    hitRate,
    proseTriggers: prose.reduce((sum, score) => sum + score.triggered, 0),
    missingItems,
  };
}
