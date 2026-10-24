import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteLegacyLibraryBytes,
  loadLegacyLibraryBytes,
} from "@/lib/platform/web/legacy-storage";

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

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

describe("the Library copy older web builds saved", () => {
  it("reads the IndexedDB copy", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await withStore("readwrite", (store) => store.put(bytes, "main"));

    const loaded = await loadLegacyLibraryBytes();
    expect(loaded).not.toBeNull();
    expect(Array.from(loaded ?? [])).toEqual([1, 2, 3]);
  });

  it("reads the oldest localStorage copy when IndexedDB holds none", async () => {
    const bytes = new Uint8Array([83, 81, 76]);
    localStorage.setItem("maibuk-database", btoa(String.fromCharCode(...bytes)));

    const loaded = await loadLegacyLibraryBytes();
    expect(loaded).not.toBeNull();
    expect(Array.from(loaded ?? [])).toEqual([83, 81, 76]);
  });

  it("reports null only when nothing was ever saved", async () => {
    expect(await loadLegacyLibraryBytes()).toBeNull();
  });

  it("rejects a failed read instead of calling it nothing saved", async () => {
    const get = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(() => {
      throw new DOMException("The operation failed", "UnknownError");
    });

    try {
      await expect(loadLegacyLibraryBytes()).rejects.toThrow(/operation failed/);
    } finally {
      get.mockRestore();
    }
  });

  it("deletes both copies", async () => {
    await withStore("readwrite", (store) => store.put(new Uint8Array([1]), "main"));
    localStorage.setItem("maibuk-database", btoa("saved"));

    await deleteLegacyLibraryBytes();

    expect(await loadLegacyLibraryBytes()).toBeNull();
    expect(localStorage.getItem("maibuk-database")).toBeNull();
  });
});
