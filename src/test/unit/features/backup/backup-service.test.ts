import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BackupAdapter, BackupEntry } from "@/lib/platform/types";
import { parseTriggerFromFilename } from "@/features/backup/utils";

const mockGenerateSqlDump = vi.hoisted(() => vi.fn());
const mockCreateBackup = vi.hoisted(() => vi.fn());
const mockGetDatabase = vi.hoisted(() => vi.fn());
const mockParseSqlStatements = vi.hoisted(() => vi.fn());
const mockLoadBooks = vi.hoisted(() => vi.fn());
const mockLoadChapters = vi.hoisted(() => vi.fn());
const mockLoadNotes = vi.hoisted(() => vi.fn());
const mockLoadCanvases = vi.hoisted(() => vi.fn());
const mockSetChapterState = vi.hoisted(() => vi.fn());
const mockBookState = vi.hoisted(() => ({
  books: [{ id: "book-1" }],
  loadBooks: mockLoadBooks,
}));
const mockChapterState = vi.hoisted(
  (): { currentBookId: string | null; loadChapters: typeof mockLoadChapters } => ({
    currentBookId: "book-1",
    loadChapters: mockLoadChapters,
  })
);

vi.mock("../../../../features/backup/generate-sql-dump", () => ({
  generateSqlDump: mockGenerateSqlDump,
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
    setState: mockSetChapterState,
  },
}));

vi.mock("../../../../features/notes/store", () => ({
  useNoteStore: { getState: () => ({ loadNotes: mockLoadNotes }) },
}));

vi.mock("../../../../features/canvas/store", () => ({
  useCanvasStore: { getState: () => ({ loadCanvases: mockLoadCanvases }) },
}));

const { BackupService } = await import("@/features/backup/backup-service");

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
    listBackupsPage: vi.fn(async ({ page, pageSize }) => {
      const entries = Array.from(store.values())
        .map((v) => v.entry)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
      const clampedPage = Math.min(Math.max(1, page), totalPages);
      return {
        entries: entries.slice((clampedPage - 1) * pageSize, clampedPage * pageSize),
        totalCount: entries.length,
        totalSizeBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        page: clampedPage,
        pageSize,
      };
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
    mockDb = {
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };
    mockGetDatabase.mockResolvedValue(mockDb);
    mockParseSqlStatements.mockImplementation((sql: string) => {
      if (sql === "INSERT INTO books ...") {
        return ["INSERT INTO books ..."];
      }
      return [];
    });
    mockBookState.books = [{ id: "book-1" }];
    mockChapterState.currentBookId = "book-1";
    mockLoadBooks.mockResolvedValue(undefined);
    mockLoadChapters.mockResolvedValue(undefined);
    mockLoadNotes.mockResolvedValue(undefined);
    mockLoadCanvases.mockResolvedValue(undefined);
    service = new BackupService(mockAdapter);
  });

  describe("createBackup", () => {
    it("generates dump and saves with correct filename pattern", async () => {
      await service.createBackup("daily");

      expect(mockGenerateSqlDump).toHaveBeenCalled();
      expect(mockAdapter.saveBackup).toHaveBeenCalledWith(
        expect.stringMatching(/^maibuk-backup-daily-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sql$/),
        "INSERT INTO books ..."
      );
    });

    it("creates a close backup whose listed trigger is preserved", async () => {
      await service.createBackup("close");

      expect(mockAdapter.saveBackup).toHaveBeenCalledWith(
        expect.stringMatching(/^maibuk-backup-close-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sql$/),
        "INSERT INTO books ..."
      );
      await expect(service.listBackups()).resolves.toEqual([
        expect.objectContaining({ trigger: "close" }),
      ]);
    });

    it("throws BACKUP_EMPTY when dump contains no INSERT statements", async () => {
      mockGenerateSqlDump.mockResolvedValue(
        "-- Maibuk Database Export (SQL Dump)\n-- Exported at: 2026-03-15\n\n-- Books\n\n-- Chapters\n"
      );

      await expect(service.createBackup("daily")).rejects.toThrow("BACKUP_EMPTY");
      expect(mockAdapter.saveBackup).not.toHaveBeenCalled();
    });

    it("throws BACKUP_EMPTY when dump is an empty string", async () => {
      mockGenerateSqlDump.mockResolvedValue("");

      await expect(service.createBackup("manual")).rejects.toThrow("BACKUP_EMPTY");
      expect(mockAdapter.saveBackup).not.toHaveBeenCalled();
    });
  });

  it("parses the close trigger from a managed filename", () => {
    expect(parseTriggerFromFilename("maibuk-backup-close-2026-03-15T14-30-00.sql")).toBe("close");
  });

  describe("deleteByTrigger", () => {
    it("removes all backups matching the given trigger", async () => {
      await mockAdapter.saveBackup("maibuk-backup-pre-sync-2026-03-15T10-00-00.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-pre-sync-2026-03-15T10-00-01.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-02.sql", "sql");

      await service.deleteByTrigger("pre-sync");

      const list = await mockAdapter.listBackups();
      expect(list.length).toBe(1);
      expect(list[0].trigger).toBe("daily");
    });

    it("does nothing when no backups match the trigger", async () => {
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-00.sql", "sql");

      await service.deleteByTrigger("pre-sync");

      const list = await mockAdapter.listBackups();
      expect(list.length).toBe(1);
    });
  });

  describe("pruneBackups", () => {
    it("deletes oldest backup when over limit", async () => {
      // Use deterministic filenames via direct adapter calls
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-00.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-01.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-02.sql", "sql");

      await service.pruneBackups(2);

      const list = await mockAdapter.listBackups();
      expect(list.length).toBe(2);
    });

    it("treats close backups as unprotected prune candidates", async () => {
      await mockAdapter.saveBackup("maibuk-backup-close-2026-03-15T10-00-00.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-pre-sync-2026-03-15T10-00-01.sql", "sql");

      await service.pruneBackups(1);

      const list = await mockAdapter.listBackups();
      expect(list).toHaveLength(1);
      expect(list[0].trigger).toBe("pre-sync");
    });

    it("preserves at least 2 pre-sync and 2 pre-restore backups", async () => {
      await mockAdapter.saveBackup("maibuk-backup-pre-sync-2026-03-15T10-00-00.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-pre-sync-2026-03-15T10-00-01.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-pre-restore-2026-03-15T10-00-02.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-pre-restore-2026-03-15T10-00-03.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-04.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-05.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-06.sql", "sql");

      // Prune to 4 total — should delete daily backups, keep pre-sync and pre-restore
      await service.pruneBackups(4);

      const list = await mockAdapter.listBackups();
      const preSyncCount = list.filter((e) => e.trigger === "pre-sync").length;
      const preRestoreCount = list.filter((e) => e.trigger === "pre-restore").length;
      expect(preSyncCount).toBe(2);
      expect(preRestoreCount).toBe(2);
    });

    it("deletes from most-represented trigger type first", async () => {
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-00.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-01.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-02.sql", "sql");
      await mockAdapter.saveBackup("maibuk-backup-manual-2026-03-15T10-00-03.sql", "sql");

      await service.pruneBackups(2);

      const list = await mockAdapter.listBackups();
      // Should have deleted daily backups first (most represented), keeping manual
      const dailyCount = list.filter((e) => e.trigger === "daily").length;
      const manualCount = list.filter((e) => e.trigger === "manual").length;
      expect(manualCount).toBe(1);
      expect(dailyCount).toBe(1);
    });
  });

  describe("hasBackupForToday", () => {
    it("returns true when a backup with the trigger exists for today", async () => {
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "-");
      const filename = `maibuk-backup-daily-${todayStr}T10-00-00.sql`;
      await mockAdapter.saveBackup(filename, "INSERT INTO books ...");

      const result = await service.hasBackupForToday("daily");
      expect(result).toBe(true);
    });

    it("returns false when no backup with the trigger exists for today", async () => {
      const result = await service.hasBackupForToday("daily");
      expect(result).toBe(false);
    });

    it("returns false when today has a different trigger", async () => {
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "-");
      const filename = `maibuk-backup-manual-${todayStr}T10-00-00.sql`;
      await mockAdapter.saveBackup(filename, "INSERT INTO books ...");

      const result = await service.hasBackupForToday("daily");
      expect(result).toBe(false);
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

      await expect(
        service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql")
      ).rejects.toThrow("BACKUP_CORRUPT");

      expect(calls).toEqual(["saveBackup", "readBackup"]);
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("does not mutate data when no restoreable statements exist", async () => {
      mockAdapter.readBackup = vi.fn(async () => "INSERT INTO settings VALUES ('x');");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "INSERT INTO books ...") {
          return [];
        }
        return ["INSERT INTO settings VALUES ('x')"];
      });

      await expect(
        service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql")
      ).rejects.toThrow("RESTORE_INVALID");

      expect(mockDb.execute).not.toHaveBeenCalled();
      expect(mockLoadBooks).not.toHaveBeenCalled();
      expect(mockLoadChapters).not.toHaveBeenCalled();
    });

    it("restores books and chapters and reloads stores", async () => {
      mockChapterState.currentBookId = "book-1";
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "INSERT INTO books ...") {
          return [];
        }
        if (sql === "restore sql") {
          return [
            'INSERT INTO "books" VALUES ("book-1")',
            'INSERT OR REPLACE INTO "chapters" VALUES ("chapter-1")',
            'INSERT INTO "chapters" VALUES ("chapter-1")',
            'INSERT INTO "settings" VALUES ("ignored")',
          ];
        }
        return [];
      });

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      expect(mockDb.execute).toHaveBeenNthCalledWith(1, "DELETE FROM chapters");
      expect(mockDb.execute).toHaveBeenNthCalledWith(2, "DELETE FROM book_versions");
      expect(mockDb.execute).toHaveBeenNthCalledWith(3, "DELETE FROM books");
      expect(mockDb.execute).toHaveBeenNthCalledWith(4, "DELETE FROM notes");
      expect(mockDb.execute).toHaveBeenNthCalledWith(5, "DELETE FROM canvases");
      expect(mockDb.execute).toHaveBeenNthCalledWith(6, "DELETE FROM sync_tombstones");
      expect(mockDb.execute).toHaveBeenNthCalledWith(7, 'INSERT INTO "books" VALUES ("book-1")');
      expect(mockDb.execute).toHaveBeenNthCalledWith(
        8,
        'INSERT OR REPLACE INTO "chapters" VALUES ("chapter-1")'
      );
      expect(mockDb.execute).toHaveBeenNthCalledWith(
        9,
        'INSERT INTO "chapters" VALUES ("chapter-1")'
      );
      expect(mockDb.execute).toHaveBeenCalledTimes(9);
      expect(mockLoadBooks).toHaveBeenCalled();
      expect(mockLoadNotes).toHaveBeenCalled();
      expect(mockLoadCanvases).toHaveBeenCalled();
      expect(mockLoadChapters).toHaveBeenCalledWith("book-1");
    });

    it("clears chapter state when current book is absent from restored data", async () => {
      mockChapterState.currentBookId = "deleted-book";
      mockBookState.books = [{ id: "book-1" }];
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "restore sql") {
          return ['INSERT INTO "books" VALUES ("book-1")'];
        }
        return [];
      });

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      expect(mockLoadChapters).not.toHaveBeenCalled();
      expect(mockSetChapterState).toHaveBeenCalledWith({
        chapters: [],
        currentChapter: null,
        currentBookId: null,
        isLoading: false,
        error: null,
      });
    });

    it("clears chapter state when there was no current book", async () => {
      mockChapterState.currentBookId = null;
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "restore sql") {
          return ['INSERT INTO "books" VALUES ("book-1")'];
        }
        return [];
      });

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      expect(mockLoadChapters).not.toHaveBeenCalled();
      expect(mockSetChapterState).toHaveBeenCalled();
    });

    it("rejects statements that target restore tables without a values clause", async () => {
      mockAdapter.readBackup = vi.fn(async () => 'INSERT INTO "books" SET id = 1');
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === 'INSERT INTO "books" SET id = 1') {
          return ['INSERT INTO "books" SET id = 1'];
        }
        return [];
      });

      await expect(
        service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql")
      ).rejects.toThrow("RESTORE_INVALID");

      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("accepts insert or replace statements for restore tables", async () => {
      mockChapterState.currentBookId = "book-1";
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "restore sql") {
          return ['INSERT OR REPLACE INTO "books" VALUES ("book-1")'];
        }
        return [];
      });

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      expect(mockDb.execute).toHaveBeenCalledWith(
        'INSERT OR REPLACE INTO "books" VALUES ("book-1")'
      );
    });

    it("surfaces statement-level error when an INSERT fails", async () => {
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "restore sql") {
          return ['INSERT INTO "books" VALUES ("book-1")'];
        }
        return [];
      });
      mockDb.execute
        .mockResolvedValueOnce({ rowsAffected: 1 }) // DELETE FROM chapters
        .mockResolvedValueOnce({ rowsAffected: 1 }) // DELETE FROM book_versions
        .mockResolvedValueOnce({ rowsAffected: 1 }) // DELETE FROM books
        .mockResolvedValueOnce({ rowsAffected: 1 }) // DELETE FROM notes
        .mockResolvedValueOnce({ rowsAffected: 1 }) // DELETE FROM canvases
        .mockResolvedValueOnce({ rowsAffected: 1 }) // DELETE FROM sync_tombstones
        .mockRejectedValueOnce(new Error("UNIQUE constraint failed")); // INSERT fails

      await expect(
        service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql")
      ).rejects.toThrow(
        "RESTORE_FAILED: Restore failed on statement 1/1: UNIQUE constraint failed"
      );

      expect(mockDb.execute).toHaveBeenCalledTimes(7);
      expect(mockLoadBooks).not.toHaveBeenCalled();
    });

    it("normalizes and restores valid canvas documents", async () => {
      const doc = JSON.stringify({
        schemaVersion: 1,
        nodes: [],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 2 },
      });
      const statement = `INSERT INTO "canvases" ("id", "title", "doc", "pinned", "order", "created_at", "updated_at", "content_updated_at") VALUES ('canvas-1', 'Map', '${doc}', 0, 0, 1, 1, 1)`;
      const normalizedDoc = JSON.stringify({
        schemaVersion: 2,
        nodes: [],
        edges: [],
        strokes: [],
        viewport: { x: 10, y: 20, zoom: 2 },
      });
      const normalizedStatement = `INSERT INTO "canvases" ("id", "title", "doc", "pinned", "order", "created_at", "updated_at", "content_updated_at") VALUES ('canvas-1', 'Map', '${normalizedDoc}', 0, 0, 1, 1, 1)`;
      mockAdapter.readBackup = vi.fn(async () => "restore canvas");
      mockParseSqlStatements.mockImplementation((sql: string) =>
        sql === "restore canvas" ? [statement] : []
      );

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      expect(mockDb.execute).toHaveBeenCalledWith(normalizedStatement);
      expect(mockLoadCanvases).toHaveBeenCalled();
    });

    it("rejects corrupt canvas documents before deleting existing data", async () => {
      const statement = `INSERT INTO "canvases" ("id", "title", "doc", "pinned", "order", "created_at", "updated_at", "content_updated_at") VALUES ('canvas-1', 'Map', '{', 0, 0, 1, 1, 1)`;
      mockAdapter.readBackup = vi.fn(async () => "restore corrupt canvas");
      mockParseSqlStatements.mockImplementation((sql: string) =>
        sql === "restore corrupt canvas" ? [statement] : []
      );

      await expect(
        service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql")
      ).rejects.toThrow("RESTORE_INVALID");

      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("skips pre-restore snapshot when current database is empty but still restores", async () => {
      // generateSqlDump returns comment-only dump (empty DB)
      mockGenerateSqlDump.mockResolvedValue(
        "-- Maibuk Database Export\n-- Exported at: 2026-03-15\n\n-- Books\n\n-- Chapters\n"
      );
      mockChapterState.currentBookId = "book-1";
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "restore sql") {
          return ['INSERT INTO "books" VALUES ("book-1")'];
        }
        return [];
      });

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      // Should NOT have saved a useless pre-restore backup
      expect(mockAdapter.saveBackup).not.toHaveBeenCalled();
      // But restore should still proceed
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM chapters");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM book_versions");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM books");
      expect(mockDb.execute).toHaveBeenCalledWith('INSERT INTO "books" VALUES ("book-1")');
      expect(mockLoadBooks).toHaveBeenCalled();
    });

    it("accepts INSERT INTO book_versions and still rejects non-allowlisted tables", async () => {
      mockChapterState.currentBookId = "book-1";
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "restore sql") {
          return [
            'INSERT INTO "book_versions" VALUES ("ver-1")',
            'INSERT INTO "unknown_table" VALUES ("x")',
            'INSERT INTO "settings" VALUES ("y")',
          ];
        }
        return [];
      });

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      expect(mockDb.execute).toHaveBeenCalledWith('INSERT INTO "book_versions" VALUES ("ver-1")');
      expect(mockDb.execute).not.toHaveBeenCalledWith('INSERT INTO "unknown_table" VALUES ("x")');
      expect(mockDb.execute).not.toHaveBeenCalledWith('INSERT INTO "settings" VALUES ("y")');
    });

    it("deletes stale book_versions before inserting restored ones", async () => {
      mockChapterState.currentBookId = "book-1";
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "restore sql") {
          return [
            'INSERT INTO "book_versions" VALUES ("ver-1")',
            'INSERT INTO "book_versions" VALUES ("ver-2")',
          ];
        }
        return [];
      });

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      const calls = mockDb.execute.mock.calls.map((c) => c[0] as string);
      const deleteIndex = calls.indexOf("DELETE FROM book_versions");
      const insertIndices = [
        calls.indexOf('INSERT INTO "book_versions" VALUES ("ver-1")'),
        calls.indexOf('INSERT INTO "book_versions" VALUES ("ver-2")'),
      ];
      expect(deleteIndex).toBeGreaterThanOrEqual(0);
      expect(insertIndices[0]).toBeGreaterThan(deleteIndex);
      expect(insertIndices[1]).toBeGreaterThan(deleteIndex);
    });

    it("restores cleanly when backup contains no book_versions INSERTs", async () => {
      mockChapterState.currentBookId = "book-1";
      mockAdapter.readBackup = vi.fn(async () => "restore sql");
      mockParseSqlStatements.mockImplementation((sql: string) => {
        if (sql === "restore sql") {
          return ['INSERT INTO "books" VALUES ("book-1")'];
        }
        return [];
      });

      await service.restoreBackup("maibuk-backup-manual-2026-03-15T10-00-00.sql");

      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM book_versions");
      expect(mockDb.execute).toHaveBeenCalledWith('INSERT INTO "books" VALUES ("book-1")');
      expect(mockLoadBooks).toHaveBeenCalled();
    });
  });
});
