import { getDatabase } from "../../lib/db";
import { useBookStore } from "../books/store";
import { useChapterStore } from "../chapters/store";
import type { BookSnapshot } from "./types";

interface BookRow {
  id: string;
  title: string;
  subtitle: string | null;
  author_name: string;
  description: string | null;
  genre: string | null;
  language: string;
  cover_image_path: string | null;
  cover_data: string | null;
  word_count: number;
  target_word_count: number | null;
  status: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number | null;
  last_chapter_id: string | null;
}

interface ChapterRow {
  id: string;
  book_id: string;
  title: string;
  content: string | null;
  synopsis: string | null;
  order: number;
  parent_id: string | null;
  chapter_type: string;
  word_count: number;
  status: string;
  is_included_in_export: number;
  created_at: number;
  updated_at: number;
}

export async function serializeBook(bookId: string): Promise<string> {
  const db = await getDatabase();

  const books = await db.select<BookRow[]>("SELECT * FROM books WHERE id = ?", [bookId]);

  if (books.length === 0) {
    throw new Error(`Book not found: ${bookId}`);
  }

  const bookRow = books[0];
  const chapters = await db.select<ChapterRow[]>(
    'SELECT * FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
    [bookId]
  );

  const snapshot: BookSnapshot = {
    book: {
      id: bookRow.id,
      title: bookRow.title,
      subtitle: bookRow.subtitle,
      authorName: bookRow.author_name,
      description: bookRow.description,
      genre: bookRow.genre,
      language: bookRow.language,
      coverImagePath: bookRow.cover_image_path,
      coverData: bookRow.cover_data,
      wordCount: bookRow.word_count,
      targetWordCount: bookRow.target_word_count,
      status: bookRow.status,
      createdAt: bookRow.created_at,
      updatedAt: bookRow.updated_at,
      lastOpenedAt: bookRow.last_opened_at,
      lastChapterId: bookRow.last_chapter_id,
    },
    chapters: chapters.map((ch) => ({
      id: ch.id,
      bookId: ch.book_id,
      title: ch.title,
      content: ch.content,
      synopsis: ch.synopsis,
      order: ch.order,
      parentId: ch.parent_id,
      chapterType: ch.chapter_type,
      wordCount: ch.word_count,
      status: ch.status,
      isIncludedInExport: Boolean(ch.is_included_in_export),
      createdAt: ch.created_at,
      updatedAt: ch.updated_at,
    })),
  };

  return JSON.stringify(snapshot);
}

export async function applyBookSnapshot(snapshot: BookSnapshot): Promise<void> {
  const db = await getDatabase();
  const { book, chapters } = snapshot;

  // Each statement is auto-committed individually. The pre-sync backup
  // is the safety net if something fails mid-apply (tauri-plugin-sql uses
  // a connection pool, so BEGIN/COMMIT across separate execute() calls
  // cannot be relied upon).

  // Upsert book
  await db.execute(
    `INSERT OR REPLACE INTO books (
      id, title, subtitle, author_name, description, genre, language,
      cover_image_path, cover_data, word_count, target_word_count, status,
      created_at, updated_at, last_opened_at, last_chapter_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      book.id,
      book.title,
      book.subtitle,
      book.authorName,
      book.description,
      book.genre,
      book.language,
      book.coverImagePath,
      book.coverData,
      book.wordCount,
      book.targetWordCount,
      book.status,
      book.createdAt,
      book.updatedAt,
      book.lastOpenedAt,
      book.lastChapterId,
    ]
  );

  // Delete existing chapters for this book, then insert fresh
  await db.execute("DELETE FROM chapters WHERE book_id = ?", [book.id]);

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    try {
      await db.execute(
        `INSERT INTO chapters (
          id, book_id, title, content, synopsis, "order", parent_id,
          chapter_type, word_count, status, is_included_in_export,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ch.id,
          ch.bookId,
          ch.title,
          ch.content,
          ch.synopsis,
          ch.order,
          ch.parentId,
          ch.chapterType,
          ch.wordCount,
          ch.status,
          ch.isIncludedInExport ? 1 : 0,
          ch.createdAt,
          ch.updatedAt,
        ]
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Sync apply failed on chapter ${i + 1}/${chapters.length} ("${ch.title}"): ${detail}`
      );
    }
  }

  // Reload stores so UI reflects the new data
  await useBookStore.getState().loadBooks();
  const currentBookId = useChapterStore.getState().currentBookId;
  if (currentBookId === book.id) {
    await useChapterStore.getState().loadChapters(book.id);
  }
}
