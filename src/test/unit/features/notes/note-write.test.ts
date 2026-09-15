import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { onChange, resetChangeFeedForTests, type Change } from "@/features/sync/change-feed";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

const { useNoteStore } = await import("@/features/notes/store");
const { updateNoteRow } = await import("@/features/notes/write");

describe("note write path", () => {
  let changes: Change[];

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);
    resetChangeFeedForTests();
    changes = [];
    onChange((change) => {
      changes.push(change);
    });
    useNoteStore.setState({ notes: [], currentNote: null, isLoading: false, error: null });
  });

  afterEach(() => {
    resetChangeFeedForTests();
  });

  it("creates a note as a local content change", async () => {
    const note = await useNoteStore.getState().createNote({ title: "New" });

    expect(changes).toEqual([{ entity: "note", id: note.id, origin: "local", kind: "content" }]);
    expect(note.contentUpdatedAt).toBe(note.createdAt);
  });

  it("marks title and content edits as content", async () => {
    const note = await useNoteStore.getState().createNote({ title: "A" });
    changes.length = 0;

    await useNoteStore.getState().updateNote({ id: note.id, title: "B" });
    await useNoteStore.getState().updateNote({ id: note.id, content: "<p>Body</p>" });

    expect(changes.map((c) => c.kind)).toEqual(["content", "content"]);
  });

  it("marks tagging, pinning, and filing as metadata without moving Last Edited", async () => {
    const note = await useNoteStore.getState().createNote({ title: "A" });
    const before = note.contentUpdatedAt;
    changes.length = 0;

    const tagged = await useNoteStore.getState().updateNote({ id: note.id, tags: ["x"] });
    const pinned = await useNoteStore.getState().updateNote({ id: tagged!.id, pinned: true });
    const filed = await useNoteStore.getState().updateNote({ id: pinned!.id, bookId: "b1" });

    expect(changes.map((c) => c.kind)).toEqual(["metadata", "metadata", "metadata"]);
    expect(filed?.contentUpdatedAt).toBe(before);
    // updated_at is the sync clock and still bumps on every write.
    expect(filed?.updatedAt).toBeGreaterThanOrEqual(note.updatedAt);
  });

  it("emits the given origin, so remote writes never schedule Auto Sync", async () => {
    const note = await useNoteStore.getState().createNote({ title: "A" });
    changes.length = 0;

    await updateNoteRow({ id: note.id, title: "Remote" }, "remote");

    expect(changes).toEqual([{ entity: "note", id: note.id, origin: "remote", kind: "content" }]);
  });

  it("emits nothing when the write fails before persistence", async () => {
    mockGetDatabase.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      useNoteStore.getState().createNote({ title: "Lost" })
    ).rejects.toThrow("disk full");
    expect(changes).toEqual([]);
  });

  it("records a tombstone on a local delete", async () => {
    const note = await useNoteStore.getState().createNote({ title: "Gone" });
    changes.length = 0;

    await useNoteStore.getState().deleteNote(note.id);

    const tombstones = await testDb.select<{ entity_id: string }[]>(
      "SELECT entity_id FROM sync_tombstones WHERE entity_type = 'note'"
    );
    expect(tombstones.map((t) => t.entity_id)).toEqual([note.id]);
    expect(changes).toEqual([{ entity: "note", id: note.id, origin: "local", kind: "content" }]);
  });

  it("emits nothing when a reorder persists zero rows", async () => {
    await useNoteStore.getState().reorderNotes(["ghost-1", "ghost-2"]);

    expect(changes).toEqual([]);
  });

  it("emits only for the reorder rows that actually persisted", async () => {
    const kept = await useNoteStore.getState().createNote({ title: "Kept" });
    changes.length = 0;

    await useNoteStore.getState().reorderNotes([kept.id, "ghost-1"]);

    expect(changes).toEqual([{ entity: "note", id: kept.id, origin: "local", kind: "metadata" }]);
  });
});
