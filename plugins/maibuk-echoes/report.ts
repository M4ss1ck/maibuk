/**
 * The Echoes report pipeline (#450, unit 3): the scope's text in, the three
 * ordered row lists the report page draws out. Pure but for the source it
 * reads, so a unit test and the performance lane drive it with no host; the
 * page supplies a source over the SDK's Library reads.
 *
 * Detection stays in `find-echoes.ts`. This module only loads one Chapter at a
 * time — yielding between them so a large Book never blocks a single frame, and
 * reporting progress for the bar — runs `findEchoes` once over the loaded text,
 * and groups its Echoes into rows ordered by count (descending), then word
 * (ascending), so the order is stable run to run.
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
import { type Token, tokenize } from "./language";

/** One row of a report tab: an Echo, its count, and where it appears. */
export interface EchoReportRow {
  kind: EchoKind;
  /** The Echo's normalized match key; unique inside its kind. */
  key: string;
  /** The word or phrase as it first appears in the text. */
  label: string;
  count: number;
  /** The 0-based Chapter positions the Echo appears in, ascending, distinct. */
  chapterIndexes: number[];
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
  for (const echo of echoes) report[echo.kind].push(toRow(echo, texts));
  for (const kind of ECHO_KINDS) report[kind].sort(compareRows);
  return report;
}

function toRow(echo: Echo, texts: readonly string[]): EchoReportRow {
  const first = echo.occurrences[0];
  const chapterText = texts[first.chapter] ?? "";
  return {
    kind: echo.kind,
    key: echo.normalized,
    label: chapterText.slice(first.from, first.to),
    count: echo.occurrences.length,
    chapterIndexes: distinctChapters(echo.occurrences),
    occurrences: echo.occurrences,
  };
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

/**
 * About `words` words around an occurrence in its Chapter text, the matched run
 * included in place. Token offsets, not character math, so a word is never
 * clipped; falls back to the whole text when the occurrence is not found.
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
  return chapterText.slice(tokens[first].from, tokens[last].to);
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
