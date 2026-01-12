import { create } from "zustand";
import { getDatabase } from "../../lib/db";
import type {
  Chapter,
  CreateChapterInput,
  UpdateChapterInput,
  ChapterType,
  ChapterStatus,
} from "./types";

function generateId(): string {
  return crypto.randomUUID();
}

function toChapter(row: Record<string, unknown>): Chapter {
  return {
    id: row.id as string,
    bookId: row.book_id as string,
    title: row.title as string,
    content: row.content as string | null,
    synopsis: row.synopsis as string | undefined,
    order: row.order as number,
    parentId: row.parent_id as string | undefined,
    chapterType: row.chapter_type as ChapterType,
    wordCount: row.word_count as number,
    status: row.status as ChapterStatus,
    isIncludedInExport: Boolean(row.is_included_in_export),
    createdAt: new Date((row.created_at as number) * 1000),
    updatedAt: new Date((row.updated_at as number) * 1000),
  };
}

interface ChapterStore {
  chapters: Chapter[];
  currentChapter: Chapter | null;
  currentBookId: string | null; // Track which book's chapters are loaded
  isLoading: boolean;
  error: string | null;

  // Actions
  loadChapters: (bookId: string) => Promise<void>;
  loadChapter: (id: string) => Promise<void>;
  createChapter: (input: CreateChapterInput) => Promise<Chapter>;
  updateChapter: (id: string, input: UpdateChapterInput) => Promise<void>;
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
    set({ isLoading: true, error: null, chapters: [], currentChapter: null, currentBookId: bookId });
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

  createChapter: async (input: CreateChapterInput) => {
    const db = await getDatabase();
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);

    // Get the next order number
    const orderResult = await db.select<{ max_order: number | null }[]>(
      'SELECT MAX("order") as max_order FROM chapters WHERE book_id = ?',
      [input.bookId]
    );
    const nextOrder = (orderResult[0]?.max_order ?? -1) + 1;

    await db.execute(
      `INSERT INTO chapters (id, book_id, title, "order", parent_id, chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', 1, ?, ?)`,
      [
        id,
        input.bookId,
        input.title,
        nextOrder,
        input.parentId || null,
        input.chapterType || "chapter",
        now,
        now,
      ]
    );

    const newChapter: Chapter = {
      id,
      bookId: input.bookId,
      title: input.title,
      content: null,
      order: nextOrder,
      parentId: input.parentId,
      chapterType: input.chapterType || "chapter",
      wordCount: 0,
      status: "draft",
      isIncludedInExport: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    set((state) => ({ chapters: [...state.chapters, newChapter] }));
    return newChapter;
  },

  updateChapter: async (id: string, input: UpdateChapterInput) => {
    const db = await getDatabase();
    const now = Math.floor(Date.now() / 1000);

    const updates: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];

    if (input.title !== undefined) {
      updates.push("title = ?");
      values.push(input.title);
    }
    if (input.content !== undefined) {
      updates.push("content = ?");
      values.push(input.content);

      // Calculate word count from content
      const text = input.content.replace(/<[^>]*>/g, " ");
      const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
      updates.push("word_count = ?");
      values.push(wordCount);
    }
    if (input.synopsis !== undefined) {
      updates.push("synopsis = ?");
      values.push(input.synopsis);
    }
    if (input.chapterType !== undefined) {
      updates.push("chapter_type = ?");
      values.push(input.chapterType);
    }
    if (input.status !== undefined) {
      updates.push("status = ?");
      values.push(input.status);
    }
    if (input.isIncludedInExport !== undefined) {
      updates.push("is_included_in_export = ?");
      values.push(input.isIncludedInExport ? 1 : 0);
    }

    values.push(id);

    await db.execute(
      `UPDATE chapters SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    // Calculate word count if content was updated
    let wordCount: number | undefined;
    if (input.content !== undefined) {
      const text = input.content.replace(/<[^>]*>/g, " ");
      wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    }

    set((state) => ({
      chapters: state.chapters.map((chapter) =>
        chapter.id === id
          ? {
            ...chapter,
            ...input,
            ...(wordCount !== undefined ? { wordCount } : {}),
            updatedAt: new Date(),
          }
          : chapter
      ),
      currentChapter:
        state.currentChapter?.id === id
          ? {
            ...state.currentChapter,
            ...input,
            ...(wordCount !== undefined ? { wordCount } : {}),
            updatedAt: new Date(),
          }
          : state.currentChapter,
    }));
  },

  deleteChapter: async (id: string) => {
    const db = await getDatabase();
    await db.execute("DELETE FROM chapters WHERE id = ?", [id]);

    set((state) => ({
      chapters: state.chapters.filter((chapter) => chapter.id !== id),
      currentChapter:
        state.currentChapter?.id === id ? null : state.currentChapter,
    }));
  },

  reorderChapters: async (bookId: string, chapterIds: string[]) => {
    const db = await getDatabase();
    const now = Math.floor(Date.now() / 1000);

    // Update each chapter's order
    for (let i = 0; i < chapterIds.length; i++) {
      await db.execute(
        'UPDATE chapters SET "order" = ?, updated_at = ? WHERE id = ?',
        [i, now, chapterIds[i]]
      );
    }

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
