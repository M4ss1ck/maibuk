// The Dictation Command Interpreter (ADR 0015): deterministic, pure rules over
// finished lines. No engine, no editor, no DOM. See
// docs/research/dictation-command-interpreter.md sections 2.4 and 3.
//
// A finished line first passes the Dictation Vocabulary: heard forms are
// replaced by their written form as protected literal text. What remains is
// matched against a prebuilt token trie of Spoken Punctuation phrases, longest
// match first. Matching folds case and accents and ignores the model's own
// punctuation; model punctuation adjacent to a matched phrase is dropped so
// marks never double. Text is then cased and spaced using the bounded text
// before the caret.
import { normalizePhrase, tokenWords, tokenize, type Token } from "@/features/dictation/normalize";
import type { DictationEdit } from "@/features/dictation/router";
import {
  defaultTriggers,
  entriesFor,
  isEntryEnabled,
  type PhraseAction,
  type SpokenPunctuationEntry,
  type SpokenPunctuationLanguageSettings,
} from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";
import {
  buildVoiceCommandTable,
  matchVoiceCommand,
  type CustomVoiceCommands,
  type VoiceCommandRun,
  type VoiceCommandTable,
} from "@/features/dictation/voice-commands";
import type { VocabularyEntry } from "@/features/dictation/vocabulary";

export interface TokenTrieNode<Match = SpokenPunctuationEntry> {
  children: Map<string, TokenTrieNode<Match>>;
  match?: Match;
}

/** A prebuilt token trie for one Dictation Language. Build once, reuse per line. */
export interface PhraseTable {
  language: DictationLanguage;
  trie: TokenTrieNode;
  /** Heard-form trie for the Dictation Vocabulary; matched before everything else. */
  vocabularyTrie: TokenTrieNode<VocabularyEntry>;
  /** Normalized whole-line phrases that remove the last dictated sentence. */
  scratch: ReadonlySet<string>;
  /** Whole-line Voice Commands (ADR 0014), matched before scratch that. */
  voice: VoiceCommandTable;
}

export interface PhraseTableOptions {
  /** What the author switched off, and the extra phrases they added. */
  settings?: SpokenPunctuationLanguageSettings;
  /** What the Dictation Model's text already has; sets the entries' defaults. */
  capabilities?: ModelSpec["capabilities"];
  /** The author's Dictation Vocabulary for this Dictation Language. */
  vocabulary?: readonly VocabularyEntry[];
  /** The author's custom Voice Commands (ADR 0014); each replaces that language's defaults. */
  voice?: CustomVoiceCommands;
}

export interface InterpreterState {
  /** Capitalize the first letter of the next word (a carried sentence charge). */
  capitalizeNext: boolean;
  /** Suppress the separating space before the next word. */
  noSpaceNext: boolean;
}

export const INITIAL_INTERPRETER_STATE: InterpreterState = {
  capitalizeNext: false,
  noSpaceNext: false,
};

export interface InterpretInput {
  /** Moonshine's final text for one finished line. */
  line: string;
  /** Bounded text before the caret (at most 256 characters). */
  before: string;
  /** What the Dictation Model's text already has. */
  capabilities: ModelSpec["capabilities"];
  table: PhraseTable;
  state: InterpreterState;
}

export interface InterpretResult {
  result:
    | { kind: "edits"; edits: DictationEdit[] }
    | ({ kind: "voice_command" } & VoiceCommandRun)
    | { kind: "scratch" };
  state: InterpreterState;
  spokenPunctuationCount: number;
}

/**
 * The whole-line rule over the already-substituted tokens: folds case and
 * accents, ignores model punctuation, and never counts a protected Vocabulary
 * written form, so the Vocabulary can write "borra eso" without the line
 * removing it again.
 */
function isScratchTokens(tokens: Token[], table: PhraseTable): boolean {
  // Never let a protected Vocabulary written form act as scratch that.
  if (tokens.some((token) => token.protected)) return false;
  const norm = tokenWords(tokens).join(" ");
  return norm !== "" && table.scratch.has(norm);
}

interface Match {
  start: number;
  end: number;
  entry: SpokenPunctuationEntry;
}

/** Adds one phrase to a token trie as a chain of normalized word tokens. */
function addPhrase<MatchType>(root: TokenTrieNode<MatchType>, phrase: string, entry: MatchType) {
  const words = tokenize(phrase)
    .filter((token) => !token.mark)
    .map((token) => token.norm ?? "");
  if (words.length === 0) return;
  let node = root;
  for (const word of words) {
    let child = node.children.get(word);
    if (!child) {
      child = { children: new Map() };
      node.children.set(word, child);
    }
    node = child;
  }
  node.match = entry;
}

const OPENING_MARKS = new Set(["¿", "¡", "«", "“", "‘", "(", "[", "{"]);
const SENTENCE_END_MARKS = new Set([".", "?", "!"]);

/**
 * One shared sentence-boundary rule for the interpreter, the editor target,
 * and the orphan copy path: a sentence ends after `.`, `?`, `!`, or a hard
 * break (`\n` in the bounded text before the caret).
 */
function lastSentenceEndIndex(text: string): number {
  for (let idx = text.length - 1; idx >= 0; idx -= 1) {
    const ch = text[idx];
    if (ch === "\n" || SENTENCE_END_MARKS.has(ch)) return idx;
  }
  return -1;
}

/** Opening quotes and parentheses an opener is inserted after, never before. */
const SENTENCE_START_SKIP_MARKS = new Set(["«", "“", "‘", "(", "[", "{"]);

function stepPastOpeningMarks(text: string, offset: number): number {
  let i = offset;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || SENTENCE_START_SKIP_MARKS.has(ch)) i += 1;
    else break;
  }
  return i;
}

/** Start of the current sentence: after the last end mark, past whitespace and opening quotes/parens. */
export function findSentenceStartOffset(text: string): number {
  return stepPastOpeningMarks(text, lastSentenceEndIndex(text) + 1);
}

/** Walks a token trie over whole words, folded, longest match first. */
function findTrieMatches<MatchType>(
  tokens: Token[],
  trie: TokenTrieNode<MatchType>
): { start: number; end: number; entry: MatchType }[] {
  const matches: { start: number; end: number; entry: MatchType }[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].mark || tokens[i].protected) {
      i += 1;
      continue;
    }
    let node: TokenTrieNode<MatchType> | undefined = trie;
    let best: { start: number; end: number; entry: MatchType } | null = null;
    let j = i;
    while (j < tokens.length && node) {
      const token = tokens[j];
      if (token.mark) {
        j += 1;
        continue;
      }
      // Protected text is never matched over, and never re-matched itself.
      if (token.protected) break;
      const child = node.children.get(token.norm ?? "");
      if (!child) break;
      node = child;
      if (node.match) best = { start: i, end: j, entry: node.match };
      j += 1;
    }
    if (best) {
      matches.push(best);
      i = best.end + 1;
    } else {
      i += 1;
    }
  }
  return matches;
}

/**
 * The Dictation Vocabulary pass, run before everything else (ADR 0015). Each
 * matched heard form becomes one protected token carrying the written form
 * exactly as typed, so no later step can re-case it or read it as punctuation,
 * a Voice Command, or a scratch phrase. Model punctuation inside the matched
 * span is dropped with the heard words.
 */
export function applyVocabulary(tokens: Token[], trie: TokenTrieNode<VocabularyEntry>): Token[] {
  if (trie.children.size === 0) return tokens;
  const matches = findTrieMatches(tokens, trie);
  if (matches.length === 0) return tokens;
  const out: Token[] = [];
  let copyUntil = 0;
  for (const match of matches) {
    for (let index = copyUntil; index < match.start; index += 1) out.push(tokens[index]);
    out.push({ surface: match.entry.written, norm: null, mark: false, protected: true });
    copyUntil = match.end + 1;
  }
  for (let index = copyUntil; index < tokens.length; index += 1) out.push(tokens[index]);
  return out;
}

/** Build the prebuilt token trie for one Dictation Language. */
export function buildPhraseTable(
  language: DictationLanguage,
  options: PhraseTableOptions = {}
): PhraseTable {
  const { settings, capabilities, vocabulary, voice } = options;
  const trie: TokenTrieNode = { children: new Map() };
  const vocabularyTrie: TokenTrieNode<VocabularyEntry> = { children: new Map() };
  const scratch = new Set<string>();

  for (const entry of entriesFor(language)) {
    if (!isEntryEnabled(entry, settings, capabilities)) continue;
    const aliases = settings?.aliases[entry.id] ?? [];
    const phrases = [...defaultTriggers(entry), ...aliases];
    if (entry.actions.some((action) => action.kind === "scratch")) {
      for (const phrase of phrases) {
        const norm = normalizePhrase(phrase);
        if (norm !== "") scratch.add(norm);
      }
      continue;
    }
    for (const phrase of phrases) addPhrase(trie, phrase, entry);
  }

  for (const entry of vocabulary ?? []) {
    addPhrase(vocabularyTrie, entry.heard, entry);
  }

  return {
    language,
    trie,
    vocabularyTrie,
    scratch,
    voice: buildVoiceCommandTable(language, voice),
  };
}

function isSentenceStart(before: string): boolean {
  if (before === "") return true;
  if (before[before.length - 1] === "\n") return true;
  const trimmed = before.replace(/[ \t]+$/u, "");
  if (trimmed === "") return true;
  return SENTENCE_END_MARKS.has(trimmed[trimmed.length - 1]);
}

/** Whether the current sentence already has its Spanish opener. Derived from `before`, never stored. */
function openerInSentence(before: string, mark: "¿" | "¡"): boolean {
  const lastEnd = lastSentenceEndIndex(before);
  return before.indexOf(mark, lastEnd + 1) !== -1;
}

function uppercaseFirst(word: string): string {
  return word.replace(
    /^(\P{L}*)(\p{L})/u,
    (_all, prefix: string, letter: string) => prefix + letter.toUpperCase()
  );
}

function lowercaseFirst(word: string): string {
  return word.replace(
    /^(\P{L}*)(\p{L})/u,
    (_all, prefix: string, letter: string) => prefix + letter.toLowerCase()
  );
}

function endsWithOpening(text: string): boolean {
  return OPENING_MARKS.has(text[text.length - 1]);
}

export function interpret(input: InterpretInput): InterpretResult {
  const { line, before, capabilities, table, state } = input;
  const rawTokens = tokenize(line);
  if (rawTokens.length === 0) {
    return { result: { kind: "edits", edits: [] }, state, spokenPunctuationCount: 0 };
  }

  // The Dictation Vocabulary runs first (ADR 0015): the rest of the pipeline
  // sees its written forms as protected literal text.
  const tokens = applyVocabulary(rawTokens, table.vocabularyTrie);

  // A whole-line Voice Command runs a registry Command instead of inserting
  // (ADR 0015 order: after the Vocabulary, before scratch that). A written
  // form the Vocabulary produced is literal text and never fires a Command.
  if (tokens.every((token) => !token.protected)) {
    const command = matchVoiceCommand(table.voice, tokenWords(tokens));
    if (command) {
      return {
        result: { kind: "voice_command", id: command.id, polarity: command.polarity },
        state,
        spokenPunctuationCount: 0,
      };
    }
  }

  // Built-in whole-line words (ADR 0015 order): scratch that never acts inside
  // prose, and never matches words the Vocabulary replacement wrote.
  if (isScratchTokens(tokens, table)) {
    return { result: { kind: "scratch" }, state, spokenPunctuationCount: 0 };
  }

  // The table already holds the entries that act; capabilities only decide
  // whether a model `?`/`!` earns the Spanish opener it could not have typed.
  const modelInsertsMarks = capabilities.punctuation;
  const spanish = table.language === "es";
  const edits: DictationEdit[] = [];
  let spokenPunctuationCount = 0;
  let current = "";
  let capitalize = state.capitalizeNext || isSentenceStart(before);
  let firstWord = true;
  let hasQuestionOpener = openerInSentence(before, "¿");
  let hasExclamationOpener = openerInSentence(before, "¡");
  let capNext = false;
  let literalNext = false;

  const flush = () => {
    if (current !== "") {
      edits.push({ kind: "text", text: current });
      current = "";
    }
  };

  const resetSentence = () => {
    hasQuestionOpener = false;
    hasExclamationOpener = false;
  };

  const ensureOpener = (mark: "¿" | "¡") => {
    const has = mark === "¿" ? hasQuestionOpener : hasExclamationOpener;
    if (!spanish || has) return;
    flush();
    edits.push({ kind: "opener", mark });
    if (mark === "¿") hasQuestionOpener = true;
    else hasExclamationOpener = true;
  };

  const appendWord = (surface: string, forceCap = false) => {
    let word = surface;
    if (forceCap || capitalize) {
      word = uppercaseFirst(word);
      capitalize = false;
    } else if (firstWord) {
      word = lowercaseFirst(word);
    }
    firstWord = false;
    if (current !== "" && !endsWithOpening(current) && !/\s$/u.test(current)) current += " ";
    current += word;
  };

  // A Vocabulary written form goes in exactly as typed: no sentence casing,
  // no lowercasing, and a pending cap or literal charge is spent on it.
  const appendProtected = (surface: string) => {
    if (current !== "" && !endsWithOpening(current) && !/\s$/u.test(current)) current += " ";
    current += surface;
    firstWord = false;
    capitalize = false;
    capNext = false;
    literalNext = false;
  };

  const appendMark = (mark: string) => {
    if (mark === "¿") hasQuestionOpener = true;
    else if (mark === "¡") hasExclamationOpener = true;
    else if (mark === "?" && spanish && !modelInsertsMarks) ensureOpener("¿");
    else if (mark === "!" && spanish && !modelInsertsMarks) ensureOpener("¡");
    if (OPENING_MARKS.has(mark) && current !== "" && !/\s$/u.test(current)) current += " ";
    current += mark;
    if (SENTENCE_END_MARKS.has(mark)) {
      capitalize = true;
      resetSentence();
    }
  };

  // Scratch entries live in `table.scratch`, never in the trie, so this loop
  // never sees a `scratch` action.
  const emitActions = (actions: readonly PhraseAction[]) => {
    for (const action of actions) {
      if (action.kind === "mark") {
        appendMark(action.mark);
      } else if (action.kind === "paragraph") {
        flush();
        edits.push({ kind: "paragraph" });
        capitalize = true;
        resetSentence();
      } else if (action.kind === "line_break") {
        flush();
        edits.push({ kind: "line_break" });
        capitalize = true;
      } else if (action.kind === "list_item") {
        flush();
        edits.push({ kind: "list_item" });
        capitalize = true;
        resetSentence();
      } else if (action.kind === "cap") {
        capNext = true;
      } else if (action.kind === "literal") {
        literalNext = true;
      }
    }
  };

  const allMatches = findTrieMatches(tokens, table.trie);
  const allByStart = new Map<number, Match>();
  for (const match of allMatches) allByStart.set(match.start, match);

  // The token right after a modifier, skipping only model punctuation. Phrase
  // tokens count: "di literal coma" targets "coma" even though it starts a
  // match, and "hola mayúscula coma" targets "coma" the same way.
  const immediateNextWord = (from: number): number | null => {
    let j = from;
    while (j < tokens.length) {
      if (tokens[j].mark) {
        j += 1;
        continue;
      }
      return j;
    }
    return null;
  };

  // "literal" only escapes when the words right after it would otherwise act
  // (they start a matched phrase). Otherwise it is ordinary prose and stays
  // as text, so it never deletes a word. "capitalize"/"mayúscula" acts on the
  // next word anywhere. A modifier with no word after it stays as prose.
  const matches: Match[] = [];
  for (const match of allMatches) {
    const isCap = match.entry.actions.some((action) => action.kind === "cap");
    const isLiteral = match.entry.actions.some((action) => action.kind === "literal");
    if (!isCap && !isLiteral) {
      matches.push(match);
      continue;
    }
    const target = immediateNextWord(match.end + 1);
    if (target === null) continue;
    if (isCap) {
      matches.push(match);
      continue;
    }
    if (allByStart.has(target)) matches.push(match);
  }

  const byStart = new Map<number, Match>();
  const skip = new Set<number>();
  const drop = new Set<number>();
  for (const match of matches) {
    byStart.set(match.start, match);
    for (let k = match.start; k <= match.end; k += 1) skip.add(k);
    // A layout phrase or a next-word modifier adds no mark, so punctuation
    // before it belongs to the preceding prose. A spoken mark replaces
    // adjacent model punctuation.
    if (match.entry.actions.some((action) => action.kind === "mark")) {
      let beforeMark = match.start - 1;
      while (
        beforeMark >= 0 &&
        tokens[beforeMark].mark &&
        !OPENING_MARKS.has(tokens[beforeMark].surface)
      ) {
        drop.add(beforeMark);
        beforeMark -= 1;
      }
    }
    // A trailing mark on the phrase itself ("New paragraph.") is model noise.
    // A modifier's trailing model punctuation ("capitalize.", "literal, coma")
    // is dropped too; the modifier's word follows after skipping marks.
    let afterMark = match.end + 1;
    while (
      afterMark < tokens.length &&
      tokens[afterMark].mark &&
      !OPENING_MARKS.has(tokens[afterMark].surface)
    ) {
      drop.add(afterMark);
      afterMark += 1;
    }
  }

  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].protected) {
      appendProtected(tokens[i].surface);
      i += 1;
      continue;
    }
    if ((capNext || literalNext) && !tokens[i].mark) {
      // A modifier protects its word even when that word would otherwise start
      // a Spoken Punctuation phrase ("literal coma" writes "coma"). Free any
      // longer phrase starting here so its tail stays as prose.
      const overriding = byStart.get(i);
      if (overriding) {
        for (let k = overriding.start + 1; k <= overriding.end; k += 1) skip.delete(k);
        byStart.delete(i);
      }
      const forceCap = capNext;
      capNext = false;
      literalNext = false;
      appendWord(tokens[i].surface, forceCap);
      i += 1;
      continue;
    }
    if ((capNext || literalNext) && (tokens[i].mark || skip.has(i) || drop.has(i))) {
      // Model punctuation between a modifier and its word is noise.
      i += 1;
      continue;
    }
    const match = byStart.get(i);
    if (match) {
      emitActions(match.entry.actions);
      spokenPunctuationCount += 1;
      i = match.end + 1;
      continue;
    }
    if (skip.has(i) || drop.has(i)) {
      i += 1;
      continue;
    }
    const token = tokens[i];
    if (token.mark) appendMark(token.surface);
    else appendWord(token.surface);
    i += 1;
  }
  flush();

  return {
    result: { kind: "edits", edits },
    state: { capitalizeNext: capitalize, noSpaceNext: state.noSpaceNext },
    spokenPunctuationCount,
  };
}
