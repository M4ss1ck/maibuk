import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

const { mockSerializeBook, mockApplyBookSnapshot } = vi.hoisted(() => ({
  mockSerializeBook: vi.fn(),
  mockApplyBookSnapshot: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../features/sync/serializer", () => ({
  serializeBook: mockSerializeBook,
  applyBookSnapshot: mockApplyBookSnapshot,
}));

const { useVersionStore } = await import("../../../../features/versions/store");

async function seedBook(db: DatabaseAdapter, bookId = "book-1") {
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [bookId, "Test Book", "Author", now, now]
  );
}

function makeSnapshot(wordCount: number, updatedAt: number): string {
  return JSON.stringify({
    book: {
      id: "book-1",
      title: "Test Book",
      subtitle: null,
      authorName: "Author",
      description: null,
      genre: null,
      language: "en",
      coverImagePath: null,
      coverData: null,
      wordCount,
      targetWordCount: null,
      status: "draft",
      createdAt: updatedAt,
      updatedAt,
      lastOpenedAt: null,
      lastChapterId: null,
    },
    chapters: [],
  });
}

describe("useVersionStore", () => {
  let testDb: DatabaseAdapter;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await seedBook(testDb);
    mockSerializeBook.mockReset();
    mockApplyBookSnapshot.mockReset();

    useVersionStore.setState({
      versions: [],
      currentBookId: null,
      isLoading: false,
      error: null,
    });
  });

  describe("createVersion", () => {
    it("inserts a row and returns a BookVersion", async () => {
      const snapshot = makeSnapshot(1000, 1000);
      mockSerializeBook.mockResolvedValue(snapshot);

      const version = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        name: "Draft 1",
        triggerType: "manual",
      });

      expect(version).not.toBeNull();
      expect(version?.name).toBe("Draft 1");
      expect(version?.triggerType).toBe("manual");
      expect(version?.bookId).toBe("book-1");
      expect(version?.wordCount).toBe(1000);

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM book_versions WHERE id = ?",
        [version!.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].snapshot).toBe(snapshot);
      expect(rows[0].trigger_type).toBe("manual");
    });

    it("dedups when checksum matches the last version", async () => {
      const snapshot = makeSnapshot(1000, 1000);
      mockSerializeBook.mockResolvedValue(snapshot);

      const v1 = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });
      expect(v1).not.toBeNull();

      const v2 = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });
      expect(v2).toBeNull();

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM book_versions WHERE book_id = ?",
        ["book-1"]
      );
      expect(rows).toHaveLength(1);
    });

    it("preends new version to local state when currentBookId matches", async () => {
      const snapshot = makeSnapshot(1000, 1000);
      mockSerializeBook.mockResolvedValue(snapshot);

      useVersionStore.setState({ currentBookId: "book-1" });

      await useVersionStore.getState().createVersion({
        bookId: "book-1",
        name: "First",
        triggerType: "manual",
      });

      expect(useVersionStore.getState().versions).toHaveLength(1);
      expect(useVersionStore.getState().versions[0].name).toBe("First");
    });
  });

  describe("loadVersions", () => {
    it("returns versions ordered by created_at DESC, id DESC", async () => {
      const now = Math.floor(Date.now() / 1000);
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-a", "book-1", null, "{}", 0, "chk-a", "auto-idle", now]
      );
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-b", "book-1", null, "{}", 0, "chk-b", "manual", now]
      );

      await useVersionStore.getState().loadVersions("book-1");

      const ids = useVersionStore.getState().versions.map((v) => v.id);
      expect(ids).toEqual(["ver-b", "ver-a"]);
    });

    it("never exposes the snapshot field", async () => {
      const now = Math.floor(Date.now() / 1000);
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-1", "book-1", null, '{"secret": true}', 0, "chk-1", "manual", now]
      );

      await useVersionStore.getState().loadVersions("book-1");

      const version = useVersionStore.getState().versions[0];
      expect(version).toBeDefined();
      expect("snapshot" in version).toBe(false);
    });
  });

  describe("getVersionSnapshot", () => {
    it("returns the stored JSON string", async () => {
      const now = Math.floor(Date.now() / 1000);
      const snapshot = '{"book":{"title":"Test"}}';
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-1", "book-1", null, snapshot, 0, "chk-1", "manual", now]
      );

      const result = await useVersionStore.getState().getVersionSnapshot("ver-1");
      expect(result).toBe(snapshot);
    });

    it("throws when version is not found", async () => {
      await expect(
        useVersionStore.getState().getVersionSnapshot("missing")
      ).rejects.toThrow("Version not found");
    });
  });

  describe("restoreVersion", () => {
    it("creates a pre-restore version with correct triggerType and name", async () => {
      const targetSnapshot = makeSnapshot(1000, 1000);
      const currentSnapshot = makeSnapshot(1200, 2000);

      mockSerializeBook
        .mockResolvedValueOnce(targetSnapshot)
        .mockResolvedValueOnce(currentSnapshot);

      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        name: "Target",
        triggerType: "manual",
      });

      await useVersionStore.getState().restoreVersion(target!.id, {
        preRestoreName: "Before restoring \"Target\"",
      });

      const rows = await testDb.select<Record<string, unknown>[]>(
        `SELECT * FROM book_versions WHERE book_id = ? AND trigger_type = ?`,
        ["book-1", "pre-restore"]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Before restoring "Target"');
    });

    it("bumps updatedAt timestamps in the snapshot before applying", async () => {
      const targetSnapshot = makeSnapshot(1000, 1000);
      const currentSnapshot = makeSnapshot(1200, 2000);

      mockSerializeBook
        .mockResolvedValueOnce(targetSnapshot)
        .mockResolvedValueOnce(currentSnapshot);

      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });

      const beforeRestore = Math.floor(Date.now() / 1000);
      await useVersionStore.getState().restoreVersion(target!.id);
      const afterRestore = Math.floor(Date.now() / 1000);

      expect(mockApplyBookSnapshot).toHaveBeenCalledTimes(1);
      const applied = mockApplyBookSnapshot.mock.calls[0][0] as {
        book: { updatedAt: number };
        chapters: Array<{ updatedAt: number }>;
      };

      expect(applied.book.updatedAt).toBeGreaterThanOrEqual(beforeRestore);
      expect(applied.book.updatedAt).toBeLessThanOrEqual(afterRestore);
    });

    it("refreshes version list after restore", async () => {
      const targetSnapshot = makeSnapshot(1000, 1000);
      const currentSnapshot = makeSnapshot(1200, 2000);

      mockSerializeBook
        .mockResolvedValueOnce(targetSnapshot)
        .mockResolvedValueOnce(currentSnapshot);

      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });

      useVersionStore.setState({ currentBookId: "book-1" });
      await useVersionStore.getState().restoreVersion(target!.id);

      // Should have the original + pre-restore versions in state
      expect(useVersionStore.getState().versions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("renameVersion", () => {
    it("updates the name in DB and state", async () => {
      const now = Math.floor(Date.now() / 1000);
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-1", "book-1", "Old Name", "{}", 0, "chk-1", "manual", now]
      );

      useVersionStore.setState({
        currentBookId: "book-1",
        versions: [
          {
            id: "ver-1",
            bookId: "book-1",
            name: "Old Name",
            wordCount: 0,
            checksum: "chk-1",
            triggerType: "manual",
            createdAt: new Date(now * 1000),
            syncedAt: null,
          },
        ],
      });

      await useVersionStore.getState().renameVersion("ver-1", "New Name");

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT name FROM book_versions WHERE id = ?",
        ["ver-1"]
      );
      expect(rows[0].name).toBe("New Name");
      expect(useVersionStore.getState().versions[0].name).toBe("New Name");
    });
  });

  describe("deleteVersion", () => {
    it("removes the row from DB and state", async () => {
      const now = Math.floor(Date.now() / 1000);
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-1", "book-1", null, "{}", 0, "chk-1", "manual", now]
      );

      useVersionStore.setState({
        currentBookId: "book-1",
        versions: [
          {
            id: "ver-1",
            bookId: "book-1",
            name: null,
            wordCount: 0,
            checksum: "chk-1",
            triggerType: "manual",
            createdAt: new Date(now * 1000),
            syncedAt: null,
          },
        ],
      });

      await useVersionStore.getState().deleteVersion("ver-1");

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM book_versions WHERE id = ?",
        ["ver-1"]
      );
      expect(rows).toHaveLength(0);
      expect(useVersionStore.getState().versions).toHaveLength(0);
    });
  });
});
