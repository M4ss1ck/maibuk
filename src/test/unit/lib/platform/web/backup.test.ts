import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createWebBackup } from "../../../../../lib/platform/web/backup";
import type { BackupAdapter } from "../../../../../lib/platform/types";

describe("WebBackupAdapter", () => {
  let adapter: BackupAdapter;

  beforeEach(async () => {
    // Clear IndexedDB before each test
    indexedDB.deleteDatabase("maibuk-backups");
    adapter = await createWebBackup();
  });

  describe("saveBackup + listBackups", () => {
    it("saves a backup and lists it", async () => {
      await adapter.saveBackup(
        "maibuk-backup-launch-2026-03-15T14-30-00.sql",
        "INSERT INTO books ..."
      );

      const list = await adapter.listBackups();
      expect(list).toHaveLength(1);
      expect(list[0].filename).toBe("maibuk-backup-launch-2026-03-15T14-30-00.sql");
      expect(list[0].trigger).toBe("launch");
      expect(list[0].checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(list[0].sizeBytes).toBeGreaterThan(0);
      expect(list[0].createdAt).toBeInstanceOf(Date);
    });

    it("lists multiple backups sorted newest first", async () => {
      await adapter.saveBackup("maibuk-backup-launch-2026-03-15T14-30-00.sql", "sql1");
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await adapter.saveBackup("maibuk-backup-pre-sync-2026-03-15T14-30-10.sql", "sql2");

      const list = await adapter.listBackups();
      expect(list).toHaveLength(2);
      expect(list[0].filename).toBe("maibuk-backup-pre-sync-2026-03-15T14-30-10.sql");
      expect(list[1].filename).toBe("maibuk-backup-launch-2026-03-15T14-30-00.sql");
    });
  });

  describe("readBackup", () => {
    it("reads saved backup content", async () => {
      const sql = "INSERT INTO books (id) VALUES ('test');";
      await adapter.saveBackup("maibuk-backup-manual-2026-03-15T14-30-00.sql", sql);

      const content = await adapter.readBackup("maibuk-backup-manual-2026-03-15T14-30-00.sql");
      expect(content).toBe(sql);
    });

    it("throws on missing backup", async () => {
      await expect(adapter.readBackup("nonexistent.sql")).rejects.toThrow();
    });

    it("rejects corrupted backup content", async () => {
      const sql = "INSERT INTO books (id) VALUES ('test');";
      await adapter.saveBackup("maibuk-backup-manual-2026-03-15T14-30-00.sql", sql);

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("maibuk-backups", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("backups", "readwrite");
        tx.objectStore("backups").put({
          filename: "maibuk-backup-manual-2026-03-15T14-30-00.sql",
          sql: "CORRUPTED",
          trigger: "manual",
          createdAt: new Date().toISOString(),
          sizeBytes: 9,
          checksum: "deadbeef",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });

      await expect(adapter.readBackup("maibuk-backup-manual-2026-03-15T14-30-00.sql")).rejects.toThrow(/checksum/i);
    });
  });

  describe("deleteBackup", () => {
    it("deletes a backup", async () => {
      await adapter.saveBackup("maibuk-backup-launch-2026-03-15T14-30-00.sql", "sql");
      await adapter.deleteBackup("maibuk-backup-launch-2026-03-15T14-30-00.sql");

      const list = await adapter.listBackups();
      expect(list).toHaveLength(0);
    });

    it("returns a friendly error when quota retry still fails", async () => {
      const quotaError = new DOMException("Quota exceeded", "QuotaExceededError");
      let transactionCall = 0;
      const db = {
        close: vi.fn(),
        transaction: vi.fn().mockImplementation((_storeName: string, mode: string) => {
          transactionCall += 1;

          if (mode === "readonly") {
            const getAllRequest = {
              result: [
                {
                  filename: "maibuk-backup-launch-2026-03-15T14-25-00.sql",
                  sql: "old",
                  trigger: "launch",
                  createdAt: new Date().toISOString(),
                  sizeBytes: 3,
                  checksum: "abc",
                },
              ],
              onsuccess: null as null | (() => void),
              onerror: null as null | (() => void),
            };

            queueMicrotask(() => {
              getAllRequest.onsuccess?.();
            });

            return {
              objectStore: vi.fn().mockReturnValue({ getAll: vi.fn().mockReturnValue(getAllRequest) }),
            };
          }

          const shouldFailWrite = transactionCall === 1 || transactionCall === 4;
          const transaction = {
            objectStore: vi.fn().mockReturnValue({
              put: vi.fn(),
              delete: vi.fn(),
            }),
            oncomplete: null as null | (() => void),
            onerror: null as null | (() => void),
            error: shouldFailWrite ? quotaError : null,
          };

          queueMicrotask(() => {
            if (shouldFailWrite) {
              transaction.onerror?.();
              return;
            }
            transaction.oncomplete?.();
          });

          return transaction;
        }),
      };

      const openSpy = vi.spyOn(indexedDB, "open").mockImplementation(() => {
        const request = {
          result: db,
          error: null,
          onsuccess: null as null | (() => void),
          onerror: null as null | (() => void),
          onupgradeneeded: null as null | (() => void),
        } as unknown as IDBOpenDBRequest;

        queueMicrotask(() => {
          request.onsuccess?.(new Event("success"));
        });

        return request;
      });

      await expect(
        adapter.saveBackup("maibuk-backup-manual-2026-03-15T14-30-00.sql", "sql"),
      ).rejects.toThrow(/storage full/i);

      openSpy.mockRestore();
    });
  });
});
