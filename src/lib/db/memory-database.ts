import type { Database as SqliteDatabase, SqlValue, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { AtomicStatement, DatabaseAdapter } from "@/lib/platform/types";
import { runAtomic } from "@/lib/db/atomic";
import { exportSqlDump } from "@/lib/db/sql-export";
import { exportSqliteBytes, loadSqlite3 } from "@/lib/db/sqlite-engine";
import { toLibraryError, toLibraryRow } from "@/lib/db/sqlite-parity";

/**
 * A Library that lives only in memory: nothing it holds is ever persisted.
 * The Tutorial Library (ADR 0008) and the store tests use it. It runs the
 * SQLite project's own WASM build so FTS5 is available, in-process and
 * without a Worker. The web Worker wraps the same class around its pooled
 * database, so both paths share one set of row and error rules.
 */
export class MemoryDatabaseAdapter implements DatabaseAdapter {
  constructor(
    private db: SqliteDatabase,
    private sqlite3: Sqlite3Static
  ) {}

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
    this.run(sql, params);
    return { rowsAffected: this.db.changes() };
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    try {
      const rows =
        params === undefined
          ? this.db.selectObjects(sql)
          : this.db.selectObjects(sql, params as readonly SqlValue[]);
      return rows.map(toLibraryRow) as T;
    } catch (error) {
      throw toLibraryError(error);
    }
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

  /** The database file's bytes, not a SQL dump: a seed, or an exported copy. */
  exportBytes(): Uint8Array {
    return exportSqliteBytes(this.sqlite3, this.db);
  }

  async executeAtomic(statements: readonly AtomicStatement[]): Promise<void> {
    runAtomic({ run: (sql, params) => this.run(sql, params) }, statements);
  }

  /** The same statement runner `runAtomic` uses, on the official build's oo1 API. */
  private run(sql: string, params?: readonly unknown[]): void {
    if (sql.trim().length === 0) return;
    try {
      if (params === undefined) {
        this.db.exec(sql);
      } else {
        this.db.exec({ sql, bind: params as readonly SqlValue[] });
      }
    } catch (error) {
      throw toLibraryError(error);
    }
  }
}

/** An empty in-memory Library, without a schema. */
export async function createMemoryDatabase(): Promise<MemoryDatabaseAdapter> {
  const engine = await loadSqlite3();
  const db = new engine.oo1.DB(":memory:", "c");
  // The official build's WASM default is 8192; the engine this replaced used
  // 4096. Keep the page size the Library size checks and Compaction were
  // written against.
  db.exec("PRAGMA page_size = 4096");
  return new MemoryDatabaseAdapter(db, engine);
}
