import { create } from "zustand";
import { getDatabase } from "@/lib/db";
import {
  createBookRow,
  deleteBookRow,
  toBook,
  updateBookRow,
  updateBookWordCountRow,
} from "@/features/books/write";
import type { Book, CreateBookInput, UpdateBookInput } from "@/features/books/types";

interface BookStore {
  books: Book[];
  currentBook: Book | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadBooks: () => Promise<void>;
  loadBook: (id: string) => Promise<void>;
  /**
   * Re-read books from the database after something outside the UI changed
   * them (a sync pull). Unlike loadBooks/loadBook it never flips isLoading, so
   * an open BookEditor keeps its editor mounted, and it does not touch
   * last_opened_at.
   */
  refreshBooks: () => Promise<void>;
  createBook: (input: CreateBookInput) => Promise<Book>;
  updateBook: (id: string, input: UpdateBookInput) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
  updateWordCount: (id: string, wordCount: number) => Promise<void>;
}

export const useBookStore = create<BookStore>((set) => ({
  books: [],
  currentBook: null,
  isLoading: false,
  error: null,

  loadBooks: async () => {
    set({ isLoading: true, error: null });
    try {
      const db = await getDatabase();
      const result = await db.select<Record<string, unknown>[]>(
        "SELECT * FROM books ORDER BY last_opened_at DESC, updated_at DESC"
      );
      const books = result.map(toBook);
      set({ books, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  loadBook: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const db = await getDatabase();
      const result = await db.select<Record<string, unknown>[]>(
        "SELECT * FROM books WHERE id = ?",
        [id]
      );
      if (result.length === 0) {
        throw new Error("Book not found");
      }
      const book = toBook(result[0]);

      // Update last opened timestamp. Navigation state: no Change is emitted.
      const now = Math.floor(Date.now() / 1000);
      await db.execute("UPDATE books SET last_opened_at = ? WHERE id = ?", [now, id]);

      set({ currentBook: { ...book, lastOpenedAt: new Date() }, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  refreshBooks: async () => {
    const db = await getDatabase();
    const result = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM books ORDER BY last_opened_at DESC, updated_at DESC"
    );
    const books = result.map(toBook);
    set((state) => {
      const current = state.currentBook
        ? books.find((book) => book.id === state.currentBook?.id)
        : undefined;
      return {
        books,
        currentBook: current ?? state.currentBook,
      };
    });
  },

  createBook: async (input: CreateBookInput) => {
    // The write path persists, returns the stored book, and emits the Change.
    const newBook = await createBookRow(input, "local");

    set((state) => ({ books: [newBook, ...state.books] }));
    return newBook;
  },

  updateBook: async (id: string, input: UpdateBookInput) => {
    // The write path persists, returns the stored book, and emits the Change.
    const updated = await updateBookRow(id, input, "local");
    if (!updated) return;

    set((state) => ({
      books: state.books.map((book) => (book.id === id ? updated : book)),
      currentBook: state.currentBook?.id === id ? updated : state.currentBook,
    }));
  },

  deleteBook: async (id: string) => {
    // The write path records the tombstone, deletes, and emits the Change.
    await deleteBookRow(id, "local");

    set((state) => ({
      books: state.books.filter((book) => book.id !== id),
      currentBook: state.currentBook?.id === id ? null : state.currentBook,
    }));
  },

  updateWordCount: async (id: string, wordCount: number) => {
    // Derived recompute: bumps the sync clock but never Last Edited, no Change.
    const updated = await updateBookWordCountRow(id, wordCount);
    if (!updated) return;

    set((state) => ({
      books: state.books.map((book) => (book.id === id ? updated : book)),
      currentBook: state.currentBook?.id === id ? updated : state.currentBook,
    }));
  },
}));
