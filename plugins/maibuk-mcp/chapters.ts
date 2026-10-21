/**
 * The `read_chapter` tool for the maibuk-mcp Plugin: one Chapter's content in
 * character windows. Pure-ish handler over a `PluginClient`, like `get_book`.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";
import {
  errorResult,
  libraryCall,
  readWindow,
  resolveRef,
  shortId,
  titleOrUntitled,
} from "./library";

/** Arguments for `read_chapter`. */
export interface ReadChapterArgs {
  chapter: string;
  format?: "text" | "html";
  offset?: number;
  length?: number;
}

type ChapterRow = Awaited<ReturnType<PluginClient["library"]["chapters"]["list"]>>[number];
type BookRow = Awaited<ReturnType<PluginClient["library"]["books"]["list"]>>[number];

/**
 * The candidate line an ambiguous Chapter prefix answers with, shared by the
 * tools that resolve a Chapter ref: short id, title, and its Book.
 */
export function chapterCandidate(
  chapter: ChapterRow,
  booksById: Map<string, BookRow>,
  allChapterIds: readonly string[]
): string {
  const sid = shortId(chapter.id, allChapterIds);
  const title = titleOrUntitled(chapter.title);
  const book = booksById.get(chapter.bookId);
  const bookTitle = book ? titleOrUntitled(book.title) : "Untitled";
  return `${sid}  ${title}  in ${bookTitle}`;
}

export async function readChapter(
  client: PluginClient,
  args: ReadChapterArgs
): Promise<CallToolResult> {
  const ref = (args.chapter ?? "").trim();
  const format = args.format ?? "text";

  return libraryCall(async () => {
    const books = await client.library.books.list();
    const bookIds = books.map((book) => book.id);
    const booksById = new Map(books.map((book) => [book.id, book]));

    const allChapters: ChapterRow[] = [];
    for (const book of books) {
      const chapters = await client.library.chapters.list({ bookId: book.id });
      allChapters.push(...chapters);
    }
    const allChapterIds = allChapters.map((chapter) => chapter.id);

    const resolved = resolveRef({
      ref,
      rows: allChapters,
      noun: "Chapter",
      listTool: "get_book",
      tool: "read_chapter",
      line: (chapter) => chapterCandidate(chapter, booksById, allChapterIds),
    });
    if ("result" in resolved) return resolved.result;

    const full = await client.library.chapters.get({ chapterId: resolved.row.id });
    if (!full) {
      return errorResult(`No Chapter has the id ${ref}; call get_book to see the Chapters.`);
    }

    const content = format === "html" ? full.content.html : full.content.text;
    const windowed = readWindow(content, args.offset, args.length);
    if ("pastEnd" in windowed) {
      return errorResult(
        `The offset ${args.offset} is past the end of the Chapter (${windowed.total} characters); call read_chapter with a smaller offset.`
      );
    }

    const chapterSid = shortId(full.id, allChapterIds);
    const title = titleOrUntitled(full.title);
    const book = booksById.get(full.bookId);
    const bookLine = book
      ? `${shortId(book.id, bookIds)}  ${titleOrUntitled(book.title)}`
      : full.bookId;

    const header = [
      `Chapter ${chapterSid}: ${title}`,
      `Book: ${bookLine}`,
      `Words: ${full.wordCount}`,
      `Last Edited: ${new Date(full.updatedAt).toISOString()}`,
      `Format: ${format}`,
      `Characters ${windowed.start}-${windowed.end} of ${windowed.total}`,
      windowed.nextOffset === null ? "End of Chapter." : `Next offset: ${windowed.nextOffset}`,
    ].join("\n");

    return {
      content: [
        { type: "text", text: header },
        { type: "text", text: windowed.window },
      ],
    };
  });
}
