import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BackupAdapter, BackupEntry } from "../../../../lib/platform/types";

const mockGenerateSqlDump = vi.hoisted(() => vi.fn());
const mockComputeChecksum = vi.hoisted(() => vi.fn());
const mockCreateBackup = vi.hoisted(() => vi.fn());
const mockGetDatabase = vi.hoisted(() => vi.fn());
const mockParseSqlStatements = vi.hoisted(() => vi.fn());
const mockLoadBooks = vi.hoisted(() => vi.fn());
const mockLoadChapters = vi.hoisted(() => vi.fn());
const mockBookState = vi.hoisted(() => ({
  books: [{ id: "book-1" }],
  loadBooks: mockLoadBooks,
}));
const mockChapterState = vi.hoisted(() => ({
  currentBookId: "book-1",
  loadChapters: mockLoadChapters,
}));

vi.mock("../../../../features/backup/generate-sql-dump", () => ({
  generateSqlDump: mockGenerateSqlDump,
}));

vi.mock("../../../../features/sync/crypto", () => ({
  computeChecksum: mockComputeChecksum,
}));

vi.mock("../../../../lib/platform", () => ({
  createBackup: mockCreateBackup,
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../lib/db/sql-parser", () => ({
  parseSqlStatements: mockParseSqlStatements,
}));

vi.mock("../../../../features/books/store", () => ({
  useBookStore: {
    getState: () => mockBookState,
    setState: vi.fn(),
  },
}));

vi.mock("../../../../features/chapters/store", () => ({
  useChapterStore: {
    getState: () => mockChapterState,
    setState: vi.fn(),
  },
}));

const { BackupService } = await import(
  "../../../../features/backup/backup-service"
);

function parseTriggerFromFilename(filename: string): BackupEntry["trigger"] {
  const match = filename.match(/^maibuk-backup-(launch|close|pre-sync|pre-restore|manual)-/);
  return match?.[1] as BackupEntry["trigger"] ?? "unknown";
}

function createMockAdapter(): BackupAdapter {
  const store = new Map<string, { sql: string; entry: BackupEntry }>();
  let counter = 0; // Deterministic timestamps to avoid flaky sort ordering
  return {
    saveBackup: vi.fn(async (filename, sql) => {
      store.set(filename, {
        sql,
        entry: {
          filename,
          trigger: parseTriggerFromFilename(filename),
          createdAt: new Date(Date.now() + counter++ * 1000),
          sizeBytes: sql.length,
          checksum: `hash:${sql}`,
        },
      });
    }),
    listBackups: vi.fn(async () => {
      return Array.from(store.values())
        .map((v) => v.entry)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }),
    readBackup: vi.fn(async (filename) => {
      const item = store.get(filename);
      if (!item) throw new Error("Not found");
      return item.sql;
    }),
    deleteBackup: vi.fn(async (filename) => {
      store.delete(filename);
    }),
  };
}

describe("BackupService", () => {
  let mockAdapter: BackupAdapter;
  let service: InstanceType<typeof BackupService>;
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    mockCreateBackup.mockResolvedValue(mockAdapter);
    mockGenerateSqlDump.mockResolvedValue("INSERT INTO books ...");
    mockComputeChecksum.mockResolvedValue("hash:INSERT INTO books ...");
    mockDb = {
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };
    mockGetDatabase.mockResolvedValue(mockDb);
    mockParseSqlStatements.mockReturnValue([]);
    mockBookState.books = [{ id: "book-1" }];
    mockLoadBooks.mockResolvedValue(undefined);
    mockLoadChapters.mockResolvedValue(undefined);
    service = new BackupService(mockAdapter);
  });

  describe("createBackup", () => {
    it("generates dump and saves with correct filename pattern", async () => {
      await service.createBackup("launch");

      expect(mockGenerateSqlDump).toHaveBeenCalled();
      expect(mockAdapter.saveBackup).toHaveBeenCalledWith(
        expect.stringMatching(/^maibuk-backup-launch-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sql$/),
        "INSERT INTO books ..."
      );
    });
  });

  describe("pruneBackups", () => {
    it("deletes oldest backup when over limit", async () => {
      // Use deterministic filenames via direct adapter calls
      await mockAdapter.saveBackup("maibuk-backup-launch-2026-03-15T10-00-00.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-launch-2026-03-15T10-00-01.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-launch-2026-03-15T10-00-02.sql", "sql");

      await service.pruneBackups(2);

      const list = await mockAdapter.listBackups();
      expect(list.length).toBe(2);
    });

    it("preserves at least 2 pre-sync and 2 pre-restore backups", async () => {
      await mockAdapter.saveBackup("maibuk-backup-pre-sync-2026-03-15T10-00-00.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-pre-sync-2026-03-15T10-00-01.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-pre-restore-2026-03-15T10-00-02.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-pre-restore-2026-03-15T10-00-03.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-launch-2026-03-15T10-00-04.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-launch-2026-03-15T10-00-05.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-launch-2026-03-15T10-00-06.sql", "sql");

      // Prune to 4 total — should delete launch backups, keep pre-sync and pre-restore
      await service.pruneBackups(4);

      const list = await mockAdapter.listBackups();
      const preSyncCount = list.filter((e) => e.trigger === "pre-sync").length;
      const preRestoreCount = list.filter((e) => e.trigger === "pre-restore").length;
      expect(preSyncCount).toBe(2);
      expect(preRestoreCount).toBe(2);
    });

    it("deletes from most-represented trigger type first", async () => {
      await mockAdapter.saveBackup("maibuk-backup-launch-2026-03-15T10-00-00.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-launch-2026-03-15T10-00-01.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-launch-2026-03-15T10-00-02.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-manual-2026-03-15T10-00-03.sql", "sql");

      await service.pruneBackups(2);

      const list = await mockAdapter.listBackups();
      // Should have deleted launch backups first (most represented), keeping manual
      const launchCount = list.filter((e) => e.trigger === "launch").length;
      const manualCount = list.filter((e) => e.trigger === "manual").length;
      expect(manualCount).toBe(1);
      expect(launchCount).toBe(1);
    });
  });

  describe("verifyBackup", () => {
    it("returns true for valid checksum", async () => {
      await service.createBackup("manual");
      const list = await mockAdapter.listBackups();
      mockComputeChecksum.mockResolvedValue(list[0].checksum);

      const valid = await service.verifyBackup(list[0].filename);
      expect(valid).toBe(true);
    });

    it("returns false for mismatched checksum", async () => {
      await service.createBackup("manual");
      const list = await mockAdapter.listBackups();
      mockComputeChecksum.mockResolvedValue("different-hash");

      const valid = await service.verifyBackup(list[0].filename);
      expect(valid).toBe(false);
    });
  });

  describe("restoreBackup", () => {
    it("creates a pre-restore backup before reading the target backup", async () => {
      const calls: string[] = [];
      mockAdapter.saveBackup = vi.fn(async () => {
        calls.push("saveBackup");
      });
      mockAdapter.readBackup = vi.fn(async () => {
        calls.push("readBackup");
        throw new Error("Backup checksum mismatch");
      });

      await expect(service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql")).rejects.toThrow(
        "BACKUP_CORRUPT",
      );

      expect(calls).toEqual(["saveBackup", "readBackup"]);
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("does not mutate data when no restoreable statements exist", async () => {
      mockAdapter.readBackup = vi.fn(async () => "INSERT INTO settings VALUES ('x');");
      mockParseSqlStatements.mockReturnValue(["INSERT INTO settings VALUES ('x')"]);

      await expect(service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql")).rejects.toThrow(
        "RESTORE_INVALID",
      );

      expect(mockDb.execute).not.toHaveBeenCalledWith("BEGIN");
      expect(mockLoadBooks).not.toHaveBeenCalled();
      expect(mockLoadChapters).not.toHaveBeenCalled();
    });

    it("restores books and chapters and reloads stores", async () => {
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockReturnValue([
        'INSERT INTO "books" VALUES ("book-1")',
        'INSERT INTO "chapters" VALUES ("chapter-1")',
        'INSERT INTO "settings" VALUES ("ignored")',
      ]);

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      expect(mockDb.execute).toHaveBeenNthCalledWith(1, "BEGIN");
      expect(mockDb.execute).toHaveBeenNthCalledWith(2, "DELETE FROM chapters");
      expect(mockDb.execute).toHaveBeenNthCalledWith(3, "DELETE FROM books");
      expect(mockDb.execute).toHaveBeenNthCalledWith(4, 'INSERT INTO "books" VALUES ("book-1")');
      expect(mockDb.execute).toHaveBeenNthCalledWith(5, 'INSERT INTO "chapters" VALUES ("chapter-1")');
      expect(mockDb.execute).toHaveBeenNthCalledWith(6, "COMMIT");
      expect(mockLoadBooks).toHaveBeenCalled();
      expect(mockLoadChapters).toHaveBeenCalledWith("book-1");
    });

    it("rolls back if restore statements fail", async () => {
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockReturnValue(['INSERT INTO "books" VALUES ("book-1")']);
      mockDb.execute
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockRejectedValueOnce(new Error("insert failed"))
        .mockResolvedValueOnce({ rowsAffected: 1 });

      await expect(service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql")).rejects.toThrow(
        "RESTORE_FAILED",
      );

      expect(mockDb.execute).toHaveBeenCalledWith("ROLLBACK");
      expect(mockLoadBooks).not.toHaveBeenCalled();
    });
  });
});
