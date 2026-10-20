import { type Analyzer, type Token, breaksBetween, createAnalyzer, tokenize } from "./language";

export type EchoKind = "nearby" | "overused" | "phrase";

export interface EchoOccurrence {
  chapter: number; // index into the input array; 0 for a single string
  from: number; // offset into that Chapter's text
  to: number;
}

export interface Echo {
  kind: EchoKind;
  normalized: string; // nearby/overused: the match key (stem, or folded word)
  occurrences: EchoOccurrence[]; // document order (chapter, then from); never empty
}

export interface EchoSettings {
  nearby: boolean;
  overused: boolean;
  phrases: boolean;
  stemming: boolean;
  nearbyWindow: number; // words; clamped to 10..200
  ignore: readonly string[];
}

export const NEARBY_WINDOW_MIN = 10;
export const NEARBY_WINDOW_MAX = 200;

export const DEFAULT_ECHO_SETTINGS: EchoSettings = {
  nearby: true,
  overused: true,
  phrases: true,
  stemming: true,
  nearbyWindow: 50,
  ignore: [],
};

// Short words carry no signal.
const MIN_WORD_LETTERS = 4;
const OVERUSED_MIN_COUNT = 5;
const OVERUSED_RATE_PER_THOUSAND = 3;

// Longest first, so a contained phrase lands on the longer one.
const PHRASE_LENGTHS: readonly number[] = [5, 4, 3];
const PHRASE_CHAPTER_MIN_COUNT = 2;
const PHRASE_BOOK_MIN_COUNT = 3;

interface IgnoreIndex {
  folded: ReadonlySet<string>;
  keys: ReadonlySet<string>;
}

function buildIgnoreIndex(entries: readonly string[], analyzer: Analyzer): IgnoreIndex {
  const folded = new Set<string>();
  const keys = new Set<string>();
  for (const entry of entries) {
    const tokens = tokenize(entry.trim());
    // Only a one-word entry names a word; a longer entry is a phrase key.
    if (tokens.length !== 1) continue;
    const [token] = tokens;
    folded.add(token.folded);
    keys.add(analyzer.key(token.folded));
  }
  return { folded, keys };
}

function matchKey(token: Token, analyzer: Analyzer, ignore: IgnoreIndex): string | null {
  if (token.letters < MIN_WORD_LETTERS) return null;
  if (analyzer.isStopWord(token.folded)) return null;
  if (ignore.folded.has(token.folded)) return null;
  const key = analyzer.key(token.folded);
  if (ignore.keys.has(key)) return null;
  return key;
}

/**
 * Each token's match key, or null when it is short, a stop word, or ignored.
 * Nearby and overused both group by this key, so it is computed once per token
 * instead of once per detection pass (#451).
 */
function matchKeys(
  chapters: readonly Token[][],
  analyzer: Analyzer,
  ignore: IgnoreIndex
): (string | null)[][] {
  return chapters.map((tokens) => tokens.map((token) => matchKey(token, analyzer, ignore)));
}

interface GroupedToken {
  index: number; // token index in the Chapter, counting every token
  occurrence: EchoOccurrence;
}

function collectChain(
  group: readonly GroupedToken[],
  start: number,
  end: number,
  key: string,
  echoes: Echo[]
): void {
  if (end - start < 2) return;
  echoes.push({
    kind: "nearby",
    normalized: key,
    occurrences: group.slice(start, end).map((entry) => entry.occurrence),
  });
}

function nearbyEchoes(
  chapters: readonly Token[][],
  keys: readonly (string | null)[][],
  window: number
): Echo[] {
  const echoes: Echo[] = [];
  for (let chapter = 0; chapter < chapters.length; chapter++) {
    const tokens = chapters[chapter];
    const chapterKeys = keys[chapter];
    const byKey = new Map<string, GroupedToken[]>();
    for (let index = 0; index < tokens.length; index++) {
      const key = chapterKeys[index];
      if (key === null) continue;
      const token = tokens[index];
      const occurrence: EchoOccurrence = { chapter, from: token.from, to: token.to };
      const group = byKey.get(key);
      if (group === undefined) byKey.set(key, [{ index, occurrence }]);
      else group.push({ index, occurrence });
    }
    for (const [key, group] of byKey) {
      let start = 0;
      for (let i = 1; i < group.length; i++) {
        if (group[i].index - group[i - 1].index > window) {
          collectChain(group, start, i, key, echoes);
          start = i;
        }
      }
      collectChain(group, start, group.length, key, echoes);
    }
  }
  return sortByFirstOccurrence(echoes);
}

function overusedEchoes(chapters: readonly Token[][], keys: readonly (string | null)[][]): Echo[] {
  const groups = new Map<string, EchoOccurrence[]>();
  let totalWords = 0;
  for (let chapter = 0; chapter < chapters.length; chapter++) {
    const tokens = chapters[chapter];
    const chapterKeys = keys[chapter];
    totalWords += tokens.length;
    for (let index = 0; index < tokens.length; index++) {
      const key = chapterKeys[index];
      if (key === null) continue;
      const token = tokens[index];
      const occurrence: EchoOccurrence = { chapter, from: token.from, to: token.to };
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [occurrence]);
      else group.push(occurrence);
    }
  }
  const echoes: Echo[] = [];
  if (totalWords === 0) return echoes;
  for (const [key, occurrences] of groups) {
    if (occurrences.length < OVERUSED_MIN_COUNT) continue;
    const rate = (occurrences.length * 1000) / totalWords;
    if (rate <= OVERUSED_RATE_PER_THOUSAND) continue;
    echoes.push({ kind: "overused", normalized: key, occurrences });
  }
  return sortByFirstOccurrence(echoes);
}

function buildPhraseIgnoreKeys(entries: readonly string[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    const tokens = tokenize(entry);
    if (tokens.length === 0) continue;
    keys.add(tokenKey(tokens, 0, tokens.length - 1));
  }
  return keys;
}

function runEndsFor(text: string, tokens: readonly Token[]): Int32Array {
  const ends = new Int32Array(tokens.length);
  if (tokens.length === 0) return ends;
  ends[tokens.length - 1] = tokens.length - 1;
  for (let index = tokens.length - 2; index >= 0; index--) {
    ends[index] = breaksBetween(text, tokens[index], tokens[index + 1]) ? index : ends[index + 1];
  }
  return ends;
}

interface PhraseOccurrence {
  chapter: number;
  start: number; // token index of the first word in the Chapter
  end: number; // token index of the last word, inclusive
  occurrence: EchoOccurrence;
}

function phraseOccurrencesByKey(
  chapters: readonly Token[][],
  runEnds: readonly Int32Array[],
  n: number,
  analyzer: Analyzer,
  ignored: ReadonlySet<string>
): Map<string, PhraseOccurrence[]> {
  const byKey = new Map<string, PhraseOccurrence[]>();
  for (let chapter = 0; chapter < chapters.length; chapter++) {
    const tokens = chapters[chapter];
    const ends = runEnds[chapter];
    for (let start = 0; start + n <= tokens.length; start++) {
      const end = start + n - 1;
      if (ends[start] < end) continue; // a sentence break falls inside the run
      let allStopWords = true;
      for (let index = start; index <= end; index++) {
        if (!analyzer.isStopWord(tokens[index].folded)) {
          allStopWords = false;
          break;
        }
      }
      if (allStopWords) continue;
      const key = tokenKey(tokens, start, end);
      if (ignored.has(key)) continue;
      const occurrence: PhraseOccurrence = {
        chapter,
        start,
        end,
        occurrence: { chapter, from: tokens[start].from, to: tokens[end].to },
      };
      const group = byKey.get(key);
      if (group === undefined) byKey.set(key, [occurrence]);
      else group.push(occurrence);
    }
  }
  return byKey;
}

// Folded, not stemmed: a phrase matches on its exact words.
function tokenKey(tokens: readonly Token[], start: number, end: number): string {
  let key = tokens[start].folded;
  for (let index = start + 1; index <= end; index++) key += ` ${tokens[index].folded}`;
  return key;
}

function withoutOverlaps(group: readonly PhraseOccurrence[]): PhraseOccurrence[] {
  const kept: PhraseOccurrence[] = [];
  let lastChapter = -1;
  let lastEnd = -1;
  for (const entry of group) {
    if (entry.chapter === lastChapter && entry.start <= lastEnd) continue;
    kept.push(entry);
    lastChapter = entry.chapter;
    lastEnd = entry.end;
  }
  return kept;
}

function phraseEchoes(
  texts: readonly string[],
  chapters: readonly Token[][],
  analyzer: Analyzer,
  ignored: ReadonlySet<string>,
  threshold: number
): Echo[] {
  const runEnds = chapters.map((tokens, chapter) => runEndsFor(texts[chapter], tokens));
  // Per Chapter, the furthest token covered by a flagged longer phrase.
  const coverEnd = chapters.map((tokens) => new Int32Array(tokens.length).fill(-1));
  const echoes: Echo[] = [];
  for (const n of PHRASE_LENGTHS) {
    const byKey = phraseOccurrencesByKey(chapters, runEnds, n, analyzer, ignored);
    const flagged: PhraseOccurrence[] = [];
    for (const [key, group] of byKey) {
      // Drop covered runs before overlaps, so a covered run never hides a free one.
      const survivors = withoutOverlaps(
        group.filter((entry) => coverEnd[entry.chapter][entry.start] < entry.end)
      );
      if (survivors.length < threshold) continue;
      const occurrences: EchoOccurrence[] = [];
      for (const entry of survivors) {
        occurrences.push(entry.occurrence);
        flagged.push(entry);
      }
      echoes.push({ kind: "phrase", normalized: key, occurrences });
    }
    for (const entry of flagged) {
      const row = coverEnd[entry.chapter];
      if (row[entry.start] < entry.end) row[entry.start] = entry.end;
    }
    // Fold each row into a prefix max, so a lookup answers "a flagged longer
    // phrase starting at or before here reaches this far".
    for (const row of coverEnd) {
      for (let index = 1; index < row.length; index++) {
        if (row[index] < row[index - 1]) row[index] = row[index - 1];
      }
    }
  }
  return sortByFirstOccurrence(echoes);
}

function compareOccurrences(a: EchoOccurrence, b: EchoOccurrence): number {
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  return a.from - b.from;
}

function sortByFirstOccurrence(echoes: Echo[]): Echo[] {
  return echoes.sort((left, right) =>
    compareOccurrences(left.occurrences[0], right.occurrences[0])
  );
}

function clampWindow(window: number): number {
  if (!Number.isFinite(window)) return DEFAULT_ECHO_SETTINGS.nearbyWindow;
  window = Math.round(window);
  if (window < NEARBY_WINDOW_MIN) return NEARBY_WINDOW_MIN;
  if (window > NEARBY_WINDOW_MAX) return NEARBY_WINDOW_MAX;
  return window;
}

/** `findEchoes` output plus the tokenization it ran, for callers that reuse it. */
export interface EchoDetection {
  echoes: Echo[];
  /** One token list per Chapter, in the same order as the input. */
  chapters: Token[][];
}

/** A string is one Chapter (Chapter scope). An array is a Book, one string per Chapter (Book scope). */
export function findEchoes(
  text: string | readonly string[],
  language: string,
  settings: EchoSettings
): Echo[] {
  return findEchoesWithTokens(text, language, settings).echoes;
}

/**
 * `findEchoes` plus the tokenization behind it, so a caller that already needs
 * the tokens (the highlight ranges' word-distance lookup) never retokenizes the
 * Chapter (#451). The `echoes` result is identical to `findEchoes`.
 */
export function findEchoesWithTokens(
  text: string | readonly string[],
  language: string,
  settings: EchoSettings
): EchoDetection {
  const analyzer = createAnalyzer(language, { stemming: settings.stemming });
  const chapterTexts = typeof text === "string" ? [text] : text;
  const chapters = chapterTexts.map((chapter) => tokenize(chapter));
  const ignore = buildIgnoreIndex(settings.ignore, analyzer);
  const window = clampWindow(settings.nearbyWindow);
  const phraseThreshold =
    typeof text === "string" ? PHRASE_CHAPTER_MIN_COUNT : PHRASE_BOOK_MIN_COUNT;
  const keys = settings.nearby || settings.overused ? matchKeys(chapters, analyzer, ignore) : [];

  // concat, not push(...): a Book can yield more Echoes than a call accepts arguments.
  const echoes = [
    settings.nearby ? nearbyEchoes(chapters, keys, window) : [],
    settings.overused ? overusedEchoes(chapters, keys) : [],
    settings.phrases
      ? phraseEchoes(
          chapterTexts,
          chapters,
          analyzer,
          buildPhraseIgnoreKeys(settings.ignore),
          phraseThreshold
        )
      : [],
  ].flat();
  return { echoes, chapters };
}
