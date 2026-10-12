/**
 * The Library reads the Plugin API serves (ADR 0022): Books, Chapters by Book,
 * Notes, and Canvases. Every read goes to the Library directly; nothing is
 * published to a store, and nothing but plain text and sanitized HTML crosses
 * the API. Chapters report their containing Book as their Change entity, so a
 * reader that wants Chapter edits subscribes to `library.changed` and pulls.
 *
 * Timestamps are Unix seconds in the Library and milliseconds since the epoch
 * in the API, the one shape every Plugin sees.
 */

import DOMPurify from "dompurify";
import type {
  PluginBook,
  PluginCanvasSummary,
  PluginChapterSummary,
  PluginContent,
  PluginNoteSummary,
} from "@/features/plugins/types";
import { getDatabase } from "@/lib/db";

type Row = Record<string, unknown>;

/** Sanitized HTML: scripts, event handlers, and anything unsafe never cross the API. */
export function sanitizePluginHtml(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html);
}

/** The plain text a reader wants, with tags dropped and whitespace collapsed. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return (body.textContent ?? "").trim();
}

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
    language: (row.language as string | null) ?? "en",
    wordCount: (row.word_count as number) ?? 0,
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
