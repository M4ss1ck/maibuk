import { createDatabase, IS_TAURI, type DatabaseAdapter } from "../platform";

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
    CREATE INDEX IF NOT EXISTS idx_chapters_order ON chapters(book_id, "order")
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_book_versions_book ON book_versions(book_id, created_at DESC)
  `);
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
  await database.execute("DELETE FROM chapters");
  await database.execute("DELETE FROM book_versions");
  await database.execute("DELETE FROM books");
  await database.execute("DELETE FROM cover_templates");
  await database.execute("DELETE FROM settings");
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
