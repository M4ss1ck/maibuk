import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { parseSqlStatements } from "@/lib/db/sql-parser";
import { exportSqlDump } from "@/lib/db/sql-export";

const DB_STORAGE_KEY = "maibuk-database";

export class WebDatabaseAdapter implements DatabaseAdapter {
  // Serializes IndexedDB writes so overlapping persists don't race on the same
  // transaction. Each persist enqueues a write of its own snapshot.
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private db: SqlJsDatabase) {}

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
    this.db.run(sql, params as (string | number | null | Uint8Array)[]);
    // Resolve once the write is durable. A failed persist must reject the
    // write: the Edit Session surfaces it as "Not saved" instead of "Saved".
    await this.persist();
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
    await this.persist();
    this.db.close();
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
        this.db.run(statement);
      }
    }

    await this.persist();
  }

  private persist(): Promise<void> {
    // Always persist to IndexedDB. localStorage is avoided entirely: books can
    // be metadata-heavy and base64-in-localStorage blows the ~5MB quota,
    // surfacing as "Failed to persist database". IndexedDB stores the binary
    // directly with a far larger quota.
    const data = this.db.export();
    this.writeChain = this.writeChain
      // A previous failed write must not stop the next attempt.
      .catch(() => {})
      .then(() => this.persistToIndexedDB(data));
    return this.writeChain;
  }

  /** One-time migration of a database previously persisted in localStorage. */
  async migrateLegacyStorage(): Promise<void> {
    await this.persist();
    localStorage.removeItem(DB_STORAGE_KEY);
  }

  private async persistToIndexedDB(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("maibuk-db-storage", 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("database")) {
          db.createObjectStore("database");
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        try {
          const transaction = db.transaction("database", "readwrite");
          const store = transaction.objectStore("database");
          store.put(data, "main");
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        } catch (error) {
          // A synchronous put failure (quota, DataError) must reject too.
          reject(error);
        }
      };
    });
  }
}

/**
 * The saved Library, or null only when none was ever saved. A failed read
 * rejects: treating it as "nothing saved" opened an empty Library, and its
 * first write replaced the author's saved one.
 */
async function loadFromIndexedDB(): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("maibuk-db-storage", 1);

    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("database")) {
        db.createObjectStore("database");
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      try {
        const transaction = db.transaction("database", "readonly");
        const store = transaction.objectStore("database");
        const getRequest = store.get("main");
        getRequest.onsuccess = () => {
          db.close();
          resolve((getRequest.result as Uint8Array | undefined) ?? null);
        };
        getRequest.onerror = () => {
          db.close();
          reject(getRequest.error ?? new Error("Could not read the saved Library"));
        };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

export async function createWebDatabase(_path: string): Promise<DatabaseAdapter> {
  const SQL = await initSqlJs({
    // Load sql.js WASM from CDN
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
  });

  // IndexedDB is the primary (and only) persistence target.
  // A saved Library that cannot be read or parsed must stop the open, never
  // fall through to a new empty one that would be saved over it.
  const indexedDBData = await loadFromIndexedDB();
  if (indexedDBData) {
    return new WebDatabaseAdapter(new SQL.Database(indexedDBData));
  }

  // Legacy: a database persisted by an older build still lives in localStorage.
  // Load it, migrate it into IndexedDB, then drop the localStorage copy so we
  // never hit the storage quota again.
  const legacy = localStorage.getItem(DB_STORAGE_KEY);
  if (legacy) {
    const binary = Uint8Array.from(atob(legacy), (c) => c.charCodeAt(0));
    const adapter = new WebDatabaseAdapter(new SQL.Database(binary));
    await adapter.migrateLegacyStorage();
    return adapter;
  }

  // Create new database
  return new WebDatabaseAdapter(new SQL.Database());
}
