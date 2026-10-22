import { create } from "zustand";
import { getDatabase } from "@/lib/db";
import {
  createBookRow,
  deleteBookRow,
  toBook,
  updateBookRow,
  updateBookWordCountRow,
} from "@/features/books/write";
import { STORE_VIEW } from "@/features/sync/change-feed";
import type { Book, CreateBookInput, UpdateBookInput } from "@/features/books/types";

// An older read can resolve after a newer one, or after a local write; without
// a ticket its rows would replace fresher state and the Library would show a
// book out of order until it remounts.
let readTicket = 0;
// Ticket of the newest read whose rows reached the store.
let appliedReadTicket = 0;
// Bumped by every store write that sets `books`, so a read issued earlier knows
// its rows predate that write.
let writeEpoch = 0;

const BOOKS_SELECT = "SELECT * FROM books ORDER BY last_opened_at DESC, updated_at DESC";

async function readBooks(): Promise<Book[]> {
  const db = await getDatabase();
  const rows = await db.select<Record<string, unknown>[]>(BOOKS_SELECT);
  return rows.map(toBook);
}

type ReadOutcome = "applied" | "stale-read" | "stale-write";

function applyRead(ticket: number, epochAtIssue: number): ReadOutcome {
  // A newer read already applied, so these rows lose.
  if (ticket < appliedReadTicket) return "stale-read";
  // A store write landed after this read was issued; the rows are outdated.
  if (writeEpoch !== epochAtIssue) return "stale-write";
  appliedReadTicket = ticket;
  return "applied";
}

/**
 * Read every book, or null when a newer read already reached the store. A
 * store write that lands mid-read triggers one fresh read; a second one is
 * applied anyway so the store never sits without data.
 */
async function readFreshBooks(): Promise<Book[] | null> {
  let ticket = ++readTicket;
  let epoch = writeEpoch;
  let books = await readBooks();
  let outcome = applyRead(ticket, epoch);
  if (outcome === "stale-write") {
    // The write is committed, so one fresh read sees it.
    ticket = ++readTicket;
    epoch = writeEpoch;
    books = await readBooks();
    outcome = applyRead(ticket, epoch);
    if (outcome === "stale-write") appliedReadTicket = ticket;
  }
  if (outcome === "stale-read") {
    if (import.meta.env.DEV)
      console.debug("[books] dropped stale read", { ticket, latest: appliedReadTicket });
    return null;
  }
  return books;
}

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
      const books = await readFreshBooks();
      if (!books) {
        if (useBookStore.getState().isLoading) set({ isLoading: false });
        return;
      }
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
    const books = await readFreshBooks();
    if (!books) return;
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
    // The store updates its own view below, so the Change needs no refresh.
    const newBook = await createBookRow(input, "local", STORE_VIEW);

    writeEpoch++;
    set((state) => ({ books: [newBook, ...state.books] }));
    return newBook;
  },

  updateBook: async (id: string, input: UpdateBookInput) => {
    // The write path persists, returns the stored book, and emits the Change.
    const updated = await updateBookRow(id, input, "local", STORE_VIEW);
    if (!updated) return;

    writeEpoch++;
    set((state) => ({
      books: state.books.map((book) => (book.id === id ? updated : book)),
      currentBook: state.currentBook?.id === id ? updated : state.currentBook,
    }));
  },

  deleteBook: async (id: string) => {
    // The write path records the tombstone, deletes, and emits the Change.
    await deleteBookRow(id, "local", STORE_VIEW);

    writeEpoch++;
    set((state) => ({
      books: state.books.filter((book) => book.id !== id),
      currentBook: state.currentBook?.id === id ? null : state.currentBook,
    }));
  },

  updateWordCount: async (id: string, wordCount: number) => {
    // Derived recompute: bumps the sync clock but never Last Edited, no Change.
    const updated = await updateBookWordCountRow(id, wordCount);
    if (!updated) return;

    writeEpoch++;
    set((state) => ({
      books: state.books.map((book) => (book.id === id ? updated : book)),
      currentBook: state.currentBook?.id === id ? updated : state.currentBook,
    }));
  },
}));
