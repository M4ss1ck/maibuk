/**
 * The `list_notes` tool for the maibuk-mcp Plugin: a paged, filtered list of
 * Notes. Pure-ish handler over a `PluginClient`, like `list_books`.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";
import {
  errorResult,
  excerptOf,
  isoDate,
  libraryCall,
  pageLines,
  readWindow,
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

export interface ReadNoteArgs {
  note: string;
  format?: "text" | "html";
  offset?: number;
  length?: number;
}

export async function readNote(client: PluginClient, args: ReadNoteArgs): Promise<CallToolResult> {
  const ref = (args.note ?? "").trim();
  const format = args.format ?? "text";

  return libraryCall(async () => {
    const notes = await client.library.notes.list();
    const allIds = notes.map((note) => note.id);

    const resolved = resolveRef({
      ref,
      rows: notes,
      noun: "Note",
      listTool: "list_notes",
      tool: "read_note",
      line: (note) => noteLine(note, allIds),
    });
    if ("result" in resolved) return resolved.result;

    const full = await client.library.notes.get({ noteId: resolved.row.id });
    if (!full) {
      return errorResult(`No Note has the id ${ref}; call list_notes to see the Notes.`);
    }

    const content = format === "html" ? full.content.html : full.content.text;
    const windowed = readWindow(content, args.offset, args.length);
    if ("pastEnd" in windowed) {
      return errorResult(
        `The offset ${args.offset} is past the end of the Note (${windowed.total} characters); call read_note with a smaller offset.`
      );
    }

    const noteSid = shortId(full.id, allIds);
    const title = titleOrUntitled(full.title);
    let bookHeaderLine: string;
    if (full.bookId === null) {
      bookHeaderLine = "Book: Unfiled";
    } else {
      const books = await client.library.books.list();
      const book = books.find((entry) => entry.id === full.bookId);
      bookHeaderLine =
        book !== undefined
          ? `Book: ${shortId(
              book.id,
              books.map((entry) => entry.id)
            )}  ${titleOrUntitled(book.title)}`
          : `Book: ${full.bookId}`;
    }
    const tagsLine = full.tags.length === 0 ? "Tags: none" : `Tags: ${full.tags.join(", ")}`;

    const header = [
      `Note ${noteSid}: ${title}`,
      bookHeaderLine,
      tagsLine,
      `Words: ${full.wordCount}`,
      `Last Edited: ${new Date(full.updatedAt).toISOString()}`,
      `Format: ${format}`,
      `Characters ${windowed.start}-${windowed.end} of ${windowed.total}`,
      windowed.nextOffset === null ? "End of Note." : `Next offset: ${windowed.nextOffset}`,
    ].join("\n");

    return {
      content: [
        { type: "text", text: header },
        { type: "text", text: windowed.window },
      ],
    };
  });
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
