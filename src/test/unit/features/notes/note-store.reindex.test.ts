import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));
vi.mock("../../../../features/sync/tombstones", () => ({
  recordTombstone: vi.fn(),
}));

const { useNoteStore } = await import("../../../../features/notes/store");

describe("note store reindex on save", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    useNoteStore.setState({ notes: [], currentNote: null });
  });

  it("indexes wikilinks when a note is saved", async () => {
    const note = await useNoteStore.getState().createNote({ title: "Src" });
    await useNoteStore.getState().updateNote({
      id: note.id,
      content: '<p><a class="wikilink" href="maibuk://note/n2">x</a></p>',
    });
    const rows = await testDb.select<{ target_id: string }[]>(
      "SELECT target_id FROM links WHERE source_id = ?",
      [note.id],
    );
    expect(rows).toEqual([{ target_id: "n2" }]);
  });
});
