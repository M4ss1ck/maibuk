import Database from "@tauri-apps/plugin-sql";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { parseSqlStatements } from "@/lib/db/sql-parser";
import { exportSqlDump } from "@/lib/db/sql-export";

class TauriDatabaseAdapter implements DatabaseAdapter {
  constructor(private db: Database) {}

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
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
    // Exported through the shared worker-backed dump helper.
    return exportSqlDump(this);
  }

  async importData(sqlContent: string): Promise<void> {
    // Parse SQL statements properly handling semicolons inside quoted strings
    const statements = parseSqlStatements(sqlContent);

    for (const statement of statements) {
      if (statement.length > 0) {
        await this.db.execute(statement);
      }
    }
  }
}

export async function createTauriDatabase(path: string): Promise<DatabaseAdapter> {
  const db = await Database.load(path);
  return new TauriDatabaseAdapter(db);
}
