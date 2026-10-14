import EnglishStemmer from "./vendor/snowball/english-stemmer.js";
import SpanishStemmer from "./vendor/snowball/spanish-stemmer.js";
import { ENGLISH_STOP_WORDS, SPANISH_STOP_WORDS } from "./vendor/snowball/stop-words";

export type LanguageSupport = "full" | "limited";

export function baseLanguage(language: string): string {
  return language.split(/[-_]/)[0].toLowerCase();
}

export function languageSupport(language: string): LanguageSupport {
  const base = baseLanguage(language);
  return base === "en" || base === "es" ? "full" : "limited";
}

export interface Token {
  from: number;
  to: number;
  folded: string;
  letters: number;
}

const WORD_PATTERN = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const LETTER_PATTERN = /\p{L}/gu;

/** NFC, lowercase, and the typographic apostrophe as ASCII, so "didn’t" meets the stop lists. */
function fold(word: string): string {
  return word.normalize("NFC").toLowerCase().replaceAll("’", "'");
}

function countLetters(word: string): number {
  return word.match(LETTER_PATTERN)?.length ?? 0;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = new RegExp(WORD_PATTERN.source, "gu");
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    const word = match[0];
    const from = match.index;
    tokens.push({
      from,
      to: from + word.length,
      folded: fold(word),
      letters: countLetters(word),
    });
    match = pattern.exec(text);
  }
  return tokens;
}

export interface Analyzer {
  support: LanguageSupport;
  isStopWord(folded: string): boolean;
  key(folded: string): string;
}

const ENGLISH_STOP_WORD_SET: ReadonlySet<string> = new Set(ENGLISH_STOP_WORDS);
const SPANISH_STOP_WORD_SET: ReadonlySet<string> = new Set(SPANISH_STOP_WORDS);
const NO_STOP_WORDS: ReadonlySet<string> = new Set();

function stopWordsFor(base: string): ReadonlySet<string> {
  if (base === "en") return ENGLISH_STOP_WORD_SET;
  if (base === "es") return SPANISH_STOP_WORD_SET;
  return NO_STOP_WORDS;
}

interface Stemmer {
  stemWord(word: string): string;
}

let englishStemmer: Stemmer | null = null;
let spanishStemmer: Stemmer | null = null;

function stemmerFor(base: string): Stemmer | null {
  if (base === "en") {
    if (englishStemmer === null) englishStemmer = new EnglishStemmer();
    return englishStemmer;
  }
  if (base === "es") {
    if (spanishStemmer === null) spanishStemmer = new SpanishStemmer();
    return spanishStemmer;
  }
  return null;
}

export function createAnalyzer(language: string, options: { stemming: boolean }): Analyzer {
  const support = languageSupport(language);
  const base = baseLanguage(language);
  const stopWords = stopWordsFor(base);
  const stemmer = options.stemming && support === "full" ? stemmerFor(base) : null;
  const keys = new Map<string, string>();

  return {
    support,
    isStopWord(folded: string): boolean {
      return support === "full" && stopWords.has(folded);
    },
    key(folded: string): string {
      const cached = keys.get(folded);
      if (cached !== undefined) return cached;
      const value = stemmer === null ? folded : stemmer.stemWord(folded);
      keys.set(folded, value);
      return value;
    },
  };
}

const BREAK_PATTERN = /[.!?…;:\n"“”«»()—]/;

export function breaksBetween(text: string, a: Token, b: Token): boolean {
  return BREAK_PATTERN.test(text.slice(a.to, b.from));
}
