import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { WebDatabaseAdapter } from "@/lib/platform/web/database";
import { AtomicStatementError } from "@/lib/db/atomic";

const DB_NAME = "maibuk-db-storage";

function stubSqlJs() {
  return {
    run: vi.fn(),
    export: vi.fn(() => new Uint8Array([7, 7, 7])),
    getRowsModified: vi.fn(() => 1),
    close: vi.fn(),
  } as unknown as SqlJsDatabase;
}

function readPersisted(): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("database");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("database", "readonly").objectStore("database").get("main");
      get.onsuccess = () => {
        const value = (get.result as Uint8Array | undefined) ?? null;
        db.close();
        resolve(value);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
  });
}

describe("WebDatabaseAdapter persistence", () => {
  it("execute resolves only after the snapshot is in IndexedDB", async () => {
    const db = stubSqlJs();
    const adapter = new WebDatabaseAdapter(db);

    await adapter.execute("INSERT INTO books VALUES (1)");

    expect(db.run).toHaveBeenCalledWith("INSERT INTO books VALUES (1)", undefined);
    expect(Array.from((await readPersisted()) ?? [])).toEqual([7, 7, 7]);
    await adapter.close();
  });

  it("execute rejects when IndexedDB refuses the write", async () => {
    const db = stubSqlJs();
    const adapter = new WebDatabaseAdapter(db);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });

    try {
      await expect(adapter.execute("INSERT INTO books VALUES (1)")).rejects.toThrow(
        /quota has been exceeded/
      );
    } finally {
      put.mockRestore();
    }
  });

  it("a failed write does not stop the next one", async () => {
    const db = stubSqlJs();
    const adapter = new WebDatabaseAdapter(db);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });

    try {
      await expect(adapter.execute("INSERT INTO books VALUES (1)")).rejects.toThrow();
    } finally {
      put.mockRestore();
    }

    await adapter.execute("INSERT INTO books VALUES (2)");
    expect(Array.from((await readPersisted()) ?? [])).toEqual([7, 7, 7]);
    await adapter.close();
  });

  it("a failed executeAtomic leaves the persisted bytes untouched", async () => {
    const SQL = await initSqlJs();
    const sqlDb = new SQL.Database();
    sqlDb.run("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT)");
    sqlDb.run("INSERT INTO notes (id, title) VALUES ('kept', 'Kept')");
    const adapter = new WebDatabaseAdapter(sqlDb as unknown as SqlJsDatabase);

    await adapter.execute("INSERT INTO notes (id, title) VALUES ('base', 'Base')");
    const before = await readPersisted();
    expect(before).not.toBeNull();

    await expect(
      adapter.executeAtomic([
        "INSERT INTO notes (id, title) VALUES ('doomed', 'Doomed')",
        "INSERT INTO missing_table (id) VALUES ('x')",
      ])
    ).rejects.toBeInstanceOf(AtomicStatementError);

    expect(await readPersisted()).toEqual(before);
    expect(
      await adapter.select<Record<string, unknown>[]>("SELECT id FROM notes ORDER BY id")
    ).toEqual([{ id: "base" }, { id: "kept" }]);

    await adapter.execute("INSERT INTO notes (id, title) VALUES ('marker', 'Marker')");
    const persisted = await readPersisted();
    expect(persisted).not.toBeNull();
    const restored = new SQL.Database(persisted ?? undefined);
    try {
      const stmt = restored.prepare("SELECT id FROM notes ORDER BY id");
      const ids: unknown[] = [];
      while (stmt.step()) {
        ids.push((stmt.getAsObject() as Record<string, unknown>).id);
      }
      stmt.free();
      expect(ids).toEqual(["base", "kept", "marker"]);
    } finally {
      restored.close();
    }
    await adapter.close();
  });
});
