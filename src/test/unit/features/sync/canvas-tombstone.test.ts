import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression test for the pending-deletion dispatcher: a tombstone whose kind
// has no registered sync adapter (e.g. "canvas", which nothing syncs yet)
// must never be sent to another kind's remote delete. The pre-Entity-Sync
// engine sent every non-book tombstone to `deleteRemoteNote`; restoring that
// fallback (`registry[type] ?? registry.note`) turns this test red.
const mockDeleteRemoteBook = vi.hoisted(() => vi.fn());
const mockDeleteRemoteNote = vi.hoisted(() => vi.fn());
const mockMarkTombstonePushed = vi.hoisted(() => vi.fn());
const mockClearSyncBase = vi.hoisted(() => vi.fn());
const mockListPendingTombstones = vi.hoisted(() => vi.fn());

vi.mock("../../../../features/sync/tombstones", () => ({
  listPendingTombstones: mockListPendingTombstones,
  markTombstonePushed: mockMarkTombstonePushed,
  getTombstone: vi.fn().mockResolvedValue(null),
  hasTombstone: vi.fn().mockResolvedValue(false),
  tombstoneId: (entityType: string, entityId: string) => `${entityType}:${entityId}`,
}));

vi.mock("../../../../features/sync/sync-state", () => ({
  getSyncBase: vi.fn().mockResolvedValue(null),
  setSyncBase: vi.fn().mockResolvedValue(undefined),
  clearSyncBase: mockClearSyncBase,
}));

const { processPendingDeletions } = await import("@/features/sync/entity-sync");

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteRemoteBook.mockResolvedValue(undefined);
  mockDeleteRemoteNote.mockResolvedValue(undefined);
  mockMarkTombstonePushed.mockResolvedValue(undefined);
});

describe("canvas tombstone", () => {
  it("never calls another kind's remote delete for an unregistered kind", async () => {
    mockListPendingTombstones.mockResolvedValue([
      {
        id: "canvas:canvas-1",
        entityType: "canvas",
        entityId: "canvas-1",
        title: "Plot map",
        deletedAt: 1000,
        confirmedAt: 1001,
        pushedAt: null,
      },
    ]);

    const emitLog = vi.fn();
    const result = await processPendingDeletions(
      {
        book: { deleteRemote: mockDeleteRemoteBook },
        note: { deleteRemote: mockDeleteRemoteNote },
      },
      ["book", "note", "canvas"],
      { scope: "all", direction: "bidirectional", confirmedDeletionIds: [] },
      emitLog
    );

    expect(mockDeleteRemoteBook).not.toHaveBeenCalled();
    expect(mockDeleteRemoteNote).not.toHaveBeenCalled();
    expect(mockMarkTombstonePushed).not.toHaveBeenCalled();
    expect(mockClearSyncBase).not.toHaveBeenCalled();
    expect(result).toEqual({ actions: [], pendingDeletions: [] });
  });

  it("still pushes confirmed book and note deletions through their own adapter", async () => {
    mockListPendingTombstones.mockResolvedValue([
      {
        id: "book:book-1",
        entityType: "book",
        entityId: "book-1",
        title: "A Book",
        deletedAt: 1000,
        confirmedAt: 1001,
        pushedAt: null,
      },
      {
        id: "note:note-1",
        entityType: "note",
        entityId: "note-1",
        title: "A Note",
        deletedAt: 1000,
        confirmedAt: 1001,
        pushedAt: null,
      },
    ]);

    const emitLog = vi.fn();
    const result = await processPendingDeletions(
      {
        book: { deleteRemote: mockDeleteRemoteBook },
        note: { deleteRemote: mockDeleteRemoteNote },
      },
      ["book", "note"],
      { scope: "all", direction: "bidirectional", confirmedDeletionIds: [] },
      emitLog
    );

    expect(mockDeleteRemoteBook).toHaveBeenCalledWith("book-1");
    expect(mockDeleteRemoteNote).toHaveBeenCalledWith("note-1");
    expect(mockMarkTombstonePushed).toHaveBeenCalledTimes(2);
    expect(result.actions).toEqual(["pushed", "pushed"]);
  });
});
