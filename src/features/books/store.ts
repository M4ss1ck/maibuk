import { create } from "zustand";
import { getDatabase } from "../../lib/db";
import type { Book, CreateBookInput, UpdateBookInput } from "./types";

function generateId(): string {
  return crypto.randomUUID();
}

function toBook(row: Record<string, unknown>): Book {
  return {
    id: row.id as string,
    title: row.title as string,
    subtitle: row.subtitle as string | undefined,
    authorName: row.author_name as string,
    description: row.description as string | undefined,
    genre: row.genre as string | undefined,
    language: row.language as string,
    coverImagePath: row.cover_image_path as string | undefined,
    coverData: row.cover_data as string | undefined,
    wordCount: row.word_count as number,
    targetWordCount: row.target_word_count as number | undefined,
    status: row.status as "draft" | "in-progress" | "completed",
    createdAt: new Date((row.created_at as number) * 1000),
    updatedAt: new Date((row.updated_at as number) * 1000),
    lastOpenedAt: row.last_opened_at
      ? new Date((row.last_opened_at as number) * 1000)
      : undefined,
  };
}

interface BookStore {
  books: Book[];
  currentBook: Book | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadBooks: () => Promise<void>;
  loadBook: (id: string) => Promise<void>;
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

      // Update last opened timestamp
      const now = Math.floor(Date.now() / 1000);
      await db.execute("UPDATE books SET last_opened_at = ? WHERE id = ?", [
        now,
        id,
      ]);

      set({ currentBook: { ...book, lastOpenedAt: new Date() }, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  createBook: async (input: CreateBookInput) => {
    const db = await getDatabase();
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);

    await db.execute(
      `INSERT INTO books (id, title, subtitle, author_name, description, genre, language, word_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'en', 0, 'draft', ?, ?)`,
      [
        id,
        input.title,
        input.subtitle || null,
        input.authorName,
        input.description || null,
        input.genre || null,
        now,
        now,
      ]
    );

    const newBook: Book = {
      id,
      title: input.title,
      subtitle: input.subtitle,
      authorName: input.authorName,
      description: input.description,
      genre: input.genre,
      language: "en",
      wordCount: 0,
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    set((state) => ({ books: [newBook, ...state.books] }));
    return newBook;
  },

  updateBook: async (id: string, input: UpdateBookInput) => {
    const db = await getDatabase();
    const now = Math.floor(Date.now() / 1000);

    const updates: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];

    if (input.title !== undefined) {
      updates.push("title = ?");
      values.push(input.title);
    }
    if (input.subtitle !== undefined) {
      updates.push("subtitle = ?");
      values.push(input.subtitle);
    }
    if (input.authorName !== undefined) {
      updates.push("author_name = ?");
      values.push(input.authorName);
    }
    if (input.description !== undefined) {
      updates.push("description = ?");
      values.push(input.description);
    }
    if (input.genre !== undefined) {
      updates.push("genre = ?");
      values.push(input.genre);
    }
    if (input.status !== undefined) {
      updates.push("status = ?");
      values.push(input.status);
    }
    if (input.targetWordCount !== undefined) {
      updates.push("target_word_count = ?");
      values.push(input.targetWordCount);
    }
    if (input.coverImagePath !== undefined) {
      updates.push("cover_image_path = ?");
      values.push(input.coverImagePath);
    }
    if (input.coverData !== undefined) {
      updates.push("cover_data = ?");
      values.push(input.coverData);
    }

    values.push(id);

    await db.execute(
      `UPDATE books SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    set((state) => ({
      books: state.books.map((book) =>
        book.id === id
          ? { ...book, ...input, updatedAt: new Date() }
          : book
      ),
      currentBook:
        state.currentBook?.id === id
          ? { ...state.currentBook, ...input, updatedAt: new Date() }
          : state.currentBook,
    }));
  },

  deleteBook: async (id: string) => {
    const db = await getDatabase();
    await db.execute("DELETE FROM books WHERE id = ?", [id]);

    set((state) => ({
      books: state.books.filter((book) => book.id !== id),
      currentBook: state.currentBook?.id === id ? null : state.currentBook,
    }));
  },

  updateWordCount: async (id: string, wordCount: number) => {
    const db = await getDatabase();
    const now = Math.floor(Date.now() / 1000);

    await db.execute(
      "UPDATE books SET word_count = ?, updated_at = ? WHERE id = ?",
      [wordCount, now, id]
    );

    set((state) => ({
      books: state.books.map((book) =>
        book.id === id ? { ...book, wordCount, updatedAt: new Date() } : book
      ),
      currentBook:
        state.currentBook?.id === id
          ? { ...state.currentBook, wordCount, updatedAt: new Date() }
          : state.currentBook,
    }));
  },
}));
