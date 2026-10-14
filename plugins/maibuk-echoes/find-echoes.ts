import { type Analyzer, type Token, createAnalyzer, tokenize } from "./language";

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

/** A word below this many letters is never eligible (short words carry no signal). */
const MIN_WORD_LETTERS = 4;
const OVERUSED_MIN_COUNT = 5;
const OVERUSED_RATE_PER_THOUSAND = 3;

/** Folded forms and match keys of the Ignore list; a token is ignored when either matches. */
interface IgnoreIndex {
  folded: ReadonlySet<string>;
  keys: ReadonlySet<string>;
}

function buildIgnoreIndex(entries: readonly string[], analyzer: Analyzer): IgnoreIndex {
  const folded = new Set<string>();
  const keys = new Set<string>();
  for (const entry of entries) {
    const [token] = tokenize(entry.trim());
    if (token === undefined) continue;
    folded.add(token.folded);
    keys.add(analyzer.key(token.folded));
  }
  return { folded, keys };
}

/** The match key of an eligible token, or null when it is too short, a stop word, or ignored. */
function matchKey(token: Token, analyzer: Analyzer, ignore: IgnoreIndex): string | null {
  if (token.letters < MIN_WORD_LETTERS) return null;
  if (analyzer.isStopWord(token.folded)) return null;
  if (ignore.folded.has(token.folded)) return null;
  const key = analyzer.key(token.folded);
  if (ignore.keys.has(key)) return null;
  return key;
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
  analyzer: Analyzer,
  ignore: IgnoreIndex,
  window: number
): Echo[] {
  const echoes: Echo[] = [];
  for (let chapter = 0; chapter < chapters.length; chapter++) {
    const tokens = chapters[chapter];
    const byKey = new Map<string, GroupedToken[]>();
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const key = matchKey(token, analyzer, ignore);
      if (key === null) continue;
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

function overusedEchoes(
  chapters: readonly Token[][],
  analyzer: Analyzer,
  ignore: IgnoreIndex
): Echo[] {
  const groups = new Map<string, EchoOccurrence[]>();
  let totalWords = 0;
  for (let chapter = 0; chapter < chapters.length; chapter++) {
    const tokens = chapters[chapter];
    totalWords += tokens.length;
    for (const token of tokens) {
      const key = matchKey(token, analyzer, ignore);
      if (key === null) continue;
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

function phraseEchoes(): Echo[] {
  // TODO(maibuk-echoes): Repeated phrase detection lands in the follow-up task.
  // It is 3-5 token n-grams inside one Chapter, cut by breaksBetween(), with
  // containment against longer phrases; see docs/plans/449-find-echoes.md.
  return [];
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

/** A string is one Chapter (Chapter scope). An array is a Book, one string per Chapter (Book scope). */
export function findEchoes(
  text: string | readonly string[],
  language: string,
  settings: EchoSettings
): Echo[] {
  const analyzer = createAnalyzer(language, { stemming: settings.stemming });
  const chapters = (typeof text === "string" ? [text] : text).map((chapter) => tokenize(chapter));
  const ignore = buildIgnoreIndex(settings.ignore, analyzer);
  const window = clampWindow(settings.nearbyWindow);

  // concat, not push(...): a Book can yield more Echoes than a call accepts arguments.
  return [
    settings.nearby ? nearbyEchoes(chapters, analyzer, ignore, window) : [],
    settings.overused ? overusedEchoes(chapters, analyzer, ignore) : [],
    settings.phrases ? phraseEchoes() : [],
  ].flat();
}
