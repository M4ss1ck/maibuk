/**
 * The `edit_chapter` tool for the maibuk-mcp Plugin: find-and-replace of one
 * exact piece of a Chapter's text, or an append to its end. Both edits work on
 * the stored HTML, so an Agent changes a few characters instead of sending the
 * whole Chapter back, and every byte it did not name stays where it was.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { PluginClient } from "@/plugin-sdk";
import { chapterCandidate } from "./chapters";
import { errorResult, libraryCall, resolveRef, titleOrUntitled } from "./library";

/** Arguments for `edit_chapter`. */
export interface EditChapterArgs {
  chapter: string;
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
type EditMode =
  | { kind: "replace"; find: string; replace: string }
  | { kind: "append"; text: string; format: "text" | "html" };

/**
 * Resolves the arguments to exactly one mode. The modes never mix, so an Agent
 * that sends both learns which shape to send instead of guessing what won.
 */
function editModeOf(args: EditChapterArgs): EditMode | { result: CallToolResult } {
  const { find, replace, append } = args;

  if (append !== undefined && (find !== undefined || replace !== undefined)) {
    return {
      result: errorResult(
        "Give find and replace, or append, but not both; call read_chapter first to copy the exact text."
      ),
    };
  }
  if (append !== undefined) {
    if (append === "") {
      return {
        result: errorResult(
          "Give the text to append; call read_chapter to see where the Chapter ends."
        ),
      };
    }
    return { kind: "append", text: append, format: args.format ?? "text" };
  }
  if (find === undefined || replace === undefined) {
    return {
      result: errorResult(
        "Give find and replace together, or append; call read_chapter first to copy the exact text."
      ),
    };
  }
  if (find === "") {
    return {
      result: errorResult(
        "Give the exact text to find; call read_chapter with format html to copy it."
      ),
    };
  }
  return { kind: "replace", find, replace };
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
  const mode = editModeOf(args);
  if ("result" in mode) return mode.result;

  return libraryCall(async () => {
    const resolved = await resolveChapter(client, ref, "edit_chapter");
    if ("result" in resolved) return resolved.result;

    const full = resolved.full;

    const html = full.content.html;
    let updatedHtml: string;
    let sentence: string;

    if (mode.kind === "replace") {
      const find = escapeAsStoredHtml(mode.find);
      const matches = textMatchIndexes(html, find, scanHtml(html));
      if (matches.length === 0) {
        return errorResult(
          full.content.text.includes(mode.find)
            ? "That text crosses formatting, so read the Chapter as HTML (read_chapter with format html) and pick a find within one run of text."
            : "No match for that find text; read the Chapter as HTML (read_chapter with format html) and copy the exact text."
        );
      }
      if (matches.length > 1) {
        return errorResult(
          `That find text matches ${matches.length} places; include more surrounding text in find so it matches once.`
        );
      }
      const at = matches[0];
      updatedHtml =
        html.slice(0, at) + escapeAsStoredHtml(mode.replace) + html.slice(at + find.length);
      sentence = `Replaced 1 match in Chapter ${titleOrUntitled(full.title)}.`;
    } else {
      const fragment = mode.format === "html" ? mode.text : paragraphsOf(mode.text);
      updatedHtml = html + fragment;
      sentence = `Appended to Chapter ${titleOrUntitled(full.title)}.`;
    }

    // After every refusal (validation, no match, several matches) and before
    // the write, so a refused write takes no Checkpoint and a failed
    // Checkpoint leaves the content unchanged.
    const checkpoint = await writeGuard.ensureCheckpoint(full.bookId);
    if (checkpoint !== null) return checkpoint;

    await client.library.chapters.updateContent({
      chapterId: full.id,
      content: { html: updatedHtml },
    });

    // Re-read after the write: the host stamps Last Edited itself, and the
    // Agent passes this value back as expectedLastEdited later.
    const stored = await client.library.chapters.get({ chapterId: full.id });
    const lastEdited = new Date((stored ?? full).updatedAt).toISOString();
    return {
      content: [{ type: "text", text: `${sentence}\nLast Edited: ${lastEdited}` }],
    };
  });
}

/** Arguments for `write_chapter`. */
export interface WriteChapterArgs {
  chapter: string;
  expectedLastEdited: string;
  text?: string;
  html?: string;
}

export async function writeChapter(
  client: PluginClient,
  args: WriteChapterArgs,
  writeGuard: WriteGuard
): Promise<CallToolResult> {
  if ((args.text !== undefined) === (args.html !== undefined)) {
    return errorResult(
      "Give the new content as text or as html, not both; call read_chapter first to get Last Edited."
    );
  }

  return libraryCall(async () => {
    const resolved = await resolveChapter(client, args.chapter.trim(), "write_chapter");
    if ("result" in resolved) return resolved.result;

    const full = resolved.full;

    const current = new Date(full.updatedAt).toISOString();
    if (args.expectedLastEdited.trim() !== current) {
      return errorResult(
        `The Chapter changed since you read it (Last Edited is now ${current}); call read_chapter again and redo the change.`
      );
    }

    // After the expectedLastEdited check and before the write: a refused
    // write takes no Checkpoint, and a failed Checkpoint refuses the write.
    const checkpoint = await writeGuard.ensureCheckpoint(full.bookId);
    if (checkpoint !== null) return checkpoint;

    await client.library.chapters.updateContent({
      chapterId: full.id,
      content: args.text !== undefined ? { text: args.text } : { html: args.html as string },
    });

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
