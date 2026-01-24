import Database from "@tauri-apps/plugin-sql";
import type { DatabaseAdapter } from "../types";

function escapeSQL(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function generateInsertStatements(
  tableName: string,
  rows: Record<string, unknown>[]
): string {
  if (rows.length === 0) return "";

  const statements: string[] = [];
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((col) => escapeSQL(row[col]));
    statements.push(
      `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`
    );
  }
  return statements.join("\n");
}

class TauriDatabaseAdapter implements DatabaseAdapter {
  constructor(private db: Database) {}

  async execute(
    sql: string,
    params?: unknown[]
  ): Promise<{ rowsAffected: number }> {
    const result = await this.db.execute(sql, params);
    return { rowsAffected: result.rowsAffected };
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    return this.db.select(sql, params) as Promise<T>;
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async exportData(): Promise<Uint8Array> {
    // Generate SQL dump since we can't read the file directly without permissions
    const [books, chapters, coverTemplates, settings] = await Promise.all([
      this.select<Record<string, unknown>[]>("SELECT * FROM books"),
      this.select<Record<string, unknown>[]>("SELECT * FROM chapters"),
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
      "-- Cover Templates",
      generateInsertStatements("cover_templates", coverTemplates),
      "",
      "-- Settings",
      generateInsertStatements("settings", settings),
    ];

    const sqlDump = lines.join("\n");
    return new TextEncoder().encode(sqlDump);
  }
}

export async function createTauriDatabase(
  path: string
): Promise<DatabaseAdapter> {
  const db = await Database.load(path);
  return new TauriDatabaseAdapter(db);
}
