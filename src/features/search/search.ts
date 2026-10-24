/**
 * Library Search: the one public read of the device-local index.
 *
 * It narrows candidates through the FTS5 `trigram` index (with diacritics
 * removed) for a literal query of three or more characters, and scans the
 * plain-text table for a shorter query or a Regex, then confirms every match
 * in JS with the same expression Find and Replace uses. That is what keeps a
 * snippet, a count, and the editor's own matches in agreement, and why a
 * match never spans a block. Literal matching is accent-insensitive by
 * default; a Regex pins the exact accents.
 *
 * One result per item, ranked by a title match, then match count, then most
 * recently edited, then the open Book as a tiebreaker.
 */

import type { DatabaseAdapter } from "@/lib/platform/types";
import {
  buildFoldedLiteralRegExp,
  buildSearchRegExp,
  findMatchRanges,
  matchFoldedRanges,
  matchRanges,
  type MatchRange,
} from "@/lib/search/expression";
import { canvasCardIdsByBlock } from "@/features/search/extract";
import type {
  SearchItemKind,
  SearchLibraryOptions,
  SearchLibraryResult,
  SearchResult,
  SearchResults,
  SearchSnippet,
} from "@/features/search/types";

export const DEFAULT_SEARCH_LIMIT = 20;

/** Characters of context kept before and after the best match. */
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

/** A literal query this long can go through the trigram index. */
const INDEX_MIN_CHARS = 3;

const FIELD_RANK = { title: 0, subtitle: 1, description: 2, content: 3, card: 4 } as const;

const ROW_COLUMNS = "id, item_kind, item_id, book_id, field, block_index, text, updated_at";

interface IndexRow {
  id: number;
  item_kind: SearchItemKind;
  item_id: string;
  book_id: string | null;
  field: keyof typeof FIELD_RANK;
  block_index: number;
  text: string;
  updated_at: number;
}

interface MatchedBlock {
  field: keyof typeof FIELD_RANK;
  blockIndex: number;
  text: string;
  ranges: MatchRange[];
}

interface ItemMatch {
  kind: SearchItemKind;
  itemId: string;
  bookId: string | null;
  titleMatch: boolean;
  matchCount: number;
  updatedAt: number;
  best: MatchedBlock;
}

interface ItemDetails {
  title: string;
  canvasDoc: unknown;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Escapes a literal query as an FTS5 string. Quoted, every operator is
 * literal; the trigram tokenizer (with diacritics removed) turns it into
 * accent-insensitive substring matching, which is a superset of what the
 * shared matcher will confirm.
 */
function ftsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

async function scanRows(
  db: DatabaseAdapter,
  kinds: readonly SearchItemKind[] | undefined,
  bookId: string | undefined
): Promise<IndexRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (kinds) {
    conditions.push(`item_kind IN (${placeholders(kinds.length)})`);
    params.push(...kinds);
  }
  if (bookId !== undefined) {
    conditions.push("book_id = ?");
    params.push(bookId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT ${ROW_COLUMNS} FROM search_text ${where} ORDER BY id`;
  return db.select<IndexRow[]>(sql, params.length > 0 ? params : undefined);
}

async function indexedRows(
  db: DatabaseAdapter,
  query: string,
  kinds: readonly SearchItemKind[] | undefined,
  bookId: string | undefined
): Promise<IndexRow[]> {
  const kindWhere = kinds ? `AND s.item_kind IN (${placeholders(kinds.length)})` : "";
  const bookWhere = bookId !== undefined ? "AND s.book_id = ?" : "";
  const sql = `SELECT s.id, s.item_kind, s.item_id, s.book_id, s.field, s.block_index, s.text, s.updated_at
    FROM search_text_fts f
    JOIN search_text s ON s.id = f.rowid
    WHERE search_text_fts MATCH ? ${kindWhere} ${bookWhere}
    ORDER BY s.id`;
  return db.select<IndexRow[]>(sql, [
    ftsPhrase(query),
    ...(kinds ?? []),
    ...(bookId !== undefined ? [bookId] : []),
  ]);
}

/** Groups matching blocks into one item each, keeping the best block. */
function groupMatches(
  rows: readonly IndexRow[],
  term: string,
  options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
  regex: RegExp
): ItemMatch[] {
  const items = new Map<string, ItemMatch>();
  // A literal query compiles once; every block folds and runs it. A null
  // folded query (only combining marks) matches exactly, like before.
  const folded =
    options.regex || term.length === 0 ? null : buildFoldedLiteralRegExp(term, options);

  for (const row of rows) {
    // The shared matcher confirms every candidate: a literal query folds
    // accents on both sides, a Regex runs against the text as written.
    const ranges = options.regex
      ? matchRanges(regex, row.text)
      : (folded !== null
        ? matchFoldedRanges(folded, row.text)
        : findMatchRanges(row.text, term, options));
    if (ranges.length === 0) continue;

    const key = `${row.item_kind}:${row.item_id}`;
    const block: MatchedBlock = {
      field: row.field,
      blockIndex: row.block_index,
      text: row.text,
      ranges,
    };
    const existing = items.get(key);
    if (!existing) {
      items.set(key, {
        kind: row.item_kind,
        itemId: row.item_id,
        bookId: row.book_id,
        titleMatch: row.field === "title",
        matchCount: ranges.length,
        updatedAt: row.updated_at,
        best: block,
      });
      continue;
    }

    existing.matchCount += ranges.length;
    existing.titleMatch = existing.titleMatch || row.field === "title";
    existing.updatedAt = Math.max(existing.updatedAt, row.updated_at);
    if (isEarlierBlock(block, existing.best)) existing.best = block;
  }

  return [...items.values()];
}

function isEarlierBlock(candidate: MatchedBlock, current: MatchedBlock): boolean {
  const rank = FIELD_RANK[candidate.field] - FIELD_RANK[current.field];
  if (rank !== 0) return rank < 0;
  return candidate.blockIndex < current.blockIndex;
}

function inOpenBook(item: ItemMatch, openBookId: string | null | undefined): boolean {
  if (!openBookId) return false;
  return item.bookId === openBookId || (item.kind === "book" && item.itemId === openBookId);
}

function rankMatches(
  items: readonly ItemMatch[],
  openBookId: string | null | undefined
): ItemMatch[] {
  return [...items].sort((a, b) => {
    if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
    if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    const aOpen = inOpenBook(a, openBookId);
    const bOpen = inOpenBook(b, openBookId);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    // A stable order keeps a page boundary from moving between two calls.
    const byKind = a.kind.localeCompare(b.kind);
    return byKind !== 0 ? byKind : a.itemId.localeCompare(b.itemId);
  });
}

interface TitleRow {
  id: string;
  title: string;
}

interface CanvasRow extends TitleRow {
  doc: string;
}

async function readDetails(
  db: DatabaseAdapter,
  items: readonly ItemMatch[]
): Promise<Map<string, ItemDetails>> {
  const idsByKind = new Map<SearchItemKind, string[]>();
  for (const item of items) {
    const ids = idsByKind.get(item.kind) ?? [];
    ids.push(item.itemId);
    idsByKind.set(item.kind, ids);
  }

  const details = new Map<string, ItemDetails>();

  const bookIds = idsByKind.get("book") ?? [];
  if (bookIds.length > 0) {
    const rows = await db.select<TitleRow[]>(
      `SELECT id, title FROM books WHERE id IN (${placeholders(bookIds.length)})`,
      bookIds
    );
    for (const row of rows) details.set(`book:${row.id}`, { title: row.title, canvasDoc: null });
  }

  const chapterIds = idsByKind.get("chapter") ?? [];
  if (chapterIds.length > 0) {
    const rows = await db.select<TitleRow[]>(
      `SELECT id, title FROM chapters WHERE id IN (${placeholders(chapterIds.length)})`,
      chapterIds
    );
    for (const row of rows) details.set(`chapter:${row.id}`, { title: row.title, canvasDoc: null });
  }

  const noteIds = idsByKind.get("note") ?? [];
  if (noteIds.length > 0) {
    const rows = await db.select<TitleRow[]>(
      `SELECT id, title FROM notes WHERE id IN (${placeholders(noteIds.length)})`,
      noteIds
    );
    for (const row of rows) details.set(`note:${row.id}`, { title: row.title, canvasDoc: null });
  }

  const canvasIds = idsByKind.get("canvas") ?? [];
  if (canvasIds.length > 0) {
    const rows = await db.select<CanvasRow[]>(
      `SELECT id, title, doc FROM canvases WHERE id IN (${placeholders(canvasIds.length)})`,
      canvasIds
    );
    for (const row of rows)
      details.set(`canvas:${row.id}`, { title: row.title, canvasDoc: row.doc });
  }

  return details;
}

function parseCanvasDoc(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function buildSnippet(block: MatchedBlock): SearchSnippet {
  const first = block.ranges[0];
  const from = Math.max(0, first.start - SNIPPET_BEFORE);
  const to = Math.min(block.text.length, first.end + SNIPPET_AFTER);
  const highlights: Array<[number, number]> = [];
  for (const range of block.ranges) {
    if (range.start >= from && range.end <= to) {
      highlights.push([range.start - from, range.end - from]);
    }
  }
  return { text: block.text.slice(from, to), highlights };
}

function toResult(item: ItemMatch, details: Map<string, ItemDetails>): SearchResult {
  const detail = details.get(`${item.kind}:${item.itemId}`);
  const ids: SearchResult["ids"] = { itemId: item.itemId, bookId: item.bookId };

  if (item.kind === "canvas") {
    ids.canvasId = item.itemId;
    const cardIds = canvasCardIdsByBlock(parseCanvasDoc(detail?.canvasDoc));
    const cardId = cardIds[item.best.blockIndex];
    if (cardId) ids.cardId = cardId;
  }

  return {
    kind: item.kind,
    ids,
    // A stale index row can outlive its row for a moment; the block text is
    // the only title left, so show it rather than an empty row.
    title: detail?.title ?? item.best.text,
    matchCount: item.matchCount,
    snippet: buildSnippet(item.best),
    firstMatchOffset: item.best.ranges[0].start,
  };
}

interface CursorPayload {
  offset: number;
}

function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset } satisfies CursorPayload));
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const payload = JSON.parse(atob(cursor)) as Partial<CursorPayload>;
    const offset = payload.offset;
    return typeof offset === "number" && Number.isFinite(offset) && offset > 0
      ? Math.floor(offset)
      : 0;
  } catch {
    return 0;
  }
}

/** Runs one Library Search and returns one result per item, with a page cursor. */
export async function searchLibrary(
  db: DatabaseAdapter,
  options: SearchLibraryOptions
): Promise<SearchLibraryResult> {
  if (options.query.length === 0) return { results: [] };
  if (options.kinds && options.kinds.length === 0) return { results: [] };

  let regex: RegExp;
  try {
    regex = buildSearchRegExp(options.query, {
      caseSensitive: options.matchCase ?? false,
      wholeWord: options.wholeWord ?? false,
      regex: options.regex ?? false,
    });
  } catch (error) {
    return {
      error: "invalid-regex",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const useIndex = !options.regex && options.query.length >= INDEX_MIN_CHARS;
  const rows = useIndex
    ? await indexedRows(db, options.query, options.kinds, options.bookId)
    : await scanRows(db, options.kinds, options.bookId);

  const ranked = rankMatches(
    groupMatches(
      rows,
      options.query,
      {
        caseSensitive: options.matchCase ?? false,
        wholeWord: options.wholeWord ?? false,
        regex: options.regex ?? false,
      },
      regex
    ),
    options.openBookId ?? options.bookId
  );

  const limit = Math.max(1, options.limit ?? DEFAULT_SEARCH_LIMIT);
  const offset = decodeCursor(options.cursor);
  const page = ranked.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = page.length > 0 && nextOffset < ranked.length;

  const details = await readDetails(db, page);
  const results = page.map((item) => toResult(item, details));

  const response: SearchResults = hasMore
    ? { results, nextCursor: encodeCursor(nextOffset) }
    : { results };
  return response;
}
