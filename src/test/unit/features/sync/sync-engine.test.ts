import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetDatabase = vi.hoisted(() => vi.fn());
const mockSerializeBook = vi.hoisted(() => vi.fn());
const mockComputeChecksum = vi.hoisted(() => vi.fn());
const mockEncrypt = vi.hoisted(() => vi.fn());
const mockDecrypt = vi.hoisted(() => vi.fn());
const mockPushBookBlob = vi.hoisted(() => vi.fn());
const mockPullBookBlob = vi.hoisted(() => vi.fn());
const mockListRemoteBooks = vi.hoisted(() => vi.fn());
const mockApplyBookSnapshot = vi.hoisted(() => vi.fn());

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
}));

// Pre-mock backup module — Task 10 will add backup imports to sync-engine.ts.
// Without this mock, vitest would try to resolve the real backup module and fail.
vi.mock("../../../../lib/platform", () => ({
  getOS: vi.fn().mockResolvedValue({ locale: vi.fn().mockResolvedValue("en-US") }),
  createBackup: vi.fn().mockResolvedValue({
    saveBackup: vi.fn(),
    listBackups: vi.fn().mockResolvedValue([]),
    readBackup: vi.fn(),
    deleteBackup: vi.fn(),
  }),
}));

vi.mock("../../../../features/backup/backup-service", () => ({
  BackupService: class {
    createBackup = vi.fn().mockResolvedValue("mock-backup.sql");
    pruneBackups = vi.fn();
  },
}));

const { syncBook, syncAllBooks } = await import("../../../../features/sync/sync-engine");

describe("syncBook — timestamp fix", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  const noopConflict = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDatabase.mockResolvedValue(mockDb);
    mockSerializeBook.mockResolvedValue('{"book":{}}');
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
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
});

describe("syncAllBooks — truthful outcomes", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDatabase.mockResolvedValue(mockDb);
    mockSerializeBook.mockResolvedValue('{"book":{}}');
    mockComputeChecksum.mockResolvedValue("local-checksum");
    mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
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
});
