/**
 * The two Book tools for the maibuk-mcp Plugin: `list_books` and `get_book`.
 * Pure-ish handlers over a `PluginClient`: all Library reads go through the
 * client, so the Tutorial refusal (library-unavailable) surfaces as a tool
 * error and any other failure propagates.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";
import {
  errorResult,
  excerptOf,
  isLibraryUnavailable,
  isoDate,
  LIBRARY_UNAVAILABLE_TEXT,
  libraryCall,
  pageLines,
  resolveRef,
  shortId,
  titleOrUntitled,
} from "./library";

export { isLibraryUnavailable, LIBRARY_UNAVAILABLE_TEXT, shortId };

/** Arguments for `list_books`. */
export interface ListBooksArgs {
  status?: "draft" | "in-progress" | "completed" | "archived";
  cursor?: string;
  limit?: number;
  detail?: "titles" | "excerpts";
}

/** Arguments for `get_book`. */
export interface GetBookArgs {
  book: string;
  detail?: "titles" | "excerpts";
}

type BookRow = Awaited<ReturnType<PluginClient["library"]["books"]["list"]>>[number];

function bookLine(book: BookRow, allIds: readonly string[]): string {
  const sid = shortId(book.id, allIds);
  const title = titleOrUntitled(book.title);
  return `${sid}  ${title}  ${book.wordCount} words  ${isoDate(book.updatedAt)}`;
}

/**
 * The excerpt for a Book's list line: its first Chapter's (lowest `order`)
 * text, or "" when the Book has no Chapters or no text.
 */
async function bookExcerpt(client: PluginClient, bookId: string): Promise<string> {
  const chapters = await client.library.chapters.list({ bookId });
  if (chapters.length === 0) return "";
  const first = [...chapters].sort((a, b) => a.order - b.order)[0];
  const full = await client.library.chapters.get({ chapterId: first.id });
  return excerptOf(full?.content.text ?? "");
}

export async function listBooks(
  client: PluginClient,
  args: ListBooksArgs
): Promise<CallToolResult> {
  return libraryCall(async () => {
    const books = await client.library.books.list();

    const allIds = books.map((book) => book.id);
    const filtered = args?.status ? books.filter((book) => book.status === args.status) : books;
    const sorted = [...filtered].sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const excerpts = (args?.detail ?? "titles") === "excerpts";

    return pageLines({
      rows: sorted,
      cursor: args?.cursor,
      limit: args?.limit,
      noun: "Books",
      tool: "list_books",
      lines: async (book) => {
        const line = bookLine(book, allIds);
        if (!excerpts) return [line];
        const excerpt = await bookExcerpt(client, book.id);
        return excerpt === "" ? [line] : [line, `  ${excerpt}`];
      },
    });
  });
}

export async function getBook(client: PluginClient, args: GetBookArgs): Promise<CallToolResult> {
  const ref = args.book.trim();

  if (ref.length < 8) {
    return errorResult("Use at least 8 characters of a Book id; call list_books to see them.");
  }

  return libraryCall(async () => {
    const books = await client.library.books.list();

    const allIds = books.map((book) => book.id);
    const resolved = resolveRef({
      ref,
      rows: books,
      noun: "Book",
      listTool: "list_books",
      tool: "get_book",
      line: (book) => bookLine(book, allIds),
    });
    if ("result" in resolved) return resolved.result;
    const bookId = resolved.row.id;

    const book = await client.library.books.get({ bookId });
    const chapters = await client.library.chapters.list({ bookId });
    const notes = await client.library.notes.list({ bookId });

    if (!book) {
      return errorResult(`No Book has the id ${ref}; call list_books to see the Books.`);
    }

    const sortedChapters = [...chapters].sort((a, b) => a.order - b.order);
    const chapterIds = sortedChapters.map((chapter) => chapter.id);
    const noteIds = notes.map((note) => note.id);
    const excerpts = (args.detail ?? "titles") === "excerpts";

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
    lines.push(`Last Edited: ${isoDate(book.updatedAt)}`);
    lines.push("");
    lines.push(`Chapters (${sortedChapters.length}):`);
    if (sortedChapters.length === 0) {
      lines.push("none");
    } else {
      for (const [index, chapter] of sortedChapters.entries()) {
        const sid = shortId(chapter.id, chapterIds);
        const ctitle = titleOrUntitled(chapter.title);
        lines.push(`${index + 1}. ${sid}  ${ctitle}  ${chapter.wordCount} words`);
        if (excerpts) {
          const full = await client.library.chapters.get({ chapterId: chapter.id });
          const excerpt = excerptOf(full?.content.text ?? "");
          if (excerpt !== "") lines.push(`  ${excerpt}`);
        }
      }
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
        if (excerpts) {
          const full = await client.library.notes.get({ noteId: note.id });
          const excerpt = excerptOf(full?.content.text ?? "");
          if (excerpt !== "") lines.push(`  ${excerpt}`);
        }
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  });
}
