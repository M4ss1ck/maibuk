/**
 * The statements that keep one item's rows in `search_text` in step with its
 * save. They are built here so every write path can put them in the same
 * atomic batch as the item's own row: either both persist or neither does.
 */

import type { AtomicStatement } from "@/lib/platform/types";
import {
  bookFieldBlocks,
  canvasBlocks,
  chapterContentBlocks,
  noteContentBlocks,
} from "@/features/search/extract";
import type { SearchBlock, SearchItemKind } from "@/features/search/types";

export interface SearchItemText {
  itemKind: SearchItemKind;
  itemId: string;
  bookId: string | null;
  blocks: readonly SearchBlock[];
  updatedAt: number;
}

/**
 * Rows per multi-row INSERT. Each row binds seven parameters, far below
 * SQLite's variable limit, and a page of the rebuild becomes a handful of
 * statements instead of one per block: on the web engine every statement is a
 * fresh prepare, and that overhead, not the data, was most of the load (#639).
 */
const BLOCKS_PER_INSERT = 200;

/**
 * Many items' rows in as few statements as SQLite allows. The whole-index
 * rebuild uses this after clearing the table: `OR REPLACE` overwrites a block a
 * save wrote mid-pass instead of failing its unique key, and the rebuild's
 * sweep re-reads that saved item before the FTS rebuild.
 */
export function rebuildSearchRowsStatements(items: readonly SearchItemText[]): AtomicStatement[] {
  const rows: (string | number | null)[][] = [];
  for (const item of items) {
    for (const block of item.blocks) {
      rows.push([
        item.itemKind,
        item.itemId,
        item.bookId,
        block.field,
        block.blockIndex,
        block.text,
        item.updatedAt,
      ]);
    }
  }

  const statements: AtomicStatement[] = [];
  for (let index = 0; index < rows.length; index += BLOCKS_PER_INSERT) {
    const chunk = rows.slice(index, index + BLOCKS_PER_INSERT);
    statements.push({
      sql: `INSERT OR REPLACE INTO search_text
        (item_kind, item_id, book_id, field, block_index, text, updated_at)
        VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      params: chunk.flat(),
    });
  }
  return statements;
}

/** Deletes the item's old rows, then inserts one row per block. */
export function replaceSearchRowsStatements(item: SearchItemText): AtomicStatement[] {
  const statements: AtomicStatement[] = [
    {
      sql: "DELETE FROM search_text WHERE item_kind = ? AND item_id = ?",
      params: [item.itemKind, item.itemId],
    },
  ];
  for (const block of item.blocks) {
    statements.push({
      sql: `INSERT INTO search_text
        (item_kind, item_id, book_id, field, block_index, text, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        item.itemKind,
        item.itemId,
        item.bookId,
        block.field,
        block.blockIndex,
        block.text,
        item.updatedAt,
      ],
    });
  }
  return statements;
}

export function chapterSearchStatements(
  chapter: { id: string; bookId: string; content: string | null | undefined },
  updatedAt: number
): AtomicStatement[] {
  return replaceSearchRowsStatements({
    itemKind: "chapter",
    itemId: chapter.id,
    bookId: chapter.bookId,
    blocks: chapterContentBlocks(chapter.content),
    updatedAt,
  });
}

export function noteSearchStatements(
  note: { id: string; bookId?: string | null; content: string | null | undefined },
  updatedAt: number
): AtomicStatement[] {
  return replaceSearchRowsStatements({
    itemKind: "note",
    itemId: note.id,
    bookId: note.bookId ?? null,
    blocks: noteContentBlocks(note.content),
    updatedAt,
  });
}

export function canvasSearchStatements(
  canvas: { id: string; doc: unknown },
  updatedAt: number
): AtomicStatement[] {
  return replaceSearchRowsStatements({
    itemKind: "canvas",
    itemId: canvas.id,
    bookId: null,
    blocks: canvasBlocks(canvas.doc),
    updatedAt,
  });
}

export function bookSearchStatements(
  book: {
    id: string;
    title?: string | null;
    subtitle?: string | null;
    description?: string | null;
  },
  updatedAt: number
): AtomicStatement[] {
  return replaceSearchRowsStatements({
    itemKind: "book",
    itemId: book.id,
    bookId: book.id,
    blocks: bookFieldBlocks(book),
    updatedAt,
  });
}

export function deleteSearchItemStatement(
  itemKind: SearchItemKind,
  itemId: string
): AtomicStatement {
  return {
    sql: "DELETE FROM search_text WHERE item_kind = ? AND item_id = ?",
    params: [itemKind, itemId],
  };
}

/** Deletes the index rows of every Chapter a subquery selects. */
export function deleteSearchChaptersStatement(
  chapterIdsSql: string,
  params: readonly (string | number | null)[]
): AtomicStatement {
  return {
    sql: `DELETE FROM search_text WHERE item_kind = 'chapter' AND item_id IN (${chapterIdsSql})`,
    params,
  };
}
