/**
 * The Library reads the Plugin API serves (ADR 0022): Books, Chapters by Book,
 * Notes, and Canvases. Every read goes to the Library directly; nothing is
 * published to a store, and nothing but plain text and sanitized HTML crosses
 * the API. Chapters report their containing Book as their Change entity, so a
 * reader that wants Chapter edits subscribes to `library.changed` and pulls.
 *
 * Here too are the `library:write` rows (#452, #588): a Book details update and
 * a Checkpoint, Chapter create/delete/reorder/update, and Note create/update,
 * each through the entity's own narrow write path (ADR 0005) with Origin
 * "local", so the write Flushes open editors, normalizes, emits on the Change
 * Feed, and refuses sample ids. The Chapter delete takes the author's own
 * Delete path (`deleteChapterRow`), so sync and Deletion Review carry it like
 * theirs: a Chapter has no tombstone of its own, so what another device pulls
 * is its Book's snapshot without the Chapter.
 *
 * Timestamps are Unix seconds in the Library and milliseconds since the epoch
 * in the API, the one shape every Plugin sees.
 */

import DOMPurify from "dompurify";
import { htmlToPlainText } from "@/components/editor/html-to-text";
import { plainTextToEditorHtml } from "@/components/editor/plain-text-html";
import {
  createChapterRow,
  deleteChapterRow,
  reorderChapterRows,
  updateChapterRow,
} from "@/features/chapters/write";
import { updateBookRow } from "@/features/books/write";
import type { BookStatus } from "@/features/books/types";
import type { ChapterStatus, ChapterType } from "@/features/chapters/types";
import { countWords } from "@/features/metrics/word-count";
import { createNoteRow, updateNoteRow } from "@/features/notes/write";
import type {
  PluginBook,
  PluginCanvasSummary,
  PluginChapterSummary,
  PluginContent,
  PluginNoteSummary,
} from "@/features/plugins/types";
import { PendingEditsFlushError, flushPendingEdits } from "@/features/sync/pending-edits";
import { TutorialIdLeakError } from "@/features/tutorial/library-switch";
import { useVersionStore } from "@/features/versions/store";
import { getDatabase } from "@/lib/db";
import { PluginApiError } from "@/plugin-sdk/protocol";

type Row = Record<string, unknown>;

/** Sanitized HTML: scripts, event handlers, and anything unsafe never cross the API. */
export function sanitizePluginHtml(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html);
}

// The plain-text helper lives with the editor schema it mirrors (#396), so the
// Library reads and #441's selection/reveal share one coordinate system.
export { htmlToPlainText };

function pluginContent(html: string | null | undefined): PluginContent {
  // Plain text comes from the sanitized HTML, so a script's own text never
  // reaches a Plugin as if it were content.
  const safe = sanitizePluginHtml(html);
  return { text: htmlToPlainText(safe), html: safe };
}

function toMillis(seconds: unknown): number {
  return typeof seconds === "number" ? seconds * 1000 : 0;
}

function toBook(row: Row): PluginBook {
  return {
    id: row.id as string,
    title: row.title as string,
    subtitle: (row.subtitle as string | null) ?? null,
    authorName: row.author_name as string,
    genre: (row.genre as string | null) ?? null,
    language: (row.language as string | null) ?? "en",
    wordCount: (row.word_count as number) ?? 0,
    targetWordCount: (row.target_word_count as number | null) ?? null,
    // The column defaults to "draft"; a row from before it existed reads as one.
    status: (row.status as BookStatus | null) ?? "draft",
    updatedAt: toMillis(row.updated_at),
  };
}

function toChapterSummary(row: Row): PluginChapterSummary {
  return {
    id: row.id as string,
    bookId: row.book_id as string,
    title: row.title as string,
    order: row.order as number,
    parentId: (row.parent_id as string | null) ?? null,
    wordCount: (row.word_count as number) ?? 0,
    // Both columns have a default; a row without one reads as the default.
    chapterType: (row.chapter_type as ChapterType | null) ?? "chapter",
    status: (row.status as ChapterStatus | null) ?? "draft",
    updatedAt: toMillis(row.updated_at),
  };
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function toNoteSummary(row: Row): PluginNoteSummary {
  return {
    id: row.id as string,
    bookId: (row.book_id as string | null) ?? null,
    title: row.title as string,
    language: (row.language as string | null) ?? null,
    tags: parseTags(row.tags),
    wordCount: (row.word_count as number) ?? 0,
    updatedAt: toMillis(row.updated_at),
  };
}

function toCanvasSummary(row: Row): PluginCanvasSummary {
  return {
    // Canvases carry no Book association in the Library; the API keeps the
    // field so a future association does not change the shape.
    id: row.id as string,
    bookId: null,
    title: row.title as string,
    updatedAt: toMillis(row.updated_at),
  };
}

/** Every Book, most recently updated first. */
export async function listPluginBooks(): Promise<PluginBook[]> {
  const db = await getDatabase();
  const rows = await db.select<Row[]>("SELECT * FROM books ORDER BY updated_at DESC");
  return rows.map(toBook);
}

/** One Book's details, or null when it does not exist. */
export async function getPluginBook(bookId: string): Promise<PluginBook | null> {
  const db = await getDatabase();
  const rows = await db.select<Row[]>("SELECT * FROM books WHERE id = ?", [bookId]);
  return rows.length > 0 ? toBook(rows[0]) : null;
}

/** A Book's Chapters in order, without their content. */
export async function listPluginChapters(bookId: string): Promise<PluginChapterSummary[]> {
  const db = await getDatabase();
  const rows = await db.select<Row[]>(
    'SELECT * FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
    [bookId]
  );
  return rows.map(toChapterSummary);
}

/** One Chapter with its content, or null when it does not exist. */
export async function getPluginChapter(
  chapterId: string
): Promise<(PluginChapterSummary & { content: PluginContent }) | null> {
  const db = await getDatabase();
  const rows = await db.select<Row[]>("SELECT * FROM chapters WHERE id = ?", [chapterId]);
  if (rows.length === 0) return null;
  return { ...toChapterSummary(rows[0]), content: pluginContent(rows[0].content as string | null) };
}

/** Notes, all of them or one Book's, without their content. */
export async function listPluginNotes(bookId?: string): Promise<PluginNoteSummary[]> {
  const db = await getDatabase();
  const rows =
    bookId === undefined
      ? await db.select<Row[]>('SELECT * FROM notes ORDER BY pinned DESC, "order" ASC, updated_at DESC')
      : await db.select<Row[]>(
          'SELECT * FROM notes WHERE book_id = ? ORDER BY pinned DESC, "order" ASC, updated_at DESC',
          [bookId]
        );
  return rows.map(toNoteSummary);
}

/** One Note with its content, or null when it does not exist. */
export async function getPluginNote(
  noteId: string
): Promise<(PluginNoteSummary & { content: PluginContent }) | null> {
  const db = await getDatabase();
  const rows = await db.select<Row[]>("SELECT * FROM notes WHERE id = ?", [noteId]);
  if (rows.length === 0) return null;
  return { ...toNoteSummary(rows[0]), content: pluginContent(rows[0].content as string | null) };
}

/** Canvases with their metadata. Canvas content is not part of the API. */
export async function listPluginCanvases(bookId?: string): Promise<PluginCanvasSummary[]> {
  // No Canvas carries a Book association today, so a Book filter matches none.
  if (bookId !== undefined) return [];
  const db = await getDatabase();
  const rows = await db.select<Row[]>(
    'SELECT * FROM canvases ORDER BY pinned DESC, "order" ASC, updated_at DESC'
  );
  return rows.map(toCanvasSummary);
}

/** One Canvas's metadata, or null when it does not exist. */
export async function getPluginCanvas(canvasId: string): Promise<PluginCanvasSummary | null> {
  const db = await getDatabase();
  const rows = await db.select<Row[]>("SELECT * FROM canvases WHERE id = ?", [canvasId]);
  return rows.length > 0 ? toCanvasSummary(rows[0]) : null;
}

// Library writes (#452). A fragment is plain text or an HTML fragment the host
// sanitizes; both become the HTML the entity's write path normalizes.

/** A content fragment a Plugin writes: plain text, or HTML the host sanitizes. */
export type PluginContentFragment = { text: string } | { html: string };

/**
 * The HTML a fragment becomes before a write path normalizes it. HTML passes
 * through the same sanitizer every read uses; plain text is escaped into
 * paragraphs, and an empty fragment becomes empty content.
 */
export function fragmentToHtml(fragment: PluginContentFragment): string {
  if ("html" in fragment) return sanitizePluginHtml(fragment.html);
  return fragment.text === "" ? "" : plainTextToEditorHtml(fragment.text);
}

/** A write against an id the Library does not hold; the Plugin sees a refusal. */
function notFound(entity: "Book" | "Chapter" | "Note", id: string): PluginApiError {
  return new PluginApiError({ code: "invalid-params", message: `${entity} ${id} does not exist` });
}

/** The word count of a fragment's final HTML, counted the way the editor counts. */
function contentWordCount(html: string): number {
  return countWords(htmlToPlainText(html));
}

/**
 * One `library:write` handler's shared refusal mapping. The write paths signal
 * two recoverable failures with their own error types: a Flush that could not
 * save an open editor (`PendingEditsFlushError`) means nothing was written and
 * the author's edits are still open, and a Tutorial sample id means the write
 * targets a read-only Library. Both become `library-unavailable` so a Plugin
 * can retry or tell the author; every other error rethrows unchanged.
 */
async function libraryWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PendingEditsFlushError) {
      throw new PluginApiError({
        code: "library-unavailable",
        message: "An open editor could not save; nothing was written. Try again.",
      });
    }
    if (error instanceof TutorialIdLeakError) {
      throw new PluginApiError({
        code: "library-unavailable",
        message: "The Tutorial Library is read-only; nothing was written.",
      });
    }
    throw error;
  }
}

/**
 * Updates a Book's title, Author Name, Genre, Book Status, or Target Word
 * Count through the Book write path. Every field is optional but at least one
 * must be given, so a call never becomes a bare sync-clock bump; a null Genre
 * or Target Word Count clears it, and a missing id comes back as null.
 */
export async function updatePluginBook(input: {
  bookId: string;
  title?: string;
  authorName?: string;
  genre?: string | null;
  status?: BookStatus;
  targetWordCount?: number | null;
}): Promise<null> {
  const changes = {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.authorName === undefined ? {} : { authorName: input.authorName }),
    // The row writer stores what it is given; a null clears the column.
    ...(input.genre === undefined ? {} : { genre: input.genre as string }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.targetWordCount === undefined
      ? {}
      : { targetWordCount: input.targetWordCount as number }),
  };
  return libraryWrite(async () => {
    if (Object.keys(changes).length === 0) {
      throw new PluginApiError({
        code: "invalid-params",
        message: "Give at least one Book field to update",
      });
    }
    const book = await updateBookRow(input.bookId, changes, "local");
    if (!book) throw notFound("Book", input.bookId);
    return null;
  });
}

/**
 * Takes a Checkpoint of a Book through the normal Version path (#588). Open
 * editors flush first, the way the close and pre-sync triggers do, so the
 * Checkpoint holds what the author already typed; the Version Trigger is
 * "plugin" and the label becomes the Version's name. `createVersion` dedups by
 * checksum, so an unchanged Book comes back as a null versionId.
 */
export async function checkpointPluginBook(input: {
  bookId: string;
  label: string;
}): Promise<{ versionId: string | null }> {
  return libraryWrite(async () => {
    const book = await getPluginBook(input.bookId);
    if (!book) throw notFound("Book", input.bookId);
    const label = input.label.trim();
    if (label.length === 0 || label.length > 200) {
      throw new PluginApiError({
        code: "invalid-params",
        message: "Give a label of 1 to 200 characters for the Checkpoint",
      });
    }
    await flushPendingEdits();
    const version = await useVersionStore.getState().createVersion({
      bookId: input.bookId,
      triggerType: "plugin",
      name: label,
    });
    return { versionId: version?.id ?? null };
  });
}

/** Replaces a Chapter's content through the Chapter write path. */
export async function updatePluginChapterContent(
  chapterId: string,
  fragment: PluginContentFragment
): Promise<null> {
  return libraryWrite(async () => {
    const chapter = await updateChapterRow(chapterId, { content: fragmentToHtml(fragment) }, "local");
    if (!chapter) throw notFound("Chapter", chapterId);
    return null;
  });
}

/** Whether a Chapter row exists; the delete path itself no-ops on a missing one. */
async function chapterExists(chapterId: string): Promise<boolean> {
  const db = await getDatabase();
  const rows = await db.select<{ id: string }[]>("SELECT id FROM chapters WHERE id = ?", [
    chapterId,
  ]);
  return rows.length > 0;
}

/** The ids of a Book's Chapters in stored order. */
async function chapterOrder(bookId: string): Promise<string[]> {
  return (await listPluginChapters(bookId)).map((chapter) => chapter.id);
}

/**
 * Creates a Chapter through the Chapter write path (#588) and returns its id.
 * The row is appended, then the Book is reordered to the requested 0-based
 * position, the same create-then-reorder pair the UI uses to insert one. A
 * content fragment lands through the same path as updateContent, which
 * sanitizes, normalizes, and recounts the words; position is checked against
 * the Book's Chapter count before anything is written, so a refused position
 * leaves no row behind.
 */
export async function createPluginChapter(input: {
  bookId: string;
  title: string;
  position?: number;
  content?: PluginContentFragment;
}): Promise<{ chapterId: string }> {
  return libraryWrite(async () => {
    const book = await getPluginBook(input.bookId);
    if (!book) throw notFound("Book", input.bookId);
    const before = await chapterOrder(input.bookId);
    if (input.position !== undefined && (input.position < 0 || input.position > before.length)) {
      throw new PluginApiError({
        code: "invalid-params",
        message: `position ${input.position} is outside 0 to ${before.length} for Book ${input.bookId}`,
      });
    }

    const chapter = await createChapterRow(
      { bookId: input.bookId, title: input.title },
      "local"
    );
    if (input.content !== undefined) {
      await updateChapterRow(chapter.id, { content: fragmentToHtml(input.content) }, "local");
    }
    if (input.position !== undefined) {
      // Read the order back after the write: a Chapter added meanwhile belongs
      // in the list too, and the new one is appended last.
      const ids = await chapterOrder(input.bookId);
      const from = ids.indexOf(chapter.id);
      if (from !== -1 && from !== input.position) {
        ids.splice(from, 1);
        ids.splice(input.position, 0, chapter.id);
        await reorderChapterRows(input.bookId, ids, "local");
      }
    }
    return { chapterId: chapter.id };
  });
}

/**
 * Deletes a Chapter through the normal Delete path (#588): the same
 * `deleteChapterRow` call the author's delete makes, so the Book's snapshot
 * loses the Chapter and the Change Feed carries it as a local content Change.
 * A missing id is refused; the row writer itself would no-op.
 */
export async function deletePluginChapter(chapterId: string): Promise<null> {
  return libraryWrite(async () => {
    if (!(await chapterExists(chapterId))) throw notFound("Chapter", chapterId);
    await deleteChapterRow(chapterId, "local");
    return null;
  });
}

/**
 * Reorders a Book's Chapters to the given ids through the Chapter write path.
 * The list must be exactly the Book's Chapters — no missing, extra, or
 * duplicate id — so a Plugin can never move another Book's Chapter or drop
 * one out of the order by omission.
 */
export async function reorderPluginChapters(input: {
  bookId: string;
  chapterIds: string[];
}): Promise<null> {
  return libraryWrite(async () => {
    if (!(await getPluginBook(input.bookId))) throw notFound("Book", input.bookId);
    const stored = await chapterOrder(input.bookId);
    const given = input.chapterIds;
    const exact =
      given.length === stored.length &&
      new Set(given).size === given.length &&
      stored.every((chapterId) => given.includes(chapterId));
    if (!exact) {
      throw new PluginApiError({
        code: "invalid-params",
        message: `chapterIds must be exactly the ${stored.length} Chapters of Book ${input.bookId}, in the new order`,
      });
    }
    await reorderChapterRows(input.bookId, given, "local");
    return null;
  });
}

/**
 * Updates a Chapter's title, Chapter Type, or Chapter Status through the
 * Chapter write path. Every field is optional but at least one must be given,
 * the same rule as a Book update; a missing id comes back as a refusal.
 */
export async function updatePluginChapter(input: {
  chapterId: string;
  title?: string;
  chapterType?: ChapterType;
  status?: ChapterStatus;
}): Promise<null> {
  const changes = {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.chapterType === undefined ? {} : { chapterType: input.chapterType }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
  return libraryWrite(async () => {
    if (Object.keys(changes).length === 0) {
      throw new PluginApiError({
        code: "invalid-params",
        message: "Give at least one Chapter field to update",
      });
    }
    const chapter = await updateChapterRow(input.chapterId, changes, "local");
    if (!chapter) throw notFound("Chapter", input.chapterId);
    return null;
  });
}

/** Creates a Note through the Note write path and returns its id. */
export async function createPluginNote(input: {
  title: string;
  bookId?: string | null;
  content?: PluginContentFragment;
}): Promise<{ noteId: string }> {
  return libraryWrite(async () => {
    const content = input.content === undefined ? undefined : fragmentToHtml(input.content);
    const note = await createNoteRow(
      {
        title: input.title,
        bookId: input.bookId ?? null,
        ...(content === undefined
          ? {}
          : { content, wordCount: contentWordCount(content) }),
      },
      "local"
    );
    return { noteId: note.id };
  });
}

/**
 * Updates a Note's title or content through the Note write path. No "current"
 * state is read before the write: `updateNoteRow` merges the given fields onto
 * the stored row, so an omitted field (the title, or the bookId it derives) is
 * left as stored, and a missing id comes back as null.
 */
export async function updatePluginNote(input: {
  noteId: string;
  title?: string;
  content?: PluginContentFragment;
}): Promise<null> {
  return libraryWrite(async () => {
    const content = input.content === undefined ? undefined : fragmentToHtml(input.content);
    const note = await updateNoteRow(
      {
        id: input.noteId,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(content === undefined
          ? {}
          : { content, wordCount: contentWordCount(content) }),
      },
      "local"
    );
    if (!note) throw notFound("Note", input.noteId);
    return null;
  });
}
