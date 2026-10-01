import fuzzysort from "fuzzysort";
import type { Prepared, Result as FuzzysortResult } from "fuzzysort";

export type PaletteItemKind =
  | "command"
  | "page"
  | "book"
  | "chapter"
  | "note"
  | "canvas"
  | "settingsRow";
export type PalettePage = "root" | "chapters" | "books" | "notes" | "canvases";
export type PaletteSectionId =
  | "recent"
  | "commands"
  | "chapters"
  | "notes"
  | "books"
  | "canvases"
  | "settings";

export const PALETTE_SECTION_ORDER: readonly PaletteSectionId[] = [
  "recent",
  "commands",
  "chapters",
  "notes",
  "books",
  "canvases",
  "settings",
];

export const PALETTE_SECTION_CAP = 50;

/** Labels, descriptions, and keyword lists; the caller's `t` cast to accept registry keys. */
export type PaletteTranslate = (
  key: string,
  options?: Record<string, unknown>
) => string | readonly string[];

export interface PaletteItem {
  key: string;
  kind: PaletteItemKind;
  id: string;
  label: string;
  terms: readonly string[];
  state: "runnable" | "disabled";
  detail?: string;
  bookId?: string;
  targetPage?: PalettePage;
}

export interface PaletteResult {
  item: PaletteItem;
  score: number;
  highlights: readonly (readonly [number, number])[];
}

export interface PaletteSection {
  id: PaletteSectionId;
  results: readonly PaletteResult[];
}

export interface PaletteQuery {
  query: string;
  page: PalettePage;
  recent: readonly string[];
  openBookId?: string | null;
}

export interface PaletteIndex {
  readonly entries: readonly PreparedPaletteItem[];
  readonly byKey: ReadonlyMap<string, PreparedPaletteItem>;
}

interface PreparedPaletteItem {
  item: PaletteItem;
  labelRank: number;
  section: PaletteSectionId;
  labelTarget: Prepared;
  termTargets: readonly Prepared[];
  foldedLabel: string;
  foldedWords: readonly string[];
  wordInitials: string;
  foldedHaystack: string;
}

const labelCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
}

function sectionOf(item: PaletteItem): PaletteSectionId {
  switch (item.kind) {
    case "command":
    case "page":
      return "commands";
    case "chapter":
      return "chapters";
    case "note":
      return "notes";
    case "book":
      return "books";
    case "canvas":
      return "canvases";
    case "settingsRow":
      return "settings";
  }
}

function pageKeeps(item: PaletteItem, query: PaletteQuery): boolean {
  switch (query.page) {
    case "root":
      return true;
    case "books":
      return item.kind === "book";
    case "notes":
      return item.kind === "note";
    case "canvases":
      return item.kind === "canvas";
    case "chapters":
      return (
        item.kind === "chapter" && query.openBookId != null && item.bookId === query.openBookId
      );
  }
}

function mergeIndexes(indexes: ReadonlyArray<number>): (readonly [number, number])[] {
  const sorted = [...indexes].sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const index of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && index === last[1]) {
      last[1] = index + 1;
    } else if (!last || index !== last[1] - 1) {
      ranges.push([index, index + 1]);
    }
  }
  return ranges;
}

function compareResults(a: ScoredEntry, b: ScoredEntry): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.entry.labelRank !== b.entry.labelRank) return a.entry.labelRank - b.entry.labelRank;
  const aKey = a.entry.item.key;
  const bKey = b.entry.item.key;
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

export function preparePaletteIndex(items: readonly PaletteItem[]): PaletteIndex {
  const entries: PreparedPaletteItem[] = items.map((item) => {
    const foldedLabel = fold(item.label);
    const foldedTerms = item.terms.map((term) => fold(term));
    const foldedWords = foldedLabel.split(/\s+/).filter((word) => word.length > 0);
    return {
      item,
      labelRank: 0,
      section: sectionOf(item),
      labelTarget: fuzzysort.prepare(item.label),
      termTargets: item.terms.map((term) => fuzzysort.prepare(term)),
      foldedLabel,
      foldedWords,
      wordInitials: foldedWords.map((word) => word[0] as string).join(""),
      foldedHaystack:
        foldedTerms.length > 0 ? `${foldedLabel} ${foldedTerms.join(" ")}` : foldedLabel,
    };
  });
  const ranked = [...entries].sort((a, b) => {
    const byLabel = labelCollator.compare(a.item.label, b.item.label);
    if (byLabel !== 0) return byLabel;
    return a.item.key < b.item.key ? -1 : a.item.key > b.item.key ? 1 : 0;
  });
  ranked.forEach((entry, labelRank) => {
    entry.labelRank = labelRank;
  });
  const byKey = new Map<string, PreparedPaletteItem>();
  for (const entry of entries) {
    if (!byKey.has(entry.item.key)) byKey.set(entry.item.key, entry);
  }
  return { entries, byKey };
}

interface ScoredEntry {
  entry: PreparedPaletteItem;
  score: number;
  // The raw fuzzysort result is kept so its `indexes` copy materializes only
  // for survivors in toResult, not for every match.
  labelMatch: FuzzysortResult | null;
}

function isSubsequence(haystack: string, needle: string): boolean {
  let hi = 0;
  let ni = 0;
  while (hi < haystack.length && ni < needle.length) {
    if (haystack.charCodeAt(hi) === needle.charCodeAt(ni)) ni += 1;
    hi += 1;
  }
  return ni >= needle.length;
}

function scoreEntry(
  entry: PreparedPaletteItem,
  trimmed: string,
  foldedQuery: string,
  chapterBoostBookId: string | null,
): ScoredEntry | null {
  // Single-character queries skip the ordered scan: fuzzysort's own
  // bitflags check rejects entries missing the character faster.
  if (foldedQuery.length > 1 && !isSubsequence(entry.foldedHaystack, foldedQuery)) return null;
  const labelMatch = fuzzysort.single(trimmed, entry.labelTarget);
  let bestTermScore: number | null = null;
  if (!(labelMatch && labelMatch.score >= 0.9)) {
    for (let i = 0; i < entry.termTargets.length; i += 1) {
      const termMatch = fuzzysort.single(trimmed, entry.termTargets[i]);
      if (termMatch && (bestTermScore == null || termMatch.score > bestTermScore)) {
        bestTermScore = termMatch.score;
      }
    }
  }
  if (!labelMatch && bestTermScore == null) return null;

  let score = Math.max(labelMatch ? labelMatch.score : -Infinity, (bestTermScore ?? 0) * 0.9);
  if (entry.foldedLabel === foldedQuery) {
    score += 2;
  } else if (entry.foldedLabel.startsWith(foldedQuery)) {
    score += 1;
  } else if (
    entry.foldedWords.length > 0 &&
    (foldedQuery.length === 0 ||
      (entry.wordInitials.includes(foldedQuery[0] as string) &&
        entry.foldedWords.some((word) => word.startsWith(foldedQuery))))
  ) {
    score += 0.5;
  }
  if (
    chapterBoostBookId !== null &&
    entry.section === "chapters" &&
    entry.item.bookId === chapterBoostBookId
  ) {
    score += 0.5;
  }
  return {
    entry,
    score,
    labelMatch,
  };
}

function toResult(scored: ScoredEntry): PaletteResult {
  return {
    item: scored.entry.item,
    score: scored.score,
    highlights: scored.labelMatch ? mergeIndexes(scored.labelMatch.indexes) : [],
  };
}

function insertBounded(list: ScoredEntry[], hit: ScoredEntry): void {
  const hitScore = hit.score;
  const hitRank = hit.entry.labelRank;
  const hitKey = hit.entry.item.key;
  if (list.length >= PALETTE_SECTION_CAP) {
    // Fast path with the same order as below: most hits are worse than the
    // current cutoff, so one inlined compare rejects them without a search.
    const worst = list[list.length - 1];
    if (hitScore < worst.score) return;
    if (hitScore === worst.score) {
      const worstRank = worst.entry.labelRank;
      if (hitRank > worstRank) return;
      if (hitRank === worstRank && hitKey >= worst.entry.item.key) return;
    }
  }
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const current = list[mid];
    let order: number;
    if (current.score !== hitScore) order = current.score - hitScore;
    else if (current.entry.labelRank !== hitRank) order = hitRank - current.entry.labelRank;
    else if (hitKey < current.entry.item.key) order = -1;
    else if (hitKey > current.entry.item.key) order = 1;
    else order = 0;
    if (order < 0) hi = mid;
    else lo = mid + 1;
  }
  if (list.length < PALETTE_SECTION_CAP) {
    list.splice(lo, 0, hit);
  } else if (lo < list.length) {
    list.splice(lo, 0, hit);
    list.length = PALETTE_SECTION_CAP;
  }
}

export function searchPalette(index: PaletteIndex, query: PaletteQuery): PaletteSection[] {
  const trimmed = query.query.trim();
  if (trimmed === "") {
    if (query.page === "root") {
      const results: PaletteResult[] = [];
      for (const key of query.recent) {
        const entry = index.byKey.get(key);
        if (entry) results.push({ item: entry.item, score: 0, highlights: [] });
      }
      if (results.length === 0) return [];
      return [{ id: "recent", results }];
    }
    const results: PaletteResult[] = [];
    for (const entry of index.entries) {
      if (pageKeeps(entry.item, query)) {
        results.push({ item: entry.item, score: 0, highlights: [] });
      }
    }
    if (results.length === 0) return [];
    return [{ id: sectionOf(results[0].item), results }];
  }

  const foldedQuery = fold(trimmed);
  // Hoisted out of the per-entry loop: the open-Book chapter boost applies at
  // most to chapters of one Book.
  const chapterBoostBookId =
    (query.page === "root" || query.page === "chapters") && query.openBookId != null
      ? query.openBookId
      : null;
  const recentPosition =
    query.page === "root" && query.recent.length > 0
      ? new Map<string, number>()
      : null;
  if (recentPosition) {
    for (let i = 0; i < query.recent.length; i += 1) {
      const key = query.recent[i];
      if (!recentPosition.has(key)) recentPosition.set(key, i);
    }
  }
  const recentResults: { scored: ScoredEntry; position: number }[] = [];
  const bySection = new Map<PaletteSectionId, ScoredEntry[]>();
  const rootPage = query.page === "root";
  const entries = index.entries;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!rootPage && !pageKeeps(entry.item, query)) continue;
    const scored = scoreEntry(entry, trimmed, foldedQuery, chapterBoostBookId);
    if (!scored) continue;
    const position = recentPosition?.get(entry.item.key);
    if (position !== undefined) {
      recentResults.push({ scored, position: position as number });
    } else {
      const section = entry.section;
      const list = bySection.get(section);
      if (list) insertBounded(list, scored);
      else bySection.set(section, [scored]);
    }
  }

  const sections: PaletteSection[] = [];
  if (recentResults.length > 0) {
    recentResults.sort((a, b) => a.position - b.position);
    sections.push({
      id: "recent",
      results: recentResults.slice(0, PALETTE_SECTION_CAP).map(({ scored }) => toResult(scored)),
    });
  }
  for (const sectionId of PALETTE_SECTION_ORDER) {
    if (sectionId === "recent") continue;
    const list = bySection.get(sectionId);
    if (!list || list.length === 0) continue;
    // insertBounded maintains this same order; re-sort through the canonical
    // comparator so compareResults defines the final order (linear: the input
    // is already ordered).
    list.sort(compareResults);
    sections.push({ id: sectionId, results: list.map((scored) => toResult(scored)) });
  }
  return sections;
}

export function liveRecentKeys(index: PaletteIndex, recent: readonly string[]): string[] {
  return recent.filter((key) => index.byKey.has(key));
}
