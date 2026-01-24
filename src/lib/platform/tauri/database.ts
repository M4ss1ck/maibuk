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

  async importData(sqlContent: string): Promise<void> {
    // Parse SQL statements properly handling semicolons inside quoted strings
    const statements = this.parseSqlStatements(sqlContent);

    for (const statement of statements) {
      if (statement.length > 0) {
        await this.db.execute(statement);
      }
    }
  }

  private parseSqlStatements(sqlContent: string): string[] {
    const statements: string[] = [];
    let current = "";
    let inString = false;
    let stringChar = "";

    for (let i = 0; i < sqlContent.length; i++) {
      const char = sqlContent[i];

      // Handle string boundaries
      if ((char === "'" || char === '"') && sqlContent[i - 1] !== "\\") {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          // Check for escaped quotes ('')
          if (char === "'" && sqlContent[i + 1] === "'") {
            current += char;
            i++; // Skip the next quote
            current += sqlContent[i];
            continue;
          }
          inString = false;
          stringChar = "";
        }
      }

      // Statement terminator (only outside strings)
      if (char === ";" && !inString) {
        const trimmed = current.trim();
        // Filter out comments and empty statements
        const cleanStatement = trimmed
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim();

        if (cleanStatement.length > 0 && !cleanStatement.startsWith("--")) {
          statements.push(cleanStatement);
        }
        current = "";
      } else {
        current += char;
      }
    }

    // Handle last statement without trailing semicolon
    const trimmed = current.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("--")) {
      const cleanStatement = trimmed
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (cleanStatement.length > 0) {
        statements.push(cleanStatement);
      }
    }

    return statements;
  }
}

export async function createTauriDatabase(
  path: string
): Promise<DatabaseAdapter> {
  const db = await Database.load(path);
  return new TauriDatabaseAdapter(db);
}
