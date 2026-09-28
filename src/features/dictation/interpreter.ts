// The Dictation Command Interpreter (ADR 0015): deterministic, pure rules over
// finished lines. No engine, no editor, no DOM. See
// docs/research/dictation-command-interpreter.md sections 2.4 and 3.
//
// A finished line is matched against a prebuilt token trie of Spoken
// Punctuation phrases, longest match first. Matching folds case and accents and
// ignores the model's own punctuation; model punctuation adjacent to a matched
// phrase is dropped so marks never double. Text is then cased and spaced using
// the bounded text before the caret.
import type { DictationEdit } from "@/features/dictation/router";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";
import { EN_PHRASES } from "@/features/dictation/phrases-en";
import { ES_PHRASES } from "@/features/dictation/phrases-es";

/** One emitted piece of a phrase: a mark, a paragraph split, or a line break. */
export type PhraseAction = { kind: "mark"; mark: string } | { kind: "paragraph" } | { kind: "line_break" };

export interface PhraseEntry {
  actions: PhraseAction[];
  /** Spoken Punctuation (marks) is gated by the model; layout phrases are not. */
  punctuation: boolean;
}

export interface TokenTrieNode {
  children: Map<string, TokenTrieNode>;
  match?: PhraseEntry;
}

/** A prebuilt token trie for one Dictation Language. Build once, reuse per line. */
export interface PhraseTable {
  language: DictationLanguage;
  trie: TokenTrieNode;
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
  result: { kind: "edits"; edits: DictationEdit[] };
  state: InterpreterState;
  spokenPunctuationCount: number;
}

export interface PhraseDefinition {
  phrase: string;
  entry: PhraseEntry;
}

// Keyed by Dictation Language, never the UI locale (ADR 0014).
const PHRASES: Record<DictationLanguage, readonly PhraseDefinition[]> = { en: EN_PHRASES, es: ES_PHRASES };

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;

interface Token {
  surface: string;
  norm: string | null;
  mark: boolean;
}

interface Match {
  start: number;
  end: number;
  entry: PhraseEntry;
}

const OPENING_MARKS = new Set(["¿", "¡", "«", "“", "‘", "(", "[", "{"]);
const SENTENCE_END_MARKS = new Set([".", "?", "!"]);

function normalizeWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.normalize("NFC").matchAll(TOKEN_RE)) {
    const surface = match[0];
    if (/[\p{L}\p{N}]/u.test(surface)) {
      tokens.push({ surface, norm: normalizeWord(surface), mark: false });
    } else {
      tokens.push({ surface, norm: null, mark: true });
    }
  }
  return tokens;
}

/** Case- and accent-folded, punctuation-free phrase key. Shared by matching and storage. */
export function normalizePhrase(text: string): string {
  return tokenize(text)
    .filter((token) => !token.mark)
    .map((token) => token.norm ?? "")
    .join(" ");
}

/** Build the prebuilt token trie for one Dictation Language. */
export function buildPhraseTable(language: DictationLanguage): PhraseTable {
  const trie: TokenTrieNode = { children: new Map() };
  for (const { phrase, entry } of PHRASES[language]) {
    const words = tokenize(phrase)
      .filter((token) => !token.mark)
      .map((token) => token.norm ?? "");
    let node = trie;
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
  return { language, trie };
}

function isSentenceStart(before: string): boolean {
  if (before === "") return true;
  if (before[before.length - 1] === "\n") return true;
  const trimmed = before.replace(/[ \t]+$/u, "");
  if (trimmed === "") return true;
  return SENTENCE_END_MARKS.has(trimmed[trimmed.length - 1]);
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

function findMatches(tokens: Token[], table: PhraseTable, allowPunctuation: boolean): Match[] {
  const matches: Match[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].mark) {
      i += 1;
      continue;
    }
    let node: TokenTrieNode | undefined = table.trie;
    let best: Match | null = null;
    let j = i;
    while (j < tokens.length && node) {
      const token = tokens[j];
      if (token.mark) {
        j += 1;
        continue;
      }
      const child = node.children.get(token.norm ?? "");
      if (!child) break;
      node = child;
      if (node.match && (allowPunctuation || !node.match.punctuation)) {
        best = { start: i, end: j, entry: node.match };
      }
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

export function interpret(input: InterpretInput): InterpretResult {
  const { line, before, capabilities, table, state } = input;
  const tokens = tokenize(line);
  if (tokens.length === 0) {
    return { result: { kind: "edits", edits: [] }, state, spokenPunctuationCount: 0 };
  }

  const allowPunctuation = !capabilities.punctuation;
  const edits: DictationEdit[] = [];
  let spokenPunctuationCount = 0;
  let current = "";
  let capitalize = state.capitalizeNext || isSentenceStart(before);
  let firstWord = true;

  const flush = () => {
    if (current !== "") {
      edits.push({ kind: "text", text: current });
      current = "";
    }
  };

  const appendWord = (surface: string) => {
    let word = surface;
    if (capitalize) {
      word = uppercaseFirst(word);
      capitalize = false;
    } else if (firstWord) {
      word = lowercaseFirst(word);
    }
    firstWord = false;
    if (current !== "" && !endsWithOpening(current) && !/\s$/u.test(current)) current += " ";
    current += word;
  };

  const appendMark = (mark: string) => {
    if (OPENING_MARKS.has(mark) && current !== "" && !/\s$/u.test(current)) current += " ";
    current += mark;
    if (SENTENCE_END_MARKS.has(mark)) capitalize = true;
  };

  const emitActions = (actions: PhraseAction[]) => {
    for (const action of actions) {
      if (action.kind === "mark") {
        appendMark(action.mark);
      } else if (action.kind === "paragraph") {
        flush();
        edits.push({ kind: "paragraph" });
        capitalize = true;
      } else {
        flush();
        edits.push({ kind: "line_break" });
      }
    }
  };

  const matches = findMatches(tokens, table, allowPunctuation);
  const byStart = new Map<number, Match>();
  const skip = new Set<number>();
  const drop = new Set<number>();
  for (const match of matches) {
    byStart.set(match.start, match);
    for (let k = match.start; k <= match.end; k += 1) skip.add(k);
    // A layout phrase adds no mark, so punctuation before it belongs to the
    // preceding prose. A spoken mark replaces adjacent model punctuation.
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
