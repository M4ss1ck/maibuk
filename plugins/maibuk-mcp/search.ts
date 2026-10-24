/**
 * The `search_library` tool for the maibuk-mcp Plugin: Library Search over the
 * Plugin API's `library.search`, so an Agent finds a word, name, or passage
 * without reading every Chapter. Pure-ish handler over a `PluginClient`, like
 * `list_books`: results are one compact line per item with the reference the
 * matching get tool accepts, and a cursor line when another page remains.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";
import type { PluginApiOutput } from "@/features/plugins/types";
import { bookLine } from "./books";
import {
  errorResult,
  excerptOf,
  libraryCall,
  resolveRef,
  shortId,
  titleOrUntitled,
} from "./library";

/** Arguments for `search_library`. */
export interface SearchLibraryArgs {
  query: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  kinds?: Array<"book" | "chapter" | "note" | "canvas">;
  book?: string;
  limit?: number;
  cursor?: string;
}

type SearchSuccess = Extract<PluginApiOutput<"library.search">, { results: unknown }>;
type SearchResult = SearchSuccess["results"][number];

/**
 * One result's compact snippet: the match wrapped in `«»`, whitespace
 * collapsed, cut to 150 characters like every other excerpt. Ranges outside
 * the text or running backwards are ignored, so a surprising highlight never
 * breaks the line.
 */
export function markedExcerpt(snippet: {
  text: string;
  highlights: { from: number; to: number }[];
}): string {
  const ranges = snippet.highlights
    .filter((range) => range.from >= 0 && range.to > range.from && range.to <= snippet.text.length)
    .sort((a, b) => a.from - b.from);
  let marked = "";
  let at = 0;
  for (const range of ranges) {
    if (range.from < at) continue;
    marked += snippet.text.slice(at, range.from);
    marked += `«${snippet.text.slice(range.from, range.to)}»`;
    at = range.to;
  }
  marked += snippet.text.slice(at);
  return excerptOf(marked);
}

/**
 * One result's line: its kind, the reference the matching get tool accepts, its
 * title, its match count, and its marked snippet. Canvas hits name the Canvas
 * alone: Canvas content is not part of the API, so no read tool takes a card.
 */
function searchLine(
  result: SearchResult,
  ids: { books: string[]; chapters: string[]; notes: string[]; canvases: string[] }
): string {
  const matches = result.matchCount === 1 ? "1 match" : `${result.matchCount} matches`;
  const snippet = markedExcerpt(result.snippet);
  switch (result.kind) {
    case "book":
      return `book ${shortId(result.bookId, ids.books)}  ${titleOrUntitled(result.title)}  ${matches}  ${snippet}`;
    case "chapter":
      return `chapter ${shortId(result.chapterId, ids.chapters)}  ${titleOrUntitled(result.title)}  ${matches}  ${snippet}`;
    case "note":
      return `note ${shortId(result.noteId, ids.notes)}  ${titleOrUntitled(result.title)}  ${matches}  ${snippet}`;
    case "canvas":
      return `canvas ${shortId(result.canvasId, ids.canvases)}  ${titleOrUntitled(result.title)}  ${matches}  ${snippet}`;
  }
}

export async function searchLibrary(
  client: PluginClient,
  args: SearchLibraryArgs
): Promise<CallToolResult> {
  const query = (args.query ?? "").trim();

  return libraryCall(async () => {
    if (query === "") {
      return errorResult(
        "Give a word or phrase to search for; call search_library again with a query."
      );
    }
    if (args.kinds !== undefined && args.kinds.length === 0) {
      return errorResult("Give at least one kind to search; call search_library again with kinds.");
    }

    const books = await client.library.books.list();
    const allBookIds = books.map((book) => book.id);

    let bookId: string | undefined;
    const bookRef = args.book?.trim();
    if (bookRef !== undefined && bookRef !== "") {
      const resolved = resolveRef({
        ref: bookRef,
        rows: books,
        noun: "Book",
        listTool: "list_books",
        tool: "search_library",
        line: (book) => bookLine(book, allBookIds),
      });
      if ("result" in resolved) return resolved.result;
      bookId = resolved.row.id;
    }

    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);

    const answer = await client.library.search({
      query,
      ...(args.matchCase !== undefined ? { matchCase: args.matchCase } : {}),
      ...(args.wholeWord !== undefined ? { wholeWord: args.wholeWord } : {}),
      ...(args.regex !== undefined ? { regex: args.regex } : {}),
      ...(args.kinds !== undefined ? { kinds: args.kinds } : {}),
      ...(bookId !== undefined ? { bookId } : {}),
      limit,
      ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
    });
    if ("error" in answer) return errorResult(answer.message);

    if (answer.results.length === 0) {
      return { content: [{ type: "text", text: `No matches for "${query}".` }] };
    }

    // Short references are unique prefixes within a kind, so only the kinds on
    // this page need their id lists.
    const kindsShown = new Set(answer.results.map((result) => result.kind));
    const allChapters: Awaited<ReturnType<PluginClient["library"]["chapters"]["list"]>> = [];
    if (kindsShown.has("chapter")) {
      for (const book of books) {
        const chapters = await client.library.chapters.list({ bookId: book.id });
        allChapters.push(...chapters);
      }
    }
    const notes = kindsShown.has("note") ? await client.library.notes.list() : [];
    const canvases = kindsShown.has("canvas") ? await client.library.canvases.list() : [];
    const ids = {
      books: allBookIds,
      chapters: allChapters.map((chapter) => chapter.id),
      notes: notes.map((note) => note.id),
      canvases: canvases.map((canvas) => canvas.id),
    };

    const lines = [
      `Results 1-${answer.results.length} for "${query}"`,
      ...answer.results.map((result) => searchLine(result, ids)),
    ];
    if (answer.nextCursor !== undefined) {
      lines.push(`More: call search_library with the same query and cursor "${answer.nextCursor}"`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });
}
