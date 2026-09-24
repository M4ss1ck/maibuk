// Narrow write path for Books and their Chapters (ADR 0005): every mutation
// of the books/chapters tables goes through here — normalize, persist, return
// the stored model, emit the Change. Stores, Version Restore, Import, and the
// sync serializer all call these; nobody hand-signals.
//
// Last Edited for a Book lives in content_updated_at (the Note pattern):
// title, subtitle, description, and cover changes move it, as do chapter
// text/title changes; organizational fields (status, order, filing, tags) do
// not. updated_at stays the sync conflict clock and always bumps.

import { getDatabase } from "@/lib/db";
import { assertWritableId } from "@/features/tutorial/library-switch";
import { recordTombstone } from "@/features/sync/tombstones";
import { emitChange, type ChangeKind, type ChangeOrigin } from "@/features/sync/change-feed";
import { normalizeChapterContent, toChapter } from "@/features/chapters/write";
import { reindexSource } from "@/features/links/link-index";
import type {
  Book,
  BookStatus,
  CreateBookInput,
  UpdateBookInput,
} from "@/features/books/types";
import type { BookSnapshot } from "@/features/sync/types";
import type { Chapter } from "@/features/chapters/types";

function generateId(): string {
  return crypto.randomUUID();
}

export function toBook(row: Record<string, unknown>): Book {
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
    status: row.status as BookStatus,
    createdAt: new Date((row.created_at as number) * 1000),
    updatedAt: new Date((row.updated_at as number) * 1000),
    // Fall back to updated_at for rows created before the column existed.
    contentUpdatedAt: new Date(
      ((row.content_updated_at as number | null) ?? (row.updated_at as number)) * 1000
    ),
    lastOpenedAt: row.last_opened_at ? new Date((row.last_opened_at as number) * 1000) : undefined,
    lastChapterId: row.last_chapter_id as string | undefined,
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function readBook(id: string): Promise<Book | null> {
  const db = await getDatabase();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM books WHERE id = ?", [
    id,
  ]);
  return rows.length > 0 ? toBook(rows[0]) : null;
}

/** Read every Book the import result needs. */
export async function fetchStoredBook(id: string): Promise<Book | null> {
  return readBook(id);
}

/** Book fields that carry what the book says (title, details, cover). */
function bookContentChanged(
  input: UpdateBookInput,
  existing: { title: string; subtitle?: string; description?: string; coverImagePath?: string; coverData?: string }
): boolean {
  return (
    (input.title !== undefined && input.title !== existing.title) ||
    (input.subtitle !== undefined && (input.subtitle ?? undefined) !== existing.subtitle) ||
    (input.description !== undefined && (input.description ?? undefined) !== existing.description) ||
    (input.coverImagePath !== undefined && (input.coverImagePath ?? undefined) !== existing.coverImagePath) ||
    (input.coverData !== undefined && (input.coverData ?? undefined) !== existing.coverData)
  );
}

export async function createBookRow(
  input: CreateBookInput,
  origin: ChangeOrigin
): Promise<Book> {
  const db = await getDatabase();
  const id = generateId();
  const now = nowSeconds();

  await db.execute(
    `INSERT INTO books (id, title, subtitle, author_name, description, genre, language, word_count, status, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'en', 0, 'draft', ?, ?, ?)`,
    [
      id,
      input.title,
      input.subtitle || null,
      input.authorName,
      input.description || null,
      input.genre || null,
      now,
      now,
      now,
    ]
  );

  let stored: Book | null = null;
  try {
    stored = await readBook(id);
  } catch {
    stored = null;
  }
  // A read-back failure after the durable write still emits below.
  const own: Book = stored ?? {
    id,
    title: input.title,
    subtitle: input.subtitle,
    authorName: input.authorName,
    description: input.description,
    genre: input.genre,
    language: "en",
    coverImagePath: undefined,
    coverData: undefined,
    wordCount: 0,
    targetWordCount: undefined,
    status: "draft",
    createdAt: new Date(now * 1000),
    updatedAt: new Date(now * 1000),
    contentUpdatedAt: new Date(now * 1000),
    lastOpenedAt: undefined,
    lastChapterId: undefined,
  };
  await emitChange({ entity: "book", id, origin, kind: "content" });
  return own;
}

/** Resolves with the book as stored, or null when it no longer exists. */
export async function updateBookRow(
  id: string,
  input: UpdateBookInput,
  origin: ChangeOrigin
): Promise<Book | null> {
  assertWritableId(id);
  const db = await getDatabase();
  const existing = await readBook(id);
  if (!existing) return null;
  const now = nowSeconds();
  const contentChanged = bookContentChanged(input, existing);
  const kind: ChangeKind = contentChanged ? "content" : "metadata";

  const updates: string[] = ["updated_at = ?"];
  const values: unknown[] = [now];
  if (contentChanged) {
    updates.push("content_updated_at = ?");
    values.push(now);
  }

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
  if (input.language !== undefined) {
    updates.push("language = ?");
    values.push(input.language);
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
  if (input.lastChapterId !== undefined) {
    updates.push("last_chapter_id = ?");
    values.push(input.lastChapterId);
  }

  values.push(id);

  await db.execute(`UPDATE books SET ${updates.join(", ")} WHERE id = ?`, values);

  // Capture this save's stored result before the emission's awaits: a later
  // save must not replace it. A read-back failure after the durable write
  // still emits below.
  let stored: Book | null = null;
  try {
    stored = await readBook(id);
  } catch {
    stored = null;
  }
  const own: Book = stored ?? {
    ...existing,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
    ...(input.authorName !== undefined ? { authorName: input.authorName } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.genre !== undefined ? { genre: input.genre } : {}),
    ...(input.language !== undefined ? { language: input.language } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.targetWordCount !== undefined ? { targetWordCount: input.targetWordCount } : {}),
    ...(input.coverImagePath !== undefined ? { coverImagePath: input.coverImagePath } : {}),
    ...(input.coverData !== undefined ? { coverData: input.coverData } : {}),
    ...(input.lastChapterId !== undefined ? { lastChapterId: input.lastChapterId } : {}),
    updatedAt: new Date(now * 1000),
    contentUpdatedAt: contentChanged ? new Date(now * 1000) : existing.contentUpdatedAt,
  };
  await emitChange({ entity: "book", id, origin, kind });
  return own;
}

/**
 * Derived word-count recompute: bumps the sync clock like before, but never
 * moves Last Edited and emits no Change.
 */
export async function updateBookWordCountRow(id: string, wordCount: number): Promise<Book | null> {
  assertWritableId(id);
  const db = await getDatabase();
  const now = nowSeconds();

  await db.execute("UPDATE books SET word_count = ?, updated_at = ? WHERE id = ?", [
    wordCount,
    now,
    id,
  ]);

  return readBook(id);
}

/** Local delete: records a tombstone so sync carries the deletion. */
export async function deleteBookRow(id: string, origin: ChangeOrigin): Promise<void> {
  assertWritableId(id);
  const db = await getDatabase();
  const rows = await db.select<{ title: string }[]>("SELECT title FROM books WHERE id = ?", [id]);
  if (rows.length > 0) {
    await recordTombstone({
      entityType: "book",
      entityId: id,
      title: rows[0].title,
    });
  }
  await db.execute("DELETE FROM books WHERE id = ?", [id]);
  await emitChange({ entity: "book", id, origin, kind: "content" });
}

/**
 * Removal of a book deleted on another device. Records no tombstone (the
 * server already has the deletion, and a tombstone would block pulling the
 * book back if another device restores it).
 */
export async function removeBookRow(id: string, origin: ChangeOrigin): Promise<void> {
  assertWritableId(id);
  const db = await getDatabase();
  const chapters = await db.select<{ id: string }[]>("SELECT id FROM chapters WHERE book_id = ?", [
    id,
  ]);
  for (const chapter of chapters) {
    await db.execute("DELETE FROM links WHERE source_id = ?", [chapter.id]).catch(() => {});
  }
  // The schema declares ON DELETE CASCADE, but no adapter enables SQLite's
  // foreign_keys pragma, so the dependent rows are deleted explicitly.
  for (const table of [
    "chapter_epub_meta",
    "epub_structures",
    "book_styles",
    "book_metadata",
    "project_assets",
    "book_versions",
    "chapters",
  ]) {
    await db.execute(`DELETE FROM ${table} WHERE book_id = ?`, [id]).catch(() => {});
  }
  await db.execute("DELETE FROM books WHERE id = ?", [id]);
  await emitChange({ entity: "book", id, origin, kind: "content" });
}

export interface AppliedBook {
  book: Book;
  chapters: Chapter[];
}

/**
 * Replace the local book and its chapters with a synced snapshot (pull or
 * local restore). Chapter content goes through the same normalization as
 * local writes, and applied chapters are link-indexed through the shared
 * helper (index failures never fail the apply).
 *
 * The Change kind is classified against the current rows: a metadata-only
 * Pull keeps its kind and preserves the existing Last Edited (legacy
 * snapshots without contentUpdatedAt fall back to updatedAt only when the
 * content actually changed). A local restore reads as a fresh local edit:
 * timestamps move to now and the kind is content. Resolves with the rows as
 * stored.
 */
export async function applyBookSnapshotData(
  snapshot: BookSnapshot,
  origin: ChangeOrigin
): Promise<AppliedBook> {
  assertWritableId(snapshot.book.id);
  for (const chapter of snapshot.chapters) assertWritableId(chapter.id);
  const db = await getDatabase();
  const { book, chapters } = snapshot;

  // Each statement is auto-committed individually. The pre-sync backup
  // is the safety net if something fails mid-apply (tauri-plugin-sql uses
  // a connection pool, so BEGIN/COMMIT across separate execute() calls
  // cannot be relied upon).
  const now = nowSeconds();

  // Snapshot writes share normalization with local writes: classify the
  // normalized incoming content against the current rows.
  const normalizedChapters = chapters.map((ch) => {
    if (ch.content == null) return ch;
    const normalized = normalizeChapterContent(ch.content);
    return { ...ch, content: normalized.html, wordCount: normalized.wordCount };
  });

  interface ExistingBookRow {
    title: string;
    subtitle: string | null;
    description: string | null;
    cover_image_path: string | null;
    cover_data: string | null;
    updated_at: number;
    content_updated_at: number | null;
  }
  const existingBookRows = await db.select<ExistingBookRow[]>(
    `SELECT title, subtitle, description, cover_image_path, cover_data,
            updated_at, content_updated_at FROM books WHERE id = ?`,
    [book.id]
  );
  const existingBook = existingBookRows[0] ?? null;
  interface ExistingChapterRow {
    id: string;
    title: string;
    content: string | null;
    synopsis: string | null;
  }
  const existingChapterRows = await db.select<ExistingChapterRow[]>(
    "SELECT id, title, content, synopsis FROM chapters WHERE book_id = ?",
    [book.id]
  );

  let kind: ChangeKind = "content";
  const bookUpdatedAt = origin === "local" ? now : book.updatedAt;
  let bookContentUpdatedAt = origin === "local" ? now : (book.contentUpdatedAt ?? book.updatedAt);
  if (existingBook !== null && origin !== "local") {
    const sameBook =
      book.title === existingBook.title &&
      (book.subtitle ?? null) === existingBook.subtitle &&
      (book.description ?? null) === existingBook.description &&
      (book.coverImagePath ?? null) === existingBook.cover_image_path &&
      (book.coverData ?? null) === existingBook.cover_data;
    const byId = new Map(existingChapterRows.map((row) => [row.id, row]));
    const sameChapters =
      byId.size === normalizedChapters.length &&
      normalizedChapters.every((ch) => {
        const row = byId.get(ch.id);
        return (
          row !== undefined &&
          ch.title === row.title &&
          (ch.content ?? "") === (row.content ?? "") &&
          (ch.synopsis ?? null) === row.synopsis
        );
      });
    if (sameBook && sameChapters) {
      kind = "metadata";
      // A metadata-only Pull adopts the snapshot's sync clock but preserves
      // the existing Last Edited.
      bookContentUpdatedAt = existingBook.content_updated_at ?? existingBook.updated_at;
    }
  }

  // Upsert book
  await db.execute(
    `INSERT OR REPLACE INTO books (
      id, title, subtitle, author_name, description, genre, language,
      cover_image_path, cover_data, word_count, target_word_count, status,
      created_at, updated_at, content_updated_at, last_opened_at, last_chapter_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      bookUpdatedAt,
      bookContentUpdatedAt,
      book.lastOpenedAt,
      book.lastChapterId,
    ]
  );

  const applyChapters = async (): Promise<void> => {
    // Delete existing chapters for this book, then insert fresh
    await db.execute("DELETE FROM chapters WHERE book_id = ?", [book.id]);

    for (let i = 0; i < normalizedChapters.length; i++) {
      const ch = normalizedChapters[i];
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
            origin === "local" ? now : ch.updatedAt,
          ]
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Sync apply failed on chapter ${i + 1}/${normalizedChapters.length} ("${ch.title}"): ${detail}`
        );
      }
    }
  };

  try {
    await applyChapters();
  } catch (error) {
    // The book row (and possibly earlier chapters) already persisted; their
    // notification must not be lost with the failure.
    await emitChange({ entity: "book", id: book.id, origin, kind });
    throw error;
  }

  // Capture this apply's stored result before unrelated awaits (indexing,
  // emission): a later save must not replace it. A read-back failure after
  // the durable writes still emits below.
  let storedBook: Book | null = null;
  let storedChapters: Chapter[] = [];
  try {
    storedBook = await readBook(book.id);
    const chapterRows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
      [book.id]
    );
    storedChapters = chapterRows.map(toChapter);
  } catch {
    storedBook = null;
    storedChapters = [];
  }
  const ownBook: Book =
    storedBook ??
    toBook({
      id: book.id,
      title: book.title,
      subtitle: book.subtitle,
      author_name: book.authorName,
      description: book.description,
      genre: book.genre,
      language: book.language,
      cover_image_path: book.coverImagePath,
      cover_data: book.coverData,
      word_count: book.wordCount,
      target_word_count: book.targetWordCount,
      status: book.status,
      created_at: book.createdAt,
      updated_at: bookUpdatedAt,
      content_updated_at: bookContentUpdatedAt,
      last_opened_at: book.lastOpenedAt,
      last_chapter_id: book.lastChapterId,
    });
  const ownChapters: Chapter[] =
    storedChapters.length > 0
      ? storedChapters
      : normalizedChapters.map((ch) =>
          toChapter({
            id: ch.id,
            book_id: ch.bookId,
            title: ch.title,
            content: ch.content,
            synopsis: ch.synopsis,
            order: ch.order,
            parent_id: ch.parentId,
            chapter_type: ch.chapterType,
            word_count: ch.wordCount,
            status: ch.status,
            is_included_in_export: ch.isIncludedInExport ? 1 : 0,
            created_at: ch.createdAt,
            updated_at: origin === "local" ? now : ch.updatedAt,
          })
        );

  for (const ch of ownChapters) {
    if (ch.content == null) continue;
    // The link index is derived data: a failure there must not turn a
    // persisted apply into a failure.
    await reindexSource({
      sourceType: "chapter",
      sourceId: ch.id,
      sourceBookId: book.id,
      contentHtml: ch.content,
    }).catch(() => {});
  }
  await emitChange({ entity: "book", id: book.id, origin, kind });
  return { book: ownBook, chapters: ownChapters };
}
