import { describe, it, expect, beforeEach, vi } from "vitest";

// Same module mocks as sync-engine.test.ts — the engine under test is fully
// isolated from network, database, and backup side effects.
const mockGetDatabase = vi.hoisted(() => vi.fn());
const mockCreateBackupAdapter = vi.hoisted(() => vi.fn());
const mockSerializeBook = vi.hoisted(() => vi.fn());
const mockComputeChecksum = vi.hoisted(() => vi.fn());
const mockEncrypt = vi.hoisted(() => vi.fn());
const mockDecrypt = vi.hoisted(() => vi.fn());
const mockPushBookBlob = vi.hoisted(() => vi.fn());
const mockPullBookBlob = vi.hoisted(() => vi.fn());
const mockListRemoteBooks = vi.hoisted(() => vi.fn());
const mockListRemoteVersions = vi.hoisted(() => vi.fn());
const mockPushVersionBlob = vi.hoisted(() => vi.fn());
const mockPullVersionBlob = vi.hoisted(() => vi.fn());
const mockApplyBookSnapshot = vi.hoisted(() => vi.fn());
const mockSerializeNote = vi.hoisted(() => vi.fn());
const mockNormalizeNoteSnapshotForSync = vi.hoisted(() => vi.fn((json: string) => json));
const mockApplyNoteSnapshot = vi.hoisted(() => vi.fn());
const mockPushNoteBlob = vi.hoisted(() => vi.fn());
const mockPullNoteBlob = vi.hoisted(() => vi.fn());
const mockListRemoteNotes = vi.hoisted(() => vi.fn());
const mockDeleteRemoteBook = vi.hoisted(() => vi.fn());
const mockDeleteRemoteNote = vi.hoisted(() => vi.fn());
const mockRefreshAuth = vi.hoisted(() => vi.fn());
const mockSyncStoreGetState = vi.hoisted(() => vi.fn());
const mockSyncStoreSetState = vi.hoisted(() => vi.fn());
const mockCreateVersion = vi.hoisted(() => vi.fn());
const mockUseSettingsStoreGetState = vi.hoisted(() => vi.fn());
const mockSyncMetricsRows = vi.hoisted(() => vi.fn());
const mockListPendingTombstones = vi.hoisted(() => vi.fn());
const mockMarkTombstonePushed = vi.hoisted(() => vi.fn());
const mockGetTombstone = vi.hoisted(() => vi.fn());
const mockEnsureGenericCollectionMigration = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("@/features/sync/serializer", () => ({
  serializeBook: mockSerializeBook,
  applyBookSnapshot: mockApplyBookSnapshot,
  serializeNote: mockSerializeNote,
  normalizeNoteSnapshotForSync: mockNormalizeNoteSnapshotForSync,
  applyNoteSnapshot: mockApplyNoteSnapshot,
}));

vi.mock("@/features/sync/crypto", () => ({
  computeChecksum: mockComputeChecksum,
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
  isSyncCryptoError: () => false,
}));

vi.mock("@/features/sync/client", () => ({
  pushBookBlob: mockPushBookBlob,
  pullBookBlob: mockPullBookBlob,
  listRemoteBooks: mockListRemoteBooks,
  listRemoteVersions: mockListRemoteVersions,
  pushVersionBlob: mockPushVersionBlob,
  pullVersionBlob: mockPullVersionBlob,
  refreshAuth: mockRefreshAuth,
  pushNoteBlob: mockPushNoteBlob,
  pullNoteBlob: mockPullNoteBlob,
  listRemoteNotes: mockListRemoteNotes,
  deleteRemoteBook: mockDeleteRemoteBook,
  deleteRemoteNote: mockDeleteRemoteNote,
}));

vi.mock("@/lib/platform", () => ({
  getOS: vi.fn().mockResolvedValue({ locale: vi.fn().mockResolvedValue("en-US") }),
  createBackup: mockCreateBackupAdapter,
}));

vi.mock("@/features/sync/store", () => ({
  useSyncStore: {
    getState: mockSyncStoreGetState,
    setState: mockSyncStoreSetState,
  },
}));

vi.mock("@/features/settings/store", () => ({
  useSettingsStore: {
    getState: mockUseSettingsStoreGetState,
    setState: vi.fn(),
  },
}));

vi.mock("@/features/versions/store", () => ({
  useVersionStore: {
    getState: () => ({ createVersion: mockCreateVersion }),
  },
}));

const mockBackupServiceCreateBackup = vi.hoisted(() => vi.fn());
const mockBackupServiceDeleteByTrigger = vi.hoisted(() => vi.fn());
vi.mock("@/features/backup/backup-service", () => ({
  BackupService: class {
    createBackup = mockBackupServiceCreateBackup;
    deleteByTrigger = mockBackupServiceDeleteByTrigger;
    pruneBackups = vi.fn();
  },
}));

vi.mock("@/features/metrics/metrics-sync", () => ({
  syncMetricsRows: mockSyncMetricsRows,
}));

vi.mock("@/features/sync/tombstones", () => ({
  listPendingTombstones: mockListPendingTombstones,
  getTombstone: mockGetTombstone,
  markTombstonePushed: mockMarkTombstonePushed,
}));

vi.mock("@/features/sync/migration-reset", () => ({
  ensureGenericCollectionMigration: mockEnsureGenericCollectionMigration,
}));

const { syncBook, syncAllBooks, syncSingleNote, resetSyncEngineForTests } = await import(
  "@/features/sync/sync-engine"
);

describe("sync concurrency — FIFO serialization", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetSyncEngineForTests();
    mockGetDatabase.mockResolvedValue(mockDb);
    mockCreateBackupAdapter.mockResolvedValue({
      saveBackup: vi.fn(),
      listBackups: vi.fn().mockResolvedValue([]),
      readBackup: vi.fn(),
      deleteBackup: vi.fn(),
    });
    mockBackupServiceCreateBackup.mockResolvedValue("mock-backup.sql");
    mockBackupServiceDeleteByTrigger.mockResolvedValue(undefined);
    mockSerializeBook.mockResolvedValue('{"book":{}}');
    mockSerializeNote.mockResolvedValue('{"note":{}}');
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockDecrypt.mockResolvedValue('{"book":{"id":"book-1"}}');
    mockSyncStoreGetState.mockReturnValue({ authVerified: true });
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: false } });
    mockCreateVersion.mockResolvedValue(null);
    mockListRemoteVersions.mockResolvedValue([]);
    mockPushVersionBlob.mockResolvedValue(undefined);
    mockPullVersionBlob.mockResolvedValue(null);
    mockPushBookBlob.mockResolvedValue(undefined);
    mockPullBookBlob.mockResolvedValue(null);
    mockPushNoteBlob.mockResolvedValue(undefined);
    mockPullNoteBlob.mockResolvedValue(null);
    mockListRemoteNotes.mockResolvedValue([]);
    mockListPendingTombstones.mockResolvedValue([]);
    mockGetTombstone.mockResolvedValue(null);
    mockDeleteRemoteBook.mockResolvedValue(undefined);
    mockDeleteRemoteNote.mockResolvedValue(undefined);
    mockMarkTombstonePushed.mockResolvedValue(undefined);
    mockSyncMetricsRows.mockResolvedValue(undefined);
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test" }];
      if (sql.includes("GROUP BY b.id")) return [{ id: "book-1", updated_at: 1000 }];
      if (sql.includes("FROM notes")) return [{ id: "note-1", updated_at: 1000 }];
      if (sql.includes("book_versions")) return [];
      return [];
    });
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it("delivers each queued caller its own passphrase, log and conflict callback", async () => {
    // book-1 is remotely newer → the first sync blocks on its conflict dialog.
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);
    // note-1 is local-only → the queued note sync pushes without conflict.
    mockListRemoteNotes.mockResolvedValue([]);

    let resolveConflict: ((choice: "push" | "pull" | "cancel") => void) | null = null;
    const blockedConflict = () =>
      new Promise<"push" | "pull" | "cancel">((resolve) => {
        resolveConflict = resolve;
      });
    const bookLog: { event: string }[] = [];
    const noteLog: { event: string }[] = [];
    const noteConflict = vi.fn().mockResolvedValue("cancel");

    const firstSync = syncBook("book-1", "pass-one", blockedConflict, {
      onLog: (entry) => {
        bookLog.push(entry);
      },
    });
    await new Promise((r) => setTimeout(r, 10));

    const secondSync = syncSingleNote("note-1", "pass-two", noteConflict, {
      onLog: (entry) => {
        noteLog.push(entry);
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    // The queued note sync has not started while the book sync is blocked.
    expect(mockPushNoteBlob).not.toHaveBeenCalled();

    if (resolveConflict) {
      (resolveConflict as (choice: "push" | "pull" | "cancel") => void)("cancel");
    }
    const [firstResult, secondResult] = await Promise.all([firstSync, secondSync]);

    expect(firstResult).toEqual({ outcome: "cancelled", action: "cancelled" });
    expect(secondResult).toEqual({ outcome: "success", action: "pushed" });
    // The note push used the second caller's passphrase, not the first's.
    expect(mockEncrypt).toHaveBeenCalledWith(expect.anything(), "pass-two");
    expect(mockPushNoteBlob).toHaveBeenCalledTimes(1);
    // Each caller received only its own log entries.
    expect(bookLog.map((e) => e.event)).toContain("conflict");
    expect(noteLog.map((e) => e.event)).toContain("push");
    expect(noteLog.some((e) => e.event === "conflict")).toBe(false);
    expect(noteConflict).not.toHaveBeenCalled();
  });

  it("releases the queue after a rejection so the next caller still runs", async () => {
    mockBackupServiceCreateBackup
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue("mock-backup.sql");
    mockListRemoteBooks.mockResolvedValue([]);

    const firstSync = syncBook("book-1", "pass", vi.fn());
    const secondSync = syncBook("book-2", "pass", vi.fn());

    // The first rejection propagates to its own caller (exact spec error).
    await expect(firstSync).rejects.toThrow(
      "Could not create a safety backup. Sync aborted. Free up disk space and try again."
    );
    // The queued caller is not swallowed by the earlier failure.
    await expect(secondSync).resolves.toEqual({ outcome: "success", action: "pushed" });
    expect(mockPushBookBlob).toHaveBeenCalledTimes(1);
  });

  it("gives each queued operation its own pre-sync backup", async () => {
    mockListRemoteBooks.mockResolvedValue([]);

    const [batchResult, singleResult] = await Promise.all([
      syncAllBooks("pass", vi.fn(), { scope: "books" }),
      syncBook("book-1", "pass", vi.fn()),
    ]);

    expect(batchResult.outcome).toBe("success");
    expect(singleResult.outcome).toBe("success");
    expect(mockBackupServiceCreateBackup).toHaveBeenCalledTimes(2);
  });

  it("captures confirmedDeletionIds at enqueue time", async () => {
    // The first sync blocks on its conflict dialog while the second waits.
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);
    let resolveConflict: ((choice: "push" | "pull" | "cancel") => void) | null = null;
    let conflictReached = false;
    const blockedConflict = () => {
      conflictReached = true;
      return new Promise<"push" | "pull" | "cancel">((resolve) => {
        resolveConflict = resolve;
      });
    };

    const firstSync = syncAllBooks("pass", blockedConflict, { scope: "books" });
    await vi.waitFor(() => expect(conflictReached).toBe(true));

    // A deletion is reported only after the first sync passed its own
    // (empty) deletion check.
    mockListPendingTombstones.mockResolvedValue([
      {
        id: "book:book-1",
        entityType: "book",
        entityId: "book-1",
        title: "Deleted Draft",
        deletedAt: 1000,
        confirmedAt: null,
        pushedAt: null,
      },
    ]);
    const confirmedIds = ["book:book-1"];
    const secondSync = syncAllBooks("pass", vi.fn().mockResolvedValue("cancel"), {
      scope: "books",
      confirmedDeletionIds: confirmedIds,
    });
    // Mutating the caller's array after enqueue must not affect the queued op.
    confirmedIds.length = 0;

    if (resolveConflict) {
      (resolveConflict as (choice: "push" | "pull" | "cancel") => void)("cancel");
    }
    await expect(firstSync).resolves.toMatchObject({ outcome: "cancelled" });
    await expect(secondSync).resolves.toMatchObject({ outcome: "partial" });

    expect(mockDeleteRemoteBook).toHaveBeenCalledWith("book-1");
  });
});
