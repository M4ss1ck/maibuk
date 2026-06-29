import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { parseSqlStatements } from "@/lib/db/sql-parser";

const DB_STORAGE_KEY = "maibuk-database";

function escapeSQL(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function generateInsertStatements(tableName: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  const statements: string[] = [];
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((col) => escapeSQL(row[col]));
    statements.push(
      `INSERT OR REPLACE INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`
    );
  }
  return statements.join("\n");
}

class WebDatabaseAdapter implements DatabaseAdapter {
  // Serializes IndexedDB writes so overlapping persists don't race on the same
  // transaction. Each persist enqueues a write of its own snapshot.
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private db: SqlJsDatabase) {}

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
    this.db.run(sql, params as (string | number | null | Uint8Array)[]);
    this.persist();
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
    this.persist();
    await this.writeChain;
    this.db.close();
  }

  async exportData(): Promise<Uint8Array> {
    // Generate SQL dump for consistency with Tauri export
    const [books, chapters, bookVersions, notes, syncTombstones, coverTemplates, settings] =
      await Promise.all([
        this.select<Record<string, unknown>[]>("SELECT * FROM books"),
        this.select<Record<string, unknown>[]>("SELECT * FROM chapters"),
        this.select<Record<string, unknown>[]>("SELECT * FROM book_versions"),
        this.select<Record<string, unknown>[]>("SELECT * FROM notes"),
        this.select<Record<string, unknown>[]>("SELECT * FROM sync_tombstones"),
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
      "-- Book Versions",
      generateInsertStatements("book_versions", bookVersions),
      "",
      "-- Notes",
      generateInsertStatements("notes", notes),
      "",
      "-- Sync Tombstones",
      generateInsertStatements("sync_tombstones", syncTombstones),
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
    const statements = parseSqlStatements(sqlContent);

    for (const statement of statements) {
      if (statement.length > 0) {
        this.db.run(statement);
      }
    }

    this.persist();
  }

  private persist(): void {
    // Always persist to IndexedDB. localStorage is avoided entirely: books can
    // be metadata-heavy and base64-in-localStorage blows the ~5MB quota,
    // surfacing as "Failed to persist database". IndexedDB stores the binary
    // directly with a far larger quota.
    const data = this.db.export();
    this.writeChain = this.writeChain
      .catch(() => {})
      .then(() => this.persistToIndexedDB(data))
      .catch((error) => {
        console.error("Failed to persist database:", error);
      });
  }

  /** One-time migration of a database previously persisted in localStorage. */
  async migrateLegacyStorage(): Promise<void> {
    this.persist();
    await this.writeChain;
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
        const transaction = db.transaction("database", "readwrite");
        const store = transaction.objectStore("database");
        store.put(data, "main");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }
}

async function loadFromIndexedDB(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open("maibuk-db-storage", 1);

    request.onerror = () => resolve(null);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("database")) {
        db.createObjectStore("database");
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("database", "readonly");
      const store = transaction.objectStore("database");
      const getRequest = store.get("main");
      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => resolve(null);
    };
  });
}

export async function createWebDatabase(_path: string): Promise<DatabaseAdapter> {
  const SQL = await initSqlJs({
    // Load sql.js WASM from CDN
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
  });

  // IndexedDB is the primary (and only) persistence target.
  const indexedDBData = await loadFromIndexedDB();
  if (indexedDBData) {
    try {
      return new WebDatabaseAdapter(new SQL.Database(indexedDBData));
    } catch (error) {
      console.warn("Failed to restore from IndexedDB:", error);
    }
  }

  // Legacy: a database persisted by an older build still lives in localStorage.
  // Load it, migrate it into IndexedDB, then drop the localStorage copy so we
  // never hit the storage quota again.
  const legacy = localStorage.getItem(DB_STORAGE_KEY);
  if (legacy) {
    try {
      const binary = Uint8Array.from(atob(legacy), (c) => c.charCodeAt(0));
      const adapter = new WebDatabaseAdapter(new SQL.Database(binary));
      await adapter.migrateLegacyStorage();
      return adapter;
    } catch (error) {
      console.warn("Failed to migrate localStorage database:", error);
    }
  }

  // Create new database
  return new WebDatabaseAdapter(new SQL.Database());
}
