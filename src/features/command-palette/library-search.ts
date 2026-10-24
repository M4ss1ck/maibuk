import {
  searchPalette,
  type PaletteIndex,
  type PalettePage,
  type PaletteResult,
  type PaletteSection,
  type PaletteTranslate,
} from "@/features/command-palette/palette-index";
import type { SearchItemKind, SearchResult } from "@/features/search/types";

export interface SearchLibraryOptions {
  index: PaletteIndex;
  /** What the author typed, without the Commands prefix. */
  query: string;
  /** The nested page narrowing the results, or "root" for every kind. */
  page: PalettePage;
  recent: readonly string[];
  openBookId?: string | null;
  /**
   * The shared search switches, read from the switches store by the caller.
   * Title ranking ignores them; the Text section reads them (unit 2), so the
   * palette and Find and Replace count the same matches.
   */
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

/**
 * The one seam Library Search reads through. Title matches come from the
 * palette index below; the Text section reads the search module through the
 * helpers beside it, so the palette never grows a second path into the
 * Library.
 */
export function searchLibrary({
  index,
  query,
  page,
  recent,
  openBookId,
}: SearchLibraryOptions): PaletteSection[] {
  return searchPalette(index, { mode: "library", query, page, recent, openBookId });
}

/** How many text rows the Text section lists before asking to refine. */
export const TEXT_SEARCH_LIMIT = 50;

/**
 * How long a scan-path query (under 3 characters, or Regex) waits for a pause
 * in typing before it runs. The indexed path queries immediately.
 */
export const TEXT_SEARCH_DEBOUNCE_MS = 200;

/** A literal query this long can go through the trigram index, like the module. */
export const TEXT_SEARCH_INDEX_MIN_CHARS = 3;

const PAGE_TEXT_KINDS: Record<PalettePage, readonly SearchItemKind[] | undefined> = {
  root: undefined,
  chapters: ["chapter"],
  books: ["book"],
  notes: ["note"],
  canvases: ["canvas"],
};

/** The nested page narrows the text results to its kind; root searches all kinds. */
export function textSearchKinds(page: PalettePage): readonly SearchItemKind[] | undefined {
  return PAGE_TEXT_KINDS[page];
}

/**
 * Whether the query runs the scan path: under 3 characters, or a Regex. Those
 * wait for a pause in typing and are cancelled by the next keystroke; a
 * literal query of 3 or more characters queries immediately.
 */
export function isTextScanQuery(query: string, regex: boolean): boolean {
  return regex || query.length < TEXT_SEARCH_INDEX_MIN_CHARS;
}

export interface BuildTextResultsOptions {
  results: readonly SearchResult[];
  /** Book titles by id, from the entities the palette already loaded. */
  bookTitles: ReadonlyMap<string, string>;
  t: PaletteTranslate;
}

/**
 * One palette row per text result, in the module's rank order. Choosing one
 * navigates exactly as choosing the same item's title row: the key carries a
 * `text:` prefix so it never collides with the title row's, and the caller
 * records the title row's key for Recent. The accessible name carries the
 * kind, title, Book, and snippet text; the detail carries the Book.
 */
export function buildTextResults({
  results,
  bookTitles,
  t,
}: BuildTextResultsOptions): PaletteResult[] {
  return results.map((result) => {
    const bookTitle =
      result.kind === "book" || result.ids.bookId == null
        ? undefined
        : bookTitles.get(result.ids.bookId);
    const kindLabel = t(`commandPalette.kinds.${result.kind}`);
    const kind = typeof kindLabel === "string" && kindLabel !== "" ? kindLabel : result.kind;
    const nameParts = [kind, result.title];
    if (bookTitle) nameParts.push(bookTitle);
    nameParts.push(result.snippet.text);
    return {
      item: {
        key: `text:${result.kind}:${result.ids.itemId}`,
        kind: result.kind,
        id: result.ids.itemId,
        label: result.title,
        terms: [],
        state: "runnable",
        detail: bookTitle,
        bookId: result.ids.bookId ?? undefined,
        snippet: {
          text: result.snippet.text,
          highlights: result.snippet.highlights,
        },
        matchCount: result.matchCount,
        accessibleName: nameParts.join(" "),
      },
      score: 0,
      highlights: [],
    };
  });
}
