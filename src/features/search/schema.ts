/**
 * The device-local Library Search index. It holds plain text only, one row per
 * block, and an FTS5 `trigram` index over it. It is derived data: never synced,
 * never backed up, never part of a Restore, and rebuilt from the Library
 * whenever it is missing or stale.
 *
 * `trigram` is case-insensitive by default and keeps diacritics exact, which
 * is the editor's own Find and Replace default. Queries shorter than three
 * characters cannot use it; unit 2 scans the plain text for those.
 */

import type { DatabaseAdapter } from "@/lib/platform/types";

export const SEARCH_TEXT_TABLE = "search_text";
export const SEARCH_FTS_TABLE = "search_text_fts";

/**
 * Creates the index on both platforms and on the in-memory test Library.
 * Safe to run on every open: every statement is `IF NOT EXISTS`.
 */
export async function ensureSearchSchema(
  db: Pick<DatabaseAdapter, "execute">
): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ${SEARCH_TEXT_TABLE} (
      id INTEGER PRIMARY KEY,
      item_kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      book_id TEXT,
      field TEXT NOT NULL,
      block_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_search_text_block
      ON ${SEARCH_TEXT_TABLE}(item_kind, item_id, field, block_index)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_search_text_item
      ON ${SEARCH_TEXT_TABLE}(item_kind, item_id)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_search_text_book
      ON ${SEARCH_TEXT_TABLE}(book_id)
  `);

  // External content: the FTS5 index points at search_text instead of
  // storing a second copy of every block.
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${SEARCH_FTS_TABLE} USING fts5(
      text,
      content='${SEARCH_TEXT_TABLE}',
      content_rowid='id',
      tokenize='trigram'
    )
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS search_text_ai AFTER INSERT ON ${SEARCH_TEXT_TABLE} BEGIN
      INSERT INTO ${SEARCH_FTS_TABLE}(rowid, text) VALUES (new.id, new.text);
    END
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS search_text_ad AFTER DELETE ON ${SEARCH_TEXT_TABLE} BEGIN
      INSERT INTO ${SEARCH_FTS_TABLE}(${SEARCH_FTS_TABLE}, rowid, text)
        VALUES ('delete', old.id, old.text);
    END
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS search_text_au AFTER UPDATE ON ${SEARCH_TEXT_TABLE} BEGIN
      INSERT INTO ${SEARCH_FTS_TABLE}(${SEARCH_FTS_TABLE}, rowid, text)
        VALUES ('delete', old.id, old.text);
      INSERT INTO ${SEARCH_FTS_TABLE}(rowid, text) VALUES (new.id, new.text);
    END
  `);
}
