/**
 * The `manage_chapter` tool for the maibuk-mcp Plugin: one Chapter's title,
 * Chapter Type, or Chapter Status, its place among the Book's Chapters, and its
 * deletion. The field update lands first, then the move, so an Agent that names
 * both gets one Chapter in its new place under its new title.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";
import { resolveChapter, type WriteGuard } from "./edits";
import { errorResult, libraryCall, positionRefusal, resolveRef, titleOrUntitled } from "./library";
import { bookLine } from "./books";

/**
 * The Chapter Types a Chapter may hold. Mirrored from the host's
 * `CHAPTER_TYPES` because a Plugin imports no host code; `structure.test.ts`
 * fails if the two drift apart.
 */
export const CHAPTER_TYPES = [
  "chapter",
  "prologue",
  "epilogue",
  "part",
  "frontmatter",
  "backmatter",
] as const;

/**
 * The Chapter Statuses a Chapter may hold, mirrored from the host's
 * `CHAPTER_STATUSES` the same way as `CHAPTER_TYPES`.
 */
export const CHAPTER_STATUSES = ["draft", "revised", "final"] as const;

/**
 * The Book Statuses a Book may hold. Mirrored from the host's
 * `BOOK_STATUSES` because a Plugin imports no host code; `structure.test.ts`
 * fails if the two drift apart.
 */
export const BOOK_STATUSES = ["draft", "in-progress", "completed", "archived"] as const;

/** One Book Status the tool accepts, from the mirrored list. */
export type BookStatus = (typeof BOOK_STATUSES)[number];

/** One Chapter Type the tool accepts, from the mirrored list. */
export type ChapterType = (typeof CHAPTER_TYPES)[number];

/** One Chapter Status the tool accepts, from the mirrored list. */
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

/** Arguments for `manage_chapter`. */
export interface ManageChapterArgs {
  chapter: string;
  title?: string;
  chapterType?: string;
  status?: string;
  position?: number;
  delete?: boolean;
}

/** Arguments for `update_book`. */
export interface UpdateBookArgs {
  book: string;
  title?: string;
  authorName?: string;
  genre?: string;
  status?: string;
  targetWordCount?: number | null;
}

/** Whether `value` is one of the Chapter Types the host accepts. */
function isChapterType(value: string): boolean {
  return (CHAPTER_TYPES as readonly string[]).includes(value);
}

/** Whether `value` is one of the Chapter Statuses the host accepts. */
function isChapterStatus(value: string): boolean {
  return (CHAPTER_STATUSES as readonly string[]).includes(value);
}

/** Whether `value` is one of the Book Statuses the host accepts. */
function isBookStatus(value: string): boolean {
  return (BOOK_STATUSES as readonly string[]).includes(value);
}

/**
 * Resolves the arguments to the one shape the tool runs, or refuses with the
 * sentence that tells the Agent which shape to send. No Library call happens
 * here, so every refusal lands before the Checkpoint and changes nothing.
 */
function intentOf(
  args: ManageChapterArgs
): { kind: "delete" } | { kind: "change"; title?: string } | { result: CallToolResult } {
  const wantsDelete = args.delete === true;
  const wantsFields =
    args.title !== undefined || args.chapterType !== undefined || args.status !== undefined;
  const wantsPosition = args.position !== undefined;

  if (wantsDelete && (wantsFields || wantsPosition)) {
    return {
      result: errorResult(
        "Delete the Chapter on its own: call manage_chapter with delete and no other field."
      ),
    };
  }
  if (!wantsDelete && !wantsFields && !wantsPosition) {
    return {
      result: errorResult(
        "Give title, chapterType, status, or position to change the Chapter, or delete to remove it."
      ),
    };
  }
  if (args.title !== undefined && args.title.trim() === "") {
    return {
      result: errorResult(
        "Give a title of at least one character; call read_chapter to see the Chapter's current title."
      ),
    };
  }
  if (args.chapterType !== undefined && !isChapterType(args.chapterType)) {
    return {
      result: errorResult(
        `The Chapter Types are ${CHAPTER_TYPES.join(", ")}; call manage_chapter with one of them.`
      ),
    };
  }
  if (args.status !== undefined && !isChapterStatus(args.status)) {
    return {
      result: errorResult(
        `The Chapter Statuses are ${CHAPTER_STATUSES.join(", ")}; call manage_chapter with one of them.`
      ),
    };
  }
  if (wantsDelete) return { kind: "delete" };
  return { kind: "change", ...(args.title === undefined ? {} : { title: args.title.trim() }) };
}

/** The `1`-based position `get_book` prints for the Chapter with `chapterId`. */
function positionOf(chapterIds: readonly string[], chapterId: string): number {
  return chapterIds.indexOf(chapterId) + 1;
}

/**
 * Changes one Chapter: its title, Chapter Type, or Chapter Status, its place
 * among the Book's Chapters, or its deletion. Every refusal answers before the
 * Checkpoint, so a refused call never versions the Book.
 */
export async function manageChapter(
  client: PluginClient,
  args: ManageChapterArgs,
  writeGuard: WriteGuard
): Promise<CallToolResult> {
  const ref = (args.chapter ?? "").trim();
  const intent = intentOf(args);
  if ("result" in intent) return intent.result;

  return libraryCall(async () => {
    const resolved = await resolveChapter(client, ref, "manage_chapter");
    if ("result" in resolved) return resolved.result;

    const full = resolved.full;

    const siblings = [...(await client.library.chapters.list({ bookId: full.bookId }))].sort(
      (a, b) => a.order - b.order
    );
    const chapterIds = siblings.map((chapter) => chapter.id);
    const count = chapterIds.length;

    const refusal = positionRefusal(args.position, count);
    if (refusal !== null) return refusal;

    // After every refusal and before the first write, so a refused call takes no
    // Checkpoint and a failed Checkpoint leaves the Chapter alone.
    const checkpoint = await writeGuard.ensureCheckpoint(full.bookId);
    if (checkpoint !== null) return checkpoint;

    if (intent.kind === "delete") {
      await client.library.chapters.delete({ chapterId: full.id });
      return {
        content: [
          {
            type: "text",
            text: `Deleted Chapter ${titleOrUntitled(full.title)}; the Checkpoint taken before this Connection's first write still holds it.`,
          },
        ],
      };
    }

    if (args.title !== undefined || args.chapterType !== undefined || args.status !== undefined) {
      await client.library.chapters.update({
        chapterId: full.id,
        ...(args.title === undefined ? {} : { title: args.title.trim() }),
        ...(args.chapterType === undefined ? {} : { chapterType: args.chapterType as ChapterType }),
        ...(args.status === undefined ? {} : { status: args.status as ChapterStatus }),
      });
    }

    const title = intent.title ?? full.title;
    let position = positionOf(chapterIds, full.id);
    if (args.position !== undefined && args.position !== position) {
      const reordered = [...chapterIds];
      reordered.splice(position - 1, 1);
      reordered.splice(args.position - 1, 0, full.id);
      await client.library.chapters.reorder({ bookId: full.bookId, chapterIds: reordered });
      position = args.position;
    }

    return {
      content: [
        {
          type: "text",
          text: `Chapter ${titleOrUntitled(title)} is now chapter ${position} of ${count}.`,
        },
      ],
    };
  });
}

/**
 * Changes one Book's title, Author Name, Genre, Book Status, or Target Word
 * Count. Every refusal answers before the Checkpoint, so a refused call never
 * versions the Book.
 */
export async function updateBook(
  client: PluginClient,
  args: UpdateBookArgs,
  writeGuard: WriteGuard
): Promise<CallToolResult> {
  const wantsFields =
    args.title !== undefined ||
    args.authorName !== undefined ||
    args.genre !== undefined ||
    args.status !== undefined ||
    args.targetWordCount !== undefined;

  if (!wantsFields) {
    return errorResult(
      "Give title, authorName, genre, status, or targetWordCount to change the Book."
    );
  }
  if (args.title !== undefined) {
    const trimmed = args.title.trim();
    if (trimmed === "") {
      return errorResult(
        "Give a title of at least one character; call get_book to see the Book's current title."
      );
    }
    if (trimmed.length > 500) {
      return errorResult(
        "A title can be at most 500 characters; call update_book with a shorter one."
      );
    }
  }
  if (args.authorName !== undefined && args.authorName.length > 500) {
    return errorResult(
      "Author Name can be at most 500 characters; call update_book with a shorter one."
    );
  }
  if (args.genre !== undefined && args.genre.length > 200) {
    return errorResult("Genre can be at most 200 characters; call update_book with a shorter one.");
  }
  if (args.status !== undefined && !isBookStatus(args.status)) {
    return errorResult(
      `The Book Statuses are ${BOOK_STATUSES.join(", ")}; call update_book with one of them.`
    );
  }
  if (args.targetWordCount !== undefined && args.targetWordCount !== null) {
    const value = args.targetWordCount;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return errorResult(
        "Give targetWordCount as a whole number of words of at least 1, or null to clear it."
      );
    }
  }

  const ref = (args.book ?? "").trim();

  return libraryCall(async () => {
    const books = await client.library.books.list();
    const allIds = books.map((book) => book.id);
    const resolved = resolveRef({
      ref,
      rows: books,
      noun: "Book",
      listTool: "list_books",
      tool: "update_book",
      line: (book) => bookLine(book, allIds),
    });
    if ("result" in resolved) return resolved.result;

    const bookId = resolved.row.id;
    const oldTitle = resolved.row.title;
    const newTitle = args.title !== undefined ? args.title.trim() : oldTitle;

    const changed: string[] = [];
    if (args.title !== undefined) changed.push("title");
    if (args.authorName !== undefined) changed.push("Author Name");
    if (args.genre !== undefined) changed.push("Genre");
    if (args.status !== undefined) changed.push("Book Status");
    if (args.targetWordCount !== undefined) changed.push("Target Word Count");

    const checkpoint = await writeGuard.ensureCheckpoint(bookId);
    if (checkpoint !== null) return checkpoint;

    await client.library.books.update({
      bookId,
      ...(args.title === undefined ? {} : { title: args.title.trim() }),
      ...(args.authorName === undefined ? {} : { authorName: args.authorName }),
      ...(args.genre === undefined ? {} : { genre: args.genre === "" ? null : args.genre }),
      ...(args.status === undefined ? {} : { status: args.status as BookStatus }),
      ...(args.targetWordCount === undefined ? {} : { targetWordCount: args.targetWordCount }),
    });

    return {
      content: [
        {
          type: "text",
          text: `Updated Book ${titleOrUntitled(newTitle)}: ${changed.join(", ")}.`,
        },
      ],
    };
  });
}
