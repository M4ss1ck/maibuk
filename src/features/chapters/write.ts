// Narrow write path for Chapters (ADR 0005): every mutation of the chapters
// table goes through here — normalize, persist, return the stored Chapter,
// emit the Change. Chapter edits belong to their containing Book, so Changes
// use entity "book" with the containing book's id. Stores and the sync
// serializer all call these; nobody hand-signals.
//
// A chapter content change (title, body, synopsis) advances the containing
// Book's Last Edited; metadata changes (type, status, inclusion, order) do
// not. Equal-content updates never advance it.

import { getDatabase } from "@/lib/db";
import { emitChange, type ChangeKind, type ChangeOrigin } from "@/features/sync/change-feed";
import { assignHeadingIds } from "@/features/links/heading-ids";
import { reindexSource } from "@/features/links/link-index";
import type {
  Chapter,
  ChapterStatus,
  ChapterType,
  CreateChapterInput,
  UpdateChapterInput,
} from "@/features/chapters/types";

function generateId(): string {
  return crypto.randomUUID();
}

export function toChapter(row: Record<string, unknown>): Chapter {
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

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function readChapter(id: string): Promise<Chapter | null> {
  const db = await getDatabase();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM chapters WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? toChapter(rows[0]) : null;
}

/** Shared normalization for local writes and snapshot writes. */
export function normalizeChapterContent(content: string): { html: string; wordCount: number } {
  const normalized = assignHeadingIds(content);
  const text = normalized.html.replace(/<[^>]*>/g, " ");
  return {
    html: normalized.html,
    wordCount: text.split(/\s+/).filter((w) => w.length > 0).length,
  };
}

/** Bump the containing Book's sync clock and Last Edited after a content change. */
async function touchParentBook(bookId: string, now: number): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE books SET updated_at = ?, content_updated_at = ? WHERE id = ?", [
    now,
    now,
    bookId,
  ]);
}

interface BookStamps {
  updated_at: number;
  content_updated_at: number | null;
}

async function readBookStamps(bookId: string): Promise<BookStamps | null> {
  const db = await getDatabase();
  const rows = await db.select<BookStamps[]>(
    "SELECT updated_at, content_updated_at FROM books WHERE id = ?",
    [bookId]
  );
  return rows[0] ?? null;
}

/** Read every Book/Chapter the import result needs, in gallery order. */
export async function fetchStoredChapters(bookId: string): Promise<Chapter[]> {
  const db = await getDatabase();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
    [bookId]
  );
  return rows.map(toChapter);
}

export async function createChapterRow(
  input: CreateChapterInput,
  origin: ChangeOrigin
): Promise<Chapter> {
  const db = await getDatabase();
  const id = generateId();
  const now = nowSeconds();

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

  // A new chapter (with its title) is new content for the containing Book.
  // The chapter row already persisted: its signal is kept even if the parent
  // touch fails, and the failure is surfaced instead of swallowed.
  let parentError: unknown = null;
  try {
    await touchParentBook(input.bookId, now);
  } catch (error) {
    parentError = error;
  }

  // Capture this save's stored result before unrelated awaits (reindex,
  // emission): a later save must not replace it with newer content. A
  // read-back failure after the durable write still emits below.
  let stored: Chapter | null = null;
  try {
    stored = await readChapter(id);
  } catch {
    stored = null;
  }
  const own: Chapter = stored ?? {
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
    createdAt: new Date(now * 1000),
    updatedAt: new Date(now * 1000),
  };
  await emitChange({ entity: "book", id: input.bookId, origin, kind: "content" });
  if (parentError) throw parentError;
  return own;
}

/**
 * Resolves with the chapter as stored (content normalized), or null when the
 * row no longer exists. Always reads back from the database, so callers get
 * the normalized content even when the chapter is not loaded in the store.
 */
export async function updateChapterRow(
  id: string,
  input: UpdateChapterInput,
  origin: ChangeOrigin
): Promise<Chapter | null> {
  const db = await getDatabase();
  const now = nowSeconds();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM chapters WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return null;
  const existing = toChapter(rows[0]);

  let normalizedContent: string | undefined;
  let wordCount: number | undefined;
  if (input.content !== undefined) {
    const normalized = normalizeChapterContent(input.content);
    normalizedContent = normalized.html;
    wordCount = normalized.wordCount;
    input = { ...input, content: normalizedContent };
  }

  const contentChanged =
    (input.title !== undefined && input.title !== existing.title) ||
    (normalizedContent !== undefined && normalizedContent !== (existing.content ?? "")) ||
    (input.synopsis !== undefined && (input.synopsis ?? undefined) !== existing.synopsis);
  const kind: ChangeKind = contentChanged ? "content" : "metadata";

  // A retry of the same content after a failed parent touch must repair the
  // Book's timestamp: when the Book's Last Edited predates the chapter's own
  // last update, that earlier content edit never touched the parent. A
  // consistent equal-content rewrite (parent stamp current) still touches
  // nothing.
  const hasContentKeys =
    input.title !== undefined || input.content !== undefined || input.synopsis !== undefined;
  const bookStamps = hasContentKeys ? await readBookStamps(existing.bookId) : null;
  const bookContentTs = bookStamps
    ? (bookStamps.content_updated_at ?? bookStamps.updated_at)
    : null;
  const chapterTsBefore = Math.floor(existing.updatedAt.getTime() / 1000);
  const shouldTouchParent =
    contentChanged ||
    (hasContentKeys && bookContentTs !== null && bookContentTs < chapterTsBefore);

  const updates: string[] = ["updated_at = ?"];
  const values: unknown[] = [now];

  if (input.title !== undefined) {
    updates.push("title = ?");
    values.push(input.title);
  }
  if (normalizedContent !== undefined) {
    updates.push("content = ?");
    values.push(normalizedContent);
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

  await db.execute(`UPDATE chapters SET ${updates.join(", ")} WHERE id = ?`, values);

  // Capture this save's stored result before unrelated awaits (parent touch,
  // reindex, emission): a later save must not replace it with newer content.
  // A read-back failure after the durable write still emits below.
  let stored: Chapter | null = null;
  try {
    stored = await readChapter(id);
  } catch {
    stored = null;
  }
  const own: Chapter = stored ?? {
    ...existing,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(normalizedContent !== undefined
      ? { content: normalizedContent, wordCount: wordCount ?? existing.wordCount }
      : {}),
    ...(input.synopsis !== undefined ? { synopsis: input.synopsis } : {}),
    ...(input.chapterType !== undefined ? { chapterType: input.chapterType } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.isIncludedInExport !== undefined
      ? { isIncludedInExport: input.isIncludedInExport }
      : {}),
    updatedAt: new Date(now * 1000),
  };

  // Only real content edits move the containing Book's Last Edited: the
  // recomputed word count alone must not. The failure is surfaced after the
  // emission below instead of swallowed.
  let parentError: unknown = null;
  if (shouldTouchParent) {
    try {
      await touchParentBook(existing.bookId, now);
    } catch (error) {
      parentError = error;
    }
  }

  if (normalizedContent !== undefined) {
    // The link index is derived data: a failure there must not turn a
    // persisted save into a failure.
    await reindexSource({
      sourceType: "chapter",
      sourceId: id,
      sourceBookId: existing.bookId,
      contentHtml: normalizedContent,
    }).catch(() => {});
  }
  await emitChange({ entity: "book", id: existing.bookId, origin, kind });
  if (parentError) throw parentError;
  return own;
}

export async function deleteChapterRow(id: string, origin: ChangeOrigin): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<{ book_id: string }[]>(
    "SELECT book_id FROM chapters WHERE id = ?",
    [id]
  );
  await db.execute("DELETE FROM chapters WHERE id = ?", [id]);
  if (rows.length > 0) {
    // Removing a chapter removes content: the Book's Last Edited moves. The
    // deletion already persisted, so its signal is kept even if the parent
    // touch fails, and the failure is surfaced instead of swallowed.
    const now = nowSeconds();
    let parentError: unknown = null;
    try {
      await db.execute("UPDATE books SET updated_at = ?, content_updated_at = ? WHERE id = ?", [
        now,
        now,
        rows[0].book_id,
      ]);
    } catch (error) {
      parentError = error;
    }
    await emitChange({ entity: "book", id: rows[0].book_id, origin, kind: "content" });
    if (parentError) throw parentError;
  }
}

export async function reorderChapterRows(
  bookId: string,
  chapterIds: string[],
  origin: ChangeOrigin
): Promise<void> {
  const db = await getDatabase();
  const now = nowSeconds();

  // Update each chapter's order — each statement auto-commits individually.
  // Only rows that actually persisted earn a notification: zero durable
  // writes means zero Changes. The book scope keeps a reorder from touching
  // (and notifying for) another Book's chapters.
  let persisted = 0;
  for (let i = 0; i < chapterIds.length; i++) {
    let affected = 0;
    try {
      const result = await db.execute(
        'UPDATE chapters SET "order" = ?, updated_at = ? WHERE id = ? AND book_id = ?',
        [i, now, chapterIds[i], bookId]
      );
      affected = result.rowsAffected ?? 0;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (persisted > 0) {
        await emitChange({ entity: "book", id: bookId, origin, kind: "metadata" });
      }
      throw new Error(`Failed to reorder chapter ${i + 1}/${chapterIds.length}: ${detail}`);
    }
    if (affected > 0) persisted++;
  }

  if (persisted > 0) {
    await emitChange({ entity: "book", id: bookId, origin, kind: "metadata" });
  }
}
