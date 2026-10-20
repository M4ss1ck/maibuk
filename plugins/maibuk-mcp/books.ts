/**
 * The two Book tools for the maibuk-mcp Plugin: `list_books` and `get_book`.
 * Pure-ish handlers over a `PluginClient`: all Library reads go through the
 * client, so the Tutorial refusal (library-unavailable) surfaces as a tool
 * error and any other failure propagates.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";

/** Arguments for `list_books`. */
export interface ListBooksArgs {
  status?: "draft" | "in-progress" | "completed" | "archived";
  cursor?: string;
  limit?: number;
}

/** Arguments for `get_book`. */
export interface GetBookArgs {
  book: string;
}

type BookRow = Awaited<ReturnType<PluginClient["library"]["books"]["list"]>>[number];
type ChapterRow = Awaited<ReturnType<PluginClient["library"]["chapters"]["list"]>>[number];
type NoteRow = Awaited<ReturnType<PluginClient["library"]["notes"]["list"]>>[number];

/** Whether a Plugin API failure refuses with `library-unavailable`. */
export function isLibraryUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "library-unavailable"
  );
}

export const LIBRARY_UNAVAILABLE_TEXT =
  "The Library is unavailable while the Tutorial runs; try again when it ends.";

function libraryUnavailableResult(): CallToolResult {
  return { content: [{ type: "text", text: LIBRARY_UNAVAILABLE_TEXT }], isError: true };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Short id for `id` among its siblings: the shortest prefix of at least 8
 * characters that no other sibling id starts with. An id shorter than 8
 * characters is returned whole.
 */
export function shortId(id: string, siblings: readonly string[]): string {
  if (id.length < 8) return id;
  for (let length = 8; length <= id.length; length += 1) {
    const prefix = id.slice(0, length);
    const clash = siblings.some((other) => other !== id && other.startsWith(prefix));
    if (!clash) return prefix;
  }
  return id;
}

function titleOrUntitled(title: string): string {
  return title === "" ? "Untitled" : title;
}

function bookLine(book: BookRow, allIds: readonly string[]): string {
  const sid = shortId(book.id, allIds);
  const title = titleOrUntitled(book.title);
  const date = new Date(book.updatedAt).toISOString().slice(0, 10);
  return `${sid}  ${title}  ${book.wordCount} words  ${date}`;
}

function invalidCursorResult(): CallToolResult {
  return errorResult("The cursor is not valid; call list_books without a cursor to start again.");
}

export async function listBooks(
  client: PluginClient,
  args: ListBooksArgs
): Promise<CallToolResult> {
  let books: BookRow[];
  try {
    books = await client.library.books.list();
  } catch (error) {
    if (isLibraryUnavailable(error)) return libraryUnavailableResult();
    throw error;
  }

  const allIds = books.map((book) => book.id);
  const filtered = args?.status ? books.filter((book) => book.status === args.status) : books;
  const sorted = [...filtered].sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const total = sorted.length;

  const limit = Math.min(Math.max(args?.limit ?? 20, 1), 50);

  let offset = 0;
  if (args?.cursor !== undefined) {
    let decoded: string;
    try {
      decoded = atob(args.cursor);
    } catch {
      return invalidCursorResult();
    }
    if (!/^\d+$/.test(decoded)) return invalidCursorResult();
    const n = Number(decoded);
    if (!Number.isInteger(n) || n < 0) return invalidCursorResult();
    if (total === 0) {
      if (n !== 0) return invalidCursorResult();
    } else if (n >= total) {
      return invalidCursorResult();
    }
    offset = n;
  }

  if (total === 0) {
    return { content: [{ type: "text", text: "No Books match." }] };
  }

  const page = sorted.slice(offset, offset + limit);
  const from = offset + 1;
  const to = offset + page.length;
  const lines: string[] = [`Books ${from}-${to} of ${total}`];
  for (const book of page) {
    lines.push(bookLine(book, allIds));
  }
  const moreRemain = offset + limit < total;
  if (moreRemain) {
    lines.push(`More: call list_books with cursor "${btoa(String(offset + limit))}"`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export async function getBook(client: PluginClient, args: GetBookArgs): Promise<CallToolResult> {
  const ref = args.book.trim();

  if (ref.length < 8) {
    return errorResult("Use at least 8 characters of a Book id; call list_books to see them.");
  }

  let books: BookRow[];
  try {
    books = await client.library.books.list();
  } catch (error) {
    if (isLibraryUnavailable(error)) return libraryUnavailableResult();
    throw error;
  }

  const allIds = books.map((book) => book.id);

  let bookId: string | null = null;
  const exact = books.find((book) => book.id === ref);
  if (exact) {
    bookId = ref;
  } else {
    const matches = books.filter((book) => book.id.startsWith(ref));
    if (matches.length === 0) {
      return errorResult(`No Book has the id ${ref}; call list_books to see the Books.`);
    }
    if (matches.length === 1) {
      bookId = matches[0].id;
    } else {
      const lines: string[] = [
        `The id ${ref} matches several Books; call get_book again with one of these ids:`,
      ];
      for (const book of matches) {
        lines.push(bookLine(book, allIds));
      }
      return errorResult(lines.join("\n"));
    }
  }

  let book: BookRow | null;
  let chapters: ChapterRow[];
  let notes: NoteRow[];
  try {
    book = await client.library.books.get({ bookId: bookId! });
    chapters = await client.library.chapters.list({ bookId: bookId! });
    notes = await client.library.notes.list({ bookId: bookId! });
  } catch (error) {
    if (isLibraryUnavailable(error)) return libraryUnavailableResult();
    throw error;
  }

  if (!book) {
    return errorResult(`No Book has the id ${ref}; call list_books to see the Books.`);
  }

  const sortedChapters = [...chapters].sort((a, b) => a.order - b.order);
  const chapterIds = sortedChapters.map((chapter) => chapter.id);
  const noteIds = notes.map((note) => note.id);

  const bookShort = shortId(book.id, allIds);
  const title = titleOrUntitled(book.title);

  const lines: string[] = [];
  lines.push(`Book ${bookShort}: ${title}`);
  if (book.subtitle !== null && book.subtitle !== "") {
    lines.push(`Subtitle: ${book.subtitle}`);
  }
  if (book.authorName !== "") {
    lines.push(`Author: ${book.authorName}`);
  }
  lines.push(`Status: ${book.status}`);
  lines.push(`Words: ${book.wordCount}`);
  lines.push(`Last Edited: ${new Date(book.updatedAt).toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`Chapters (${sortedChapters.length}):`);
  if (sortedChapters.length === 0) {
    lines.push("none");
  } else {
    sortedChapters.forEach((chapter, index) => {
      const sid = shortId(chapter.id, chapterIds);
      const ctitle = titleOrUntitled(chapter.title);
      lines.push(`${index + 1}. ${sid}  ${ctitle}  ${chapter.wordCount} words`);
    });
  }
  lines.push("");
  lines.push(`Notes (${notes.length}):`);
  if (notes.length === 0) {
    lines.push("none");
  } else {
    for (const note of notes) {
      const sid = shortId(note.id, noteIds);
      const ntitle = titleOrUntitled(note.title);
      lines.push(`${sid}  ${ntitle}`);
    }
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
