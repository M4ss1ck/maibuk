/**
 * The Shelf's view rules (#945): which Documents the author's filters and search
 * keep, the order the sort puts them in, where a search matched, and how many
 * covers fit across the Frame. These are plain values in and out, so the Frame
 * seam tests drive them through the Shelf.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules.
 */

import type { FrameShelfEntry, ShelfCoverSize, ShelfSort, ShelfViewSettings } from "./types";

/** Text folded for matching: the folded form and where each folded unit came from. */
export interface FoldedText {
  folded: string;
  /** `map[i]` is the index in the original text of the code point that produced folded unit `i`. */
  map: number[];
}

/**
 * The case- and diacritic-insensitive form of `text`. Each code point is
 * decomposed, its combining marks removed, and lowercased; `map` records the
 * original index for every folded unit, with a final sentinel at `folded.length`
 * pointing to the end of `text`.
 */
export function fold(text: string): FoldedText {
  let folded = "";
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const piece = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let unit = 0; unit < piece.length; unit += 1) {
      map.push(index);
    }
    folded += piece;
    index += char.length;
  }
  map[folded.length] = text.length;
  return { folded, map };
}

/** The folded, whitespace-separated tokens of a search. */
export function searchTokens(search: string): string[] {
  return fold(search)
    .folded.split(/\s+/)
    .filter((token) => token.length > 0);
}

/** True when every search token occurs in the Document's folded title and author. */
export function matchesSearch(
  entry: Pick<FrameShelfEntry, "title" | "author">,
  search: string
): boolean {
  const tokens = searchTokens(search);
  if (tokens.length === 0) return true;
  const haystack = fold(`${entry.title} ${entry.author}`).folded;
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Every occurrence of every search token in `text`, as original `[start, end)`
 * ranges, sorted by start with overlapping or touching ranges merged.
 */
export function matchRanges(text: string, search: string): Array<[number, number]> {
  const tokens = searchTokens(search);
  if (tokens.length === 0) return [];
  const { folded, map } = fold(text);
  const found: Array<[number, number]> = [];
  for (const token of tokens) {
    let from = folded.indexOf(token);
    while (from !== -1) {
      const last = from + token.length - 1;
      const start = map[from];
      const lastStart = map[last];
      const codePoint = text.codePointAt(lastStart) ?? 0;
      const end = lastStart + (codePoint > 0xffff ? 2 : 1);
      found.push([start, end]);
      from = folded.indexOf(token, from + 1);
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of found) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

/** Keeps the Documents that match the format, status, and search filters, in input order. */
export function filterShelf<T extends FrameShelfEntry>(
  entries: readonly T[],
  settings: Pick<ShelfViewSettings, "formats" | "statuses" | "search">
): T[] {
  return entries.filter(
    (entry) =>
      (settings.formats.length === 0 || settings.formats.includes(entry.format)) &&
      (settings.statuses.length === 0 || settings.statuses.includes(entry.status)) &&
      matchesSearch(entry, settings.search)
  );
}

const collators = new Map<string, Intl.Collator>();

/** The cached collator for a language; an invalid tag falls back to the runtime default. */
function collatorFor(language: string): Intl.Collator {
  const cached = collators.get(language);
  if (cached) return cached;
  const options: Intl.CollatorOptions = { sensitivity: "base", numeric: true };
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(language, options);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    collator = new Intl.Collator(undefined, options);
  }
  collators.set(language, collator);
  return collator;
}

function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The Documents in the sort's order, as a new array. `descending` reverses the
 * key comparison only: ties break by title ascending, then id ascending, and an
 * empty author always sorts after every author.
 */
export function sortShelf<T extends FrameShelfEntry>(
  entries: readonly T[],
  sort: ShelfSort,
  descending: boolean,
  language: string
): T[] {
  const collator = collatorFor(language);
  const direction = descending ? -1 : 1;

  const keyed = (a: T, b: T): number => {
    switch (sort) {
      case "recent":
        return compareNumbers(a.lastReadAt, b.lastReadAt) * direction;
      case "progress":
        return compareNumbers(a.progress, b.progress) * direction;
      case "added":
        return compareNumbers(a.addedAt, b.addedAt) * direction;
      case "title":
        return collator.compare(a.title, b.title) * direction;
      case "author": {
        const aBlank = a.author === "";
        const bBlank = b.author === "";
        if (aBlank !== bBlank) return aBlank ? 1 : -1;
        return collator.compare(a.author, b.author) * direction;
      }
    }
  };

  return [...entries].sort((a, b) => {
    const primary = keyed(a, b);
    if (primary !== 0) return primary;
    const byTitle = collator.compare(a.title, b.title);
    if (byTitle !== 0) return byTitle;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The Shelf's rows for a view: filtered by the view's filters and search, then sorted. */
export function queryShelf<T extends FrameShelfEntry>(
  entries: readonly T[],
  settings: ShelfViewSettings,
  language: string
): T[] {
  return sortShelf(filterShelf(entries, settings), settings.sort, settings.descending, language);
}

/** True when a format, a status, or a non-blank search narrows the Shelf. */
export function hasActiveFilters(
  settings: Pick<ShelfViewSettings, "formats" | "statuses" | "search">
): boolean {
  return (
    settings.formats.length > 0 ||
    settings.statuses.length > 0 ||
    searchTokens(settings.search).length > 0
  );
}

/** The grid cover widths in CSS pixels. */
export const COVER_WIDTHS: Readonly<Record<ShelfCoverSize, number>> = {
  small: 88,
  medium: 128,
  large: 176,
};

/**
 * How many covers fit across a Frame `width` pixels wide. The narrow layout
 * keeps 16 px of gutter on each side; the wide layout keeps 24 px around the
 * grid and 24 px between covers.
 */
export function gridColumns(wide: boolean, width: number, coverSize: ShelfCoverSize): number {
  const cover = COVER_WIDTHS[coverSize];
  if (!wide) {
    return Math.max(1, Math.round((width - 32) / cover));
  }
  return Math.max(1, Math.floor((width - 48 + 24) / (cover + 24)));
}
