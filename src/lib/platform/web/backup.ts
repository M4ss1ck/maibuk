import type { BackupAdapter, BackupEntry, BackupPage, BackupPageOptions } from "@/lib/platform/types";
import { computeChecksum } from "@/lib/checksum";
import { parseTriggerFromFilename } from "@/features/backup/utils";

const DB_NAME = "maibuk-backups";
const DB_VERSION = 2;
const STORE_NAME = "backups";
const CREATED_AT_INDEX = "createdAt";

interface StoredBackup {
  filename: string;
  sql: string;
  trigger: BackupEntry["trigger"];
  createdAt: string;
  sizeBytes: number;
  checksum: string;
}

const STORAGE_FULL_MESSAGE =
  "Backup storage full. Delete old backups in Settings or reduce retention limit.";

function toBackupEntry(stored: StoredBackup): BackupEntry {
  return {
    filename: stored.filename,
    trigger: stored.trigger,
    createdAt: new Date(stored.createdAt),
    sizeBytes: stored.sizeBytes,
    checksum: stored.checksum,
  };
}

function normalizePageOptions(options: BackupPageOptions): BackupPageOptions {
  return {
    page: Math.max(1, Math.floor(options.page)),
    pageSize: Math.max(1, Math.floor(options.pageSize)),
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "filename" });
        store.createIndex(CREATED_AT_INDEX, "createdAt");
        return;
      }

      const store = request.transaction?.objectStore(STORE_NAME);
      if (store && !store.indexNames.contains(CREATED_AT_INDEX)) {
        store.createIndex(CREATED_AT_INDEX, "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withDB<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDB();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

class WebBackupAdapter implements BackupAdapter {
  async saveBackup(filename: string, sqlContent: string): Promise<void> {
    const entry: StoredBackup = {
      filename,
      sql: sqlContent,
      trigger: parseTriggerFromFilename(filename),
      createdAt: new Date().toISOString(),
      sizeBytes: new Blob([sqlContent]).size,
      checksum: await computeChecksum(sqlContent),
    };

    try {
      await withDB(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(entry);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          })
      );
    } catch (error) {
      // Handle IndexedDB quota exceeded — auto-prune oldest eligible backup and retry once
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        const backups = await this.listBackups();
        const oldest = [...backups].reverse().find((b) => {
          // Respect per-trigger minimums (don't delete if pre-sync/pre-restore has ≤2)
          const count = backups.filter((x) => x.trigger === b.trigger).length;
          if ((b.trigger === "pre-sync" || b.trigger === "pre-restore") && count <= 2) return false;
          return true;
        });
        if (!oldest) {
          throw new Error(STORAGE_FULL_MESSAGE);
        }
        await this.deleteBackup(oldest.filename);
        // Retry once
        try {
          await withDB(
            (db) =>
              new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, "readwrite");
                tx.objectStore(STORE_NAME).put(entry);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
              })
          );
        } catch {
          throw new Error(STORAGE_FULL_MESSAGE);
        }
      } else {
        throw error;
      }
    }
  }

  async listBackups(): Promise<BackupEntry[]> {
    return withDB(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const request = tx.objectStore(STORE_NAME).getAll();
          request.onsuccess = () => {
            const entries = (request.result as StoredBackup[]).map(toBackupEntry);
            // Sort newest first
            entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            resolve(entries);
          };
          request.onerror = () => reject(request.error);
        })
    );
  }

  async listBackupsPage(options: BackupPageOptions): Promise<BackupPage> {
    const { page, pageSize } = normalizePageOptions(options);

    const totalCount = await withDB(
      (db) =>
        new Promise<number>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const request = tx.objectStore(STORE_NAME).count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        })
    );

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const clampedPage = Math.min(page, totalPages);
    const offset = (clampedPage - 1) * pageSize;

    return withDB(
      (db) =>
        new Promise((resolve, reject) => {
          const entries: BackupEntry[] = [];
          let seen = 0;
          let totalSizeBytes = 0;
          const tx = db.transaction(STORE_NAME, "readonly");
          const request = tx
            .objectStore(STORE_NAME)
            .index(CREATED_AT_INDEX)
            .openCursor(null, "prev");

          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve({
                entries,
                totalCount,
                totalSizeBytes,
                page: clampedPage,
                pageSize,
              });
              return;
            }

            const stored = cursor.value as StoredBackup;
            if (seen >= offset && entries.length < pageSize) {
              entries.push(toBackupEntry(stored));
            }
            seen += 1;
            totalSizeBytes += stored.sizeBytes;
            cursor.continue();
          };
          request.onerror = () => reject(request.error);
        })
    );
  }

  async readBackup(filename: string): Promise<string> {
    const stored = await withDB<StoredBackup | undefined>(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const request = tx.objectStore(STORE_NAME).get(filename);
          request.onsuccess = () => resolve(request.result as StoredBackup | undefined);
          request.onerror = () => reject(request.error);
        })
    );

    if (!stored) {
      throw new Error(`Backup not found: ${filename}`);
    }

    const checksum = await computeChecksum(stored.sql);
    if (checksum !== stored.checksum) {
      throw new Error(`Backup checksum mismatch: ${filename}`);
    }

    return stored.sql;
  }

  async deleteBackup(filename: string): Promise<void> {
    await withDB(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).delete(filename);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }
}

export async function createWebBackup(): Promise<BackupAdapter> {
  return new WebBackupAdapter();
}
