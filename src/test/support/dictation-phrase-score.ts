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
import {
  VOICE_VOCABULARY,
  heardForms,
  rewriteHeard,
  voiceCommandPhrases,
  voiceThatPhrases,
} from "@/features/dictation/voice-commands";
import { COMMAND_IDS, COMMANDS, type CommandDef, type CommandId } from "@/lib/shortcut-registry";
import { phraseItems, type PhraseItem } from "@/test/support/dictation-phrase-set";

/** The ship bar (issue #285): Accurate models hear at least this share of default phrases. */
export const SHIP_BAR_HIT_RATE = 0.8;

/**
 * The languages held to the hit-rate bar. English is reported but not gated
 * in v1: its only recordings are a non-native speaker's, and the misses are
 * accent, not phrasing, so no alias or removal would fix them (#285).
 */
export const SHIP_BAR_LANGUAGES: readonly DictationLanguage[] = ["es"];

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

/** Each verb Command's verb phrases and target nouns in one language. */
export function voiceUnits(language: DictationLanguage): VoiceUnits[] {
  const vocabulary = VOICE_VOCABULARY[language];
  const units: VoiceUnits[] = [];
  for (const id of COMMAND_IDS) {
    const voice = (COMMANDS[id] as CommandDef).voice;
    const verbs = voice?.verbs;
    if (!verbs) continue;
    const verbPhrases = [...new Set(verbs.flatMap((cls) => vocabulary.verbs[cls].phrases))];
    units.push({ id, verbs: verbPhrases, targets: [...(voice?.targets?.[language] ?? [])] });
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
  | { kind: "voice_that"; language: DictationLanguage; phrase: string; id: CommandId }
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
    // Whole-line label phrases have no verb and target units to infer from.
    if (!split) continue;
    const key = `${id}|${spokenKey(phrase, language)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ kind: "voice", language, phrase: `${split.verb} ${split.target}`, split });
  }
  // Demonstrative mark phrases ("bold that") follow the voice rows in order.
  // They are one row per default phrase, deduped by how they sound.
  for (const { id, phrase } of voiceThatPhrases(language)) {
    const key = `${id}|${spokenKey(phrase, language)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ kind: "voice_that", language, phrase, id });
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
    // The phrase as the models mishear it counts as the phrase itself.
    const key = phraseWords(phrase).join(" ");
    for (const [heard, meant] of Object.entries(entry.heard ?? {})) {
      if (phraseWords(meant).join(" ") === key) addToTrie(trie, heard, entry);
    }
  }
  return { ...base, trie, scratch };
}

/**
 * A clip's finished lines through the interpreter in order, the way a session
 * inserts them: each line sees the text before it and the carried state.
 */
function runLines(
  lines: readonly string[],
  table: PhraseTable,
  capabilities: ModelSpec["capabilities"]
): InterpretResult[] {
  const results: InterpretResult[] = [];
  let before = "";
  let state = INITIAL_INTERPRETER_STATE;
  for (const line of lines) {
    const result = interpret({ line, before: before.slice(-256), capabilities, table, state });
    results.push(result);
    state = result.state;
    if (result.result.kind !== "edits") continue;
    for (const edit of result.result.edits) {
      if (edit.kind === "text")
        before += before && !/\s$/u.test(before) ? ` ${edit.text}` : edit.text;
      else if (edit.kind !== "opener") before += "\n";
    }
  }
  return results;
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
  for (const result of runLines(lines, table, capabilities)) {
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
  return runLines(lines, defaultTable(language, capabilities), capabilities).some(acted);
}

/** The finished lines that carry words; a model's empty line is not a line the author sees. */
function spokenLines(finals: readonly string[]): string[] {
  return finals.filter((line) => phraseWords(line).length > 0);
}

/** A command clip is heard when it is one finished line that runs the Command its text runs. */
export function voiceClipHit(
  finals: readonly string[],
  item: PhraseItem,
  capabilities: ModelSpec["capabilities"]
): boolean {
  const table = defaultTable(item.language, capabilities);
  const [expected] = runLines([item.say], table, capabilities);
  const lines = spokenLines(finals);
  if (lines.length !== 1 || expected.result.kind !== "voice_command") return false;
  const [got] = runLines(lines, table, capabilities);
  return (
    got.result.kind === "voice_command" &&
    got.result.id === expected.result.id &&
    got.result.polarity === expected.result.polarity &&
    Boolean(got.result.that) === Boolean(expected.result.that)
  );
}

/**
 * An app-tier clip hits when the model's finals come back as exactly one
 * line that runs what the script line runs: the same kind, and for a
 * voice_command the same Command, for a click the same name, for a
 * click_number the same number. Recorded whole, scored whole, never
 * inferred from units (issue #324).
 */
export function appClipHit(
  finals: readonly string[],
  item: PhraseItem,
  capabilities: ModelSpec["capabilities"]
): boolean {
  const table = defaultTable(item.language, capabilities);
  const [expected] = runLines([item.say], table, capabilities);
  if (
    expected.result.kind !== "voice_command" &&
    expected.result.kind !== "click" &&
    expected.result.kind !== "click_number"
  ) {
    return false;
  }
  const lines = spokenLines(finals);
  if (lines.length !== 1) return false;
  const [got] = runLines(lines, table, capabilities);
  if (got.result.kind !== expected.result.kind) return false;
  if (expected.result.kind === "voice_command" && got.result.kind === "voice_command") {
    return got.result.id === expected.result.id;
  }
  if (expected.result.kind === "click" && got.result.kind === "click") {
    return got.result.name === expected.result.name;
  }
  if (expected.result.kind === "click_number" && got.result.kind === "click_number") {
    return got.result.n === expected.result.n;
  }
  return false;
}

/** What an app clip is expected to run, as a short report label. */
export function appExpectedLabel(
  item: PhraseItem,
  capabilities: ModelSpec["capabilities"]
): string {
  const table = defaultTable(item.language, capabilities);
  const [expected] = runLines([item.say], table, capabilities);
  const result = expected.result;
  if (result.kind === "voice_command") return `voice_command:${result.id}`;
  if (result.kind === "click") return `click:${result.name}`;
  if (result.kind === "click_number") return `click_number:${result.n}`;
  return result.kind;
}

export interface Clip {
  itemId: string;
  finals: string[];
}

export interface Evidence {
  itemId: string;
  heard: string;
  hit: boolean;
}

export interface PhraseScore {
  row: DefaultPhrase;
  /** "recorded": a clip says this phrase; "inferred": its verb and target were heard elsewhere. */
  source: "recorded" | "inferred";
  rate: number;
  /** The clips that decided it, with what the model heard. */
  evidence: Evidence[];
}

export interface ProseScore {
  item: PhraseItem;
  takes: number;
  triggered: number;
  /** Fires on its own text, before any model hears it. */
  firesOnText: boolean;
  heard: string[];
}

/** One app-tier clip (issue #324): recorded whole, scored whole, never inferred. */
export interface AppScore {
  item: PhraseItem;
  /** What the script line runs, e.g. "voice_command:global.gotoNotes" or "click:export". */
  expected: string;
  takes: number;
  hits: number;
  rate: number;
  heard: string[];
}

export interface ModelScore {
  language: DictationLanguage;
  phrases: PhraseScore[];
  prose: ProseScore[];
  /** One row per app-tier clip, in script order; never inferred, never gated. */
  app: AppScore[];
  /** Mean phrase rate over every default phrase: the ship bar. */
  hitRate: number;
  /** The same mean over Voice Command phrases and over Spoken Punctuation phrases. */
  voiceRate: number;
  punctuationRate: number;
  proseTriggers: number;
  /** Prose triggers on sentences that type as text when heard right: the model's share. */
  misheardProseTriggers: number;
  /** Items with no clip at all; the score is not trusted while any remain. */
  missingItems: string[];
}

class UnitTally {
  heard = 0;
  takes = 0;

  add(heard: boolean) {
    this.takes += 1;
    if (heard) this.heard += 1;
  }

  get rate(): number {
    return this.takes > 0 ? this.heard / this.takes : 0;
  }
}

function tallyOf<Key>(map: Map<Key, UnitTally>, key: Key): UnitTally {
  let tally = map.get(key);
  if (!tally) {
    tally = new UnitTally();
    map.set(key, tally);
  }
  return tally;
}

function startsWithWords(words: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= words.length && prefix.every((word, k) => words[k] === word);
}

function endsWithWords(words: readonly string[], suffix: readonly string[]): boolean {
  const offset = words.length - suffix.length;
  return offset >= 0 && suffix.every((word, k) => words[offset + k] === word);
}

function occurrences(words: readonly string[], needle: readonly string[]): number {
  let count = 0;
  for (let i = 0; i + needle.length <= words.length; i += 1) {
    if (startsWithWords(words.slice(i), needle)) count += 1;
  }
  return count;
}

function mean(rates: readonly number[]): number {
  return rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : 0;
}

type ClipsByItem = ReadonlyMap<string, readonly Clip[]>;

interface ScoreContext {
  language: DictationLanguage;
  capabilities: ModelSpec["capabilities"];
  script: readonly PhraseItem[];
  clips: ClipsByItem;
}

/**
 * Voice Command rows. A recorded row is its own clips; any other row is its
 * verb's hit rate (a verb is the same word for every Command) times its
 * target's (a target only counts for its own Command). A unit is heard only
 * in a clip that came back as one line, the same test a recorded row passes.
 */
function scoreVoice(context: ScoreContext, rows: readonly DefaultPhrase[]): PhraseScore[] {
  const { language, capabilities, script, clips } = context;
  const heard = heardForms(language);
  // Demonstrative clips ("bold that", "poner negrita eso") match a
  // voiceThatPhrases row by how they sound; they are scored as whole clips
  // below, never as verb-target units, so this loop skips them.
  const thatSpoken = new Set(
    voiceThatPhrases(language).map(({ phrase }) => spokenKey(phrase, language))
  );
  const recorded = new Map<string, Evidence[]>();
  const verbs = new Map<string, UnitTally>();
  const targets = new Map<CommandId, Map<string, UnitTally>>();
  for (const item of script.filter((entry) => entry.kind === "voice")) {
    if (thatSpoken.has(spokenKey(item.say, language))) continue;
    const split = splitVoicePhrase(item.say, language);
    if (!split) throw new Error(`script line "${item.say}" is not a default phrase`);
    const ownTargets = targets.get(split.id) ?? new Map<string, UnitTally>();
    targets.set(split.id, ownTargets);
    for (const clip of clips.get(item.id) ?? []) {
      const hit = voiceClipHit(clip.finals, item, capabilities);
      const lines = spokenLines(clip.finals);
      // A unit counts as heard in the forms the matcher accepts for it.
      const words = lines.length === 1 ? rewriteHeard(heard, spokenWords(lines[0], language)) : [];
      tallyOf(verbs, split.verb).add(
        hit || startsWithWords(words, spokenWords(split.verb, language))
      );
      tallyOf(ownTargets, split.target).add(hit || endsWithWords(words, split.target.split(" ")));
      const key = `${split.id} ${split.verb} ${split.target}`;
      recorded.set(key, [
        ...(recorded.get(key) ?? []),
        { itemId: item.id, heard: clip.finals.join(" / "), hit },
      ]);
    }
  }

  return rows.flatMap((row): PhraseScore[] => {
    if (row.kind !== "voice") return [];
    const evidence = recorded.get(`${row.split.id} ${row.phrase}`);
    if (evidence) {
      return [
        { row, source: "recorded", rate: mean(evidence.map((e) => (e.hit ? 1 : 0))), evidence },
      ];
    }
    const verb = verbs.get(row.split.verb)?.rate ?? 0;
    const target = targets.get(row.split.id)?.get(row.split.target)?.rate ?? 0;
    return [{ row, source: "inferred", rate: verb * target, evidence: [] }];
  });
}

/**
 * Demonstrative mark rows ("bold that"). A row is scored only from recorded
 * clips that say it, normalized the way they sound; a row with no recorded
 * clip is left out entirely, never inferred and never missing.
 */
function scoreVoiceThat(context: ScoreContext, rows: readonly DefaultPhrase[]): PhraseScore[] {
  const { capabilities, script, clips } = context;
  const out: PhraseScore[] = [];
  for (const row of rows) {
    if (row.kind !== "voice_that") continue;
    const key = spokenKey(row.phrase, row.language);
    const evidence: Evidence[] = [];
    for (const item of script.filter((entry) => entry.kind === "voice")) {
      if (spokenKey(item.say, row.language) !== key) continue;
      for (const clip of clips.get(item.id) ?? []) {
        evidence.push({
          itemId: item.id,
          heard: clip.finals.join(" / "),
          hit: voiceClipHit(clip.finals, item, capabilities),
        });
      }
    }
    if (evidence.length === 0) continue;
    out.push({
      row,
      source: "recorded",
      rate: mean(evidence.map((take) => (take.hit ? 1 : 0))),
      evidence,
    });
  }
  return out;
}

/**
 * Spoken Punctuation rows: every carrier that says the phrase, each take hit
 * only when the phrase acts exactly as often as in the script. More is an
 * unwanted mark in the author's text, fewer is a miss.
 */
function scorePunctuation(context: ScoreContext, rows: readonly DefaultPhrase[]): PhraseScore[] {
  const { language, capabilities, script, clips } = context;
  const carriers = script.filter((item) => item.kind === "punctuation");
  return rows.flatMap((row): PhraseScore[] => {
    if (row.kind !== "punctuation") return [];
    const needle = phraseWords(row.phrase);
    const evidence: Evidence[] = [];
    for (const item of carriers) {
      if (occurrences(phraseWords(item.say), needle) === 0) continue;
      const expected = phraseCount([item.say], language, row.entry, row.phrase, capabilities);
      if (expected === 0) continue;
      for (const clip of clips.get(item.id) ?? []) {
        const got = phraseCount(clip.finals, language, row.entry, row.phrase, capabilities);
        evidence.push({ itemId: item.id, heard: clip.finals.join(" / "), hit: got === expected });
      }
    }
    return [
      { row, source: "recorded", rate: mean(evidence.map((e) => (e.hit ? 1 : 0))), evidence },
    ];
  });
}

function scoreProse(context: ScoreContext): ProseScore[] {
  const { language, capabilities, script, clips } = context;
  return script
    .filter((item) => item.kind === "prose")
    .map((item) => {
      const own = clips.get(item.id) ?? [];
      return {
        item,
        takes: own.length,
        triggered: own.filter((clip) => proseTriggers(clip.finals, language, capabilities)).length,
        firesOnText: proseTriggers([item.say], language, capabilities),
        heard: own.map((clip) => clip.finals.join(" / ")),
      };
    });
}

/**
 * App-tier rows (issue #324): one row per script clip, in script order.
 * Every take counts; a clip with no take stays in the list with no takes,
 * reported as "not recorded" and never failing the lane.
 */
function scoreApp(context: ScoreContext): AppScore[] {
  const { capabilities, script, clips } = context;
  return script
    .filter((item) => item.kind === "app")
    .map((item) => {
      const own = clips.get(item.id) ?? [];
      const hits = own.filter((clip) => appClipHit(clip.finals, item, capabilities)).length;
      return {
        item,
        expected: appExpectedLabel(item, capabilities),
        takes: own.length,
        hits,
        rate: own.length > 0 ? hits / own.length : 0,
        heard: own.map((clip) => clip.finals.join(" / ")),
      };
    });
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
  const clips = new Map<string, Clip[]>();
  for (const clip of input.clips) clips.set(clip.itemId, [...(clips.get(clip.itemId) ?? []), clip]);
  const context: ScoreContext = { language, capabilities, script, clips };

  // Default-phrase order, so every model's rows line up in the report. A
  // voice_that row with no recorded clip has no score and stays out.
  const rows = defaultPhrases(language);
  const scored = [
    ...scoreVoice(context, rows),
    ...scoreVoiceThat(context, rows),
    ...scorePunctuation(context, rows),
  ];
  const byRow = new Map(scored.map((score) => [score.row, score]));
  const phrases = rows.flatMap((row) => {
    const score = byRow.get(row);
    return score ? [score] : [];
  });
  const prose = scoreProse(context);
  const app = scoreApp(context);
  const rateOf = (...kinds: readonly DefaultPhrase["kind"][]) =>
    mean(phrases.filter((score) => kinds.includes(score.row.kind)).map((score) => score.rate));

  return {
    language,
    phrases,
    prose,
    app,
    hitRate: mean(phrases.map((score) => score.rate)),
    voiceRate: rateOf("voice", "voice_that"),
    punctuationRate: rateOf("punctuation"),
    proseTriggers: prose.reduce((sum, score) => sum + score.triggered, 0),
    misheardProseTriggers: prose
      .filter((score) => !score.firesOnText)
      .reduce((sum, score) => sum + score.triggered, 0),
    // App clips are reported as "not recorded" in their own section and
    // never fail the lane, so they are not missing items.
    missingItems: script
      .filter((item) => item.kind !== "app" && !clips.has(item.id))
      .map((item) => item.id),
  };
}
