import Database from "@tauri-apps/plugin-sql";
import type { DatabaseAdapter } from "../types";

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
}

export async function createTauriDatabase(
  path: string
): Promise<DatabaseAdapter> {
  const db = await Database.load(path);
  return new TauriDatabaseAdapter(db);
}
