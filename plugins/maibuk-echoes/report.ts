/**
 * The Echoes report pipeline (#450, unit 3): the scope's text in, the three
 * ordered row lists the report page draws out. Pure but for the source it
 * reads, so a unit test and the performance lane drive it with no host; the
 * page supplies a source over the SDK's Library reads.
 *
 * Detection stays in `find-echoes.ts`. This module only loads one Chapter at a
 * time — yielding between them so a large Book never blocks a single frame, and
 * reporting progress for the bar — runs `findEchoes` once over the loaded text,
 * and groups its Echoes into rows: every Echo of a kind with the same normalized
 * key is merged into one row (count is the total, Chapters the union), and the
 * rows are ordered by count (descending), then word (ascending), so the order is
 * stable run to run and one row's id is unique.
 *
 * Imports only this Plugin's own files.
 */

import {
  type Echo,
  type EchoKind,
  type EchoOccurrence,
  type EchoSettings,
  findEchoes,
} from "./find-echoes";
import { breaksBetween, type Token, tokenize } from "./language";

/** One row of a report tab: one word or phrase, its count, and where it appears. */
export interface EchoReportRow {
  kind: EchoKind;
  /**
   * The Echo's normalized match key. Every Echo of this kind with the same key
   * is merged into one row, so the key is unique inside its kind — which is what
   * makes `"<kind>:<key>"` a stable, unique row identity for the page.
   */
  key: string;
  /** The word or phrase as it first appears in the text. */
  label: string;
  count: number;
  /** The 0-based Chapter positions the row appears in, ascending, distinct. */
  chapterIndexes: number[];
  /** Every occurrence across the merged Echoes, in reading order. */
  occurrences: EchoOccurrence[];
}

/** The three row lists, one per kind; a disabled or empty kind is an empty list. */
export type EchoReport = Readonly<Record<EchoKind, readonly EchoReportRow[]>>;

/** The kinds, in tab order. */
export const ECHO_KINDS: readonly EchoKind[] = ["nearby", "overused", "phrase"];

/** Every kind present with no rows, for the page's first paint. */
export const EMPTY_REPORT: EchoReport = { nearby: [], overused: [], phrase: [] };

export interface ReportProgress {
  done: number;
  total: number;
}

/** One Chapter the pipeline loaded: its id and its plain text. */
export interface ReportChapter {
  id: string;
  text: string;
}

/** What the pipeline reads: a count and a Chapter loader the page builds over the SDK. */
export interface ReportSource {
  count: number;
  /** Loads one Chapter; called in order, never concurrently. */
  load(index: number): Promise<ReportChapter>;
}

/** Whether the report covers one Chapter or a whole Book (the phrase threshold differs). */
export type ReportScope = "chapter" | "book";

export interface ReportOptions {
  scope: ReportScope;
  onProgress?: (progress: ReportProgress) => void;
  /** Awaited between Chapters; defaults to a macrotask so the host can paint. */
  yieldControl?: () => Promise<void>;
}

/** The loaded Chapters (for mapping occurrences back to a Chapter id) and the rows. */
export interface ReportComputation {
  chapters: readonly ReportChapter[];
  report: EchoReport;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * The full pipeline: load every Chapter in order (yielding between them and
 * reporting progress), run detection once over the assembled text with the
 * Chapter-scope or Book-scope threshold, and group the Echoes into rows.
 */
export async function computeReport(
  source: ReportSource,
  language: string,
  settings: EchoSettings,
  options: ReportOptions
): Promise<ReportComputation> {
  const total = Math.max(0, source.count);
  const yieldControl = options.yieldControl ?? defaultYield;
  options.onProgress?.({ done: 0, total });
  const chapters: ReportChapter[] = [];
  for (let index = 0; index < total; index++) {
    chapters.push(await source.load(index));
    options.onProgress?.({ done: index + 1, total });
    if (index + 1 < total) await yieldControl();
  }
  const texts = chapters.map((chapter) => chapter.text);
  const input = options.scope === "chapter" ? (texts[0] ?? "") : texts;
  const echoes = findEchoes(input, language, settings);
  return { chapters, report: buildReport(echoes, texts) };
}

/** Groups Echoes into the three kind lists, each ordered by count then word. */
export function buildReport(echoes: readonly Echo[], texts: readonly string[]): EchoReport {
  const report: Record<EchoKind, EchoReportRow[]> = { nearby: [], overused: [], phrase: [] };
  // Detection can return several Echoes for one word or phrase of a kind: the
  // nearby rule resets at a Chapter break, so the same word repeats as a
  // separate Echo per Chapter. A report row is one word or phrase per kind
  // across the whole scope, so merge by key first — the count is the total and
  // the Chapters are the union.
  const grouped = new Map<EchoKind, Map<string, Echo[]>>();
  for (const echo of echoes) {
    let byKey = grouped.get(echo.kind);
    if (byKey === undefined) {
      byKey = new Map();
      grouped.set(echo.kind, byKey);
    }
    const group = byKey.get(echo.normalized);
    if (group === undefined) byKey.set(echo.normalized, [echo]);
    else group.push(echo);
  }
  for (const kind of ECHO_KINDS) {
    const byKey = grouped.get(kind);
    if (byKey === undefined) continue;
    for (const [key, group] of byKey) report[kind].push(toRow(kind, key, group, texts));
    report[kind].sort(compareRows);
  }
  return report;
}

function toRow(
  kind: EchoKind,
  key: string,
  group: readonly Echo[],
  texts: readonly string[]
): EchoReportRow {
  const occurrences = group
    .flatMap((echo) => echo.occurrences)
    .sort(compareOccurrences);
  const first = occurrences[0];
  const chapterText = texts[first.chapter] ?? "";
  return {
    kind,
    key,
    label: chapterText.slice(first.from, first.to),
    count: occurrences.length,
    chapterIndexes: distinctChapters(occurrences),
    occurrences,
  };
}

function compareOccurrences(a: EchoOccurrence, b: EchoOccurrence): number {
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  return a.from - b.from;
}

function distinctChapters(occurrences: readonly EchoOccurrence[]): number[] {
  const chapters = new Set<number>();
  for (const occurrence of occurrences) chapters.add(occurrence.chapter);
  return [...chapters].sort((a, b) => a - b);
}

function compareRows(a: EchoReportRow, b: EchoReportRow): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return 0;
}

/** How many words of context an occurrence row shows on each side. */
export const CONTEXT_WORDS = 6;

/** Marks that a snippet was cut from the middle of its sentence. */
const ELLIPSIS = "…";

/**
 * About `words` words around an occurrence in its Chapter text, the matched run
 * included in place, with a leading or trailing "…" wherever the window was cut
 * from the middle of a sentence (a cut that lands on a sentence boundary is not
 * marked). Token offsets, not character math, so a word is never clipped; falls
 * back to the whole text when the occurrence is not found.
 */
export function occurrenceContext(
  chapterText: string,
  occurrence: EchoOccurrence,
  words: number = CONTEXT_WORDS
): string {
  const tokens = tokenize(chapterText);
  const range = tokenRange(tokens, occurrence);
  if (range === null) return chapterText;
  const first = Math.max(0, range.start - words);
  const last = Math.min(tokens.length - 1, range.end + words);
  const snippet = chapterText.slice(tokens[first].from, tokens[last].to);
  const lead =
    first > 0 && !breaksBetween(chapterText, tokens[first - 1], tokens[first]) ? ELLIPSIS : "";
  const tail =
    last < tokens.length - 1 && !breaksBetween(chapterText, tokens[last], tokens[last + 1])
      ? ELLIPSIS
      : "";
  return `${lead}${snippet}${tail}`;
}

function tokenRange(
  tokens: readonly Token[],
  occurrence: EchoOccurrence
): { start: number; end: number } | null {
  const start = tokens.findIndex((token) => token.from === occurrence.from);
  if (start < 0) return null;
  let end = start;
  while (end + 1 < tokens.length && tokens[end + 1].from < occurrence.to) end++;
  return { start, end };
}

/**
 * The host's caps on a `CollectionRow`'s `label` and `description`, in UTF-16
 * code units (`maibuk-collection-row` in the SDK's UI table). The host refuses a
 * longer prop and stops the Plugin, so every row string is fitted to these.
 */
export const ROW_LABEL_MAX = 512;
export const ROW_DESCRIPTION_MAX = 1024;

/**
 * `text` cut to at most `max` code units, ending in "…" when it was cut. A cut
 * never splits a surrogate pair, so the result is always well-formed text.
 */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - ELLIPSIS.length;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${text.slice(0, end)}${ELLIPSIS}`;
}

/**
 * A row summary that names as many of `titles` as fit in `max` code units. With
 * every title it is `render(titles.join(", "))`; when that is too long, it names
 * the longest leading run that fits and ends with `more(hidden)`, the count of
 * the titles left out. A summary that cannot fit even with no titles is clamped.
 */
export function fitChapterTitles(
  titles: readonly string[],
  render: (chapters: string) => string,
  more: (hidden: number) => string,
  max: number
): string {
  const full = render(titles.join(", "));
  if (full.length <= max) return full;
  const withFirst = (shown: number): string => {
    const hidden = more(titles.length - shown);
    return render(shown === 0 ? hidden : `${titles.slice(0, shown).join(", ")}, ${hidden}`);
  };
  // Each extra title adds at least its ", " separator while the hidden count
  // shrinks by at most a digit, so the length grows with `shown`: binary search.
  let best = clampText(withFirst(0), max);
  let low = 1;
  let high = titles.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const candidate = withFirst(mid);
    if (candidate.length <= max) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/**
 * At most `max` of `options`, in order, always including the one whose value is
 * `selected`: past the cap it takes the place of the last entry kept. The host
 * refuses a longer option list and stops the Plugin, so a Library past the cap
 * loses the tail of its picker, never the page.
 */
export function fitOptions<T extends { value: string }>(
  options: readonly T[],
  selected: string,
  max: number
): T[] {
  if (options.length <= max) return [...options];
  const kept = options.slice(0, max);
  if (kept.some((option) => option.value === selected)) return kept;
  const chosen = options.find((option) => option.value === selected);
  if (chosen !== undefined) kept[max - 1] = chosen;
  return kept;
}
