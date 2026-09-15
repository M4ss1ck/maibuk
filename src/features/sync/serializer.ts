// Sync serialization: snapshots in and out of the database. Writes go
// through the narrow per-entity write paths (ADR 0005) with a remote origin;
// view refresh happens through the Change Feed's view-refresh subscribers,
// which apply callers await via the emission. This module never imports or
// mutates stores directly.

import { getDatabase } from "@/lib/db";
import { applyBookSnapshotData, removeBookRow, type AppliedBook } from "@/features/books/write";
import { applyNoteSnapshotData, removeNoteRow } from "@/features/notes/write";
import { normalizeNoteSnapshotJson } from "@/features/sync/sync-codec-handlers";
import { stringifySnapshotAsync } from "@/features/sync/sync-codec";
import type { ChangeOrigin } from "@/features/sync/change-feed";
import type { BookSnapshot, NoteSnapshot } from "@/features/sync/types";
import type { Note } from "@/features/notes/types";

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
  content_updated_at: number | null;
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
      contentUpdatedAt: bookRow.content_updated_at ?? bookRow.updated_at,
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

  return stringifySnapshotAsync(snapshot);
}

/**
 * Replace the local book with a snapshot. Origin is remote for pulls
 * (timestamps kept) and local for Version Restore (timestamps move to now).
 * Resolves with the rows as stored; the emission awaits the view refresh, so
 * by the time this returns an open editor already shows the new content.
 */
export async function applyBookSnapshot(
  snapshot: BookSnapshot,
  origin: ChangeOrigin = "remote"
): Promise<AppliedBook> {
  return applyBookSnapshotData(snapshot, origin);
}

interface NoteRow {
  id: string;
  book_id: string | null;
  title: string;
  content: string | null;
  language: string | null;
  tags: string | null;
  pinned: number;
  order: number;
  word_count: number;
  collapsed_headings: string | null;
  created_at: number;
  updated_at: number;
  content_updated_at: number | null;
}

export async function serializeNote(noteId: string): Promise<string> {
  const db = await getDatabase();

  const notes = await db.select<NoteRow[]>("SELECT * FROM notes WHERE id = ?", [noteId]);

  if (notes.length === 0) {
    throw new Error(`Note not found: ${noteId}`);
  }

  const row = notes[0];
  const snapshot: NoteSnapshot = {
    note: {
      id: row.id,
      bookId: row.book_id,
      title: row.title,
      content: row.content,
      language: row.language ?? "en",
      tags: row.tags,
      pinned: Boolean(row.pinned),
      order: row.order,
      wordCount: row.word_count,
      collapsedHeadings: row.collapsed_headings,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      contentUpdatedAt: row.content_updated_at ?? row.updated_at,
    },
  };

  return stringifySnapshotAsync(snapshot);
}

export function normalizeNoteSnapshotForSync(json: string): string {
  return normalizeNoteSnapshotJson(json);
}

/**
 * Replace the local note with a snapshot (remote pull by default).
 * Resolves with the note as stored.
 */
export async function applyNoteSnapshot(
  snapshot: NoteSnapshot,
  origin: ChangeOrigin = "remote"
): Promise<Note> {
  return applyNoteSnapshotData(snapshot, origin);
}

// Removal of an item deleted on another device. Unlike the local delete
// paths this records no tombstone (the server already has the deletion, and a
// tombstone would block pulling the item if another device restores it).

export async function removeLocalNote(noteId: string): Promise<void> {
  await removeNoteRow(noteId, "remote");
}

export async function removeLocalBook(bookId: string): Promise<void> {
  await removeBookRow(bookId, "remote");
}
