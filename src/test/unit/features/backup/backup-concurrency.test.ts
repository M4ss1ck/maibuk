import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BackupAdapter, BackupEntry } from "@/lib/platform/types";
import { parseTriggerFromFilename } from "@/features/backup/utils";

const mockGenerateSqlDump = vi.hoisted(() => vi.fn());
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

vi.mock("@/features/backup/generate-sql-dump", () => ({
  generateSqlDump: mockGenerateSqlDump,
}));

vi.mock("@/lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("@/lib/db/sql-parser", () => ({
  parseSqlStatements: mockParseSqlStatements,
}));

vi.mock("@/features/books/store", () => ({
  useBookStore: {
    getState: () => mockBookState,
    setState: vi.fn(),
  },
}));

vi.mock("@/features/chapters/store", () => ({
  useChapterStore: {
    getState: () => mockChapterState,
    setState: mockSetChapterState,
  },
}));

vi.mock("@/features/notes/store", () => ({
  useNoteStore: { getState: () => ({ loadNotes: mockLoadNotes }) },
}));

vi.mock("@/features/canvas/store", () => ({
  useCanvasStore: { getState: () => ({ loadCanvases: mockLoadCanvases }) },
}));

const { BackupService, resetBackupQueueForTests } = await import(
  "@/features/backup/backup-service"
);

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

describe("BackupService concurrency — shared write queue", () => {
  let mockAdapter: BackupAdapter;
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    resetBackupQueueForTests();
    mockAdapter = createMockAdapter();
    mockGenerateSqlDump.mockResolvedValue("INSERT INTO books ...");
    mockDb = {
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };
    mockGetDatabase.mockResolvedValue(mockDb);
    mockParseSqlStatements.mockImplementation((sql: string) => [sql]);
    mockBookState.books = [{ id: "book-1" }];
    mockChapterState.currentBookId = "book-1";
    mockLoadBooks.mockResolvedValue(undefined);
    mockLoadChapters.mockResolvedValue(undefined);
    mockLoadNotes.mockResolvedValue(undefined);
    mockLoadCanvases.mockResolvedValue(undefined);
  });

  it("serializes concurrent createBackup calls across service instances", async () => {
    let active = 0;
    let maxActive = 0;
    mockGenerateSqlDump.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return "INSERT INTO books ...";
    });

    // A background backup and a pre-sync backup racing from separate
    // instances must not interleave their dump-and-save work.
    const background = new BackupService(mockAdapter);
    const preSync = new BackupService(mockAdapter);
    await Promise.all([background.createBackup("close"), preSync.createBackup("pre-sync")]);

    expect(maxActive).toBe(1);
    expect(mockAdapter.saveBackup).toHaveBeenCalledTimes(2);
  });

  it("keeps restore pre-backup before read when racing a concurrent create", async () => {
    const target = "maibuk-backup-manual-2026-03-15T10-00-00.sql";
    await mockAdapter.saveBackup(target, "TARGET SQL");
    mockParseSqlStatements.mockImplementation((sql: string) => {
      if (sql === "TARGET SQL") return [`INSERT INTO "books" (id) VALUES ('x')`];
      return [sql];
    });
    mockGenerateSqlDump.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "INSERT INTO books ...";
    });

    const order: string[] = [];
    const rawSave = mockAdapter.saveBackup;
    mockAdapter.saveBackup = vi.fn(async (filename: string, sql: string) => {
      order.push(`save:${parseTriggerFromFilename(filename)}`);
      return rawSave(filename, sql);
    });
    const rawRead = mockAdapter.readBackup;
    mockAdapter.readBackup = vi.fn(async (filename: string) => {
      order.push(`read:${filename}`);
      return rawRead(filename);
    });

    const creator = new BackupService(mockAdapter);
    const restorer = new BackupService(mockAdapter);
    await Promise.all([creator.createBackup("daily"), restorer.restoreBackup(target)]);

    // The create finished before the restore's pre-restore backup, which
    // precedes the restore's read of the target.
    expect(order).toEqual(["save:daily", "save:pre-restore", `read:${target}`]);
    expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM chapters");
  });

  it("leaves data untouched on restore failure and releases the queue", async () => {
    const target = "maibuk-backup-manual-2026-03-15T10-00-00.sql";
    await mockAdapter.saveBackup(target, "TARGET SQL");
    mockAdapter.readBackup = vi.fn(async () => {
      throw new Error("Backup checksum mismatch");
    });

    const service = new BackupService(mockAdapter);
    await expect(service.restoreBackup(target)).rejects.toThrow("BACKUP_CORRUPT");
    expect(mockDb.execute).not.toHaveBeenCalled();

    // The failed restore must not block later backup work.
    await expect(service.createBackup("daily")).resolves.toMatch(
      /^maibuk-backup-daily-.*\.sql$/
    );
  });

  it("completes concurrent delete, prune and create writes without deadlock", async () => {
    await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-00.sql", "sql");
    await mockAdapter.saveBackup("maibuk-backup-daily-2026-03-15T10-00-01.sql", "sql");
    await mockAdapter.saveBackup("maibuk-backup-manual-2026-03-15T10-00-02.sql", "sql");

    const deleter = new BackupService(mockAdapter);
    const pruner = new BackupService(mockAdapter);
    const creator = new BackupService(mockAdapter);
    await Promise.all([
      deleter.deleteByTrigger("daily"),
      pruner.pruneBackups(2),
      creator.createBackup("manual"),
    ]);

    const list = await mockAdapter.listBackups();
    expect(list.filter((e) => e.trigger === "daily")).toHaveLength(0);
    expect(list.filter((e) => e.trigger === "manual")).toHaveLength(2);
  });
});
