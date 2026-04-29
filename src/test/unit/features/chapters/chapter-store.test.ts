import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

// --- Mock getDatabase ---
let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

const { useChapterStore } = await import("../../../../features/chapters/store");

// Helper: seed a book row so FK constraints pass
async function seedBook(db: DatabaseAdapter, bookId = "book-1") {
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [bookId, "Test Book", "Author", now, now]
  );
}

describe("useChapterStore", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await seedBook(testDb);

    useChapterStore.setState({
      chapters: [],
      currentChapter: null,
      currentBookId: null,
      isLoading: false,
      error: null,
    });
  });

  describe("initial state", () => {
    it("starts empty", () => {
      const state = useChapterStore.getState();
      expect(state.chapters).toEqual([]);
      expect(state.currentChapter).toBeNull();
      expect(state.isLoading).toBe(false);
    });
  });

  describe("createChapter()", () => {
    it("creates a chapter with auto-assigned order", async () => {
      const chapter = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Chapter 1",
      });

      expect(chapter.title).toBe("Chapter 1");
      expect(chapter.bookId).toBe("book-1");
      expect(chapter.order).toBe(0); // first chapter → order 0
      expect(chapter.chapterType).toBe("chapter");
      expect(chapter.wordCount).toBe(0);
      expect(chapter.status).toBe("draft");
      expect(chapter.isIncludedInExport).toBe(true);
    });

    it("auto-increments order for subsequent chapters", async () => {
      const ch1 = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "First",
      });
      const ch2 = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Second",
      });

      expect(ch1.order).toBe(0);
      expect(ch2.order).toBe(1);
    });

    it("adds chapter to local state", async () => {
      await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "New",
      });

      expect(useChapterStore.getState().chapters).toHaveLength(1);
    });

    it("creates chapter with custom chapterType", async () => {
      const chapter = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Prologue",
        chapterType: "prologue",
      });

      expect(chapter.chapterType).toBe("prologue");
    });

    it("persists chapter in the database", async () => {
      const chapter = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Persisted",
      });

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM chapters WHERE id = ?",
        [chapter.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("Persisted");
    });
  });

  describe("loadChapters()", () => {
    it("loads chapters for a book", async () => {
      await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Ch 1",
      });
      await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Ch 2",
      });

      // Reset local state
      useChapterStore.setState({ chapters: [], currentBookId: null });

      await useChapterStore.getState().loadChapters("book-1");

      const { chapters, currentBookId } = useChapterStore.getState();
      expect(chapters).toHaveLength(2);
      expect(currentBookId).toBe("book-1");
    });

    it("clears previous chapters and currentChapter on load", async () => {
      // Simulate some pre-existing state
      useChapterStore.setState({
        chapters: [
          {
            id: "old",
            bookId: "other",
            title: "Old",
            content: null,
            order: 0,
            chapterType: "chapter" as const,
            wordCount: 0,
            status: "draft" as const,
            isIncludedInExport: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        currentChapter: null,
      });

      await useChapterStore.getState().loadChapters("book-1");

      // Should now be empty since book-1 has no chapters
      expect(useChapterStore.getState().chapters).toHaveLength(0);
    });

    it("sets error on failure", async () => {
      mockGetDatabase.mockRejectedValueOnce(new Error("Load failed"));

      await useChapterStore.getState().loadChapters("book-1");

      expect(useChapterStore.getState().error).toContain("Load failed");
    });
  });

  describe("loadChapter()", () => {
    it("loads a single chapter as currentChapter", async () => {
      const created = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "To Load",
      });

      useChapterStore.setState({ currentChapter: null });

      await useChapterStore.getState().loadChapter(created.id);

      expect(useChapterStore.getState().currentChapter?.title).toBe("To Load");
    });

    it("sets error when chapter is not found", async () => {
      await useChapterStore.getState().loadChapter("nonexistent");

      expect(useChapterStore.getState().error).toContain("Chapter not found");
    });
  });

  describe("updateChapter()", () => {
    it("updates chapter fields in DB and state", async () => {
      const created = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Original",
      });

      await useChapterStore.getState().updateChapter(created.id, {
        title: "Updated",
        status: "revised",
      });

      const chapter = useChapterStore.getState().chapters.find((c) => c.id === created.id);
      expect(chapter?.title).toBe("Updated");
      expect(chapter?.status).toBe("revised");
    });

    it("calculates word count when content is updated", async () => {
      const created = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Content Test",
      });

      await useChapterStore.getState().updateChapter(created.id, {
        content: "<p>Hello world this is a test</p>",
      });

      const chapter = useChapterStore.getState().chapters.find((c) => c.id === created.id);
      expect(chapter?.wordCount).toBe(6);
    });

    it("strips HTML tags before counting words", async () => {
      const created = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "HTML Test",
      });

      await useChapterStore.getState().updateChapter(created.id, {
        content: "<h1>Title</h1><p>One <strong>bold</strong> word</p>",
      });

      const chapter = useChapterStore.getState().chapters.find((c) => c.id === created.id);
      // "Title One bold word" = 4 words
      expect(chapter?.wordCount).toBe(4);
    });

    it("updates currentChapter when it matches", async () => {
      const created = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Current",
      });
      useChapterStore.setState({ currentChapter: created });

      await useChapterStore.getState().updateChapter(created.id, {
        title: "Updated Current",
      });

      expect(useChapterStore.getState().currentChapter?.title).toBe("Updated Current");
    });

    it("persists update in the database", async () => {
      const created = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Before",
      });

      await useChapterStore.getState().updateChapter(created.id, {
        title: "After",
        synopsis: "A summary",
      });

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT title, synopsis FROM chapters WHERE id = ?",
        [created.id]
      );
      expect(rows[0].title).toBe("After");
      expect(rows[0].synopsis).toBe("A summary");
    });
  });

  describe("deleteChapter()", () => {
    it("removes chapter from state and database", async () => {
      const created = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "To Delete",
      });

      await useChapterStore.getState().deleteChapter(created.id);

      expect(useChapterStore.getState().chapters).toHaveLength(0);

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM chapters WHERE id = ?",
        [created.id]
      );
      expect(rows).toHaveLength(0);
    });

    it("clears currentChapter when deleting it", async () => {
      const created = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Current",
      });
      useChapterStore.setState({ currentChapter: created });

      await useChapterStore.getState().deleteChapter(created.id);

      expect(useChapterStore.getState().currentChapter).toBeNull();
    });
  });

  describe("reorderChapters()", () => {
    it("updates order of chapters in DB and state", async () => {
      const ch1 = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "First",
      });
      const ch2 = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Second",
      });
      const ch3 = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "Third",
      });

      // Reverse the order
      await useChapterStore.getState().reorderChapters("book-1", [ch3.id, ch2.id, ch1.id]);

      const { chapters } = useChapterStore.getState();
      expect(chapters[0].title).toBe("Third");
      expect(chapters[1].title).toBe("Second");
      expect(chapters[2].title).toBe("First");
    });

    it("persists new order in database", async () => {
      const ch1 = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "A",
      });
      const ch2 = await useChapterStore.getState().createChapter({
        bookId: "book-1",
        title: "B",
      });

      await useChapterStore.getState().reorderChapters("book-1", [ch2.id, ch1.id]);

      const rows = await testDb.select<Record<string, unknown>[]>(
        'SELECT id, "order" FROM chapters ORDER BY "order" ASC'
      );
      expect(rows[0].id).toBe(ch2.id);
      expect(rows[1].id).toBe(ch1.id);
    });
  });

  describe("setCurrentChapter()", () => {
    it("sets the current chapter directly", () => {
      const chapter = {
        id: "ch-1",
        bookId: "book-1",
        title: "Direct",
        content: null,
        order: 0,
        chapterType: "chapter" as const,
        wordCount: 0,
        status: "draft" as const,
        isIncludedInExport: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      useChapterStore.getState().setCurrentChapter(chapter);

      expect(useChapterStore.getState().currentChapter?.id).toBe("ch-1");
    });

    it("clears current chapter when passed null", () => {
      useChapterStore.getState().setCurrentChapter(null);

      expect(useChapterStore.getState().currentChapter).toBeNull();
    });
  });
});
