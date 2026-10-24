/**
 * The kinds of Library item Library Search indexes. Versions, Checkpoints,
 * Cover data, Plugin data, Ephemeral text, and Chapter synopses are
 * deliberately absent: they are not current work.
 */
export type SearchItemKind = "book" | "chapter" | "note" | "canvas";

/** The part of an item a block of text comes from. */
export type SearchField = "title" | "subtitle" | "description" | "content" | "card";

/** One row of the device-local plain-text index: one block of one field. */
export interface SearchBlock {
  field: SearchField;
  /** The block's ordinal within the item's field, starting at 0. */
  blockIndex: number;
  text: string;
}

/** A block read back from `search_text`, with the item it belongs to. */
export interface IndexedSearchBlock extends SearchBlock {
  itemKind: SearchItemKind;
  itemId: string;
  bookId: string | null;
}

/** The one call the palette, the Plugin API, and the tests make. */
export interface SearchLibraryOptions {
  query: string;
  /** Match case is off by default; literal queries always ignore accents. */
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  /** Restricts results to these kinds. Absent means every kind. */
  kinds?: readonly SearchItemKind[];
  /**
   * Restricts results to the rows of one Book: that Book's own fields plus
   * the Chapters and Notes filed under it. Canvases and Unfiled Notes never
   * match. Absent means every Book.
   */
  bookId?: string;
  /**
   * The Book open behind the palette. It never filters: it only breaks a tie
   * after title, match count, and recency, so the author's current Book wins.
   * When a Book filter is set without an open Book, the filter is the tiebreak.
   */
  openBookId?: string | null;
  limit?: number;
  /** The `nextCursor` of the previous page. */
  cursor?: string | null;
}

/** What one result points at, so the caller can open it. */
export interface SearchResultIds {
  itemId: string;
  bookId: string | null;
  /** Set for a Canvas result: the same id as `itemId`. */
  canvasId?: string;
  /** Set for a Canvas result: the card the snippet's block belongs to. */
  cardId?: string;
}

/**
 * A Library Search text row opening its Chapter or Note in the editor: the
 * query and the shared switches the matches were counted with. Carried in
 * router location state beside `openChapterId` (Chapters) or alone (Notes),
 * consumed once on arrival so Back/Forward never reopens Find and Replace.
 * A stale result still navigates; the editor then counts the live document,
 * so the panel shows the real matches (possibly none) and no error.
 */
export interface SearchHandoff {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}
/** The text around the best match, with the matches in it highlighted. */
export interface SearchSnippet {
  text: string;
  /** `[start, end)` ranges inside `text`, in order. */
  highlights: Array<[number, number]>;
}

/** One row of Library Search: one item, however many times it matched. */
export interface SearchResult {
  kind: SearchItemKind;
  ids: SearchResultIds;
  title: string;
  /** Total matches across every block of the item. */
  matchCount: number;
  snippet: SearchSnippet;
  /** The first match's offset inside the block the snippet came from. */
  firstMatchOffset: number;
}

export interface SearchResults {
  results: SearchResult[];
  nextCursor?: string;
}

/** An invalid Regex returns an error result instead of throwing. */
export interface SearchError {
  error: "invalid-regex";
  message: string;
}

export type SearchLibraryResult = SearchResults | SearchError;
