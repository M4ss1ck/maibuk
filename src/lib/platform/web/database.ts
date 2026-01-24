import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import type { DatabaseAdapter } from "../types";

const DB_STORAGE_KEY = "maibuk-database";

function escapeSQL(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function generateInsertStatements(
  tableName: string,
  rows: Record<string, unknown>[]
): string {
  if (rows.length === 0) return "";

  const statements: string[] = [];
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((col) => escapeSQL(row[col]));
    statements.push(
      `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`
    );
  }
  return statements.join("\n");
}

class WebDatabaseAdapter implements DatabaseAdapter {
  constructor(private db: SqlJsDatabase) {}

  async execute(
    sql: string,
    params?: unknown[]
  ): Promise<{ rowsAffected: number }> {
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
    this.db.close();
  }

  async exportData(): Promise<Uint8Array> {
    // Generate SQL dump for consistency with Tauri export
    const [books, chapters, coverTemplates, settings] = await Promise.all([
      this.select<Record<string, unknown>[]>("SELECT * FROM books"),
      this.select<Record<string, unknown>[]>("SELECT * FROM chapters"),
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
      "-- Cover Templates",
      generateInsertStatements("cover_templates", coverTemplates),
      "",
      "-- Settings",
      generateInsertStatements("settings", settings),
    ];

    const sqlDump = lines.join("\n");
    return new TextEncoder().encode(sqlDump);
  }

  private persist(): void {
    try {
      const data = this.db.export();
      // For larger databases, use IndexedDB instead of localStorage
      if (data.length < 5 * 1024 * 1024) {
        // Less than 5MB
        const base64 = btoa(String.fromCharCode(...data));
        localStorage.setItem(DB_STORAGE_KEY, base64);
      } else {
        // Use IndexedDB for larger databases
        this.persistToIndexedDB(data);
      }
    } catch (error) {
      console.error("Failed to persist database:", error);
    }
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

export async function createWebDatabase(
  _path: string
): Promise<DatabaseAdapter> {
  const SQL = await initSqlJs({
    // Load sql.js WASM from CDN
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
  });

  let db: SqlJsDatabase;

  // Try to restore from localStorage first
  const saved = localStorage.getItem(DB_STORAGE_KEY);
  if (saved) {
    try {
      const binary = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
      db = new SQL.Database(binary);
      return new WebDatabaseAdapter(db);
    } catch (error) {
      console.warn("Failed to restore from localStorage, trying IndexedDB:", error);
    }
  }

  // Try IndexedDB
  const indexedDBData = await loadFromIndexedDB();
  if (indexedDBData) {
    try {
      db = new SQL.Database(indexedDBData);
      return new WebDatabaseAdapter(db);
    } catch (error) {
      console.warn("Failed to restore from IndexedDB:", error);
    }
  }

  // Create new database
  db = new SQL.Database();
  return new WebDatabaseAdapter(db);
}
