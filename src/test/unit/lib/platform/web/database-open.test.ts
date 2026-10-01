import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The adapter fetches the sql.js wasm from a CDN; load the bundled one here.
vi.mock("sql.js", async () => {
  const actual = await vi.importActual<typeof import("sql.js")>("sql.js");
  return { default: () => actual.default() };
});

import initSqlJs from "sql.js";
import { createWebDatabase } from "@/lib/platform/web/database";
import { initializeSchema } from "@/lib/db";

const DB_NAME = "maibuk-db-storage";

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("database");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const op = run(db.transaction("database", mode).objectStore("database"));
      op.onsuccess = () => {
        db.close();
        resolve(op.result);
      };
      op.onerror = () => {
        db.close();
        reject(op.error);
      };
    };
  });
}

const saveBytes = (bytes: Uint8Array) => withStore("readwrite", (s) => s.put(bytes, "main"));
const savedBytes = () => withStore<Uint8Array | undefined>("readonly", (s) => s.get("main"));

async function librarySavedWith(title: string): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT)");
  db.run("INSERT INTO books VALUES ('b1', ?)", [title]);
  return db.export();
}

describe("createWebDatabase()", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
  });

  it("opens the saved Library", async () => {
    await saveBytes(await librarySavedWith("Saved"));

    const db = await createWebDatabase("maibuk.db");

    expect(await db.select("SELECT title FROM books")).toEqual([{ title: "Saved" }]);
  });

  it("starts an empty Library only when nothing was ever saved", async () => {
    const db = await createWebDatabase("maibuk.db");

    expect(await db.select("SELECT name FROM sqlite_master")).toEqual([]);
  });

  it("rejects when the saved Library cannot be read, instead of opening an empty one", async () => {
    // Regression: a failed read resolved as "nothing saved", and the first
    // schema write saved an empty Library over the author's.
    const saved = await librarySavedWith("Saved");
    await saveBytes(saved);
    const get = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(() => {
      throw new DOMException(
        "The operation failed for reasons unrelated to the database itself.",
        "UnknownError"
      );
    });

    try {
      await expect(createWebDatabase("maibuk.db")).rejects.toThrow(/operation failed/);
    } finally {
      get.mockRestore();
    }
    expect(Array.from((await savedBytes()) ?? [])).toEqual(Array.from(saved));
  });

  it("leaves unreadable saved bytes in place when the schema cannot be applied", async () => {
    const garbage = new TextEncoder().encode("not a SQLite file, but the author's only copy");
    await saveBytes(garbage);

    const db = await createWebDatabase("maibuk.db");
    await expect(initializeSchema(db)).rejects.toThrow();

    expect(Array.from((await savedBytes()) ?? [])).toEqual(Array.from(garbage));
  });
});
