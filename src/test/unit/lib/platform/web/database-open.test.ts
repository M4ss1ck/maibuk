import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbWorkerHandler } from "@/lib/db/db-worker-handler";
import { createMemoryDatabase } from "@/lib/db/memory-database";
import { createWebDatabase, getWebLibraryOpenResult } from "@/lib/platform/web/database";
import {
  deleteLegacyLibraryBytes,
  loadLegacyLibraryBytes,
} from "@/lib/platform/web/legacy-storage";
import type { LibraryOpenDeps } from "@/lib/platform/web/library-open";
import { createTestWebDatabase } from "@/test/support/db-worker";
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

/**
 * The real open sequence with one substitution: the Worker handler runs
 * in-process. OPFS is absent under Node, so these exercise the in-memory
 * fallback with the saved copy, which is the path the author sees when the
 * pooled VFS cannot be installed.
 */
function testDeps(): LibraryOpenDeps {
  return {
    acquireLock: async () => ({ held: true, release() {} }),
    createClient: () => createTestWebDatabase(createDbWorkerHandler()),
    loadLegacyBytes: loadLegacyLibraryBytes,
    deleteLegacyBytes: deleteLegacyLibraryBytes,
  };
}

async function librarySavedWith(title: string): Promise<Uint8Array> {
  const db = await createMemoryDatabase();
  await db.execute("CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT)");
  await db.execute("INSERT INTO books VALUES ('b1', ?)", [title]);
  const bytes = db.exportBytes();
  await db.close();
  return bytes;
}

describe("createWebDatabase()", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
  });

  it("opens the saved Library", async () => {
    await saveBytes(await librarySavedWith("Saved"));

    const db = await createWebDatabase("maibuk.db", testDeps());

    expect(await db.select("SELECT title FROM books")).toEqual([{ title: "Saved" }]);
    expect(getWebLibraryOpenResult()).toEqual({ kind: "memory" });
  });

  it("starts an empty Library only when nothing was ever saved", async () => {
    const db = await createWebDatabase("maibuk.db", testDeps());

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
      await expect(createWebDatabase("maibuk.db", testDeps())).rejects.toThrow(/operation failed/);
    } finally {
      get.mockRestore();
    }
    expect(Array.from((await savedBytes()) ?? [])).toEqual(Array.from(saved));
  });

  it("leaves unreadable saved bytes in place when the schema cannot be applied", async () => {
    const garbage = new TextEncoder().encode("not a SQLite file, but the author's only copy");
    await saveBytes(garbage);

    const db = await createWebDatabase("maibuk.db", testDeps());
    await expect(initializeSchema(db)).rejects.toThrow();

    expect(Array.from((await savedBytes()) ?? [])).toEqual(Array.from(garbage));
  });
});
