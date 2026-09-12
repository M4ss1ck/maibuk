import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

const { clearAllSyncBases, clearSyncBase, getSyncBase, setSyncBase } = await import(
  "@/features/sync/sync-state"
);

describe("sync base state", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
  });

  it("has no base for an item never synced", async () => {
    await expect(getSyncBase("book", "book-1")).resolves.toBeNull();
  });

  it("stores and replaces the base per entity", async () => {
    await setSyncBase("book", "book-1", { localChecksum: "l1", remoteChecksum: "r1" });
    await setSyncBase("book", "book-1", { localChecksum: "l2", remoteChecksum: "r2" });

    await expect(getSyncBase("book", "book-1")).resolves.toEqual({
      localChecksum: "l2",
      remoteChecksum: "r2",
    });
    const rows = await testDb.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM sync_state");
    expect(rows[0].n).toBe(1);
  });

  it("keeps books and notes with the same id apart", async () => {
    await setSyncBase("book", "same-id", { localChecksum: "book", remoteChecksum: "book" });
    await setSyncBase("note", "same-id", { localChecksum: "note", remoteChecksum: "note" });

    await expect(getSyncBase("book", "same-id")).resolves.toMatchObject({ localChecksum: "book" });
    await expect(getSyncBase("note", "same-id")).resolves.toMatchObject({ localChecksum: "note" });
  });

  it("clears every base", async () => {
    await setSyncBase("book", "book-1", { localChecksum: "l", remoteChecksum: "r" });
    await setSyncBase("note", "note-1", { localChecksum: "l", remoteChecksum: "r" });

    await clearAllSyncBases();

    await expect(getSyncBase("book", "book-1")).resolves.toBeNull();
    await expect(getSyncBase("note", "note-1")).resolves.toBeNull();
  });

  it("clears one entity's base", async () => {
    await setSyncBase("note", "note-1", { localChecksum: "l", remoteChecksum: "r" });
    await setSyncBase("note", "note-2", { localChecksum: "l", remoteChecksum: "r" });

    await clearSyncBase("note", "note-1");

    await expect(getSyncBase("note", "note-1")).resolves.toBeNull();
    await expect(getSyncBase("note", "note-2")).resolves.not.toBeNull();
  });
});
