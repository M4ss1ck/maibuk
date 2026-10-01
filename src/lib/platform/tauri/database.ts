import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { AtomicStatementError } from "@/lib/db/atomic";
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
    // The webview is not allowed to close the app-owned Library pool (ADR 0017).
  }

  async exportData(): Promise<Uint8Array> {
    // Exported through the shared worker-backed dump helper.
    return exportSqlDump(this);
  }

  async executeAtomic(statements: string[]): Promise<void> {
    try {
      await invoke("library_execute_atomic", { statements });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        typeof (error as { message?: unknown }).message === "string" &&
        "index" in error &&
        ((error as { index?: unknown }).index === null ||
          typeof (error as { index?: unknown }).index === "number")
      ) {
        const { message, index } = error as { message: string; index: number | null };
        throw new AtomicStatementError(index, message, statements.length);
      }
      throw new AtomicStatementError(null, String(error), statements.length);
    }
  }
}

export async function createTauriDatabase(path: string): Promise<DatabaseAdapter> {
  const db = Database.get(path);
  return new TauriDatabaseAdapter(db);
}
