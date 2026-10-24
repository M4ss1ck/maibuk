import type {
  Database as SqliteDatabase,
  SAHPoolUtil,
  Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import { MemoryDatabaseAdapter } from "@/lib/db/memory-database";
import { formatSqlDump } from "@/lib/db/sql-export";
import { exportSqliteBytes, loadSqlite3, loadSqliteBytes } from "@/lib/db/sqlite-engine";
import {
  type DbOpenValue,
  type DbRequest,
  type DbRequestPayload,
  type DbResponse,
  serializeDbError,
} from "@/lib/db/worker-protocol";

/**
 * The Library Worker's message handling, kept apart from the Worker global
 * scope so a test can drive it in-process under Node. The Worker module is a
 * thin `postMessage` wrapper around this.
 */

/** The OPFS directory the `opfs-sahpool` VFS owns (ADR 0035). */
export const LIBRARY_POOL_DIRECTORY = "maibuk-library";

/** One Worker reply plus anything that must be transferred, not cloned. */
export interface DbHandlerReply {
  response: DbResponse;
  transfer?: Transferable[];
}

export interface DbWorkerHandler {
  handle(request: DbRequest): Promise<DbHandlerReply>;
}

interface LibraryState {
  sqlite3: Sqlite3Static | null;
  db: SqliteDatabase | null;
  adapter: MemoryDatabaseAdapter | null;
  pool: SAHPoolUtil | null;
}

function state(): LibraryState {
  return { sqlite3: null, db: null, adapter: null, pool: null };
}

/**
 * Builds the handler a Worker runs. `loadEngine` is the one seam a test needs:
 * it can reuse an engine already initialized in the test process.
 */
export function createDbWorkerHandler(
  loadEngine: () => Promise<Sqlite3Static> = loadSqlite3
): DbWorkerHandler {
  const library: LibraryState = state();

  function openPooled(sqlite3: Sqlite3Static, name: string): DbOpenValue {
    const pool = library.pool;
    if (!pool) throw new Error("The pooled Library is not open");
    const existing = pool.getFileNames().includes(`/${name}`);
    const db = new pool.OpfsSAHPoolDb(`/${name}`);
    if (!existing) {
      // A fresh Library keeps the page size the size checks and Compaction
      // were written against; an imported one already has its own.
      db.exec("PRAGMA page_size = 4096");
    }
    library.db = db;
    library.adapter = new MemoryDatabaseAdapter(db, sqlite3);
    return { mode: "opfs", existing };
  }

  function openMemory(sqlite3: Sqlite3Static, bytes?: ArrayBuffer): DbOpenValue {
    const db = new sqlite3.oo1.DB(":memory:", "c");
    if (bytes) {
      loadSqliteBytes(sqlite3, db, new Uint8Array(bytes));
    } else {
      db.exec("PRAGMA page_size = 4096");
    }
    library.db = db;
    library.adapter = new MemoryDatabaseAdapter(db, sqlite3);
    return { mode: "memory", existing: bytes !== undefined };
  }

  function closeLibrary(): void {
    if (library.adapter) {
      library.adapter.close();
    } else {
      library.db?.close();
    }
    library.db = null;
    library.adapter = null;
  }

  function requireAdapter(): MemoryDatabaseAdapter {
    if (!library.adapter) throw new Error("The Library is not open");
    return library.adapter;
  }

  function requireDatabase(): SqliteDatabase {
    if (!library.db) throw new Error("The Library is not open");
    return library.db;
  }

  async function open(request: Extract<DbRequestPayload, { op: "open" }>) {
    closeLibrary();
    if (!library.sqlite3) {
      library.sqlite3 = await loadEngine();
    }
    const sqlite3 = library.sqlite3;

    if (request.mode === "memory") {
      return openMemory(sqlite3, request.bytes);
    }

    // The cached pool survives a close, so one Worker can reopen the Library
    // after a failed migration without reinstalling the VFS.
    library.pool ??= await sqlite3.installOpfsSAHPoolVfs({
      directory: LIBRARY_POOL_DIRECTORY,
      initialCapacity: 8,
      clearOnInit: false,
      // A failed install must never damage the Library another tab holds.
      preserveOnInitFailure: true,
    });
    return openPooled(sqlite3, request.name);
  }

  async function importBytes(request: Extract<DbRequestPayload, { op: "importBytes" }>) {
    const pool = library.pool;
    if (!pool) throw new Error("The Library is not open on OPFS");
    // The destination file must not be open while it is replaced.
    closeLibrary();
    try {
      await pool.importDb(`/${request.name}`, new Uint8Array(request.bytes));
      if (!library.sqlite3) throw new Error("The Library engine is not loaded");
      openPooled(library.sqlite3, request.name);
      // The same cheap checks the page runs. A file that imported but is not
      // a Maibuk Library is removed, so the next launch retries the move
      // instead of opening an empty-looking Library.
      await requireAdapter().select("PRAGMA schema_version");
      await requireAdapter().select("SELECT count(*) AS count FROM books");
    } catch (error) {
      closeLibrary();
      try {
        pool.unlink(`/${request.name}`);
      } catch {
        // The import already failed; a file that cannot be removed is left
        // for the next launch to overwrite.
      }
      throw error;
    }
    return null;
  }

  async function run(request: DbRequestPayload): Promise<{
    value: unknown;
    transfer?: Transferable[];
  }> {
    switch (request.op) {
      case "open":
        return { value: await open(request) };
      case "execute":
        return { value: await requireAdapter().execute(request.sql, request.params) };
      case "select":
        return { value: await requireAdapter().select(request.sql, request.params) };
      case "runAtomic":
        await requireAdapter().executeAtomic(request.statements);
        return { value: null };
      case "exportBytes": {
        const sqlite3 = library.sqlite3;
        if (!sqlite3) throw new Error("The Library is not open");
        const bytes = exportSqliteBytes(sqlite3, requireDatabase());
        const buffer = bytes.buffer as ArrayBuffer;
        return { value: buffer, transfer: [buffer] };
      }
      case "importBytes":
        return { value: await importBytes(request) };
      case "exportSqlDump": {
        const bytes = await formatSqlDump(requireAdapter(), request.exportedAt);
        const buffer = bytes.buffer as ArrayBuffer;
        return { value: buffer, transfer: [buffer] };
      }
      case "close":
        closeLibrary();
        return { value: null };
    }
  }

  return {
    async handle(request: DbRequest): Promise<DbHandlerReply> {
      try {
        const { value, transfer } = await run(request);
        return { response: { id: request.id, ok: true, value }, transfer };
      } catch (error) {
        return { response: { id: request.id, ok: false, error: serializeDbError(error) } };
      }
    },
  };
}
