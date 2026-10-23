import sqlite3InitModule, {
  type Database as SqliteDatabase,
  type SqlValue,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
// The wasm ships with the app instead of being fetched from a CDN: the app
// bundle gets a hashed asset URL, and Node (tests) resolves it below from
// node_modules through the package's own Node entry point.
import sqlite3WasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import type { AtomicStatement, DatabaseAdapter } from "@/lib/platform/types";
import { runAtomic } from "@/lib/db/atomic";
import { exportSqlDump } from "@/lib/db/sql-export";

/** What `exec`/`selectObjects` hand back before parity conversion. */
function toSqlJsValue(value: SqlValue): unknown {
  // sql.js reads every INTEGER through sqlite3_column_double and so returns a
  // Number, even outside the safe-integer range. The official build keeps the
  // full int64 as BigInt; convert it so both engines hand callers the same
  // JS types (the value is lossy exactly where sql.js already was).
  return typeof value === "bigint" ? Number(value) : value;
}

/** sql.js returns plain objects; the official build returns null-prototype ones. */
function toSqlJsRow(row: Record<string, SqlValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[key] = toSqlJsValue(row[key]);
  }
  return out;
}

// The official build prefixes an SQL failure with its result code and name
// (`SQLITE_CONSTRAINT_FOREIGNKEY: sqlite3 result code 787: FOREIGN KEY
// constraint failed`); sql.js threw only SQLite's own message, which callers
// and tests match on, so strip the prefix back off.
const SQLITE_ERROR_PREFIX = /^[A-Z][A-Z0-9_]*: sqlite3 result code -?\d+: /;

function toSqlJsError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const message = error.message.replace(SQLITE_ERROR_PREFIX, "");
  return message === error.message ? error : new Error(message);
}

/**
 * A Library that lives only in memory: nothing it holds is ever persisted.
 * The Tutorial Library (ADR 0008) and the store tests use it. It runs the
 * SQLite project's own WASM build (rather than sql.js) so FTS5 is available,
 * in-process and without a Worker.
 */
export class MemoryDatabaseAdapter implements DatabaseAdapter {
  constructor(private db: SqliteDatabase) {}

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
      return rows.map(toSqlJsRow) as T;
    } catch (error) {
      throw toSqlJsError(error);
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
      throw toSqlJsError(error);
    }
  }
}

let sqlite3: Promise<Sqlite3Static> | null = null;

function isNodeRuntime(): boolean {
  const runtime = globalThis as { process?: { versions?: { node?: string } } };
  return runtime.process?.versions?.node !== undefined;
}

// Emscripten's loader is typed without its options argument, but the Node entry
// point finds `sqlite3.wasm` beside itself while the bundled app must be told
// where Vite placed the asset (never a CDN).
const initSqlite3 = sqlite3InitModule as unknown as (options?: {
  locateFile?: () => string;
}) => Promise<Sqlite3Static>;

function loadSqlite3(): Promise<Sqlite3Static> {
  sqlite3 ??= initSqlite3(isNodeRuntime() ? {} : { locateFile: () => sqlite3WasmUrl }).catch(
    (error: unknown) => {
      sqlite3 = null;
      throw error;
    }
  );
  return sqlite3;
}

/** An empty in-memory Library, without a schema. */
export async function createMemoryDatabase(): Promise<DatabaseAdapter> {
  const engine = await loadSqlite3();
  const db = new engine.oo1.DB(":memory:", "c");
  // The official build's WASM default is 8192; sql.js used 4096. Keep the
  // page size the Library size checks and Compaction were written against.
  db.exec("PRAGMA page_size = 4096");
  return new MemoryDatabaseAdapter(db);
}
