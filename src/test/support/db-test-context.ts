/**
 * In-memory database test context for Zustand store tests.
 * Uses sql.js to create a real SQLite database in memory,
 * wrapped in the same DatabaseAdapter interface the stores expect.
 *
 * Adapted from the kaont project's service-test-context pattern.
 */
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import type { DatabaseAdapter } from "../../lib/platform/types";
import { parseSqlStatements } from "../../lib/db/sql-parser";

function escapeSQL(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function generateInsertStatements(tableName: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  const statements: string[] = [];
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((col) => escapeSQL(row[col]));
    statements.push(
      `INSERT OR REPLACE INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`
    );
  }
  return statements.join("\n");
}

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
    const [
      books,
      chapters,
      bookVersions,
      projectAssets,
      bookMetadata,
      bookStyles,
      epubStructures,
      chapterEpubMeta,
      notes,
      syncTombstones,
      coverTemplates,
      settings,
    ] = await Promise.all([
      this.select<Record<string, unknown>[]>("SELECT * FROM books"),
      this.select<Record<string, unknown>[]>("SELECT * FROM chapters"),
      this.select<Record<string, unknown>[]>("SELECT * FROM book_versions"),
      this.select<Record<string, unknown>[]>("SELECT * FROM project_assets"),
      this.select<Record<string, unknown>[]>("SELECT * FROM book_metadata"),
      this.select<Record<string, unknown>[]>("SELECT * FROM book_styles"),
      this.select<Record<string, unknown>[]>("SELECT * FROM epub_structures"),
      this.select<Record<string, unknown>[]>("SELECT * FROM chapter_epub_meta"),
      this.select<Record<string, unknown>[]>("SELECT * FROM notes"),
      this.select<Record<string, unknown>[]>("SELECT * FROM sync_tombstones"),
      this.select<Record<string, unknown>[]>("SELECT * FROM cover_templates"),
      this.select<Record<string, unknown>[]>("SELECT * FROM settings"),
    ]);

    const lines: string[] = [
      "-- Maibuk Database Export (SQL Dump)",
      `-- Exported at: ${new Date().toISOString()}`,
      "-- Import this file into a SQLite database after creating the schema",
      "",
      "-- Books",
      generateInsertStatements("books", books),
      "",
      "-- Chapters",
      generateInsertStatements("chapters", chapters),
      "",
      "-- Book Versions",
      generateInsertStatements("book_versions", bookVersions),
      "",
      "-- Project Assets",
      generateInsertStatements("project_assets", projectAssets),
      "",
      "-- Book Metadata",
      generateInsertStatements("book_metadata", bookMetadata),
      "",
      "-- Book Styles",
      generateInsertStatements("book_styles", bookStyles),
      "",
      "-- EPUB Structures",
      generateInsertStatements("epub_structures", epubStructures),
      "",
      "-- Chapter EPUB Metadata",
      generateInsertStatements("chapter_epub_meta", chapterEpubMeta),
      "",
      "-- Notes",
      generateInsertStatements("notes", notes),
      "",
      "-- Sync Tombstones",
      generateInsertStatements("sync_tombstones", syncTombstones),
      "",
      "-- Cover Templates",
      generateInsertStatements("cover_templates", coverTemplates),
      "",
      "-- Settings",
      generateInsertStatements("settings", settings),
    ];

    const sqlDump = lines.join("\n");
    return new TextEncoder().encode(sqlDump);
  }

  async importData(sqlContent: string): Promise<void> {
    const statements = parseSqlStatements(sqlContent);
    for (const statement of statements) {
      if (statement.length > 0) {
        this.db.run(statement);
      }
    }
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

  await adapter.execute(`
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

  await adapter.execute(`
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

  await adapter.execute(`
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

  await adapter.execute(`
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

  await adapter.execute(`
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

  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      tags TEXT,
      pinned INTEGER DEFAULT 0,
      "order" INTEGER NOT NULL,
      word_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await adapter.execute(`
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

  await adapter.execute(`
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

  await adapter.execute(`CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id)`);
  await adapter.execute(
    `CREATE INDEX IF NOT EXISTS idx_chapters_order ON chapters(book_id, "order")`
  );
  await adapter.execute(
    `CREATE INDEX IF NOT EXISTS idx_book_versions_book ON book_versions(book_id, created_at DESC)`
  );
  await adapter.execute(
    `CREATE INDEX IF NOT EXISTS idx_project_assets_book_id ON project_assets(book_id)`
  );
  await adapter.execute(
    `CREATE INDEX IF NOT EXISTS idx_project_assets_book_href ON project_assets(book_id, href)`
  );
  await adapter.execute(
    `CREATE INDEX IF NOT EXISTS idx_book_metadata_book_id ON book_metadata(book_id)`
  );
  await adapter.execute(`CREATE INDEX IF NOT EXISTS idx_book_styles_book_id ON book_styles(book_id)`);
  await adapter.execute(
    `CREATE INDEX IF NOT EXISTS idx_epub_structures_book_id ON epub_structures(book_id)`
  );
  await adapter.execute(
    `CREATE INDEX IF NOT EXISTS idx_chapter_epub_meta_book_id ON chapter_epub_meta(book_id)`
  );
  await adapter.execute(
    `CREATE INDEX IF NOT EXISTS idx_sync_tombstones_pending
      ON sync_tombstones(entity_type, pushed_at, confirmed_at)`
  );
  await adapter.execute(`CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)`);
  await adapter.execute(`CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_type, target_id)`);

  return adapter;
}
