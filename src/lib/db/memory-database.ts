import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { parseSqlStatements } from "@/lib/db/sql-parser";
import { exportSqlDump } from "@/lib/db/sql-export";

/**
 * A sql.js Library that lives only in memory: nothing it holds is ever
 * persisted. The Tutorial Library (ADR 0008) and the store tests use it.
 */
export class MemoryDatabaseAdapter implements DatabaseAdapter {
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
    // Same exporter as the Tauri and web adapters. A hand-written dump here
    // once included canvases while production never did, which hid the
    // Backup restore that deleted every Canvas.
    return exportSqlDump(this);
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

let sqlJs: Promise<SqlJsStatic> | null = null;

// The wasm ships inside the app bundle so the Tutorial works offline and in
// the Tauri webview, which never loads sql.js otherwise.
function loadSqlJs(): Promise<SqlJsStatic> {
  sqlJs ??= initSqlJs({ locateFile: () => sqlWasmUrl }).catch((error: unknown) => {
    sqlJs = null;
    throw error;
  });
  return sqlJs;
}

/** An empty in-memory Library, without a schema. */
export async function createMemoryDatabase(): Promise<DatabaseAdapter> {
  const SQL = await loadSqlJs();
  return new MemoryDatabaseAdapter(new SQL.Database());
}
