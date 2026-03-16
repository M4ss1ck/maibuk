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
const mockApplyBookSnapshot = vi.hoisted(() => vi.fn());
const mockRefreshAuth = vi.hoisted(() => vi.fn());
const mockSyncStoreGetState = vi.hoisted(() => vi.fn());
const mockSyncStoreSetState = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../features/sync/serializer", () => ({
  serializeBook: mockSerializeBook,
  applyBookSnapshot: mockApplyBookSnapshot,
}));

vi.mock("../../../../features/sync/crypto", () => ({
  computeChecksum: mockComputeChecksum,
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
}));

vi.mock("../../../../features/sync/client", () => ({
  pushBookBlob: mockPushBookBlob,
  pullBookBlob: mockPullBookBlob,
  listRemoteBooks: mockListRemoteBooks,
  refreshAuth: mockRefreshAuth,
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

const mockBackupServiceCreateBackup = vi.hoisted(() => vi.fn());
vi.mock("../../../../features/backup/backup-service", () => ({
  BackupService: class {
    createBackup = mockBackupServiceCreateBackup;
    pruneBackups = vi.fn();
  },
}));

const { syncBook, syncAllBooks, resetSyncEngineForTests } = await import("../../../../features/sync/sync-engine");

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
    // Distinguish between timestamp query and title query to avoid false positives
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 5000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      return [];
    });
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
    const blockedConflict = () => new Promise<"push" | "pull" | "cancel">((resolve) => {
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
      "Could not create a safety backup. Sync aborted. Free up disk space and try again.",
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
      return [];
    });
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
      "Could not create a safety backup. Sync aborted. Free up disk space and try again.",
    );
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
    mockListRemoteBooks.mockResolvedValue([]);
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(MAX(ts)")) return [{ updated_at: 5000 }];
      if (sql.includes("SELECT title")) return [{ title: "Test Book" }];
      if (sql.includes("GROUP BY b.id")) return [{ id: "book-1", updated_at: 5000 }];
      return [];
    });
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
      expect.objectContaining({ authVerified: true }),
    );
  });

  it("throws sync.sessionExpired on 401 and clears auth state", async () => {
    mockSyncStoreGetState.mockReturnValue({ authVerified: false });
    const error = new Error("Token expired");
    (error as { status?: number }).status = 401;
    mockRefreshAuth.mockRejectedValue(error);

    await expect(syncBook("book-1", "pass", vi.fn())).rejects.toThrow(
      "sync.sessionExpired",
    );
    expect(mockSyncStoreSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        authStatus: "logged-out",
        authVerified: false,
      }),
    );
  });

  it("rethrows network errors without clearing auth state", async () => {
    mockSyncStoreGetState.mockReturnValue({ authVerified: false });
    mockRefreshAuth.mockRejectedValue(new Error("Failed to fetch"));

    await expect(syncBook("book-1", "pass", vi.fn())).rejects.toThrow(
      "Failed to fetch",
    );
    // Should NOT have cleared auth state
    expect(mockSyncStoreSetState).not.toHaveBeenCalledWith(
      expect.objectContaining({ authStatus: "logged-out" }),
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
