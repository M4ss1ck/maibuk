/**
 * The Library copy older web builds saved: a whole database file in
 * IndexedDB, and before that base64 in localStorage. It is read once for the
 * move into OPFS and deleted only after the pooled Library opens and passes
 * its checks (ADR 0035).
 */

const IDB_NAME = "maibuk-db-storage";
const IDB_STORE = "database";
const IDB_KEY = "main";
const LOCAL_STORAGE_KEY = "maibuk-database";

/** The saved Library, or null only when none was ever saved. */
export async function loadLegacyLibraryBytes(): Promise<Uint8Array | null> {
  const saved = await loadFromIndexedDB();
  if (saved) return saved;
  return loadFromLocalStorage();
}

/** Drops every copy the old builds kept. */
export async function deleteLegacyLibraryBytes(): Promise<void> {
  await deleteFromIndexedDB();
  localStorage.removeItem(LOCAL_STORAGE_KEY);
}

function openDatabase(mode: IDBTransactionMode): Promise<{ db: IDBDatabase; request: IDBRequest }> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB_NAME, 1);

    open.onerror = () => reject(open.error ?? new Error("Could not open IndexedDB"));

    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };

    open.onsuccess = () => {
      const db = open.result;
      try {
        const store = db.transaction(IDB_STORE, mode).objectStore(IDB_STORE);
        resolve({ db, request: store.get(IDB_KEY) });
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

/**
 * A failed read rejects: treating it as "nothing saved" opened an empty
 * Library, and its first write replaced the author's saved one.
 */
async function loadFromIndexedDB(): Promise<Uint8Array | null> {
  const { db, request } = await openDatabase("readonly");
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      db.close();
      resolve((request.result as Uint8Array | undefined) ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Could not read the saved Library"));
    };
  });
}

async function deleteFromIndexedDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB_NAME, 1);

    open.onerror = () => reject(open.error ?? new Error("Could not open IndexedDB"));

    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };

    open.onsuccess = () => {
      const db = open.result;
      try {
        const transaction = db.transaction(IDB_STORE, "readwrite");
        transaction.objectStore(IDB_STORE).delete(IDB_KEY);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

/** The oldest copy: a base64 database older builds kept in localStorage. */
function loadFromLocalStorage(): Uint8Array | null {
  if (typeof localStorage === "undefined") return null;
  const legacy = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!legacy) return null;
  return Uint8Array.from(atob(legacy), (character) => character.charCodeAt(0));
}
