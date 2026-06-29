import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

const {
  confirmTombstones,
  hasTombstone,
  listPendingTombstones,
  markTombstonePushed,
  recordTombstone,
} = await import("@/features/sync/tombstones");

describe("sync tombstones", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
  });

  it("records a pending tombstone idempotently", async () => {
    await recordTombstone({
      entityType: "book",
      entityId: "book-1",
      title: "Draft",
      deletedAt: 1000,
    });
    await recordTombstone({
      entityType: "book",
      entityId: "book-1",
      title: "Draft renamed",
      deletedAt: 2000,
    });

    const pending = await listPendingTombstones(["book"]);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      entityType: "book",
      entityId: "book-1",
      title: "Draft renamed",
      deletedAt: 2000,
      confirmedAt: null,
      pushedAt: null,
    });
  });

  it("confirms and marks tombstones as pushed", async () => {
    await recordTombstone({
      entityType: "note",
      entityId: "note-1",
      title: "Idea",
      deletedAt: 1000,
    });

    await confirmTombstones(["note:note-1"], 1100);
    await markTombstonePushed("note", "note-1", 1200);

    const pending = await listPendingTombstones(["note"]);
    const rows = await testDb.select<Record<string, unknown>[]>(
      "SELECT confirmed_at, pushed_at FROM sync_tombstones WHERE entity_type = ? AND entity_id = ?",
      ["note", "note-1"]
    );

    expect(pending).toHaveLength(0);
    expect(rows[0]).toEqual({ confirmed_at: 1100, pushed_at: 1200 });
  });

  it("reports whether a local tombstone exists for an entity", async () => {
    await recordTombstone({
      entityType: "book",
      entityId: "book-1",
      title: "Draft",
      deletedAt: 1000,
    });

    await expect(hasTombstone("book", "book-1")).resolves.toBe(true);
    await expect(hasTombstone("book", "missing")).resolves.toBe(false);
  });
});
