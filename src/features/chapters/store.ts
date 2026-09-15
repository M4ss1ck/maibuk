import { create } from "zustand";
import { getDatabase } from "@/lib/db";
import {
  createChapterRow,
  deleteChapterRow,
  reorderChapterRows,
  toChapter,
  updateChapterRow,
} from "@/features/chapters/write";
import type {
  Chapter,
  CreateChapterInput,
  UpdateChapterInput,
} from "@/features/chapters/types";

interface ChapterStore {
  chapters: Chapter[];
  currentChapter: Chapter | null;
  currentBookId: string | null; // Track which book's chapters are loaded
  isLoading: boolean;
  error: string | null;

  // Actions
  loadChapters: (bookId: string) => Promise<void>;
  loadChapter: (id: string) => Promise<void>;
  /**
   * Re-read the loaded book's chapters after something outside the UI changed
   * them (a sync pull). Unlike loadChapters it keeps the open chapter selected
   * (replaced by its fresh row) and never flips isLoading, so the editor stays
   * mounted and receives the new content in place. No-op for a book that is
   * not the one currently loaded.
   */
  refreshChapters: (bookId: string) => Promise<void>;
  createChapter: (input: CreateChapterInput) => Promise<Chapter>;
  /** Resolves with the chapter as stored (content normalized), or null when it is not loaded. */
  updateChapter: (id: string, input: UpdateChapterInput) => Promise<Chapter | null>;
  deleteChapter: (id: string) => Promise<void>;
  reorderChapters: (bookId: string, chapterIds: string[]) => Promise<void>;
  setCurrentChapter: (chapter: Chapter | null) => void;
}

export const useChapterStore = create<ChapterStore>((set, get) => ({
  chapters: [],
  currentChapter: null,
  currentBookId: null,
  isLoading: false,
  error: null,

  loadChapters: async (bookId: string) => {
    set({
      isLoading: true,
      error: null,
      chapters: [],
      currentChapter: null,
      currentBookId: bookId,
    });
    try {
      const db = await getDatabase();
      const result = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
        [bookId]
      );
      const chapters = result.map(toChapter);

      // Only update state if this is still the current book (prevents race condition)
      if (get().currentBookId === bookId) {
        set({ chapters, isLoading: false });
      }
    } catch (error) {
      // Only set error if this is still the current book
      if (get().currentBookId === bookId) {
        set({ error: String(error), isLoading: false });
      }
    }
  },

  loadChapter: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const db = await getDatabase();
      const result = await db.select<Record<string, unknown>[]>(
        "SELECT * FROM chapters WHERE id = ?",
        [id]
      );
      if (result.length === 0) {
        throw new Error("Chapter not found");
      }
      const chapter = toChapter(result[0]);
      set({ currentChapter: chapter, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  refreshChapters: async (bookId: string) => {
    if (get().currentBookId !== bookId) return;
    const db = await getDatabase();
    const result = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
      [bookId]
    );
    // The user may have switched books while the query ran.
    if (get().currentBookId !== bookId) return;
    const chapters = result.map(toChapter);
    const openId = get().currentChapter?.id;
    set({
      chapters,
      // A chapter the pull removed leaves nothing selected; BookEditor's
      // auto-select then picks a surviving one.
      currentChapter: openId ? (chapters.find((chapter) => chapter.id === openId) ?? null) : null,
    });
  },

  createChapter: async (input: CreateChapterInput) => {
    // The write path persists, returns the stored chapter, and emits the Change.
    const newChapter = await createChapterRow(input, "local");

    set((state) =>
      state.currentBookId === null || state.currentBookId === input.bookId
        ? { chapters: [...state.chapters, newChapter] }
        : {}
    );
    return newChapter;
  },

  updateChapter: async (id: string, input: UpdateChapterInput) => {
    // The write path normalizes, persists, returns the stored chapter (even
    // when it is not loaded), and emits the Change.
    const stored = await updateChapterRow(id, input, "local");
    if (!stored) return null;

    set((state) => ({
      chapters: state.chapters.map((chapter) => (chapter.id === id ? stored : chapter)),
      currentChapter: state.currentChapter?.id === id ? stored : state.currentChapter,
    }));

    return stored;
  },

  deleteChapter: async (id: string) => {
    // The write path deletes, touches the parent Book, and emits the Change.
    await deleteChapterRow(id, "local");

    set((state) => ({
      chapters: state.chapters.filter((chapter) => chapter.id !== id),
      currentChapter: state.currentChapter?.id === id ? null : state.currentChapter,
    }));
  },

  reorderChapters: async (bookId: string, chapterIds: string[]) => {
    // The write path persists the order and emits the Change.
    await reorderChapterRows(bookId, chapterIds, "local");

    // Update local state
    set((state) => ({
      chapters: state.chapters
        .map((chapter) => {
          const newOrder = chapterIds.indexOf(chapter.id);
          if (newOrder !== -1 && chapter.bookId === bookId) {
            return { ...chapter, order: newOrder, updatedAt: new Date() };
          }
          return chapter;
        })
        .sort((a, b) => a.order - b.order),
    }));
  },

  setCurrentChapter: (chapter: Chapter | null) => {
    set({ currentChapter: chapter });
  },
}));

export async function listAllChaptersForLinking(): Promise<
  { id: string; bookId: string; title: string; content: string | null }[]
> {
  const db = await getDatabase();
  const rows = await db.select<
    { id: string; book_id: string; title: string; content: string | null }[]
  >("SELECT id, book_id, title, content FROM chapters");
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    title: r.title,
    content: r.content,
  }));
}

export async function listChaptersForBookLinking(
  bookId: string
): Promise<{ id: string; bookId: string; title: string }[]> {
  const db = await getDatabase();
  const rows = await db.select<{ id: string; book_id: string; title: string }[]>(
    'SELECT id, book_id, title FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
    [bookId]
  );
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    title: r.title,
  }));
}

export async function getChapterForLinking(
  chapterId: string
): Promise<{ id: string; bookId: string; title: string; content: string | null } | null> {
  const db = await getDatabase();
  const rows = await db.select<
    { id: string; book_id: string; title: string; content: string | null }[]
  >("SELECT id, book_id, title, content FROM chapters WHERE id = ? LIMIT 1", [chapterId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    content: row.content,
  };
}
