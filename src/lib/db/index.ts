import { createDatabase, IS_TAURI, type DatabaseAdapter } from "../platform";

let db: DatabaseAdapter | null = null;

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (!db) {
    // Tauri uses "sqlite:" prefix, web just needs a name
    const dbPath = IS_TAURI ? "sqlite:maibuk.db" : "maibuk.db";
    db = await createDatabase(dbPath);
    await initializeSchema();
  }
  return db;
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
  await db.execute(`
    ALTER TABLE books ADD COLUMN last_chapter_id TEXT
  `).catch(() => {
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
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}

export async function exportDatabase(): Promise<Uint8Array> {
  const database = await getDatabase();
  return database.exportData();
}

export async function resetDatabase(): Promise<void> {
  const database = await getDatabase();

  // Delete all data from tables (order matters due to foreign keys)
  await database.execute("DELETE FROM chapters");
  await database.execute("DELETE FROM books");
  await database.execute("DELETE FROM cover_templates");
  await database.execute("DELETE FROM settings");
}
