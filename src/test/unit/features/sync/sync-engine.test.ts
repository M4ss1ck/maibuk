import { describe, it, expect, beforeEach, vi } from "vitest";

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
const mockApplyLegacyBlobAndMarkPushed = vi.hoisted(() => vi.fn());
const mockPullMetricsBlob = vi.hoisted(() => vi.fn());
const mockListPendingTombstones = vi.hoisted(() => vi.fn());
const mockHasTombstone = vi.hoisted(() => vi.fn());
const mockMarkTombstonePushed = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../features/sync/serializer", () => ({
  serializeBook: mockSerializeBook,
  applyBookSnapshot: mockApplyBookSnapshot,
  serializeNote: mockSerializeNote,
  applyNoteSnapshot: mockApplyNoteSnapshot,
}));

class FakeSyncCryptoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

vi.mock("../../../../features/sync/crypto", () => ({
  computeChecksum: mockComputeChecksum,
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
  isSyncCryptoError: (error: unknown) => error instanceof FakeSyncCryptoError,
}));

vi.mock("../../../../features/sync/client", () => ({
  pushBookBlob: mockPushBookBlob,
  pullBookBlob: mockPullBookBlob,
  listRemoteBooks: mockListRemoteBooks,
  listRemoteVersions: mockListRemoteVersions,
  pushVersionBlob: mockPushVersionBlob,
  pullVersionBlob: mockPullVersionBlob,
  refreshAuth: mockRefreshAuth,
  pullMetricsBlob: mockPullMetricsBlob,
  pushNoteBlob: mockPushNoteBlob,
  pullNoteBlob: mockPullNoteBlob,
  listRemoteNotes: mockListRemoteNotes,
  deleteRemoteBook: mockDeleteRemoteBook,
  deleteRemoteNote: mockDeleteRemoteNote,
}));

// Pre-mock backup module — Task 10 will add backup imports to sync-engine.ts.
// Without this mock, vitest would try to resolve the real backup module and fail.
vi.mock("../../../../lib/platform", () => ({
  getOS: vi.fn().mockResolvedValue({ locale: vi.fn().mockResolvedValue("en-US") }),
  createBackup: mockCreateBackupAdapter,
}));

vi.mock("../../../../features/sync/store", () => ({
  useSyncStore: {
    getState: mockSyncStoreGetState,
    setState: mockSyncStoreSetState,
  },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: {
    getState: mockUseSettingsStoreGetState,
    setState: vi.fn(),
  },
}));

vi.mock("../../../../features/versions/store", () => ({
  useVersionStore: {
    getState: () => ({ createVersion: mockCreateVersion }),
  },
}));

const mockBackupServiceCreateBackup = vi.hoisted(() => vi.fn());
const mockBackupServiceDeleteByTrigger = vi.hoisted(() => vi.fn());
vi.mock("../../../../features/backup/backup-service", () => ({
  BackupService: class {
    createBackup = mockBackupServiceCreateBackup;
    deleteByTrigger = mockBackupServiceDeleteByTrigger;
    pruneBackups = vi.fn();
  },
}));

vi.mock("../../../../features/metrics/metrics-sync", () => ({
  syncMetricsRows: mockSyncMetricsRows,
  applyLegacyBlobAndMarkPushed: mockApplyLegacyBlobAndMarkPushed,
}));

vi.mock("../../../../features/sync/tombstones", () => ({
  listPendingTombstones: mockListPendingTombstones,
  hasTombstone: mockHasTombstone,
  markTombstonePushed: mockMarkTombstonePushed,
}));

const { syncBook, syncAllBooks, resetSyncEngineForTests } = await import(
  "../../../../features/sync/sync-engine"
);

// Note sync runs inside syncAllBooks. These defaults survive vi.clearAllMocks()
// (which clears call history, not implementations), so the existing book-focused
// tests — which have no local notes — see an empty remote note set and no-op.
mockListRemoteNotes.mockResolvedValue([]);
mockSerializeNote.mockResolvedValue('{"note":{}}');
mockPushNoteBlob.mockResolvedValue(undefined);
mockPullNoteBlob.mockResolvedValue(null);
mockListPendingTombstones.mockResolvedValue([]);
mockHasTombstone.mockResolvedValue(false);
mockDeleteRemoteBook.mockResolvedValue(undefined);
mockDeleteRemoteNote.mockResolvedValue(undefined);
mockMarkTombstonePushed.mockResolvedValue(undefined);

beforeEach(() => {
  mockListPendingTombstones.mockResolvedValue([]);
  mockHasTombstone.mockResolvedValue(false);
  mockDeleteRemoteBook.mockResolvedValue(undefined);
  mockDeleteRemoteNote.mockResolvedValue(undefined);
  mockMarkTombstonePushed.mockResolvedValue(undefined);
});

describe("syncBook — timestamp fix", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  const noopConflict = vi.fn();

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
    mockSerializeBook.mockResolvedValue('{"book":{}}');
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockSyncStoreGetState.mockReturnValue({ authVerified: true });
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: false } });
    mockCreateVersion.mockResolvedValue(null);
    mockListRemoteVersions.mockResolvedValue([]);
    mockPushVersionBlob.mockResolvedValue(undefined);
    mockPullVersionBlob.mockResolvedValue(null);
    // Distinguish between timestamp query and title query to avoid false positives
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 5000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      if (sql.includes("book_versions")) return [];
      return [];
    });
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it("uses MAX of book and chapter updated_at for local timestamp", async () => {
    // Book updated_at is old (1000), but a chapter was updated recently (5000)
    // mockDb.select already returns 5000 for the timestamp query (see beforeEach)
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 3000 },
    ]);

    await syncBook("book-1", "pass", noopConflict);

    // Should push because local (5000) > remote (3000)
    expect(mockPushBookBlob).toHaveBeenCalled();
    expect(mockPullBookBlob).not.toHaveBeenCalled();
  });

  it("calls onConflict when remote is newer", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);
    noopConflict.mockResolvedValue("cancel");

    const result = await syncBook("book-1", "pass", noopConflict);

    expect(noopConflict).toHaveBeenCalled();
    expect(result).toEqual({ outcome: "cancelled", action: "cancelled" });
  });

  it("pulls and applies remote data when user chooses pull", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);
    noopConflict.mockResolvedValue("pull");
    mockPullBookBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      checksum: "remote-checksum",
    });
    mockDecrypt.mockResolvedValue('{"book":{"id":"book-1"}}');

    const result = await syncBook("book-1", "pass", noopConflict);

    expect(result).toEqual({ outcome: "success", action: "pulled" });
    expect(mockApplyBookSnapshot).toHaveBeenCalled();
    expect(mockPushBookBlob).not.toHaveBeenCalled();
  });

  it("calls onConflict when timestamps are equal but checksums differ", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 3000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 3000 },
    ]);
    noopConflict.mockResolvedValue("push");

    await syncBook("book-1", "pass", noopConflict);

    expect(noopConflict).toHaveBeenCalled();
    expect(mockPushBookBlob).toHaveBeenCalled();
  });

  it("throws if called while already syncing (concurrency guard)", async () => {
    // Set up a sync that blocks indefinitely on onConflict
    let resolveConflict: ((choice: "push" | "pull" | "cancel") => void) | null = null;
    const blockedConflict = () =>
      new Promise<"push" | "pull" | "cancel">((resolve) => {
        resolveConflict = resolve;
      });
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "different", updatedAt: 5000 },
    ]);

    // Start a sync that will block on the conflict dialog
    const firstSync = syncBook("book-1", "pass", blockedConflict);

    // Allow the first sync to reach the onConflict call
    await new Promise((r) => setTimeout(r, 10));

    // Second sync should throw immediately
    await expect(syncBook("book-2", "pass", vi.fn())).rejects.toThrow("already in progress");

    if (resolveConflict) {
      (resolveConflict as (choice: "push" | "pull" | "cancel") => void)("cancel");
    }
    await expect(firstSync).resolves.toEqual({ outcome: "cancelled", action: "cancelled" });
  });

  it("rethrows a spec-friendly error when the pre-sync backup fails", async () => {
    mockBackupServiceCreateBackup.mockRejectedValue(new Error("disk full"));

    await expect(syncBook("book-1", "pass", noopConflict)).rejects.toThrow(
      "Could not create a safety backup. Sync aborted. Free up disk space and try again."
    );

    expect(mockPushBookBlob).not.toHaveBeenCalled();
    expect(mockPullBookBlob).not.toHaveBeenCalled();
  });
});

describe("syncAllBooks — truthful outcomes", () => {
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
    mockSerializeBook.mockResolvedValue('{"book":{}}');
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockSyncStoreGetState.mockReturnValue({ authVerified: true });
    mockCreateVersion.mockResolvedValue(null);
    mockListRemoteVersions.mockResolvedValue([]);
    mockPushVersionBlob.mockResolvedValue(undefined);
    mockPullVersionBlob.mockResolvedValue(null);
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) {
        return [
          { id: "book-1", updated_at: 5000 },
          { id: "book-2", updated_at: 1000 },
        ];
      }
      if (sql.includes("SELECT title") && sql.includes("book-2")) {
        return [{ title: "Book Two" }];
      }
      if (sql.includes("book_versions")) return [];
      return [];
    });
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it("returns cancelled when the first conflict is cancelled before any sync work lands", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) {
        return [{ id: "book-2", updated_at: 1000 }];
      }
      if (sql.includes("SELECT title")) {
        return [{ title: "Book Two" }];
      }
      return [];
    });
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-2", checksum: "remote-checksum", updatedAt: 5000 },
    ]);

    const result = await syncAllBooks("pass", vi.fn().mockResolvedValue("cancel"));

    expect(result.outcome).toBe("cancelled");
    expect(result.actions).toEqual(["cancelled"]);
    expect(mockPushBookBlob).not.toHaveBeenCalled();
    expect(mockPullBookBlob).not.toHaveBeenCalled();
  });

  it("returns partial when cancellation happens after earlier books synced", async () => {
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-one", updatedAt: 3000 },
      { bookId: "book-2", checksum: "remote-two", updatedAt: 5000 },
    ]);

    const onConflict = vi.fn().mockResolvedValue("cancel");
    const result = await syncAllBooks("pass", onConflict);

    expect(result.outcome).toBe("partial");
    expect(result.actions).toEqual(["pushed", "cancelled"]);
    expect(mockPushBookBlob).toHaveBeenCalledTimes(1);
    expect(onConflict).toHaveBeenCalledTimes(1);
  });

  it("recreates the configured backup service for each sync invocation", async () => {
    mockListRemoteBooks.mockResolvedValue([]);

    await syncBook("book-1", "pass", vi.fn());
    await syncAllBooks("pass", vi.fn());

    expect(mockCreateBackupAdapter).toHaveBeenCalledTimes(2);
    expect(mockBackupServiceCreateBackup).toHaveBeenCalledTimes(2);
  });

  it("rethrows the spec-friendly error when the batch pre-sync backup fails", async () => {
    mockBackupServiceCreateBackup.mockRejectedValue(new Error("quota exceeded"));

    await expect(syncAllBooks("pass", vi.fn())).rejects.toThrow(
      "Could not create a safety backup. Sync aborted. Free up disk space and try again."
    );
  });

  it("proceeds with the sync when the local database is empty (BACKUP_EMPTY)", async () => {
    // Fresh device: no local books, first sync is a pull. The pre-sync backup
    // throws BACKUP_EMPTY because there is nothing to dump — sync must continue
    // rather than abort.
    mockBackupServiceCreateBackup.mockRejectedValue(new Error("BACKUP_EMPTY"));
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return [];
      if (sql.includes("book_versions")) return [];
      return [];
    });
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-remote", checksum: "remote-checksum", updatedAt: 5000 },
    ]);
    mockPullBookBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      checksum: "remote-checksum",
    });
    mockDecrypt.mockResolvedValue('{"book":{"id":"book-remote"},"chapters":[]}');

    const result = await syncAllBooks("pass", vi.fn());

    expect(result.outcome).toBe("success");
    expect(result.actions).toEqual(["pulled"]);
    expect(mockPullBookBlob).toHaveBeenCalledWith("book-remote");
  });
});

describe("syncAllBooks — scoped direction and deletion safety", () => {
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
    mockSerializeBook.mockResolvedValue('{"book":{}}');
    mockSerializeNote.mockResolvedValue('{"note":{}}');
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockDecrypt.mockResolvedValue('{"book":{"id":"remote-book"},"chapters":[]}');
    mockSyncStoreGetState.mockReturnValue({ authVerified: true });
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: false } });
    mockCreateVersion.mockResolvedValue(null);
    mockListRemoteVersions.mockResolvedValue([]);
    mockPushVersionBlob.mockResolvedValue(undefined);
    mockPullVersionBlob.mockResolvedValue(null);
    mockListRemoteBooks.mockResolvedValue([]);
    mockListRemoteNotes.mockResolvedValue([]);
    mockPushBookBlob.mockResolvedValue(undefined);
    mockPullBookBlob.mockResolvedValue(null);
    mockPushNoteBlob.mockResolvedValue(undefined);
    mockPullNoteBlob.mockResolvedValue(null);
    mockListPendingTombstones.mockResolvedValue([]);
    mockHasTombstone.mockResolvedValue(false);
    mockDeleteRemoteBook.mockResolvedValue(undefined);
    mockDeleteRemoteNote.mockResolvedValue(undefined);
    mockMarkTombstonePushed.mockResolvedValue(undefined);
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return [{ id: "book-1", updated_at: 5000 }];
      if (sql.includes("FROM notes")) return [{ id: "note-1", updated_at: 5000 }];
      if (sql.includes("book_versions")) return [];
      return [];
    });
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it("pull-only never pushes local-only books", async () => {
    await syncAllBooks("pass", vi.fn(), {
      scope: "books",
      direction: "pull",
    });

    expect(mockPushBookBlob).not.toHaveBeenCalled();
    expect(mockPushVersionBlob).not.toHaveBeenCalled();
  });

  it("emits operation log entries from the engine", async () => {
    const onLog = vi.fn();

    await syncAllBooks("pass", vi.fn(), {
      scope: "books",
      direction: "bidirectional",
      onLog,
    });

    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ event: "backup" }));
    expect(onLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "push", entityType: "book", entityId: "book-1" })
    );
  });

  it("notes scope does not list or sync books", async () => {
    await syncAllBooks("pass", vi.fn(), {
      scope: "notes",
      direction: "bidirectional",
    });

    expect(mockListRemoteBooks).not.toHaveBeenCalled();
    expect(mockSerializeBook).not.toHaveBeenCalled();
    expect(mockListRemoteNotes).toHaveBeenCalled();
    expect(mockPushNoteBlob).toHaveBeenCalled();
  });

  it("skips remote-only books that have a local tombstone", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return [];
      if (sql.includes("book_versions")) return [];
      return [];
    });
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "deleted-book", checksum: "remote", updatedAt: 5000 },
    ]);
    mockHasTombstone.mockImplementation(async (entityType: string, entityId: string) => {
      return entityType === "book" && entityId === "deleted-book";
    });

    const result = await syncAllBooks("pass", vi.fn(), {
      scope: "books",
      direction: "bidirectional",
    });

    expect(result.actions).toEqual(["skipped"]);
    expect(mockPullBookBlob).not.toHaveBeenCalled();
    expect(mockApplyBookSnapshot).not.toHaveBeenCalled();
  });

  it("returns pending deletions and does not delete remote rows until confirmed", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return [];
      if (sql.includes("book_versions")) return [];
      return [];
    });
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

    const result = await syncAllBooks("pass", vi.fn(), {
      scope: "books",
      direction: "bidirectional",
    });

    expect(result.outcome).toBe("partial");
    expect(result.pendingDeletions).toEqual([
      {
        id: "book:book-1",
        entityType: "book",
        entityId: "book-1",
        title: "Deleted Draft",
        deletedAt: 1000,
      },
    ]);
    expect(mockDeleteRemoteBook).not.toHaveBeenCalled();
  });

  it("pushes confirmed book and note tombstones as remote deletes", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return [];
      if (sql.includes("FROM notes")) return [];
      if (sql.includes("book_versions")) return [];
      return [];
    });
    mockListPendingTombstones.mockResolvedValue([
      {
        id: "book:book-1",
        entityType: "book",
        entityId: "book-1",
        title: "Deleted Draft",
        deletedAt: 1000,
        confirmedAt: 1100,
        pushedAt: null,
      },
      {
        id: "note:note-1",
        entityType: "note",
        entityId: "note-1",
        title: "Deleted Note",
        deletedAt: 1001,
        confirmedAt: 1100,
        pushedAt: null,
      },
    ]);

    const result = await syncAllBooks("pass", vi.fn(), {
      scope: "all",
      direction: "push",
      confirmedDeletionIds: ["book:book-1", "note:note-1"],
    });

    expect(result.pendingDeletions).toBeUndefined();
    expect(mockDeleteRemoteBook).toHaveBeenCalledWith("book-1");
    expect(mockDeleteRemoteNote).toHaveBeenCalledWith("note-1");
    expect(mockMarkTombstonePushed).toHaveBeenCalledWith("book", "book-1");
    expect(mockMarkTombstonePushed).toHaveBeenCalledWith("note", "note-1");
  });
});

describe("ensureAuth — pre-sync auth guard", () => {
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
    mockSerializeBook.mockResolvedValue('{"book":{}}');
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockSyncStoreGetState.mockReturnValue({ authVerified: true });
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: false } });
    mockCreateVersion.mockResolvedValue(null);
    mockListRemoteVersions.mockResolvedValue([]);
    mockPushVersionBlob.mockResolvedValue(undefined);
    mockPullVersionBlob.mockResolvedValue(null);
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 5000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      if (sql.includes("GROUP BY b.id")) return [{ id: "book-1", updated_at: 5000 }];
      if (sql.includes("book_versions")) return [];
      return [];
    });
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it("skips refresh when authVerified is true", async () => {
    mockSyncStoreGetState.mockReturnValue({ authVerified: true });

    await syncBook("book-1", "pass", vi.fn());

    expect(mockRefreshAuth).not.toHaveBeenCalled();
  });

  it("calls refreshAuth when authVerified is false and succeeds", async () => {
    mockSyncStoreGetState.mockReturnValue({ authVerified: false });
    mockRefreshAuth.mockResolvedValue({
      email: "user@test.com",
      token: "new-token",
    });

    await syncBook("book-1", "pass", vi.fn());

    expect(mockRefreshAuth).toHaveBeenCalled();
    expect(mockSyncStoreSetState).toHaveBeenCalledWith(
      expect.objectContaining({ authVerified: true })
    );
  });

  it("throws sync.sessionExpired on 401 and clears auth state", async () => {
    mockSyncStoreGetState.mockReturnValue({ authVerified: false });
    const error = new Error("Token expired");
    (error as { status?: number }).status = 401;
    mockRefreshAuth.mockRejectedValue(error);

    await expect(syncBook("book-1", "pass", vi.fn())).rejects.toThrow("sync.sessionExpired");
    expect(mockSyncStoreSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        authStatus: "logged-out",
        authVerified: false,
      })
    );
  });

  it("rethrows network errors without clearing auth state", async () => {
    mockSyncStoreGetState.mockReturnValue({ authVerified: false });
    mockRefreshAuth.mockRejectedValue(new Error("Failed to fetch"));

    await expect(syncBook("book-1", "pass", vi.fn())).rejects.toThrow("Failed to fetch");
    // Should NOT have cleared auth state
    expect(mockSyncStoreSetState).not.toHaveBeenCalledWith(
      expect.objectContaining({ authStatus: "logged-out" })
    );
  });

  it("ensureAuth guard also runs in syncAllBooks", async () => {
    mockSyncStoreGetState.mockReturnValue({ authVerified: false });
    mockRefreshAuth.mockResolvedValue({
      email: "user@test.com",
      token: "new-token",
    });

    await syncAllBooks("pass", vi.fn());

    expect(mockRefreshAuth).toHaveBeenCalled();
  });
});

describe("syncVersions — pure union", () => {
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
    mockSerializeBook.mockResolvedValue('{"book":{}}');
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockSyncStoreGetState.mockReturnValue({ authVerified: true });
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: false } });
    mockCreateVersion.mockResolvedValue(null);
    mockListRemoteVersions.mockResolvedValue([]);
    mockPushVersionBlob.mockResolvedValue(undefined);
    mockPullVersionBlob.mockResolvedValue(null);
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      if (sql.includes("GROUP BY b.id")) return [{ id: "book-1", updated_at: 1000 }];
      return [];
    });
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it("pushes only local-only versions and pulls only remote-only versions", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("book_versions")) {
        return [
          { id: "ver-local", checksum: "chk-local", name: "Local", trigger_type: "manual", created_at: 1000, word_count: 500, snapshot: "{}" },
        ];
      }
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteVersions.mockResolvedValue([
      {
        remoteId: "rem-1",
        versionId: "ver-remote",
        bookId: "book-1",
        checksum: "chk-remote",
        name: "Remote",
        triggerType: "manual",
        createdAt: 2000,
        wordCount: 600,
      },
    ]);
    mockPullVersionBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
    });
    mockDecrypt.mockResolvedValue('{"book":{}}');
    mockComputeChecksum
      .mockResolvedValueOnce("local-checksum") // for syncBookInBatch
      .mockResolvedValueOnce("chk-remote"); // for pulled version verification

    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);

    // Use "pull" so syncBookInBatch doesn't cancel and syncVersions runs
    const onConflict = vi.fn().mockResolvedValue("pull");
    mockPullBookBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      checksum: "remote-checksum",
    });

    await syncBook("book-1", "pass", onConflict);

    // Should push the local-only version
    expect(mockPushVersionBlob).toHaveBeenCalledTimes(1);
    expect(mockPushVersionBlob).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "ver-local" }),
      expect.any(Blob)
    );

    // Should pull the remote-only version
    expect(mockPullVersionBlob).toHaveBeenCalledWith("rem-1");
  });

  it("does not push or pull when version is present on both sides", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("book_versions")) {
        return [
          { id: "ver-shared", checksum: "chk-shared", name: "Shared", trigger_type: "manual", created_at: 1000, word_count: 500, snapshot: "{}" },
        ];
      }
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteVersions.mockResolvedValue([
      {
        remoteId: "rem-1",
        versionId: "ver-shared",
        bookId: "book-1",
        checksum: "chk-shared",
        name: "Shared",
        triggerType: "manual",
        createdAt: 1000,
        wordCount: 500,
      },
    ]);

    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);

    const onConflict = vi.fn().mockResolvedValue("cancel");
    await syncBook("book-1", "pass", onConflict);

    expect(mockPushVersionBlob).not.toHaveBeenCalled();
    expect(mockPullVersionBlob).not.toHaveBeenCalled();
  });

  it("inserts pulled version with metadata from RemoteVersionMeta", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("book_versions")) return [];
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteVersions.mockResolvedValue([
      {
        remoteId: "rem-1",
        versionId: "ver-remote",
        bookId: "book-1",
        checksum: "chk-remote",
        name: "Remote Draft",
        triggerType: "manual",
        createdAt: 2000,
        wordCount: 600,
      },
    ]);
    mockPullVersionBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
    });
    mockDecrypt.mockResolvedValue('{"book":{"title":"Remote"}}');
    mockComputeChecksum
      .mockResolvedValueOnce("local-checksum")
      .mockResolvedValueOnce("chk-remote");

    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);

    const onConflict = vi.fn().mockResolvedValue("pull");
    mockPullBookBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      checksum: "remote-checksum",
    });

    await syncBook("book-1", "pass", onConflict);

    const insertCall = mockDb.execute.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT OR IGNORE INTO book_versions")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(
      expect.arrayContaining([
        "ver-remote",
        "book-1",
        "Remote Draft",
        "manual",
        2000,
        600,
      ])
    );
  });

  it("inserts a successfully decrypted version without re-verifying its checksum", async () => {
    // Regression: version checksums are a content hash of the snapshot, not a
    // hash of the raw serialized blob, so the old pull-side re-hash check could
    // never match and skipped every pulled version. AES-GCM decrypt is the
    // integrity gate now — a version that decrypts is inserted as-is.
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("book_versions")) return [];
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteVersions.mockResolvedValue([
      {
        remoteId: "rem-1",
        versionId: "ver-remote",
        bookId: "book-1",
        checksum: "chk-remote",
        name: null,
        triggerType: "auto-idle",
        createdAt: 2000,
        wordCount: 600,
      },
    ]);
    mockPullVersionBlob.mockResolvedValue({ data: new Uint8Array([1, 2, 3]) });
    mockDecrypt.mockResolvedValue('{"book":{}}');
    // A naive hash of the decrypted blob differs from the stored checksum —
    // the engine must NOT reject the version over that.
    mockComputeChecksum.mockResolvedValue("does-not-match-chk-remote");

    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);
    const onConflict = vi.fn().mockResolvedValue("pull");
    mockPullBookBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      checksum: "remote-checksum",
    });

    await syncBook("book-1", "pass", onConflict);

    const insertCall = mockDb.execute.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT OR IGNORE INTO book_versions")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(
      expect.arrayContaining(["ver-remote", "chk-remote"])
    );
  });

  it("skips a version that fails to decrypt and continues syncing", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("book_versions")) return [];
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteVersions.mockResolvedValue([
      {
        remoteId: "rem-bad",
        versionId: "ver-bad",
        bookId: "book-1",
        checksum: "chk-bad",
        name: null,
        triggerType: "auto-idle",
        createdAt: 2000,
        wordCount: 600,
      },
    ]);
    mockPullVersionBlob.mockResolvedValue({ data: new Uint8Array([9]) });
    mockDecrypt.mockRejectedValue(new Error("corrupt blob"));

    // Local book is newer than remote → it pushes (no book decrypt), so the
    // only decrypt exercised is the failing version blob.
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 500 },
    ]);
    const onConflict = vi.fn();

    // A single bad version must not abort the whole sync.
    const result = await syncBook("book-1", "pass", onConflict);
    expect(result.outcome).toBe("success");

    const insertCall = mockDb.execute.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT OR IGNORE INTO book_versions")
    );
    expect(insertCall).toBeUndefined();
  });

  it("re-throws when a version fails to decrypt due to an invalid passphrase", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("book_versions")) return [];
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteVersions.mockResolvedValue([
      {
        remoteId: "rem-1",
        versionId: "ver-remote",
        bookId: "book-1",
        checksum: "chk-remote",
        name: null,
        triggerType: "auto-idle",
        createdAt: 2000,
        wordCount: 600,
      },
    ]);
    mockPullVersionBlob.mockResolvedValue({ data: new Uint8Array([1, 2, 3]) });
    mockDecrypt.mockRejectedValue(
      new FakeSyncCryptoError("INVALID_PASSPHRASE", "bad passphrase")
    );

    // Local book is newer → it pushes, so the failing decrypt is the version's.
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 500 },
    ]);
    const onConflict = vi.fn();

    await expect(syncBook("book-1", "pass", onConflict)).rejects.toThrow(
      "bad passphrase"
    );
  });

  it("creates pre-sync version before applyBookSnapshot on a conflict-resolved pull", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);

    const onConflict = vi.fn().mockResolvedValue("pull");
    mockPullBookBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      checksum: "remote-checksum",
    });
    mockDecrypt.mockResolvedValue('{"book":{"id":"book-1"}}');

    await syncBook("book-1", "pass", onConflict);

    const preSyncCall = mockCreateVersion.mock.calls.find(
      (call) => call[0].triggerType === "pre-sync"
    );
    expect(preSyncCall).toBeDefined();
    expect(mockApplyBookSnapshot).toHaveBeenCalled();
  });

  it("stamps synced_at on pushed versions", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("book_versions")) {
        return [
          { id: "ver-local", checksum: "chk-local", name: null, trigger_type: "manual", created_at: 1000, word_count: 500, snapshot: "{}" },
        ];
      }
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });

    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);

    const onConflict = vi.fn().mockResolvedValue("pull");
    mockPullBookBlob.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      checksum: "remote-checksum",
    });
    mockDecrypt.mockResolvedValue('{"book":{"id":"book-1"}}');

    await syncBook("book-1", "pass", onConflict);

    const updateCall = mockDb.execute.mock.calls.find((call) =>
      (call[0] as string).includes("UPDATE book_versions SET synced_at")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual(expect.arrayContaining(["ver-local"]));
  });
});

describe("syncMetrics — engine integration", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };

  const BLOB_MIGRATED_KEY = "maibuk.metrics.blobMigrated";

  beforeEach(() => {
    vi.clearAllMocks();
    resetSyncEngineForTests();
    localStorage.removeItem(BLOB_MIGRATED_KEY);
    mockGetDatabase.mockResolvedValue(mockDb);
    mockCreateBackupAdapter.mockResolvedValue({
      saveBackup: vi.fn(),
      listBackups: vi.fn().mockResolvedValue([]),
      readBackup: vi.fn(),
      deleteBackup: vi.fn(),
    });
    mockBackupServiceCreateBackup.mockResolvedValue("mock-backup.sql");
    mockSerializeBook.mockResolvedValue('{"book":{}}');
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockSyncStoreGetState.mockReturnValue({ authVerified: true });
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: false } });
    mockCreateVersion.mockResolvedValue(null);
    mockListRemoteVersions.mockResolvedValue([]);
    mockPushVersionBlob.mockResolvedValue(undefined);
    mockPullVersionBlob.mockResolvedValue(null);
    mockSyncMetricsRows.mockResolvedValue(undefined);
    mockApplyLegacyBlobAndMarkPushed.mockResolvedValue(undefined);
    mockPullMetricsBlob.mockResolvedValue(null);
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      if (sql.includes("GROUP BY b.id")) return [{ id: "book-1", updated_at: 1000 }];
      if (sql.includes("book_versions")) return [];
      return [];
    });
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it("skips metrics sync when syncMetrics is disabled", async () => {
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: false } });
    mockListRemoteBooks.mockResolvedValue([]);

    await syncBook("book-1", "pass", vi.fn());

    expect(mockSyncMetricsRows).not.toHaveBeenCalled();
    expect(mockApplyLegacyBlobAndMarkPushed).not.toHaveBeenCalled();
    expect(mockPullMetricsBlob).not.toHaveBeenCalled();
  });

  it("delegates to syncMetricsRows when sync is enabled and no legacy blob exists", async () => {
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: true } });
    mockListRemoteBooks.mockResolvedValue([]);
    mockPullMetricsBlob.mockResolvedValue(null);

    await syncBook("book-1", "pass", vi.fn());

    expect(mockPullMetricsBlob).toHaveBeenCalled();
    expect(mockApplyLegacyBlobAndMarkPushed).not.toHaveBeenCalled();
    expect(mockSyncMetricsRows).toHaveBeenCalledWith("pass");
    expect(localStorage.getItem(BLOB_MIGRATED_KEY)).toBe("true");
  });

  it("migrates a legacy blob exactly once, then runs row sync", async () => {
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: true } });
    mockListRemoteBooks.mockResolvedValue([]);
    const remoteBlob = {
      data: new Uint8Array([4, 5, 6]),
      checksum: "remote-checksum",
    };
    mockPullMetricsBlob.mockResolvedValue(remoteBlob);
    mockDecrypt.mockResolvedValue(
      '{"events":[],"tombstones":[],"updatedAt":2000}',
    );

    await syncBook("book-1", "pass", vi.fn());

    expect(mockDecrypt).toHaveBeenCalledWith(remoteBlob.data, "pass");
    expect(mockApplyLegacyBlobAndMarkPushed).toHaveBeenCalledWith({
      events: [],
      tombstones: [],
      updatedAt: 2000,
    });
    expect(mockSyncMetricsRows).toHaveBeenCalledWith("pass");
    expect(localStorage.getItem(BLOB_MIGRATED_KEY)).toBe("true");

    // Second sync — already migrated, skip the blob check entirely.
    mockPullMetricsBlob.mockClear();
    mockApplyLegacyBlobAndMarkPushed.mockClear();
    mockSyncMetricsRows.mockClear();

    await syncBook("book-1", "pass", vi.fn());

    expect(mockPullMetricsBlob).not.toHaveBeenCalled();
    expect(mockApplyLegacyBlobAndMarkPushed).not.toHaveBeenCalled();
    expect(mockSyncMetricsRows).toHaveBeenCalledWith("pass");
  });

  it("marks migration complete and continues if the legacy collection is missing", async () => {
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: true } });
    mockListRemoteBooks.mockResolvedValue([]);
    mockPullMetricsBlob.mockRejectedValue(
      Object.assign(new Error("collection not found"), { status: 404 }),
    );

    await syncBook("book-1", "pass", vi.fn());

    expect(mockApplyLegacyBlobAndMarkPushed).not.toHaveBeenCalled();
    expect(mockSyncMetricsRows).toHaveBeenCalledWith("pass");
    expect(localStorage.getItem(BLOB_MIGRATED_KEY)).toBe("true");
  });

  it("throws when the legacy blob decrypts to invalid JSON", async () => {
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: true } });
    mockListRemoteBooks.mockResolvedValue([]);
    mockPullMetricsBlob.mockResolvedValue({
      data: new Uint8Array([4, 5, 6]),
      checksum: "remote-checksum",
    });
    mockDecrypt.mockResolvedValue("not valid json at all");

    await expect(syncBook("book-1", "pass", vi.fn())).rejects.toThrow(
      "Synced metrics payload is invalid or corrupted",
    );
    // Migration must not be marked complete on a corrupt payload — we'll
    // retry next sync.
    expect(localStorage.getItem(BLOB_MIGRATED_KEY)).toBeNull();
  });

  it("runs metrics sync in syncAllBooks path when enabled", async () => {
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: true } });
    mockListRemoteBooks.mockResolvedValue([]);
    mockPullMetricsBlob.mockResolvedValue(null);

    await syncAllBooks("pass", vi.fn());

    expect(mockSyncMetricsRows).toHaveBeenCalledWith("pass");
  });

  it("runs metrics sync even on cancelled syncAllBooks (partial outcome)", async () => {
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: true } });
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return [{ id: "book-2", updated_at: 1000 }];
      if (sql.includes("SELECT title")) return [{ title: "Book Two" }];
      return [];
    });
    mockListRemoteBooks.mockResolvedValue([
      { bookId: "book-2", checksum: "remote-checksum", updatedAt: 5000 },
    ]);
    mockPullMetricsBlob.mockResolvedValue(null);

    const result = await syncAllBooks("pass", vi.fn().mockResolvedValue("cancel"));

    expect(result.outcome).toBe("cancelled");
    expect(mockSyncMetricsRows).toHaveBeenCalledWith("pass");
  });
});

describe("syncAllNotes — note sync parity with books", () => {
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
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockSyncStoreGetState.mockReturnValue({ authVerified: true });
    mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: false } });
    // No books in any of these tests — focus on notes.
    mockListRemoteBooks.mockResolvedValue([]);
    mockListRemoteNotes.mockResolvedValue([]);
    mockSerializeNote.mockResolvedValue('{"note":{"id":"note-1"}}');
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return []; // no local books
      if (sql.includes("FROM notes") && sql.includes("updated_at")) {
        return [{ id: "note-1", updated_at: 5000 }];
      }
      if (sql.includes("SELECT title FROM notes")) return [{ title: "My Note" }];
      return [];
    });
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it("pushes a local-only note", async () => {
    mockListRemoteNotes.mockResolvedValue([]);

    const result = await syncAllBooks("pass", vi.fn());

    expect(mockPushNoteBlob).toHaveBeenCalledWith("note-1", expect.anything(), "local-checksum");
    expect(result.actions).toContain("pushed");
  });

  it("skips a note whose checksum matches the remote", async () => {
    mockListRemoteNotes.mockResolvedValue([
      { remoteId: "r1", noteId: "note-1", checksum: "local-checksum", updatedAt: 5000 },
    ]);

    const result = await syncAllBooks("pass", vi.fn());

    expect(mockPushNoteBlob).not.toHaveBeenCalled();
    expect(result.actions).toContain("skipped");
  });

  it("pushes when local note is newer than a diverged remote", async () => {
    mockListRemoteNotes.mockResolvedValue([
      { remoteId: "r1", noteId: "note-1", checksum: "remote-checksum", updatedAt: 3000 },
    ]);

    await syncAllBooks("pass", vi.fn());

    expect(mockPushNoteBlob).toHaveBeenCalled();
  });

  it("asks for conflict resolution and applies remote on pull", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return [];
      if (sql.includes("FROM notes") && sql.includes("updated_at")) {
        return [{ id: "note-1", updated_at: 1000 }];
      }
      if (sql.includes("SELECT title FROM notes")) return [{ title: "My Note" }];
      return [];
    });
    mockListRemoteNotes.mockResolvedValue([
      { remoteId: "r1", noteId: "note-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);
    const onConflict = vi.fn().mockResolvedValue("pull");
    mockPullNoteBlob.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), checksum: "remote-checksum" });
    mockDecrypt.mockResolvedValue('{"note":{"id":"note-1"}}');

    const result = await syncAllBooks("pass", onConflict);

    expect(onConflict).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "note-1", bookTitle: "My Note" })
    );
    expect(mockApplyNoteSnapshot).toHaveBeenCalled();
    expect(result.actions).toContain("pulled");
  });

  it("pulls remote-only notes that have no local copy", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return [];
      if (sql.includes("FROM notes") && sql.includes("updated_at")) return []; // no local notes
      return [];
    });
    mockListRemoteNotes.mockResolvedValue([
      { remoteId: "r1", noteId: "note-remote", checksum: "remote-checksum", updatedAt: 5000 },
    ]);
    mockPullNoteBlob.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), checksum: "remote-checksum" });
    mockDecrypt.mockResolvedValue('{"note":{"id":"note-remote"}}');

    const result = await syncAllBooks("pass", vi.fn());

    expect(mockApplyNoteSnapshot).toHaveBeenCalled();
    expect(result.actions).toContain("pulled");
  });

  it("aborts the rest of note sync when a conflict is cancelled", async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY b.id")) return [];
      if (sql.includes("FROM notes") && sql.includes("updated_at")) {
        return [{ id: "note-1", updated_at: 1000 }];
      }
      if (sql.includes("SELECT title FROM notes")) return [{ title: "My Note" }];
      return [];
    });
    mockListRemoteNotes.mockResolvedValue([
      { remoteId: "r1", noteId: "note-1", checksum: "remote-checksum", updatedAt: 5000 },
    ]);

    const result = await syncAllBooks("pass", vi.fn().mockResolvedValue("cancel"));

    expect(result.outcome).toBe("cancelled");
    expect(result.actions).toContain("cancelled");
  });
});
