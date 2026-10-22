import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import type { BookSnapshot } from "@/features/sync/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { retainVersions } from "@/features/versions/retention";
import {
  insertSplitVersionStatements,
  readVersionSnapshot,
  type VersionRowInput,
} from "@/features/versions/content-store";
import {
  UPGRADE_BATCH_SIZE,
  UpgradeBackupError,
  scheduleVersionStorageUpgrade,
  settleVersionStorageUpgradeForTests,
  upgradeVersionStorage,
} from "@/features/versions/upgrade";
import "@/i18n";
import { toast } from "@/components/ui/Toast";
import { emitChange, resetChangeFeedForTests } from "@/features/sync/change-feed";
import { hasLaunchBackupSettled, onLaunchBackupSettled } from "@/features/backup/lifecycle";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";

const { mockGetDatabase, mockCreateBackup, mockServiceCreateBackup } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockCreateBackup: vi.fn(async () => ({})),
  mockServiceCreateBackup: vi.fn(async () => "pre-restore.sql"),
}));

vi.mock("@/lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  createBackup: mockCreateBackup,
}));

vi.mock("@/features/backup/backup-service", () => ({
  BackupService: class {
    createBackup = mockServiceCreateBackup;
  },
}));

vi.mock("@/features/backup/lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/backup/lifecycle")>()),
  hasLaunchBackupSettled: vi.fn(() => false),
  onLaunchBackupSettled: vi.fn(() => () => {}),
}));

vi.mock("@/features/tutorial/library-switch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/tutorial/library-switch")>()),
  isTutorialLibraryActive: vi.fn(() => false),
}));

// Retention bins are UTC days, so every seeded age is measured from this instant.
const NOW_MS = Date.UTC(2026, 9, 22, 12, 0, 0);
const NOW = Math.floor(NOW_MS / 1000);
const DAY = 24 * 60 * 60;

interface SeededVersion {
  id: string;
  bookId: string;
  triggerType: string;
  createdAt: number;
}

/** A Book with two Chapters; content embeds the bookId so each Book's text hashes differently. */
function makeSnapshot(bookId: string): BookSnapshot {
  return {
    book: {
      id: bookId,
      title: "Test Book",
      subtitle: null,
      authorName: "Author",
      description: null,
      genre: null,
      language: "en",
      coverImagePath: null,
      coverData: null,
      wordCount: 2000,
      targetWordCount: null,
      status: "draft",
      createdAt: 1000,
      updatedAt: 1000,
      lastOpenedAt: null,
      lastChapterId: null,
    },
    chapters: [
      {
        id: `${bookId}-ch-1`,
        bookId,
        title: "One",
        content: `<p>${bookId} one</p>`,
        synopsis: null,
        order: 0,
        parentId: null,
        chapterType: "chapter",
        wordCount: 1000,
        status: "draft",
        isIncludedInExport: true,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: `${bookId}-ch-2`,
        bookId,
        title: "Two",
        content: `<p>${bookId} two</p>`,
        synopsis: null,
        order: 1,
        parentId: null,
        chapterType: "chapter",
        wordCount: 1000,
        status: "draft",
        isIncludedInExport: true,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
  };
}

describe("upgradeVersionStorage", () => {
  let testDb: DatabaseAdapter;

  async function seedBook(bookId: string): Promise<void> {
    await testDb.execute(
      "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [bookId, "Test Book", "Author", NOW, NOW]
    );
  }

  /** A legacy inline Version: the whole Book as JSON in `snapshot`, format 'inline' by default. */
  async function seedInline(
    row: Omit<SeededVersion, "bookId"> & { bookId?: string; snapshot?: BookSnapshot }
  ): Promise<SeededVersion> {
    const bookId = row.bookId ?? "book-1";
    await testDb.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        bookId,
        null,
        JSON.stringify(row.snapshot ?? makeSnapshot(bookId)),
        2000,
        `chk-${row.id}`,
        row.triggerType,
        row.createdAt,
        null,
      ]
    );
    return { id: row.id, bookId, triggerType: row.triggerType, createdAt: row.createdAt };
  }

  /** A split Version written by the real store path, so its manifest rows exist. */
  async function seedSplit(row: SeededVersion): Promise<void> {
    const input: VersionRowInput = {
      id: row.id,
      bookId: row.bookId,
      name: null,
      wordCount: 2000,
      checksum: `chk-${row.id}`,
      triggerType: row.triggerType,
      createdAt: row.createdAt,
      syncedAt: null,
    };
    await testDb.executeAtomic(
      await insertSplitVersionStatements(testDb, input, makeSnapshot(row.bookId))
    );
  }

  async function counts(): Promise<{ total: number; inline: number; blobs: number }> {
    const [row] = await testDb.select<{ total: number; inline: number }[]>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN format = 'inline' THEN 1 ELSE 0 END) AS inline
       FROM book_versions`,
      []
    );
    const [blobRow] = await testDb.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM version_blobs",
      []
    );
    return { total: Number(row.total), inline: Number(row.inline ?? 0), blobs: Number(blobRow.n) };
  }

  async function remainingIds(): Promise<string[]> {
    const rows = await testDb.select<{ id: string }[]>("SELECT id FROM book_versions", []);
    return rows.map((r) => r.id).sort();
  }

  async function formatOf(id: string): Promise<string | undefined> {
    const rows = await testDb.select<{ format: string }[]>(
      "SELECT format FROM book_versions WHERE id = ?",
      [id]
    );
    return rows[0]?.format;
  }

  /** The 30 daily auto-idle rows plus one 300-day-old manual row, all on book-1. */
  async function seedRetentionSet(): Promise<SeededVersion[]> {
    const seeded: SeededVersion[] = [];
    for (let i = 0; i < 30; i++) {
      seeded.push(
        await seedInline({
          id: `auto-${i}`,
          triggerType: "auto-idle",
          createdAt: NOW - i * DAY - 3600,
        })
      );
    }
    seeded.push(
      await seedInline({ id: "manual-old", triggerType: "manual", createdAt: NOW - 300 * DAY })
    );
    return seeded;
  }

  function expectedKept(seeded: SeededVersion[]): string[] {
    return [...retainVersions(seeded, NOW)].sort();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);

    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    vi.mocked(isTutorialLibraryActive).mockReturnValue(false);
    vi.mocked(hasLaunchBackupSettled).mockReturnValue(false);
    vi.mocked(onLaunchBackupSettled).mockImplementation(() => () => {});
    await seedBook("book-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the safety backup once, before any row is deleted or converted", async () => {
    await seedRetentionSet();
    const countsAtBackup: Array<{ total: number; inline: number }> = [];
    const safetyBackup = vi.fn(async () => {
      const c = await counts();
      countsAtBackup.push({ total: c.total, inline: c.inline });
    });

    await upgradeVersionStorage(safetyBackup);

    expect(safetyBackup).toHaveBeenCalledTimes(1);
    // Seeded: 30 auto-idle + 1 manual. Nothing had been dropped or converted yet.
    expect(countsAtBackup).toEqual([{ total: 31, inline: 31 }]);
  });

  it("rejects and leaves the Library untouched when the safety backup fails", async () => {
    const seeded = await seedRetentionSet();
    const before = await remainingIds();
    const safetyBackup = vi.fn(async () => {
      throw new Error("backup failed");
    });

    const error = await upgradeVersionStorage(safetyBackup).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UpgradeBackupError);
    expect(((error as UpgradeBackupError).cause as Error).message).toBe("backup failed");

    expect(await remainingIds()).toEqual(before);
    expect(before).toHaveLength(seeded.length);
    const c = await counts();
    expect(c.inline).toBe(seeded.length);
    expect(c.blobs).toBe(0);
  });

  it("keeps exactly the Version Retention set and always keeps the manual Version", async () => {
    const seeded = await seedRetentionSet();
    const kept = expectedKept(seeded);
    // The rule must actually prune here, or this case proves nothing.
    expect(kept.length).toBeLessThan(seeded.length);

    const result = await upgradeVersionStorage(vi.fn(async () => {}));

    expect(await remainingIds()).toEqual(kept);
    expect(kept).toContain("manual-old");
    expect(result.dropped).toBe(seeded.length - kept.length);
  });

  it("converts every remaining Version to split and keeps its snapshot readable", async () => {
    const seeded = await seedRetentionSet();
    await upgradeVersionStorage(vi.fn(async () => {}));

    const nonSplit = await testDb.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM book_versions WHERE format != 'split'",
      []
    );
    expect(Number(nonSplit[0].n)).toBe(0);

    for (const id of await remainingIds()) {
      const stored = seeded.find((s) => s.id === id);
      expect(stored).toBeDefined();
      const read = await readVersionSnapshot(testDb, id);
      expect(read?.bookId).toBe("book-1");
      expect(read?.snapshot).toEqual(makeSnapshot("book-1"));
    }
  });

  it("deletes Versions whose Book is gone, together with their manifest rows", async () => {
    // Foreign keys are on in the test DB; an orphan only exists in a Library
    // where the reference was never enforced, so switch them off for this insert.
    await testDb.execute("PRAGMA foreign_keys = OFF");
    await testDb.executeAtomic(
      await insertSplitVersionStatements(
        testDb,
        {
          id: "orphan-1",
          bookId: "ghost-book",
          name: null,
          wordCount: 2000,
          checksum: "chk-orphan-1",
          triggerType: "manual",
          createdAt: NOW - DAY,
          syncedAt: null,
        },
        makeSnapshot("ghost-book")
      )
    );
    await testDb.execute("PRAGMA foreign_keys = ON");

    const manifest = async (): Promise<number> => {
      const rows = await testDb.select<{ n: number }[]>(
        "SELECT COUNT(*) AS n FROM book_version_chapters WHERE version_id = ?",
        ["orphan-1"]
      );
      return Number(rows[0].n);
    };
    expect(await manifest()).toBe(2);

    const result = await upgradeVersionStorage(vi.fn(async () => {}));

    expect(result.dropped).toBe(1);
    expect(await formatOf("orphan-1")).toBeUndefined();
    expect(await manifest()).toBe(0);
  });

  it("is idempotent: a second run converts and drops nothing and does not back up again", async () => {
    await seedRetentionSet();
    const safetyBackup = vi.fn(async () => {});

    await upgradeVersionStorage(safetyBackup);
    const second = await upgradeVersionStorage(safetyBackup);

    expect(second).toEqual({ dropped: 0, converted: 0 });
    expect(safetyBackup).toHaveBeenCalledTimes(1);
  });

  it("still runs Version Retention and skips the safety backup when no inline rows remain", async () => {
    // Split rows only, so the upgrade has nothing to convert but retention still applies.
    const seeded: SeededVersion[] = [];
    for (let i = 0; i < 30; i++) {
      const row = {
        id: `auto-${i}`,
        bookId: "book-1",
        triggerType: "auto-idle",
        createdAt: NOW - i * DAY - 3600,
      };
      seeded.push(row);
      await seedSplit(row);
    }
    const manual = {
      id: "manual-old",
      bookId: "book-1",
      triggerType: "manual",
      createdAt: NOW - 300 * DAY,
    };
    seeded.push(manual);
    await seedSplit(manual);

    const safetyBackup = vi.fn(async () => {});
    const result = await upgradeVersionStorage(safetyBackup);

    expect(safetyBackup).not.toHaveBeenCalled();
    expect(result.converted).toBe(0);
    expect(result.dropped).toBe(seeded.length - expectedKept(seeded).length);
    expect(result.dropped).toBeGreaterThan(0);
    expect(await remainingIds()).toEqual(expectedKept(seeded));
  });

  it("converts in batches of UPGRADE_BATCH_SIZE until none are left", async () => {
    // Manual Versions are always kept, so all 25 reach the conversion loop.
    for (let i = 0; i < 25; i++) {
      await seedInline({
        id: `manual-${i}`,
        triggerType: "manual",
        createdAt: NOW - (i + 1) * DAY,
      });
    }
    expect(UPGRADE_BATCH_SIZE).toBe(10);

    const result = await upgradeVersionStorage(vi.fn(async () => {}));

    expect(result).toEqual({ dropped: 0, converted: 25 });
    expect(await counts().then((c) => c.inline)).toBe(0);
  });

  it("does nothing and does not back up while the Tutorial Library is active", async () => {
    await seedInline({ id: "auto-1", triggerType: "auto-idle", createdAt: NOW - DAY });
    await seedInline({ id: "auto-2", triggerType: "auto-idle", createdAt: NOW - 2 * DAY });
    vi.mocked(isTutorialLibraryActive).mockReturnValue(true);
    const safetyBackup = vi.fn(async () => {});

    const result = await upgradeVersionStorage(safetyBackup);

    expect(result).toEqual({ dropped: 0, converted: 0 });
    expect(safetyBackup).not.toHaveBeenCalled();
    expect(await remainingIds()).toEqual(["auto-1", "auto-2"]);
    expect(await counts()).toEqual({ total: 2, inline: 2, blobs: 0 });
  });
});

describe("scheduleVersionStorageUpgrade", () => {
  let testDb: DatabaseAdapter;
  let stopUpgrade: () => void = () => {};

  beforeEach(async () => {
    vi.clearAllMocks();
    resetChangeFeedForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);

    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    vi.mocked(isTutorialLibraryActive).mockReturnValue(false);
    await testDb.execute(
      "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["book-1", "Test Book", "Author", NOW, NOW]
    );
    await testDb.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "auto-1",
        "book-1",
        null,
        JSON.stringify(makeSnapshot("book-1")),
        2000,
        "chk-auto-1",
        "auto-idle",
        NOW - DAY,
        null,
      ]
    );
  });

  afterEach(async () => {
    stopUpgrade();
    stopUpgrade = () => {};
    await settleVersionStorageUpgradeForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Starts the scheduler with the launch Backup already settled and waits for that first upgrade. */
  async function startSettled(): Promise<void> {
    vi.mocked(hasLaunchBackupSettled).mockReturnValue(true);
    stopUpgrade = scheduleVersionStorageUpgrade();
    await settleVersionStorageUpgradeForTests();
  }

  /** A legacy inline Version reappearing, as a Restore or the author's Library returning brings it back. */
  async function bringBackInline(id: string): Promise<void> {
    await testDb.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, "book-1", "Kept", JSON.stringify(makeSnapshot("book-1")), 2000, `chk-${id}`, "manual", NOW - 2 * DAY, null]
    );
  }

  async function formatOf(id: string): Promise<string | undefined> {
    const rows = await testDb.select<{ format: string }[]>(
      "SELECT format FROM book_versions WHERE id = ?",
      [id]
    );
    return rows[0]?.format;
  }

  async function formatOfAuto(): Promise<string | undefined> {
    const rows = await testDb.select<{ format: string }[]>(
      "SELECT format FROM book_versions WHERE id = ?",
      ["auto-1"]
    );
    return rows[0]?.format;
  }

  it("waits for the launch Backup to settle before the upgrade starts", async () => {
    const listeners: Array<() => void> = [];
    vi.mocked(hasLaunchBackupSettled).mockReturnValue(false);
    vi.mocked(onLaunchBackupSettled).mockImplementation((listener) => {
      listeners.push(listener);
      return () => {};
    });

    const callsBefore = mockGetDatabase.mock.calls.length;
    scheduleVersionStorageUpgrade();

    // An upgrade that started early would already have asked for the Library:
    // it runs synchronously up to that first await.
    expect(mockGetDatabase.mock.calls.length).toBe(callsBefore);
    expect(listeners).toHaveLength(1);
    expect(mockCreateBackup).not.toHaveBeenCalled();
    expect(await formatOfAuto()).toBe("inline");

    for (const listener of listeners) listener();

    await vi.waitFor(async () => {
      expect(await formatOfAuto()).toBe("split");
    });
    expect(mockCreateBackup).toHaveBeenCalledTimes(1);
  });

  it("runs immediately when the launch Backup has already settled", async () => {
    vi.mocked(hasLaunchBackupSettled).mockReturnValue(true);

    scheduleVersionStorageUpgrade();

    expect(onLaunchBackupSettled).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      expect(await formatOfAuto()).toBe("split");
    });
    expect(mockCreateBackup).toHaveBeenCalledTimes(1);
  });

  it("tells the author with a toast when the safety Backup fails, and touches nothing", async () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockServiceCreateBackup.mockRejectedValueOnce(new Error("disk full"));

    await startSettled();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Maibuk could not save a safety backup before tidying your version history, so your history stays as it is. It tries again the next time Maibuk starts."
    );
    expect(await formatOfAuto()).toBe("inline");
  });

  it("does not toast when the upgrade fails for any other reason", async () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGetDatabase.mockRejectedValueOnce(new Error("locked"));

    await startSettled();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["a Restore", { scope: "all", reason: "restore" }],
    ["a loaded Database File", { scope: "all", reason: "databaseLoad" }],
    ["a Reset", { scope: "all", reason: "resetLibrary" }],
    ["the author's Library returning after the Tutorial", { available: true, reason: "tutorial" }],
  ] as const)("upgrades again after %s", async (_label, signal) => {
    await startSettled();
    expect(await formatOfAuto()).toBe("split");
    await bringBackInline("restored");

    await emitChange(signal);
    await settleVersionStorageUpgradeForTests();

    expect(await formatOf("restored")).toBe("split");
  });

  it("does not upgrade when the Tutorial takes the Library away", async () => {
    await startSettled();
    await bringBackInline("restored");
    const callsBefore = mockGetDatabase.mock.calls.length;

    await emitChange({ available: false, reason: "tutorial" });
    await settleVersionStorageUpgradeForTests();

    expect(mockGetDatabase.mock.calls.length).toBe(callsBefore);
    expect(await formatOf("restored")).toBe("inline");
  });

  it("runs once more after a Restore that lands while an upgrade is running", async () => {
    // The first safety Backup hangs until the Restore has been announced, then
    // fails; the queued run backs up again and finishes the upgrade.
    let failFirstBackup: (error: Error) => void = () => {};
    mockServiceCreateBackup.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          failFirstBackup = reject;
        })
    );
    vi.spyOn(toast, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(hasLaunchBackupSettled).mockReturnValue(true);
    stopUpgrade = scheduleVersionStorageUpgrade();
    await vi.waitFor(() => expect(mockServiceCreateBackup).toHaveBeenCalledTimes(1));

    await emitChange({ scope: "all", reason: "restore" });
    await emitChange({ scope: "all", reason: "restore" });
    failFirstBackup(new Error("busy"));
    await settleVersionStorageUpgradeForTests();

    // Two signals during one run queue a single extra run.
    expect(mockServiceCreateBackup).toHaveBeenCalledTimes(2);
    expect(await formatOfAuto()).toBe("split");
  });

  it("stops listening once stopped", async () => {
    await startSettled();
    stopUpgrade();
    await bringBackInline("restored");

    await emitChange({ scope: "all", reason: "restore" });
    await settleVersionStorageUpgradeForTests();

    expect(await formatOf("restored")).toBe("inline");
  });

  it("never starts when stopped before the launch Backup settles", async () => {
    const listeners = new Set<() => void>();
    vi.mocked(hasLaunchBackupSettled).mockReturnValue(false);
    vi.mocked(onLaunchBackupSettled).mockImplementation((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });

    scheduleVersionStorageUpgrade()();

    expect(listeners.size).toBe(0);
  });
});
