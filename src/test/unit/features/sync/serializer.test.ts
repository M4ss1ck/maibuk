import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import type { NoteSnapshot } from "../../../../features/sync/types";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

const { applyNoteSnapshot, normalizeNoteSnapshotForSync } = await import(
  "../../../../features/sync/serializer"
);

describe("note snapshot serializer", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
  });

  it("preserves local collapsed headings when applying a pulled note snapshot", async () => {
    await testDb.execute(
      `INSERT INTO notes (id, title, content, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "note-1",
        "Local title",
        "<p>Local</p>",
        "[]",
        0,
        0,
        1,
        '["local-heading"]',
        10,
        20,
      ],
    );

    const snapshot: NoteSnapshot = {
      note: {
        id: "note-1",
        title: "Remote title",
        content: "<p>Remote</p>",
        tags: "[]",
        pinned: false,
        order: 0,
        wordCount: 2,
        collapsedHeadings: '["remote-heading"]',
        createdAt: 10,
        updatedAt: 30,
      },
    };

    await applyNoteSnapshot(snapshot);

    const rows = await testDb.select<{ collapsed_headings: string; title: string }[]>(
      "SELECT title, collapsed_headings FROM notes WHERE id = ?",
      ["note-1"],
    );
    expect(rows[0]).toEqual({
      title: "Remote title",
      collapsed_headings: '["local-heading"]',
    });
  });

  it("normalizes collapsed headings out of note snapshots used for sync checksums", () => {
    const first = JSON.stringify({
      note: {
        id: "note-1",
        title: "Same",
        collapsedHeadings: '["a"]',
        updatedAt: 20,
      },
    });
    const second = JSON.stringify({
      note: {
        id: "note-1",
        title: "Same",
        collapsedHeadings: '["b"]',
        updatedAt: 20,
      },
    });

    expect(normalizeNoteSnapshotForSync(first)).toBe(normalizeNoteSnapshotForSync(second));
  });
});
