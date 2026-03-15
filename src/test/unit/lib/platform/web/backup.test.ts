import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
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
        "INSERT INTO books ...",
        "launch",
        "abc123"
      );

      const list = await adapter.listBackups();
      expect(list).toHaveLength(1);
      expect(list[0].filename).toBe("maibuk-backup-launch-2026-03-15T14-30-00.sql");
      expect(list[0].trigger).toBe("launch");
      expect(list[0].checksum).toBe("abc123");
      expect(list[0].sizeBytes).toBeGreaterThan(0);
      expect(list[0].createdAt).toBeInstanceOf(Date);
    });

    it("lists multiple backups sorted newest first", async () => {
      await adapter.saveBackup("backup-1.sql", "sql1", "launch", "c1");
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await adapter.saveBackup("backup-2.sql", "sql2", "pre-sync", "c2");

      const list = await adapter.listBackups();
      expect(list).toHaveLength(2);
      expect(list[0].filename).toBe("backup-2.sql");
      expect(list[1].filename).toBe("backup-1.sql");
    });
  });

  describe("readBackup", () => {
    it("reads saved backup content", async () => {
      const sql = "INSERT INTO books (id) VALUES ('test');";
      await adapter.saveBackup("test.sql", sql, "manual", "hash");

      const content = await adapter.readBackup("test.sql");
      expect(content).toBe(sql);
    });

    it("throws on missing backup", async () => {
      await expect(adapter.readBackup("nonexistent.sql")).rejects.toThrow();
    });
  });

  describe("deleteBackup", () => {
    it("deletes a backup", async () => {
      await adapter.saveBackup("to-delete.sql", "sql", "launch", "hash");
      await adapter.deleteBackup("to-delete.sql");

      const list = await adapter.listBackups();
      expect(list).toHaveLength(0);
    });
  });
});
