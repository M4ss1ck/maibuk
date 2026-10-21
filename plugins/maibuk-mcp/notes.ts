/**
 * The Note tools for the maibuk-mcp Plugin: `list_notes` and `read_note`, plus
 * `write_note`, which creates a Note in a Book or as an Unfiled Note, or
 * replaces one Note's whole content, title, Tags, and Book, `edit_note`, which
 * shares `edit_chapter`'s find-and-replace and append, and `delete_note`, which
 * returns the whole text it removes. Pure-ish handlers over a `PluginClient`,
 * like `list_books`.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";
import {
  errorResult,
  excerptOf,
  isConflict,
  isoDate,
  libraryCall,
  pageLines,
  readWindow,
  resolveRef,
  shortId,
  titleOrUntitled,
} from "./library";
import { bookLine } from "./books";
import { applyEdit, editModeOf, type EditModeArgs, type EditTerms, type WriteGuard } from "./edits";

export interface ListNotesArgs {
  book?: string;
  tag?: string;
  cursor?: string;
  limit?: number;
  detail?: "titles" | "excerpts";
}

type NoteRow = Awaited<ReturnType<PluginClient["library"]["notes"]["list"]>>[number];
type FullNote = NonNullable<Awaited<ReturnType<PluginClient["library"]["notes"]["get"]>>>;

function noteLine(note: NoteRow, allIds: readonly string[]): string {
  const sid = shortId(note.id, allIds);
  const title = titleOrUntitled(note.title);
  const base = `${sid}  ${title}  ${note.wordCount} words  ${isoDate(note.updatedAt)}`;
  if (note.tags.length === 0) return base;
  return `${base}  Tags: ${note.tags.join(", ")}`;
}

/**
 * The lines that name one Note: its short id and title, where it lives (a Book
 * or Unfiled), and its Tags. `read_note` prints them above its content window
 * and `delete_note` above the whole text it returns, so both name a Note the
 * same way.
 */
async function noteIdentityLines(
  client: PluginClient,
  full: FullNote,
  allIds: readonly string[]
): Promise<string[]> {
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
  return [
    `Note ${shortId(full.id, allIds)}: ${titleOrUntitled(full.title)}`,
    bookHeaderLine,
    tagsLine,
  ];
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

    const identity = await noteIdentityLines(client, full, allIds);
    const header = [
      ...identity,
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

/** Arguments for `write_note`: replace mode names `note`, create mode names `book` or none. */
export interface WriteNoteArgs {
  note?: string;
  book?: string | null;
  title?: string;
  expectedLastEdited?: string;
  text?: string;
  html?: string;
  tags?: string[];
}

function changedSinceMessage(lastEdited: string): string {
  return `The Note changed since you read it (Last Edited is now ${lastEdited}); call read_note again and redo the change.`;
}

/** The Note an Agent named, by full id or an 8+ character prefix. */
async function resolveNote(
  client: PluginClient,
  ref: string,
  tool: string
): Promise<{ full: FullNote } | { result: CallToolResult }> {
  const notes = await client.library.notes.list();
  const allIds = notes.map((note) => note.id);

  const resolved = resolveRef({
    ref,
    rows: notes,
    noun: "Note",
    listTool: "list_notes",
    tool,
    line: (note) => noteLine(note, allIds),
  });
  if ("result" in resolved) return resolved;

  const full = await client.library.notes.get({ noteId: resolved.row.id });
  if (!full) {
    return { result: errorResult(`No Note has the id ${ref}; call list_notes to see the Notes.`) };
  }
  return { full };
}

/** The Book an Agent named as a Note's place, or null for an Unfiled Note. */
async function resolveBook(
  client: PluginClient,
  ref: string,
  tool: string
): Promise<{ bookId: string; bookTitle: string } | { result: CallToolResult }> {
  const books = await client.library.books.list();
  const allBookIds = books.map((book) => book.id);
  const resolved = resolveRef({
    ref: ref.trim(),
    rows: books,
    noun: "Book",
    listTool: "list_books",
    tool,
    line: (book) => bookLine(book, allBookIds),
  });
  if ("result" in resolved) return resolved;
  return { bookId: resolved.row.id, bookTitle: resolved.row.title };
}

/**
 * Creates a Note in a Book or as an Unfiled Note, or replaces one Note's whole
 * content, title, Tags, and Book. Mirrors `write_chapter`: a replace needs
 * `expectedLastEdited` from `read_note`, every Book the write touches takes its
 * Checkpoint first, and an Unfiled Note touches none.
 */
export async function writeNote(
  client: PluginClient,
  args: WriteNoteArgs,
  writeGuard: WriteGuard
): Promise<CallToolResult> {
  const hasNote = args.note !== undefined;

  if (args.text !== undefined && args.html !== undefined) {
    return errorResult(
      "Give the new content as text or as html, not both; call write_note again with only one of them."
    );
  }
  if (args.title !== undefined && args.title.trim().length > 500) {
    return errorResult(
      "A title can be at most 500 characters; call write_note with a shorter one."
    );
  }

  if (!hasNote) {
    if (args.expectedLastEdited !== undefined) {
      return errorResult(
        "expectedLastEdited is only for replacing a Note's content; to create, call write_note with title and no expectedLastEdited."
      );
    }

    const title = args.title === undefined ? "" : args.title.trim();
    const bookRef = args.book ?? null;

    return libraryCall(async () => {
      let bookId: string | null = null;
      let bookTitle = "";
      if (bookRef !== null) {
        const resolved = await resolveBook(client, bookRef, "write_note");
        if ("result" in resolved) return resolved.result;
        bookId = resolved.bookId;
        bookTitle = resolved.bookTitle;
      }

      // After all validation and the Book resolve, before the create: a
      // refused create takes no Checkpoint, and a failed Checkpoint refuses it.
      if (bookId !== null) {
        const checkpoint = await writeGuard.ensureCheckpoint(bookId);
        if (checkpoint !== null) return checkpoint;
      }

      const { noteId: newId } = await client.library.notes.create({
        title,
        ...(bookId === null ? {} : { bookId }),
        ...(args.text !== undefined
          ? { content: { text: args.text } }
          : args.html !== undefined
            ? { content: { html: args.html } }
            : {}),
      });

      // The Note write path creates with no Tags, so a create that names them
      // sets them through the same update a replace uses.
      if (args.tags !== undefined) {
        await client.library.notes.update({ noteId: newId, tags: args.tags });
      }

      const stored = await client.library.notes.get({ noteId: newId });
      const allIds = (await client.library.notes.list()).map((note) => note.id);
      const lastEdited = new Date(stored?.updatedAt ?? Date.now()).toISOString();
      const place =
        bookId === null ? "as an Unfiled Note" : `in Book ${titleOrUntitled(bookTitle)}`;
      return {
        content: [
          {
            type: "text",
            text: `Created Note ${titleOrUntitled(title)} ${place}; its id is ${shortId(newId, allIds)}.\nLast Edited: ${lastEdited}`,
          },
        ],
      };
    });
  }

  if (args.expectedLastEdited === undefined) {
    return errorResult(
      "Give expectedLastEdited from read_note; call read_note first to get Last Edited."
    );
  }
  const wantsChange =
    args.text !== undefined ||
    args.html !== undefined ||
    args.title !== undefined ||
    args.tags !== undefined ||
    args.book !== undefined;
  if (!wantsChange) {
    return errorResult(
      "Give text or html content, a title, Tags, or a Book to change the Note; call read_note to see it."
    );
  }
  const expectedLastEdited = args.expectedLastEdited;

  return libraryCall(async () => {
    const resolved = await resolveNote(client, (args.note as string).trim(), "write_note");
    if ("result" in resolved) return resolved.result;

    const full = resolved.full;

    const current = new Date(full.updatedAt).toISOString();
    if (expectedLastEdited.trim() !== current) {
      return errorResult(changedSinceMessage(current));
    }

    // The Note's place after the write: its Book unchanged, the named Book, or
    // null for Unfiled.
    let destinationId = full.bookId;
    let destinationTitle = "";
    if (args.book === null) {
      destinationId = null;
    } else if (args.book !== undefined) {
      const destination = await resolveBook(client, args.book, "write_note");
      if ("result" in destination) return destination.result;
      destinationId = destination.bookId;
      destinationTitle = destination.bookTitle;
    }
    const moved = destinationId !== full.bookId;

    // After the expectedLastEdited check and the destination resolve, before
    // the write: a move touches the Book the Note leaves and the Book it joins,
    // each once, and an Unfiled Note touches none.
    const touched = new Set(
      [full.bookId, destinationId].filter((bookId): bookId is string => bookId !== null)
    );
    for (const bookId of touched) {
      const checkpoint = await writeGuard.ensureCheckpoint(bookId);
      if (checkpoint !== null) return checkpoint;
    }

    const title = args.title === undefined ? undefined : args.title.trim();
    try {
      await client.library.notes.update({
        noteId: full.id,
        ...(args.text !== undefined
          ? { content: { text: args.text } }
          : args.html !== undefined
            ? { content: { html: args.html } }
            : {}),
        ...(title === undefined ? {} : { title }),
        ...(args.tags === undefined ? {} : { tags: args.tags }),
        ...(args.book === undefined ? {} : { bookId: destinationId }),
        expectedUpdatedAt: full.updatedAt,
      });
    } catch (error) {
      if (!isConflict(error)) throw error;
      const fresh = await client.library.notes.get({ noteId: full.id });
      const freshLastEdited = new Date((fresh ?? full).updatedAt).toISOString();
      return errorResult(changedSinceMessage(freshLastEdited));
    }

    const stored = await client.library.notes.get({ noteId: full.id });
    const newTitle = title ?? full.title;
    const place = moved
      ? destinationId === null
        ? " It is now an Unfiled Note."
        : ` It is now in Book ${titleOrUntitled(destinationTitle)}.`
      : "";
    return {
      content: [
        {
          type: "text",
          text: `Replaced the whole of Note ${titleOrUntitled(newTitle)}.${place}\nLast Edited: ${new Date(
            (stored ?? full).updatedAt
          ).toISOString()}`,
        },
      ],
    };
  });
}

/** Arguments for `edit_note`: the Note to change plus one edit mode's fields. */
export interface EditNoteArgs extends EditModeArgs {
  note: string;
}

/** How `edit_note` names the row it changes in the shared edit sentences. */
const NOTE_TERMS: EditTerms = { noun: "Note", readTool: "read_note" };

/**
 * Replaces one exact piece of a Note's text, or appends to its end, with the
 * same rules as `edit_chapter`: the edit runs on the stored HTML, a Note in a
 * Book takes that Book's Checkpoint first, an Unfiled Note takes none, and a
 * conflict re-reads the Note and applies the edit to the fresh content.
 */
export async function editNote(
  client: PluginClient,
  args: EditNoteArgs,
  writeGuard: WriteGuard
): Promise<CallToolResult> {
  const ref = (args.note ?? "").trim();
  const mode = editModeOf(args, NOTE_TERMS);
  if ("result" in mode) return mode.result;

  return libraryCall(async () => {
    const resolved = await resolveNote(client, ref, "edit_note");
    if ("result" in resolved) return resolved.result;

    const full = resolved.full;

    const initial = applyEdit(full.content.html, full.content.text, mode, full.title, NOTE_TERMS);
    if ("result" in initial) return initial.result;

    let updatedHtml = initial.html;
    const initialSentence = initial.sentence;

    // After every refusal (validation, no match, several matches) and before
    // the write: a refused write takes no Checkpoint and a failed Checkpoint
    // leaves the content unchanged. An Unfiled Note belongs to no Book, so it
    // takes none.
    if (full.bookId !== null) {
      const checkpoint = await writeGuard.ensureCheckpoint(full.bookId);
      if (checkpoint !== null) return checkpoint;
    }

    let current = full;
    let sentence = initialSentence;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await client.library.notes.update({
          noteId: full.id,
          content: { html: updatedHtml },
          expectedUpdatedAt: current.updatedAt,
        });
        break;
      } catch (error) {
        if (!isConflict(error)) throw error;
        if (attempt === 2) {
          return errorResult("The author is typing in this Note right now; try again in a moment.");
        }
        const fresh = await client.library.notes.get({ noteId: full.id });
        if (!fresh) {
          return errorResult(`No Note has the id ${ref}; call list_notes to see the Notes.`);
        }
        const reEdited = applyEdit(
          fresh.content.html,
          fresh.content.text,
          mode,
          fresh.title,
          NOTE_TERMS
        );
        if ("result" in reEdited) return reEdited.result;
        updatedHtml = reEdited.html;
        sentence = reEdited.sentence;
        current = fresh;
      }
    }

    // Re-read after the write: the host stamps Last Edited itself, and the
    // Agent passes this value back as expectedLastEdited later.
    const stored = await client.library.notes.get({ noteId: full.id });
    const lastEdited = new Date((stored ?? current).updatedAt).toISOString();
    return {
      content: [{ type: "text", text: `${sentence}\nLast Edited: ${lastEdited}` }],
    };
  });
}

/** Arguments for `delete_note`: the one Note to remove. */
export interface DeleteNoteArgs {
  note: string;
}

/**
 * Deletes one Note through the host's normal Delete path, so sync and Deletion
 * Review carry it, and returns its whole text so the Agent and author can
 * restore it. A Note in a Book takes that Book's Checkpoint first; an Unfiled
 * Note belongs to no Book, so it takes none, and a Note that does not resolve
 * takes none.
 */
export async function deleteNote(
  client: PluginClient,
  args: DeleteNoteArgs,
  writeGuard: WriteGuard
): Promise<CallToolResult> {
  const ref = (args.note ?? "").trim();

  return libraryCall(async () => {
    const resolved = await resolveNote(client, ref, "delete_note");
    if ("result" in resolved) return resolved.result;

    const full = resolved.full;

    // Before the delete: a failed Checkpoint refuses it and leaves the Note
    // alone. An Unfiled Note belongs to no Book, so it takes none.
    if (full.bookId !== null) {
      const checkpoint = await writeGuard.ensureCheckpoint(full.bookId);
      if (checkpoint !== null) return checkpoint;
    }

    // The identity lines are read before the row goes, so a short id never
    // lengthens because the Note itself left the list.
    const allIds = (await client.library.notes.list()).map((note) => note.id);
    const identity = await noteIdentityLines(client, full, allIds);

    await client.library.notes.delete({ noteId: full.id });

    const title = titleOrUntitled(full.title);
    // A Checkpoint is a Version of the Book's Chapters and holds no Notes, so
    // the text returned below is the only copy an Agent can restore from.
    const sentence = `Deleted Note ${title} through the normal Delete path, so a sync carries it the way it carries a Delete the author made. Its whole text follows; to restore it, call write_note with it.`;
    return {
      content: [
        { type: "text", text: [sentence, ...identity].join("\n") },
        { type: "text", text: full.content.text },
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
