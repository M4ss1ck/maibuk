import type { BackupAdapter, BackupEntry } from "../types";
import { computeChecksum } from "../../checksum";
import { parseTriggerFromFilename } from "../../../features/backup/utils";

const DB_NAME = "maibuk-backups";
const DB_VERSION = 1;
const STORE_NAME = "backups";

interface StoredBackup {
  filename: string;
  sql: string;
  trigger: BackupEntry["trigger"];
  createdAt: string;
  sizeBytes: number;
  checksum: string;
}

const STORAGE_FULL_MESSAGE = "Backup storage full. Delete old backups in Settings or reduce retention limit.";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "filename" });
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
      await withDB((db) => new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }));
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
          await withDB((db) => new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(entry);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          }));
        } catch {
          throw new Error(STORAGE_FULL_MESSAGE);
        }
      } else {
        throw error;
      }
    }
  }

  async listBackups(): Promise<BackupEntry[]> {
    return withDB((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const entries = (request.result as StoredBackup[]).map((stored) => ({
          filename: stored.filename,
          trigger: stored.trigger,
          createdAt: new Date(stored.createdAt),
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
        }));
        // Sort newest first
        entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        resolve(entries);
      };
      request.onerror = () => reject(request.error);
    }));
  }

  async readBackup(filename: string): Promise<string> {
    const stored = await withDB<StoredBackup | undefined>((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(filename);
      request.onsuccess = () => resolve(request.result as StoredBackup | undefined);
      request.onerror = () => reject(request.error);
    }));

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
    await withDB((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(filename);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
}

export async function createWebBackup(): Promise<BackupAdapter> {
  return new WebBackupAdapter();
}
