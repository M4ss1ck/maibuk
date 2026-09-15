import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetDatabase = vi.hoisted(() => vi.fn());
const mockCreateBackupAdapter = vi.hoisted(() => vi.fn());
const mockSerializeBook = vi.hoisted(() => vi.fn());
const mockSerializeNote = vi.hoisted(() => vi.fn());
const mockSerializeCanvas = vi.hoisted(() => vi.fn());
const mockComputeChecksum = vi.hoisted(() => vi.fn());
const mockEncrypt = vi.hoisted(() => vi.fn());
const mockListRemoteBooks = vi.hoisted(() => vi.fn());
const mockListRemoteNotes = vi.hoisted(() => vi.fn());
const mockListRemoteCanvases = vi.hoisted(() => vi.fn());
const mockPushBookBlob = vi.hoisted(() => vi.fn());
const mockPushNoteBlob = vi.hoisted(() => vi.fn());
const mockPushCanvasBlob = vi.hoisted(() => vi.fn());
const mockDeleteRemoteBook = vi.hoisted(() => vi.fn());
const mockDeleteRemoteNote = vi.hoisted(() => vi.fn());
const mockDeleteRemoteCanvas = vi.hoisted(() => vi.fn());
const mockListRemoteDeletedBooks = vi.hoisted(() => vi.fn());
const mockListRemoteDeletedNotes = vi.hoisted(() => vi.fn());
const mockListRemoteDeletedCanvases = vi.hoisted(() => vi.fn());
const mockListRemoteVersions = vi.hoisted(() => vi.fn());
const mockSyncStoreGetState = vi.hoisted(() => vi.fn());
const mockUseSettingsStoreGetState = vi.hoisted(() => vi.fn());
const mockCreateVersion = vi.hoisted(() => vi.fn());
const mockSyncMetricsRows = vi.hoisted(() => vi.fn());
const mockListPendingTombstones = vi.hoisted(() => vi.fn());
const mockGetTombstone = vi.hoisted(() => vi.fn());
const mockMarkTombstonePushed = vi.hoisted(() => vi.fn());
const mockEnsureGenericCollectionMigration = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../features/sync/serializer", () => ({
  serializeBook: mockSerializeBook,
  applyBookSnapshot: vi.fn(),
  serializeNote: mockSerializeNote,
  applyNoteSnapshot: vi.fn(),
  serializeCanvas: mockSerializeCanvas,
  applyCanvasSnapshot: vi.fn(),
  removeLocalBook: vi.fn(),
  removeLocalNote: vi.fn(),
  removeLocalCanvas: vi.fn(),
}));

vi.mock("../../../../features/sync/crypto", () => ({
  computeChecksum: mockComputeChecksum,
  encrypt: mockEncrypt,
  decrypt: vi.fn(),
  isSyncCryptoError: () => false,
}));

vi.mock("../../../../features/sync/client", () => ({
  pushBookBlob: mockPushBookBlob,
  pullBookBlob: vi.fn().mockResolvedValue(null),
  listRemoteBooks: mockListRemoteBooks,
  listRemoteVersions: mockListRemoteVersions,
  pushVersionBlob: vi.fn(),
  pullVersionBlob: vi.fn().mockResolvedValue(null),
  refreshAuth: vi.fn(),
  pushNoteBlob: mockPushNoteBlob,
  pullNoteBlob: vi.fn().mockResolvedValue(null),
  listRemoteNotes: mockListRemoteNotes,
  pushCanvasBlob: mockPushCanvasBlob,
  pullCanvasBlob: vi.fn().mockResolvedValue(null),
  listRemoteCanvases: mockListRemoteCanvases,
  deleteRemoteBook: mockDeleteRemoteBook,
  deleteRemoteNote: mockDeleteRemoteNote,
  deleteRemoteCanvas: mockDeleteRemoteCanvas,
  listRemoteDeletedBooks: mockListRemoteDeletedBooks,
  listRemoteDeletedNotes: mockListRemoteDeletedNotes,
  listRemoteDeletedCanvases: mockListRemoteDeletedCanvases,
}));

vi.mock("../../../../lib/platform", () => ({
  getOS: vi.fn().mockResolvedValue({ locale: vi.fn().mockResolvedValue("en-US") }),
  createBackup: mockCreateBackupAdapter,
}));

vi.mock("../../../../features/sync/store", () => ({
  useSyncStore: {
    getState: mockSyncStoreGetState,
    setState: vi.fn(),
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
}));

vi.mock("../../../../features/sync/tombstones", () => ({
  listPendingTombstones: mockListPendingTombstones,
  hasTombstone: vi.fn().mockResolvedValue(false),
  getTombstone: mockGetTombstone,
  markTombstonePushed: mockMarkTombstonePushed,
  tombstoneId: (entityType: string, entityId: string) => `${entityType}:${entityId}`,
}));

vi.mock("../../../../features/sync/migration-reset", () => ({
  ensureGenericCollectionMigration: mockEnsureGenericCollectionMigration,
}));

const { syncAllBooks, resetSyncEngineForTests } = await import("@/features/sync/sync-engine");

const noopConflict = () => {
  throw new Error("unexpected conflict");
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSyncEngineForTests();
  const mockDb = {
    select: vi.fn(async (sql: string) => {
      if (sql.includes("canvases")) {
        if (sql.includes("SELECT title")) return [{ title: "Map" }];
        if (sql.includes("SELECT doc")) return [{ doc: '{"schemaVersion":3}' }];
        return [{ id: "canvas-1", updated_at: 1 }];
      }
      if (sql.includes("notes")) {
        if (sql.includes("SELECT title")) return [{ title: "Note" }];
        return [{ id: "note-1", updated_at: 1 }];
      }
      if (sql.includes("books") || sql.includes("chapters")) {
        if (sql.includes("SELECT title")) return [{ title: "Book" }];
        if (sql.includes("book_versions")) return [];
        return [{ id: "book-1", updated_at: 1 }];
      }
      return [];
    }),
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
  };
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
  mockSerializeCanvas.mockResolvedValue('{"canvas":{}}');
  mockComputeChecksum.mockResolvedValue("checksum");
  mockEncrypt.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockSyncStoreGetState.mockReturnValue({ authVerified: true });
  mockUseSettingsStoreGetState.mockReturnValue({ metrics: { syncMetrics: false } });
  mockListRemoteBooks.mockResolvedValue([]);
  mockListRemoteNotes.mockResolvedValue([]);
  mockListRemoteCanvases.mockResolvedValue([]);
  mockListRemoteDeletedBooks.mockResolvedValue([]);
  mockListRemoteDeletedNotes.mockResolvedValue([]);
  mockListRemoteDeletedCanvases.mockResolvedValue([]);
  mockListRemoteVersions.mockResolvedValue([]);
  mockListPendingTombstones.mockResolvedValue([]);
  mockGetTombstone.mockResolvedValue(null);
});

describe("sync scope — canvases", () => {
  it("'canvases' syncs only canvases", async () => {
    const result = await syncAllBooks("pass", noopConflict, { scope: "canvases" });

    expect(mockPushCanvasBlob).toHaveBeenCalledTimes(1);
    expect(mockPushBookBlob).not.toHaveBeenCalled();
    expect(mockPushNoteBlob).not.toHaveBeenCalled();
    expect(mockListRemoteCanvases).toHaveBeenCalled();
    expect(mockListRemoteBooks).not.toHaveBeenCalled();
    expect(mockListRemoteNotes).not.toHaveBeenCalled();
    expect(result.outcome).toBe("success");
  });

  it("'all' includes canvases", async () => {
    await syncAllBooks("pass", noopConflict, { scope: "all" });

    expect(mockPushBookBlob).toHaveBeenCalledTimes(1);
    expect(mockPushNoteBlob).toHaveBeenCalledTimes(1);
    expect(mockPushCanvasBlob).toHaveBeenCalledTimes(1);
  });

  it("'books' excludes canvases", async () => {
    await syncAllBooks("pass", noopConflict, { scope: "books" });

    expect(mockPushBookBlob).toHaveBeenCalledTimes(1);
    expect(mockPushNoteBlob).not.toHaveBeenCalled();
    expect(mockPushCanvasBlob).not.toHaveBeenCalled();
    expect(mockListRemoteCanvases).not.toHaveBeenCalled();
  });

  it("'notes' excludes canvases", async () => {
    await syncAllBooks("pass", noopConflict, { scope: "notes" });

    expect(mockPushNoteBlob).toHaveBeenCalledTimes(1);
    expect(mockPushBookBlob).not.toHaveBeenCalled();
    expect(mockPushCanvasBlob).not.toHaveBeenCalled();
    expect(mockListRemoteCanvases).not.toHaveBeenCalled();
  });
});
