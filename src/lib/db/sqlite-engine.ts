import sqlite3InitModule, {
  type Database as SqliteDatabase,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
// The wasm ships with the app instead of being fetched from a CDN: the app
// bundle gets a hashed asset URL, and Node (tests) resolves it below from
// node_modules through the package's own Node entry point.
import sqlite3WasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";

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

/** The one SQLite WASM engine this context runs, loaded once. */
export function loadSqlite3(): Promise<Sqlite3Static> {
  sqlite3 ??= initSqlite3(isNodeRuntime() ? {} : { locateFile: () => sqlite3WasmUrl }).catch(
    (error: unknown) => {
      sqlite3 = null;
      throw error;
    }
  );
  return sqlite3;
}

/** The database file's bytes, for a copy (not a SQL dump). */
export function exportSqliteBytes(sqlite3: Sqlite3Static, db: SqliteDatabase): Uint8Array {
  return sqlite3.capi.sqlite3_js_db_export(db);
}

/**
 * Replaces an in-memory database's content with `bytes`. Used to show the
 * author's old Library when the move to persistent storage cannot finish.
 */
export function loadSqliteBytes(
  sqlite3: Sqlite3Static,
  db: SqliteDatabase,
  bytes: Uint8Array
): void {
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  const flags =
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
  const rc = sqlite3.capi.sqlite3_deserialize(
    db,
    "main",
    pointer,
    bytes.byteLength,
    bytes.byteLength,
    flags
  );
  if (rc !== sqlite3.capi.SQLITE_OK) {
    throw new Error(`Could not load the saved Library (SQLite result code ${rc})`);
  }
}
