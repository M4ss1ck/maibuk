import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

// --- Mock getDatabase to return our in-memory DB ---
let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

// Import store AFTER mock is set up (vi.mock is hoisted automatically)
const { useBookStore } = await import("../../../../features/books/store");

describe("useBookStore", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);

    // Reset store to initial state
    useBookStore.setState({
      books: [],
      currentBook: null,
      isLoading: false,
      error: null,
    });
  });

  describe("initial state", () => {
    it("starts with empty books array", () => {
      const state = useBookStore.getState();
      expect(state.books).toEqual([]);
      expect(state.currentBook).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe("createBook()", () => {
    it("creates a book and adds it to state", async () => {
      const book = await useBookStore.getState().createBook({
        title: "My Novel",
        authorName: "Jane Doe",
      });

      expect(book.title).toBe("My Novel");
      expect(book.authorName).toBe("Jane Doe");
      expect(book.language).toBe("en");
      expect(book.wordCount).toBe(0);
      expect(book.status).toBe("draft");
      expect(book.id).toBeDefined();

      const { books } = useBookStore.getState();
      expect(books).toHaveLength(1);
      expect(books[0].id).toBe(book.id);
    });

    it("persists book in the database", async () => {
      const book = await useBookStore.getState().createBook({
        title: "Persisted",
        authorName: "Author",
      });

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM books WHERE id = ?",
        [book.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("Persisted");
      expect(rows[0].author_name).toBe("Author");
    });

    it("creates book with optional fields", async () => {
      const book = await useBookStore.getState().createBook({
        title: "Full Book",
        authorName: "Author",
        subtitle: "A subtitle",
        description: "A description",
        genre: "Fantasy",
      });

      expect(book.subtitle).toBe("A subtitle");
      expect(book.description).toBe("A description");
      expect(book.genre).toBe("Fantasy");
    });
  });

  describe("loadBooks()", () => {
    it("loads books from the database", async () => {
      await useBookStore.getState().createBook({
        title: "Book 1",
        authorName: "Author",
      });
      await useBookStore.getState().createBook({
        title: "Book 2",
        authorName: "Author",
      });

      // Reset local state to simulate fresh load
      useBookStore.setState({ books: [] });

      await useBookStore.getState().loadBooks();

      const { books } = useBookStore.getState();
      expect(books).toHaveLength(2);
    });

    it("sets isLoading during load", async () => {
      const loadPromise = useBookStore.getState().loadBooks();
      // isLoading should be true immediately
      expect(useBookStore.getState().isLoading).toBe(true);
      await loadPromise;
      expect(useBookStore.getState().isLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      mockGetDatabase.mockRejectedValueOnce(new Error("DB error"));

      await useBookStore.getState().loadBooks();

      const { error, isLoading } = useBookStore.getState();
      expect(error).toContain("DB error");
      expect(isLoading).toBe(false);
    });
  });

  describe("loadBook()", () => {
    it("loads a single book and sets it as currentBook", async () => {
      const created = await useBookStore.getState().createBook({
        title: "To Load",
        authorName: "Author",
      });

      await useBookStore.getState().loadBook(created.id);

      const { currentBook } = useBookStore.getState();
      expect(currentBook).not.toBeNull();
      expect(currentBook!.title).toBe("To Load");
    });

    it("updates last_opened_at in the database", async () => {
      const created = await useBookStore.getState().createBook({
        title: "Opened",
        authorName: "Author",
      });

      await useBookStore.getState().loadBook(created.id);

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT last_opened_at FROM books WHERE id = ?",
        [created.id]
      );
      expect(rows[0].last_opened_at).toBeDefined();
      expect(rows[0].last_opened_at).not.toBeNull();
    });

    it("sets error when book is not found", async () => {
      await useBookStore.getState().loadBook("nonexistent-id");

      const { error } = useBookStore.getState();
      expect(error).toContain("Book not found");
    });
  });

  describe("updateBook()", () => {
    it("updates book fields in DB and state", async () => {
      const created = await useBookStore.getState().createBook({
        title: "Original",
        authorName: "Author",
      });

      await useBookStore.getState().updateBook(created.id, {
        title: "Updated Title",
        status: "in-progress",
      });

      const { books } = useBookStore.getState();
      const updated = books.find((b) => b.id === created.id);
      expect(updated?.title).toBe("Updated Title");
      expect(updated?.status).toBe("in-progress");
    });

    it("updates currentBook when it matches", async () => {
      const created = await useBookStore.getState().createBook({
        title: "Current",
        authorName: "Author",
      });
      useBookStore.setState({ currentBook: created });

      await useBookStore.getState().updateBook(created.id, {
        title: "Updated Current",
      });

      const { currentBook } = useBookStore.getState();
      expect(currentBook?.title).toBe("Updated Current");
    });

    it("does not touch currentBook when IDs differ", async () => {
      const book1 = await useBookStore.getState().createBook({
        title: "Book 1",
        authorName: "Author",
      });
      const book2 = await useBookStore.getState().createBook({
        title: "Book 2",
        authorName: "Author",
      });
      useBookStore.setState({ currentBook: book1 });

      await useBookStore.getState().updateBook(book2.id, {
        title: "Changed Book 2",
      });

      const { currentBook } = useBookStore.getState();
      expect(currentBook?.title).toBe("Book 1");
    });

    it("persists update to the database", async () => {
      const created = await useBookStore.getState().createBook({
        title: "Before",
        authorName: "Author",
      });

      await useBookStore.getState().updateBook(created.id, {
        title: "After",
        genre: "Sci-Fi",
      });

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT title, genre FROM books WHERE id = ?",
        [created.id]
      );
      expect(rows[0].title).toBe("After");
      expect(rows[0].genre).toBe("Sci-Fi");
    });
  });

  describe("deleteBook()", () => {
    it("records a pending sync tombstone before deleting the book", async () => {
      const created = await useBookStore.getState().createBook({
        title: "Doomed Draft",
        authorName: "Author",
      });

      await useBookStore.getState().deleteBook(created.id);

      const tombstones = await testDb.select<Record<string, unknown>[]>(
        "SELECT entity_type, entity_id, title, confirmed_at, pushed_at FROM sync_tombstones WHERE entity_id = ?",
        [created.id]
      );
      expect(tombstones).toEqual([
        {
          entity_type: "book",
          entity_id: created.id,
          title: "Doomed Draft",
          confirmed_at: null,
          pushed_at: null,
        },
      ]);
    });

    it("removes book from state and database", async () => {
      const created = await useBookStore.getState().createBook({
        title: "To Delete",
        authorName: "Author",
      });

      await useBookStore.getState().deleteBook(created.id);

      const { books } = useBookStore.getState();
      expect(books).toHaveLength(0);

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM books WHERE id = ?",
        [created.id]
      );
      expect(rows).toHaveLength(0);
    });

    it("clears currentBook when deleting the current book", async () => {
      const created = await useBookStore.getState().createBook({
        title: "Current",
        authorName: "Author",
      });
      useBookStore.setState({ currentBook: created });

      await useBookStore.getState().deleteBook(created.id);

      expect(useBookStore.getState().currentBook).toBeNull();
    });

    it("preserves currentBook when deleting a different book", async () => {
      const book1 = await useBookStore.getState().createBook({
        title: "Keep",
        authorName: "Author",
      });
      const book2 = await useBookStore.getState().createBook({
        title: "Delete",
        authorName: "Author",
      });
      useBookStore.setState({ currentBook: book1 });

      await useBookStore.getState().deleteBook(book2.id);

      expect(useBookStore.getState().currentBook?.id).toBe(book1.id);
    });
  });

  describe("updateWordCount()", () => {
    it("updates word count in DB and state", async () => {
      const created = await useBookStore.getState().createBook({
        title: "Counting",
        authorName: "Author",
      });

      await useBookStore.getState().updateWordCount(created.id, 5000);

      const { books } = useBookStore.getState();
      expect(books.find((b) => b.id === created.id)?.wordCount).toBe(5000);

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT word_count FROM books WHERE id = ?",
        [created.id]
      );
      expect(rows[0].word_count).toBe(5000);
    });

    it("updates currentBook word count when it matches", async () => {
      const created = await useBookStore.getState().createBook({
        title: "Current WC",
        authorName: "Author",
      });
      useBookStore.setState({ currentBook: created });

      await useBookStore.getState().updateWordCount(created.id, 1234);

      expect(useBookStore.getState().currentBook?.wordCount).toBe(1234);
    });
  });
});
