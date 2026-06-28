import { createDatabase, IS_TAURI, type DatabaseAdapter } from "../platform";
import { ensureMetricsSchema } from "../../features/metrics/events-repo";
import { DEFAULT_CANVAS_DOC_JSON } from "../canvas/defaultDoc";

let db: DatabaseAdapter | null = null;
let dbPromise: Promise<DatabaseAdapter> | null = null;

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (db) {
    return db;
  }

  if (!dbPromise) {
    dbPromise = (async () => {
      const dbPath = IS_TAURI ? "sqlite:maibuk.db" : "maibuk.db";
      db = await createDatabase(dbPath);
      await initializeSchema();
      return db;
    })();
  }

  return dbPromise;
}

export async function waitForDatabaseReady(): Promise<void> {
  await getDatabase();
}

async function initializeSchema(): Promise<void> {
  if (!db) return;

  // Create books table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      author_name TEXT NOT NULL,
      description TEXT,
      genre TEXT,
      language TEXT DEFAULT 'en',
      cover_image_path TEXT,
      cover_data TEXT,
      word_count INTEGER DEFAULT 0,
      target_word_count INTEGER,
      status TEXT DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_opened_at INTEGER,
      last_chapter_id TEXT
    )
  `);

  // Migration: Add last_chapter_id column for existing databases
  await db
    .execute(`
    ALTER TABLE books ADD COLUMN last_chapter_id TEXT
  `)
    .catch(() => {
      // Column already exists, ignore error
    });

  // Create chapters table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT,
      synopsis TEXT,
      "order" INTEGER NOT NULL,
      parent_id TEXT,
      chapter_type TEXT DEFAULT 'chapter',
      word_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      is_included_in_export INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Create book_versions table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS book_versions (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      name TEXT,
      snapshot TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      checksum TEXT NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      synced_at INTEGER
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS project_assets (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      href TEXT NOT NULL,
      media_type TEXT NOT NULL,
      role TEXT,
      data_base64 TEXT,
      text_content TEXT,
      size_bytes INTEGER,
      checksum TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS book_metadata (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      namespace TEXT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      attributes_json TEXT,
      "order" INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS book_styles (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      css TEXT NOT NULL,
      source_href TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS epub_structures (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      epub_version TEXT,
      package_path TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      spine_json TEXT NOT NULL,
      nav_json TEXT,
      compatibility_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS chapter_epub_meta (
      chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      href TEXT NOT NULL,
      media_type TEXT NOT NULL,
      nav_title TEXT,
      spine_index INTEGER NOT NULL,
      linear INTEGER DEFAULT 1,
      capabilities_json TEXT
    )
  `);

  // Create notes table (standalone Notes workspace, optionally tied to a book)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      book_id TEXT,
      title TEXT NOT NULL,
      content TEXT,
      language TEXT DEFAULT 'en',
      tags TEXT,
      pinned INTEGER DEFAULT 0,
      "order" INTEGER NOT NULL,
      word_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Migration: Add collapsed_headings column for existing databases
  await db
    .execute(`ALTER TABLE notes ADD COLUMN collapsed_headings TEXT DEFAULT '[]'`)
    .catch(() => {});
  await db
    .execute(`ALTER TABLE notes ADD COLUMN book_id TEXT`)
    .catch(() => {});
  await db
    .execute(`ALTER TABLE notes ADD COLUMN language TEXT`)
    .catch(() => {});
  await db
    .execute(`
      UPDATE notes
      SET language = COALESCE(
        (SELECT books.language FROM books WHERE books.id = notes.book_id),
        'en'
      )
      WHERE language IS NULL
    `)
    .catch(() => {});
  // Migration: Add content_updated_at (user-facing "modified" time, bumped only
  // by title/content edits — not by tagging, pinning, or reordering). Backfill
  // existing rows from updated_at so their displayed date is preserved.
  await db
    .execute(`ALTER TABLE notes ADD COLUMN content_updated_at INTEGER`)
    .catch(() => {});
  await db
    .execute(`UPDATE notes SET content_updated_at = updated_at WHERE content_updated_at IS NULL`)
    .catch(() => {});

  const escapedDefaultCanvasDoc = DEFAULT_CANVAS_DOC_JSON.split("'").join("''");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      doc TEXT NOT NULL DEFAULT '${escapedDefaultCanvasDoc}',
      pinned INTEGER NOT NULL DEFAULT 0,
      "order" INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      content_updated_at INTEGER NOT NULL
    )
  `);

  // Link index: edges extracted from note/chapter content (powers backlinks).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_book_id TEXT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_heading_id TEXT,
      label TEXT,
      resolved INTEGER DEFAULT 1,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sync_tombstones (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      title TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      pushed_at INTEGER,
      UNIQUE(entity_type, entity_id)
    )
  `);

  // Create cover_templates table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cover_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      fabric_json TEXT NOT NULL,
      thumbnail_path TEXT,
      is_built_in INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // Create settings table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Create indexes for better performance
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes(book_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_chapters_order ON chapters(book_id, "order")
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_book_versions_book ON book_versions(book_id, created_at DESC)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_project_assets_book_id ON project_assets(book_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_project_assets_book_href ON project_assets(book_id, href)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_book_metadata_book_id ON book_metadata(book_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_book_styles_book_id ON book_styles(book_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_epub_structures_book_id ON epub_structures(book_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_chapter_epub_meta_book_id ON chapter_epub_meta(book_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_sync_tombstones_pending
      ON sync_tombstones(entity_type, pushed_at, confirmed_at)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_type, target_id)
  `);

  await ensureMetricsSchema(db);
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
  dbPromise = null;
}

export async function exportDatabase(): Promise<Uint8Array> {
  const database = await getDatabase();
  return database.exportData();
}

export async function resetDatabase(): Promise<void> {
  const database = await getDatabase();

  // Delete all data from tables (order matters due to foreign keys)
  await database.execute("DELETE FROM chapter_epub_meta").catch(() => {});
  await database.execute("DELETE FROM epub_structures").catch(() => {});
  await database.execute("DELETE FROM book_styles").catch(() => {});
  await database.execute("DELETE FROM book_metadata").catch(() => {});
  await database.execute("DELETE FROM project_assets").catch(() => {});
  await database.execute("DELETE FROM chapters");
  await database.execute("DELETE FROM book_versions");
  await database.execute("DELETE FROM books");
  await database.execute("DELETE FROM cover_templates");
  await database.execute("DELETE FROM notes").catch(() => {});
  await database.execute("DELETE FROM canvases").catch(() => {});
  await database.execute("DELETE FROM links").catch(() => {});
  await database.execute("DELETE FROM sync_tombstones").catch(() => {});
  await database.execute("DELETE FROM settings");
  await database.execute("DELETE FROM metrics_cache").catch(() => {});
  await database.execute("DELETE FROM metrics_event_tombstones").catch(() => {});
  await database.execute("DELETE FROM metrics_events").catch(() => {});
}

/**
 * Regex that matches INSERT (with optional OR REPLACE/OR IGNORE) followed
 * by INTO. Captures everything before "INTO" so we can normalise it.
 */
const INSERT_INTO_RE = /^(INSERT\s+(?:OR\s+\w+\s+)?)INTO/i;

/**
 * Convert all INSERT INTO statements to INSERT OR REPLACE INTO so that
 * re-importing an export doesn't fail with UNIQUE constraint errors.
 * Non-INSERT statements are passed through unchanged.
 */
export function normaliseToUpsert(sql: string): string {
  return sql.replace(INSERT_INTO_RE, "INSERT OR REPLACE INTO");
}

export async function importDatabase(sqlContent: string): Promise<void> {
  const database = await getDatabase();
  // Convert INSERT → INSERT OR REPLACE so re-importing doesn't fail on
  // existing rows (UNIQUE constraint).
  const upsertSql = sqlContent
    .split("\n")
    .map((line) => normaliseToUpsert(line))
    .join("\n");
  await database.importData(upsertSql);
}
