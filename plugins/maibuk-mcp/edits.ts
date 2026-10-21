/**
 * The `edit_chapter` tool for the maibuk-mcp Plugin, with the pure edit logic
 * `edit_note` shares: find-and-replace of one exact piece of a Chapter's text,
 * or an append to its end. Both edits work on the stored HTML, so an Agent
 * changes a few characters instead of sending the whole Chapter back, and
 * every byte it did not name stays where it was.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";
import { bookLine } from "./books";
import { chapterCandidate } from "./chapters";
import {
  errorResult,
  isConflict,
  libraryCall,
  resolveRef,
  shortId,
  positionRefusal,
  titleOrUntitled,
} from "./library";

/** Arguments for `edit_chapter`. */
export interface EditChapterArgs extends EditModeArgs {
  chapter: string;
}

/** The arguments an edit reads its one mode from; a Chapter or a Note adds its id. */
export interface EditModeArgs {
  find?: string;
  replace?: string;
  append?: string;
  format?: "text" | "html";
}

type ChapterRow = Awaited<ReturnType<PluginClient["library"]["chapters"]["list"]>>[number];

/**
 * The text as the stored HTML writes it: the editor's serializer escapes `&`,
 * `<`, and `>`, and writes a non-breaking space as `&nbsp;`. Quotes stay
 * literal in text nodes, so escaping them would stop a find that contains one
 * from matching. Mirrored here because a Plugin imports no host code.
 */
function escapeAsStoredHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

/**
 * The paragraphs the host makes of `{text}` content: blank lines split
 * paragraphs, a single newline becomes a `<br>`, and only `&`, `<`, and `>`
 * are escaped. Mirrors the host's `plainTextToEditorHtml`.
 */
function paragraphsOf(text: string): string {
  const escapeBlock = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeBlock(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * The tag-free stretches of an HTML string and where its entities sit: the map
 * a find needs to tell text from markup, so a find that names tag or attribute
 * characters never edits the markup itself.
 */
interface HtmlTextMap {
  /** Half-open `[start, end)` ranges outside every `<...>` tag. */
  runs: Array<[number, number]>;
  /** Half-open `[start, end)` ranges of `&name;` and `&#123;` entities. */
  entities: Array<[number, number]>;
}

/** The longest entity the HTML spec names, with room to spare. */
const ENTITY_SCAN_LENGTH = 40;

/** `&name;`, `&#123;`, or `&#x1F;`, anchored at the start of the slice. */
const ENTITY_PATTERN = /^&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

/** Where the tag starting at `start` ends, or the string's end for an unclosed one. */
function tagEnd(html: string, start: number): number {
  if (html.startsWith("<!--", start)) {
    const close = html.indexOf("-->", start + 4);
    return close === -1 ? html.length : close + 3;
  }
  let quote: string | null = null;
  for (let at = start + 1; at < html.length; at += 1) {
    const character = html[at];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return at + 1;
    }
  }
  return html.length;
}

/** Where the entity starting at `at` ends, or null when the `&` opens none. */
function entityEnd(html: string, at: number): number | null {
  const match = ENTITY_PATTERN.exec(html.slice(at, at + ENTITY_SCAN_LENGTH));
  return match ? at + match[0].length : null;
}

/** Walks the HTML once, collecting its text runs and its entities. */
function scanHtml(html: string): HtmlTextMap {
  const runs: Array<[number, number]> = [];
  const entities: Array<[number, number]> = [];
  let runStart = 0;
  let at = 0;
  while (at < html.length) {
    const character = html[at];
    if (character === "&") {
      const end = entityEnd(html, at);
      if (end === null) {
        at += 1;
      } else {
        entities.push([at, end]);
        at = end;
      }
      continue;
    }
    if (character !== "<") {
      at += 1;
      continue;
    }
    if (at > runStart) runs.push([runStart, at]);
    at = tagEnd(html, at);
    runStart = at;
  }
  if (runStart < html.length) runs.push([runStart, html.length]);
  return { runs, entities };
}

/** Whether `[start, end)` is text: inside one run, holding whole entities only. */
function isTextSpan(map: HtmlTextMap, start: number, end: number): boolean {
  const insideRun = map.runs.some(([runStart, runEnd]) => runStart <= start && end <= runEnd);
  if (!insideRun) return false;
  const splitsEntity = map.entities.some(
    ([entityStart, entityEndAt]) =>
      (start > entityStart && start < entityEndAt) || (end > entityStart && end < entityEndAt)
  );
  return !splitsEntity;
}

/**
 * Every index where `needle` occurs as text. A raw hit inside a tag, an
 * attribute, or the middle of an entity is not text, so it never counts and
 * never gets edited.
 */
function textMatchIndexes(html: string, needle: string, map: HtmlTextMap): number[] {
  const found: number[] = [];
  let at = html.indexOf(needle);
  while (at !== -1) {
    if (isTextSpan(map, at, at + needle.length)) {
      found.push(at);
      at = html.indexOf(needle, at + needle.length);
    } else {
      at = html.indexOf(needle, at + 1);
    }
  }
  return found;
}

/** One edit's mode, resolved from the arguments before any Library call. */
export type EditMode =
  | { kind: "replace"; find: string; replace: string }
  | { kind: "append"; text: string; format: "text" | "html" };

/**
 * The words an edit's sentences use for the row it changes. `edit_chapter` and
 * `edit_note` share the same pure edit logic, so it names the row and the read
 * tool an Agent copies the exact text from instead of hard-coding either.
 */
export interface EditTerms {
  /** The row's noun as a sentence names it, such as `Chapter` or `Note`. */
  noun: string;
  /** The read tool that returns its text, such as `read_chapter`. */
  readTool: string;
}

/** How `edit_chapter` names the row it changes. */
const CHAPTER_TERMS: EditTerms = { noun: "Chapter", readTool: "read_chapter" };

/**
 * Resolves the arguments to exactly one mode. The modes never mix, so an Agent
 * that sends both learns which shape to send instead of guessing what won.
 */
export function editModeOf(
  args: EditModeArgs,
  terms: EditTerms
): EditMode | { result: CallToolResult } {
  const { find, replace, append } = args;

  if (append !== undefined && (find !== undefined || replace !== undefined)) {
    return {
      result: errorResult(
        `Give find and replace, or append, but not both; call ${terms.readTool} first to copy the exact text.`
      ),
    };
  }
  if (append !== undefined) {
    if (append === "") {
      return {
        result: errorResult(
          `Give the text to append; call ${terms.readTool} to see where the ${terms.noun} ends.`
        ),
      };
    }
    return { kind: "append", text: append, format: args.format ?? "text" };
  }
  if (find === undefined || replace === undefined) {
    return {
      result: errorResult(
        `Give find and replace together, or append; call ${terms.readTool} first to copy the exact text.`
      ),
    };
  }
  if (find === "") {
    return {
      result: errorResult(
        `Give the exact text to find; call ${terms.readTool} with format html to copy it.`
      ),
    };
  }
  return { kind: "replace", find, replace };
}

/**
 * The pure part of an edit: turns the stored HTML and plain text plus the
 * resolved mode into the new HTML and the success sentence, or into a refusal
 * result (no match, a match that crosses markup, or several matches). No
 * Library call happens here, so the same edit can be re-run on a fresh row.
 */
export function applyEdit(
  html: string,
  plainText: string,
  mode: EditMode,
  title: string,
  terms: EditTerms
): { html: string; sentence: string } | { result: CallToolResult } {
  if (mode.kind === "replace") {
    const find = escapeAsStoredHtml(mode.find);
    const matches = textMatchIndexes(html, find, scanHtml(html));
    if (matches.length === 0) {
      return {
        result: errorResult(
          plainText.includes(mode.find)
            ? `That text crosses formatting, so read the ${terms.noun} as HTML (${terms.readTool} with format html) and pick a find within one run of text.`
            : `No match for that find text; read the ${terms.noun} as HTML (${terms.readTool} with format html) and copy the exact text.`
        ),
      };
    }
    if (matches.length > 1) {
      return {
        result: errorResult(
          `That find text matches ${matches.length} places; include more surrounding text in find so it matches once.`
        ),
      };
    }
    const at = matches[0];
    const updatedHtml =
      html.slice(0, at) + escapeAsStoredHtml(mode.replace) + html.slice(at + find.length);
    return {
      html: updatedHtml,
      sentence: `Replaced 1 match in ${terms.noun} ${titleOrUntitled(title)}.`,
    };
  }
  const fragment = mode.format === "html" ? mode.text : paragraphsOf(mode.text);
  return {
    html: html + fragment,
    sentence: `Appended to ${terms.noun} ${titleOrUntitled(title)}.`,
  };
}

/** The row an edit reads and rewrites: the fields the shared guarded edit needs. */
export interface EditableRow {
  id: string;
  title: string;
  updatedAt: number;
  content: { html: string; text: string };
}

/** What a guarded edit reads, writes, and refuses against, so both edit tools share it. */
export interface GuardedEditOptions {
  /** The row as the edit first read it. */
  initial: EditableRow;
  mode: EditMode;
  terms: EditTerms;
  /** Takes the row's Book Checkpoint, or refuses; null means the write may proceed. */
  ensureCheckpoint(): Promise<CallToolResult | null>;
  /** Reads the row again; null when it no longer exists. */
  read(): Promise<EditableRow | null>;
  /** Writes the new HTML guarded by the `updatedAt` the edit was computed from. */
  write(html: string, expectedUpdatedAt: number): Promise<unknown>;
  /** The refusal when a re-read finds the row gone. */
  missing: CallToolResult;
}

/**
 * The guarded edit both `edit_chapter` and `edit_note` run: applies the edit to
 * the stored HTML, refuses before any Checkpoint when it cannot apply, takes
 * the Checkpoint once, then writes under `expectedUpdatedAt` and re-reads and
 * re-applies on a conflict up to three times. A refused edit takes no
 * Checkpoint and a failed Checkpoint leaves the content unchanged.
 */
export async function guardedEdit(options: GuardedEditOptions): Promise<CallToolResult> {
  const { initial, mode, terms, ensureCheckpoint, read, write, missing } = options;

  const first = applyEdit(initial.content.html, initial.content.text, mode, initial.title, terms);
  if ("result" in first) return first.result;

  let updatedHtml = first.html;
  let sentence = first.sentence;

  // After every refusal (validation, no match, several matches) and before
  // the write, so a refused write takes no Checkpoint and a failed Checkpoint
  // leaves the content unchanged.
  const checkpoint = await ensureCheckpoint();
  if (checkpoint !== null) return checkpoint;

  let current = initial;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await write(updatedHtml, current.updatedAt);
      break;
    } catch (error) {
      if (!isConflict(error)) throw error;
      if (attempt === 2) {
        return errorResult(
          `The author is typing in this ${terms.noun} right now; try again in a moment.`
        );
      }
      const fresh = await read();
      if (!fresh) return missing;
      const reEdited = applyEdit(fresh.content.html, fresh.content.text, mode, fresh.title, terms);
      if ("result" in reEdited) return reEdited.result;
      updatedHtml = reEdited.html;
      sentence = reEdited.sentence;
      current = fresh;
    }
  }

  // Re-read after the write: the host stamps Last Edited itself, and the
  // Agent passes this value back as expectedLastEdited later.
  const stored = await read();
  const lastEdited = new Date((stored ?? current).updatedAt).toISOString();
  return {
    content: [{ type: "text", text: `${sentence}\nLast Edited: ${lastEdited}` }],
  };
}

export async function resolveChapter(
  client: PluginClient,
  ref: string,
  tool: string
): Promise<
  | { full: NonNullable<Awaited<ReturnType<PluginClient["library"]["chapters"]["get"]>>> }
  | { result: CallToolResult }
> {
  const books = await client.library.books.list();
  const booksById = new Map(books.map((book) => [book.id, book]));

  const allChapters: ChapterRow[] = [];
  for (const book of books) {
    allChapters.push(...(await client.library.chapters.list({ bookId: book.id })));
  }
  const allChapterIds = allChapters.map((chapter) => chapter.id);

  const resolved = resolveRef({
    ref,
    rows: allChapters,
    noun: "Chapter",
    listTool: "get_book",
    tool,
    line: (chapter) => chapterCandidate(chapter, booksById, allChapterIds),
  });
  if ("result" in resolved) return resolved;

  const full = await client.library.chapters.get({ chapterId: resolved.row.id });
  if (!full) {
    return {
      result: errorResult(`No Chapter has the id ${ref}; call get_book to see the Chapters.`),
    };
  }
  return { full };
}

/**
 * The Connection's pre-write Checkpoint (#591), bound per request by the
 * Plugin entry (see `./server`): the entry remembers which Books this
 * Connection already checkpointed, so `ensureCheckpoint` calls the host only
 * for the Connection's first write to a Book. Null means the write may
 * proceed; a result refuses it instead.
 */
export interface WriteGuard {
  ensureCheckpoint(bookId: string): Promise<CallToolResult | null>;
}

export async function editChapter(
  client: PluginClient,
  args: EditChapterArgs,
  writeGuard: WriteGuard
): Promise<CallToolResult> {
  const ref = (args.chapter ?? "").trim();
  const mode = editModeOf(args, CHAPTER_TERMS);
  if ("result" in mode) return mode.result;

  return libraryCall(async () => {
    const resolved = await resolveChapter(client, ref, "edit_chapter");
    if ("result" in resolved) return resolved.result;

    const full = resolved.full;

    return guardedEdit({
      initial: full,
      mode,
      terms: CHAPTER_TERMS,
      ensureCheckpoint: () => writeGuard.ensureCheckpoint(full.bookId),
      read: () => client.library.chapters.get({ chapterId: full.id }),
      write: (html, expectedUpdatedAt) =>
        client.library.chapters.updateContent({
          chapterId: full.id,
          content: { html },
          expectedUpdatedAt,
        }),
      missing: errorResult(`No Chapter has the id ${ref}; call get_book to see the Chapters.`),
    });
  });
}

/** Arguments for `write_chapter`: replace mode names `chapter`, create mode names `book`. */
export interface WriteChapterArgs {
  chapter?: string;
  book?: string;
  title?: string;
  position?: number;
  expectedLastEdited?: string;
  text?: string;
  html?: string;
}

/** The refusal a whole-content write gives when the row changed since its read. */
export function changedSinceMessage(lastEdited: string, terms: EditTerms): string {
  return `The ${terms.noun} changed since you read it (Last Edited is now ${lastEdited}); call ${terms.readTool} again and redo the change.`;
}

/** The content a write sends: `{text}`, `{html}`, or null when neither is given. */
export function contentOf(args: {
  text?: string;
  html?: string;
}): { text: string } | { html: string } | null {
  if (args.text !== undefined) return { text: args.text };
  if (args.html !== undefined) return { html: args.html };
  return null;
}

export async function writeChapter(
  client: PluginClient,
  args: WriteChapterArgs,
  writeGuard: WriteGuard
): Promise<CallToolResult> {
  const hasChapter = args.chapter !== undefined;
  const hasBook = args.book !== undefined;

  if (hasChapter && hasBook) {
    return errorResult(
      "Give chapter to replace a Chapter's content, or book and title to create a new Chapter, not both."
    );
  }
  if (!hasChapter && !hasBook) {
    return errorResult(
      "Give chapter to replace a Chapter's content, or book and title to create a new Chapter; you gave neither."
    );
  }

  if (hasBook) {
    if (args.expectedLastEdited !== undefined) {
      return errorResult(
        "expectedLastEdited is only for replacing a Chapter's content; to create, call write_chapter with book and title and no expectedLastEdited."
      );
    }
    if (args.title === undefined || args.title.trim() === "") {
      return errorResult(
        "Give a title of at least one character; call write_chapter with book and a title to create."
      );
    }
    if (args.title.trim().length > 500) {
      return errorResult(
        "A title can be at most 500 characters; call write_chapter with a shorter one."
      );
    }
    if (args.text !== undefined && args.html !== undefined) {
      return errorResult(
        "Give the new content as text or as html, not both; call write_chapter again with only one of them."
      );
    }

    const title = args.title.trim();
    const ref = args.book as string;

    return libraryCall(async () => {
      const books = await client.library.books.list();
      const allBookIds = books.map((book) => book.id);
      const resolved = resolveRef({
        ref: ref.trim(),
        rows: books,
        noun: "Book",
        listTool: "list_books",
        tool: "write_chapter",
        line: (book) => bookLine(book, allBookIds),
      });
      if ("result" in resolved) return resolved.result;
      const bookId = resolved.row.id;
      const bookTitle = resolved.row.title;

      const siblings = [...(await client.library.chapters.list({ bookId }))].sort(
        (a, b) => a.order - b.order
      );
      const count = siblings.length;

      const refusal = positionRefusal(args.position, count + 1);
      if (refusal !== null) return refusal;

      // After all validation and the Book resolve, before the create: a
      // refused create takes no Checkpoint, and a failed Checkpoint refuses it.
      const checkpoint = await writeGuard.ensureCheckpoint(bookId);
      if (checkpoint !== null) return checkpoint;

      const { chapterId: newId } = await client.library.chapters.create({
        bookId,
        title,
        ...(args.position === undefined ? {} : { position: (args.position as number) - 1 }),
        ...(args.text !== undefined
          ? { content: { text: args.text } }
          : args.html !== undefined
            ? { content: { html: args.html } }
            : {}),
      });

      const after = [...(await client.library.chapters.list({ bookId }))].sort(
        (a, b) => a.order - b.order
      );
      const afterIds = after.map((chapter) => chapter.id);
      const position = after.findIndex((chapter) => chapter.id === newId) + 1;
      return {
        content: [
          {
            type: "text",
            text: `Created Chapter ${titleOrUntitled(title)} as chapter ${position} of ${after.length} in Book ${titleOrUntitled(bookTitle)}; its id is ${shortId(newId, afterIds)}.`,
          },
        ],
      };
    });
  }

  if ((args.text !== undefined) === (args.html !== undefined)) {
    return errorResult(
      "Give the new content as text or as html, not both; call read_chapter first to get Last Edited."
    );
  }
  if (args.expectedLastEdited === undefined) {
    return errorResult(
      "Give expectedLastEdited from read_chapter; call read_chapter first to get Last Edited."
    );
  }
  const expectedLastEdited = args.expectedLastEdited;

  return libraryCall(async () => {
    const resolved = await resolveChapter(client, (args.chapter as string).trim(), "write_chapter");
    if ("result" in resolved) return resolved.result;

    const full = resolved.full;

    const current = new Date(full.updatedAt).toISOString();
    if (expectedLastEdited.trim() !== current) {
      return errorResult(changedSinceMessage(current, CHAPTER_TERMS));
    }

    // After the expectedLastEdited check and before the write: a refused
    // write takes no Checkpoint, and a failed Checkpoint refuses the write.
    const checkpoint = await writeGuard.ensureCheckpoint(full.bookId);
    if (checkpoint !== null) return checkpoint;

    try {
      await client.library.chapters.updateContent({
        chapterId: full.id,
        content: args.text !== undefined ? { text: args.text } : { html: args.html as string },
        expectedUpdatedAt: full.updatedAt,
      });
    } catch (error) {
      if (!isConflict(error)) throw error;
      const fresh = await client.library.chapters.get({ chapterId: full.id });
      const freshLastEdited = new Date((fresh ?? full).updatedAt).toISOString();
      return errorResult(changedSinceMessage(freshLastEdited, CHAPTER_TERMS));
    }

    const stored = await client.library.chapters.get({ chapterId: full.id });
    return {
      content: [
        {
          type: "text",
          text: `Replaced the whole of Chapter ${titleOrUntitled(full.title)}.\nLast Edited: ${new Date(
            (stored ?? full).updatedAt
          ).toISOString()}`,
        },
      ],
    };
  });
}
