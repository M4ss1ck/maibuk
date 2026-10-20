/**
 * The `list_notes` tool for the maibuk-mcp Plugin: a paged, filtered list of
 * Notes. Pure-ish handler over a `PluginClient`, like `list_books`.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";
import {
  excerptOf,
  isoDate,
  libraryCall,
  pageLines,
  resolveRef,
  shortId,
  titleOrUntitled,
} from "./library";
import { bookLine } from "./books";

export interface ListNotesArgs {
  book?: string;
  tag?: string;
  cursor?: string;
  limit?: number;
  detail?: "titles" | "excerpts";
}

type NoteRow = Awaited<ReturnType<PluginClient["library"]["notes"]["list"]>>[number];

function noteLine(note: NoteRow, allIds: readonly string[]): string {
  const sid = shortId(note.id, allIds);
  const title = titleOrUntitled(note.title);
  const base = `${sid}  ${title}  ${note.wordCount} words  ${isoDate(note.updatedAt)}`;
  if (note.tags.length === 0) return base;
  return `${base}  Tags: ${note.tags.join(", ")}`;
}

export async function listNotes(
  client: PluginClient,
  args: ListNotesArgs
): Promise<CallToolResult> {
  return libraryCall(async () => {
    const notes = await client.library.notes.list();

    const allIds = notes.map((note) => note.id);

    let filtered = notes;

    const bookRef = args?.book?.trim();
    if (bookRef !== undefined && bookRef !== "") {
      if (bookRef.toLowerCase() === "unfiled") {
        filtered = filtered.filter((note) => note.bookId === null);
      } else {
        const books = await client.library.books.list();
        const bookIds = books.map((book) => book.id);
        const resolved = resolveRef({
          ref: bookRef,
          rows: books,
          noun: "Book",
          listTool: "list_books",
          tool: "list_notes",
          line: (book) => bookLine(book, bookIds),
        });
        if ("result" in resolved) return resolved.result;
        const bookId = resolved.row.id;
        filtered = filtered.filter((note) => note.bookId === bookId);
      }
    }

    const tagRef = args?.tag?.trim();
    if (tagRef !== undefined && tagRef !== "") {
      const needle = tagRef.toLowerCase();
      filtered = filtered.filter((note) =>
        note.tags.some((tag) => tag.trim().toLowerCase() === needle)
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const excerpts = (args?.detail ?? "titles") === "excerpts";

    return pageLines({
      rows: sorted,
      cursor: args?.cursor,
      limit: args?.limit,
      noun: "Notes",
      tool: "list_notes",
      lines: async (note) => {
        const line = noteLine(note, allIds);
        if (!excerpts) return [line];
        const full = await client.library.notes.get({ noteId: note.id });
        const excerpt = excerptOf(full?.content.text ?? "");
        return excerpt === "" ? [line] : [line, `  ${excerpt}`];
      },
    });
  });
}
