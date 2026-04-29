/**
 * In-memory database test context for Zustand store tests.
 * Uses sql.js to create a real SQLite database in memory,
 * wrapped in the same DatabaseAdapter interface the stores expect.
 *
 * Adapted from the kaont project's service-test-context pattern.
 */
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import type { DatabaseAdapter } from "../../lib/platform/types";

class InMemoryDatabaseAdapter implements DatabaseAdapter {
  constructor(private db: SqlJsDatabase) {}

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
    this.db.run(sql, params as (string | number | null | Uint8Array)[]);
    return { rowsAffected: this.db.getRowsModified() };
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    const stmt = this.db.prepare(sql);
    if (params) {
      stmt.bind(params as (string | number | null | Uint8Array)[]);
    }

    const results: Record<string, unknown>[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results as T;
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async exportData(): Promise<Uint8Array> {
    return this.db.export();
  }

  async importData(_sqlContent: string): Promise<void> {
    // No-op for tests
  }
}

/**
 * Create an in-memory SQLite database with the Maibuk schema.
 * Returns a DatabaseAdapter suitable for mocking `getDatabase()`.
 */
export async function createTestDatabase(): Promise<DatabaseAdapter> {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();
  const adapter = new InMemoryDatabaseAdapter(sqlDb);

  // Mirror the schema from src/lib/db/index.ts initializeSchema()
  await adapter.execute(`
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

  await adapter.execute(`
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

  await adapter.execute(`
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

  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await adapter.execute(`CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id)`);
  await adapter.execute(
    `CREATE INDEX IF NOT EXISTS idx_chapters_order ON chapters(book_id, "order")`
  );

  return adapter;
}
