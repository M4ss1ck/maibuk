/**
 * The Plugin API as data (ADR 0022). Every method a Plugin can call is one
 * row: id, description, input and output schema, the Plugin Permission it
 * needs, and whether it reads or writes. The SDK types, the API reference,
 * the MCP tool projection, and the broker's checks all come from these rows,
 * so adding a method is adding a row and running `pnpm generate:plugin-api`.
 * Events the host sends to subscribed Plugins are rows of a second table.
 *
 * Schemas are Zod so the broker validates input with the same definition the
 * JSON Schema is emitted from; nothing can drift between them.
 */

import { z } from "zod";
import { BOOK_STATUSES } from "@/features/books/types";
import { CHAPTER_STATUSES, CHAPTER_TYPES } from "@/features/chapters/types";
import type { McpToolProjection, PluginApiEventRow, PluginApiRow } from "@/features/plugins/types";
import { FILE_READ_MAX_BYTES } from "@/plugin-sdk/protocol";

/** The Plugin API's own semver, separate from Maibuk's release number. */
export const PLUGIN_API_VERSION = "0.1.9";

export const PLUGIN_API_NAMESPACES = [
  "library",
  "editor",
  "navigation",
  "language",
  "endpoint",
  "permissions",
  "secrets",
  "network",
  "clipboard",
  "notifications",
  "storage",
  "toolbar",
  "files",
] as const;

/** Names held for a later effort; every call into one refuses with `not-implemented`. */
export const PLUGIN_API_RESERVED_NAMESPACES = ["process"] as const;

export function defineApiRow<
  const Id extends string,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Chunk extends z.ZodType | undefined = undefined,
>(row: PluginApiRow<Id, Input, Output, Chunk>): PluginApiRow<Id, Input, Output, Chunk> {
  return row;
}

export function defineApiEvent<const Id extends string, Payload extends z.ZodType>(
  row: PluginApiEventRow<Id, Payload>
): PluginApiEventRow<Id, Payload> {
  return row;
}

const id = z.string().min(1).max(128);
const timestamp = z.number().describe("Milliseconds since the Unix epoch.");
const none = z.strictObject({});
const ok = z.null();

/**
 * The bytes `files.read` returns. JSON Schema has no byte type, so the emitter
 * turns this custom schema into an object with this description, and
 * `api-codegen` maps that description back to `ArrayBuffer` in the SDK types.
 */
export const ARRAY_BUFFER_SCHEMA_DESCRIPTION =
  "ArrayBuffer of the requested bytes; shorter than asked at the end of the file.";

const arrayBuffer = z
  .custom<ArrayBuffer>((value) => value instanceof ArrayBuffer, "ArrayBuffer")
  .describe(ARRAY_BUFFER_SCHEMA_DESCRIPTION);

const content = z.strictObject({
  text: z.string().describe("Plain text."),
  html: z.string().describe("Sanitized HTML."),
});

const book = z.strictObject({
  id,
  title: z.string(),
  subtitle: z.string().nullable(),
  authorName: z.string(),
  genre: z.string().nullable().describe("Null when the Book has no Genre."),
  language: z.string(),
  wordCount: z.int(),
  targetWordCount: z.int().nullable().describe("Null when the Book has no Target Word Count."),
  status: z.enum(BOOK_STATUSES),
  updatedAt: timestamp,
});

const chapterSummary = z.strictObject({
  id,
  bookId: id,
  title: z.string(),
  order: z.int(),
  parentId: id.nullable(),
  chapterType: z.enum(CHAPTER_TYPES),
  wordCount: z.int(),
  status: z.enum(CHAPTER_STATUSES),
  updatedAt: timestamp,
});

const noteSummary = z.strictObject({
  id,
  bookId: id.nullable(),
  title: z.string(),
  language: z.string().nullable(),
  tags: z.array(z.string()),
  wordCount: z.int(),
  updatedAt: timestamp,
});

const canvasSummary = z.strictObject({
  id,
  bookId: id.nullable(),
  title: z.string(),
  updatedAt: timestamp,
});

/** Plain-text character offsets, the one coordinate system for selection and highlights. */
const range = z.strictObject({
  from: z.int().min(0),
  to: z.int().min(0),
});

/** The text around a search hit, with the matches in it highlighted. */
const searchSnippet = z.strictObject({
  text: z.string(),
  highlights: z.array(range).describe("[from, to) ranges inside text, in order."),
});

/** The fields every `library.search` result carries, whatever its kind. */
const searchResultBase = {
  title: z.string(),
  snippet: searchSnippet,
  firstMatchOffset: z
    .int()
    .min(0)
    .describe("The first match's offset inside the block the snippet came from."),
  matchCount: z.int().min(1).describe("Total matches across every block of the item."),
};

/**
 * One `library.search` row: the item's kind with the reference the matching
 * `library.*.get` method takes (a Chapter also names its Book; a Note names
 * its Book, null when Unfiled; a Canvas names the snippet's card when the hit
 * is in a card), so a Plugin passes the reference straight to the get call.
 */
const searchResult = z.union([
  z.strictObject({
    kind: z.literal("book"),
    bookId: id.describe("Pass to library.books.get."),
    ...searchResultBase,
  }),
  z.strictObject({
    kind: z.literal("chapter"),
    chapterId: id.describe("Pass to library.chapters.get."),
    bookId: id,
    ...searchResultBase,
  }),
  z.strictObject({
    kind: z.literal("note"),
    noteId: id.describe("Pass to library.notes.get."),
    bookId: id.nullable().describe("Null when the Note is Unfiled."),
    ...searchResultBase,
  }),
  z.strictObject({
    kind: z.literal("canvas"),
    canvasId: id.describe("Pass to library.canvases.get."),
    cardId: id.optional().describe("The card the snippet came from; absent for a title hit."),
    ...searchResultBase,
  }),
]);

const fragment = z
  .union([
    z.strictObject({ text: z.string() }),
    z.strictObject({ html: z.string().describe("Sanitized by the host before it lands.") }),
  ])
  .describe("Plain text, or an HTML fragment the host sanitizes.");

const noTarget = z.strictObject({ status: z.literal("no-target") });
const applied = z.union([z.strictObject({ status: z.literal("applied") }), noTarget]);

const entityRef = z.strictObject({
  kind: z.enum(["book", "chapter", "note", "canvas"]),
  id,
});

/** What an editor is bound to: a Library entity, or the Ephemeral (no Library row). */
const editorEntityRef = z.strictObject({
  kind: z.enum(["book", "chapter", "note", "canvas", "ephemeral"]),
  id,
});

const libraryRead = { permission: "library:read", effect: "read", requiresLibrary: true } as const;
const libraryWrite = {
  permission: "library:write",
  effect: "write",
  requiresLibrary: true,
} as const;

export const PLUGIN_API_TABLE = [
  defineApiRow({
    id: "library.books.list",
    description: "Lists every Book in the Library.",
    input: none,
    output: z.array(book),
    ...libraryRead,
  }),
  defineApiRow({
    id: "library.books.get",
    description: "Reads one Book's details, or null when it does not exist.",
    input: z.strictObject({ bookId: id }),
    output: book.nullable(),
    ...libraryRead,
  }),
  defineApiRow({
    id: "library.chapters.list",
    description: "Lists a Book's Chapters in order, without their content.",
    input: z.strictObject({ bookId: id }),
    output: z.array(chapterSummary),
    ...libraryRead,
  }),
  defineApiRow({
    id: "library.chapters.get",
    description: "Reads one Chapter with its content as plain text and sanitized HTML.",
    input: z.strictObject({ chapterId: id }),
    output: z.strictObject({ ...chapterSummary.shape, content }).nullable(),
    ...libraryRead,
  }),
  defineApiRow({
    id: "library.notes.list",
    description: "Lists Notes, all of them or one Book's, without their content.",
    input: z.strictObject({ bookId: id.optional() }),
    output: z.array(noteSummary),
    ...libraryRead,
  }),
  defineApiRow({
    id: "library.notes.get",
    description: "Reads one Note with its content as plain text and sanitized HTML.",
    input: z.strictObject({ noteId: id }),
    output: z.strictObject({ ...noteSummary.shape, content }).nullable(),
    ...libraryRead,
  }),
  defineApiRow({
    id: "library.canvases.list",
    description: "Lists Canvases with their metadata. Canvas content is not part of the API.",
    input: z.strictObject({ bookId: id.optional() }),
    output: z.array(canvasSummary),
    ...libraryRead,
  }),
  defineApiRow({
    id: "library.canvases.get",
    description: "Reads one Canvas's metadata, or null when it does not exist.",
    input: z.strictObject({ canvasId: id }),
    output: canvasSummary.nullable(),
    ...libraryRead,
  }),
  defineApiRow({
    id: "library.search",
    description:
      "Searches the Library's text with the same query and switches as Library Search: one row per matching item with a snippet, match counts, and a cursor for the next page. An invalid Regex comes back as an invalid-regex error, never a refusal. When bookId is given, only that Book's items come back and a page may hold fewer than limit results; follow nextCursor until it is absent. Canvases carry no Book, so a bookId filter never returns one.",
    input: z.strictObject({
      query: z.string().min(1).max(500),
      matchCase: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      regex: z.boolean().optional(),
      kinds: z
        .array(z.enum(["book", "chapter", "note", "canvas"]))
        .min(1)
        .max(4)
        .optional(),
      bookId: id.optional(),
      limit: z.int().min(1).max(50).optional(),
      cursor: z.string().min(1).max(4096).nullable().optional(),
    }),
    output: z.union([
      z.strictObject({
        results: z.array(searchResult),
        nextCursor: z
          .string()
          .optional()
          .describe("Pass as cursor for the next page; absent when done."),
      }),
      z.strictObject({
        error: z.literal("invalid-regex"),
        message: z.string(),
      }),
    ]),
    ...libraryRead,
  }),
  defineApiRow({
    id: "library.books.update",
    description:
      "Updates a Book's title, Author Name, Genre, Book Status, or Target Word Count through the Book write path; give at least one. A null Genre or Target Word Count clears it.",
    input: z.strictObject({
      bookId: id,
      title: z.string().min(1).max(500).optional(),
      authorName: z.string().max(500).optional(),
      genre: z.string().max(200).nullable().optional(),
      status: z.enum(BOOK_STATUSES).optional(),
      targetWordCount: z.int().min(0).nullable().optional(),
    }),
    output: ok,
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.books.checkpoint",
    description:
      "Takes a Checkpoint of a Book through the normal Version path, named by the label, and returns its id; null when the Book is unchanged since its last Version.",
    input: z.strictObject({
      bookId: id,
      label: z.string().trim().min(1).max(200).describe("The Version's name."),
    }),
    output: z.strictObject({ versionId: id.nullable() }),
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.chapters.updateContent",
    description: "Replaces a Chapter's content through the Chapter write path.",
    input: z.strictObject({
      chapterId: id,
      content: fragment,
      expectedUpdatedAt: timestamp
        .optional()
        .describe(
          "Milliseconds since the Unix epoch: the updatedAt the Plugin read. When given, the write is refused with code conflict if the Chapter changed since, including by the author's typing flushed just before the write."
        ),
    }),
    output: ok,
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.chapters.create",
    description:
      "Creates a Chapter in a Book through the Chapter write path, at a 0-based position among its Chapters (omitted appends) and with optional content, and returns its id.",
    input: z.strictObject({
      bookId: id,
      title: z.string().min(1).max(500),
      position: z
        .int()
        .min(0)
        .optional()
        .describe("0-based index among the Book's Chapters; omitted appends at the end."),
      content: fragment.optional(),
    }),
    output: z.strictObject({ chapterId: id }),
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.chapters.delete",
    description:
      "Deletes a Chapter through the normal Delete path, so sync and Deletion Review carry it the way they carry a delete the author made.",
    input: z.strictObject({ chapterId: id }),
    output: ok,
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.chapters.reorder",
    description:
      "Reorders a Book's Chapters to the given ids, which must be exactly the Book's Chapters: no missing, extra, or duplicate id.",
    input: z.strictObject({ bookId: id, chapterIds: z.array(id) }),
    output: ok,
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.chapters.update",
    description:
      "Updates a Chapter's title, Chapter Type, or Chapter Status through the Chapter write path; give at least one.",
    input: z.strictObject({
      chapterId: id,
      title: z.string().min(1).max(500).optional(),
      chapterType: z.enum(CHAPTER_TYPES).optional(),
      status: z.enum(CHAPTER_STATUSES).optional(),
    }),
    output: ok,
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.notes.create",
    description:
      "Creates a Note through the Note write path and returns its id; Tags are trimmed and deduplicated like the Note tags field.",
    input: z.strictObject({
      title: z.string().max(500),
      bookId: id.nullable().optional(),
      content: fragment.optional(),
      tags: z.array(z.string()).optional(),
    }),
    output: z.strictObject({ noteId: id }),
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.notes.update",
    description:
      "Updates a Note's title, content, Tags, or Book through the Note write path; Tags are trimmed and deduplicated like the Note tags field, and a null bookId moves it to Unfiled.",
    input: z.strictObject({
      noteId: id,
      title: z.string().max(500).optional(),
      content: fragment.optional(),
      tags: z.array(z.string()).optional(),
      bookId: id.nullable().optional().describe("Null moves the Note to Unfiled."),
      expectedUpdatedAt: timestamp
        .optional()
        .describe(
          "Milliseconds since the Unix epoch: the updatedAt the Plugin read. When given, the write is refused with code conflict if the Note changed since, including by the author's typing flushed just before the write."
        ),
    }),
    output: ok,
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.notes.delete",
    description:
      "Deletes a Note through the normal Delete path, so sync and Deletion Review carry it the way they carry a delete the author made.",
    input: z.strictObject({ noteId: id }),
    output: ok,
    ...libraryWrite,
  }),
  defineApiRow({
    id: "editor.getContent",
    description:
      "Reads the target editor's content and language. The target is the rich-text editor that last took focus, else the only one on screen; no-target when there is none.",
    input: none,
    output: z.union([
      z.strictObject({
        status: z.literal("ok"),
        entity: editorEntityRef,
        language: z
          .string()
          .describe(
            "The language the text is written in: a Note's own, else its Book's; a Chapter's Book's; else the editor's Spell Check language (the Ephemeral's)."
          ),
        content,
      }),
      noTarget,
    ]),
    permission: "editor:read",
    effect: "read",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "editor.getSelection",
    description: "Reads the target editor's selection as plain-text offsets.",
    input: none,
    output: z.union([
      z.strictObject({ status: z.literal("ok"), entity: editorEntityRef, range, text: z.string() }),
      noTarget,
    ]),
    permission: "editor:read",
    effect: "read",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "editor.reveal",
    description: "Scrolls the target editor to a range and places the caret there.",
    input: z.strictObject({ range }),
    output: applied,
    permission: "editor:read",
    effect: "read",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "editor.setHighlights",
    description:
      "Replaces this Plugin's highlights of one kind in the target editor; empty ranges clear that kind. Never changes text.",
    input: z.strictObject({
      kind: z.enum(["info", "warning", "repetition"]),
      ranges: z.array(
        z.strictObject({
          ...range.shape,
          label: z.string().max(200).optional(),
          // Strict #rrggbb (ADR 0029, additive in 0.1.1): a tint and underline in this color.
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/, "color must be #rrggbb")
            .optional(),
        })
      ),
    }),
    output: applied,
    permission: "editor:decorate",
    effect: "write",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "editor.insert",
    description: "Inserts text or an HTML fragment at the caret as one undoable step.",
    input: z.strictObject({ content: fragment }),
    output: applied,
    permission: "editor:write",
    effect: "write",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "editor.replace",
    description: "Replaces a range with text or an HTML fragment as one undoable step.",
    input: z.strictObject({ range, content: fragment }),
    output: applied,
    permission: "editor:write",
    effect: "write",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "navigation.openEntity",
    description: "Opens a Book, Chapter, Note, or Canvas, optionally revealing a range.",
    input: z.strictObject({ entity: entityRef, reveal: range.optional() }),
    output: ok,
    permission: null,
    effect: "write",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "navigation.openPage",
    description: "Opens a Plugin page by its page id, in this Plugin or another installed one.",
    input: z.strictObject({ pageId: id, pluginId: id.optional() }),
    output: z.union([
      z.strictObject({ status: z.literal("opened") }),
      z.strictObject({ status: z.literal("not-found") }),
    ]),
    permission: null,
    effect: "write",
    requiresLibrary: false,
  }),
  defineApiRow({
    id: "language.get",
    description: "Reads the language Maibuk runs in. No permission is required.",
    input: none,
    output: z.strictObject({ language: z.string() }),
    permission: null,
    effect: "read",
  }),
  defineApiRow({
    id: "endpoint.address",
    description:
      "Reads this Plugin's own base URL on the Plugin Endpoint, http://127.0.0.1:<port>/plugin/<pluginId>/, or null while the Plugin Endpoint is not listening. Compare it with the URL you last showed to notice a move.",
    input: none,
    output: z.strictObject({ url: z.string().nullable() }),
    permission: "serve",
    effect: "read",
    requiresLibrary: false,
  }),
  defineApiRow({
    id: "permissions.granted",
    description:
      "Lists the Plugin Permissions this Plugin holds right now. No permission is required.",
    input: none,
    output: z.strictObject({ permissions: z.array(z.string()) }),
    permission: null,
    effect: "read",
  }),
  defineApiRow({
    id: "secrets.set",
    description: "Stores a secret by name. Secrets are never read back into the Plugin.",
    input: z.strictObject({ name: z.string().min(1).max(64), value: z.string().max(4096) }),
    output: ok,
    permission: "secrets",
    effect: "write",
  }),
  defineApiRow({
    id: "secrets.delete",
    description: "Deletes a stored secret by name.",
    input: z.strictObject({ name: z.string().min(1).max(64) }),
    output: ok,
    permission: "secrets",
    effect: "write",
  }),
  defineApiRow({
    id: "secrets.listNames",
    description: "Lists the names of this Plugin's stored secrets, never their values.",
    input: none,
    output: z.array(z.string()),
    permission: "secrets",
    effect: "read",
  }),
  defineApiRow({
    id: "network.fetch",
    description:
      "Fetches a URL on a granted host. A header can name a stored secret the host injects. A redirect is refused, so a granted host cannot forward the request, or an injected secret, to another host.",
    input: z.strictObject({
      url: z.string().max(8192),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      secretHeaders: z
        .record(z.string(), z.string())
        .optional()
        .describe("Header name to secret name; the host fills in the value."),
      body: z.string().optional(),
    }),
    output: z
      .strictObject({
        status: z.int(),
        statusText: z.string(),
        headers: z.record(z.string(), z.string()),
      })
      .describe("The response head; the body follows as streamed chunks."),
    chunk: z.strictObject({
      text: z
        .string()
        .describe(
          "The next piece of the response body, decoded as UTF-8. A chunk is at most 64 KB."
        ),
    }),
    permission: "network",
    effect: "write",
  }),
  defineApiRow({
    id: "clipboard.readText",
    description: "Reads plain text from the clipboard.",
    input: none,
    output: z.string(),
    permission: "clipboard",
    effect: "read",
  }),
  defineApiRow({
    id: "clipboard.writeText",
    description: "Writes plain text to the clipboard.",
    input: z.strictObject({ text: z.string() }),
    output: ok,
    permission: "clipboard",
    effect: "write",
  }),
  defineApiRow({
    id: "notifications.show",
    description:
      "Shows a toast naming this Plugin. At most one every 5 seconds, except while answering the author's own Command run.",
    input: z.strictObject({
      variant: z.enum(["info", "success", "warning", "error"]),
      message: z.string().min(1).max(500),
    }),
    output: ok,
    permission: null,
    effect: "write",
    minIntervalMs: 5000,
  }),
  defineApiRow({
    id: "toolbar.setPressed",
    description:
      "Sets whether one of this Plugin's Toggle Buttons shows as on. Only a toolbar button the manifest declares with toggle: true.",
    input: z.strictObject({
      button: z.string().min(1).max(64),
      pressed: z.boolean(),
    }),
    output: ok,
    permission: null,
    effect: "write",
  }),
  defineApiRow({
    id: "storage.get",
    description: "Reads a JSON value from this Plugin's storage, or null when the key is unset.",
    input: z.strictObject({ key: z.string().min(1).max(256) }),
    output: z.unknown(),
    permission: null,
    effect: "read",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "storage.set",
    description: "Stores a JSON value in this Plugin's storage.",
    input: z.strictObject({ key: z.string().min(1).max(256), value: z.unknown() }),
    output: ok,
    permission: null,
    effect: "write",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "storage.delete",
    description: "Deletes a key from this Plugin's storage.",
    input: z.strictObject({ key: z.string().min(1).max(256) }),
    output: ok,
    permission: null,
    effect: "write",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "storage.keys",
    description: "Lists every key in this Plugin's storage.",
    input: none,
    output: z.array(z.string()),
    permission: null,
    effect: "read",
    requiresLibrary: true,
  }),
  defineApiRow({
    id: "files.pick",
    description:
      "Shows Maibuk's file dialog filtered to these file types and returns the picked file's File Grant, or null when the author cancels. Refused with user-action-required unless the author's own click, key press, or Command run caused the call. Picking a file this Plugin already holds a grant for returns the same grant id.",
    input: z.strictObject({
      extensions: z
        .array(z.string().regex(/^[a-z0-9]{1,16}$/))
        .min(1)
        .max(32)
        .describe("Lowercase extensions without a dot, such as pdf or epub."),
      multiple: z.literal(false).optional().describe("Only one file at a time for now."),
    }),
    output: z
      .strictObject({ grant: z.string().min(1), name: z.string(), size: z.int() })
      .nullable()
      .describe("The picked File Grant, or null when the author cancelled."),
    permission: "files:pick",
    effect: "read",
    requiresUserAction: true,
  }),
  defineApiRow({
    id: "files.read",
    description:
      "Reads a byte range from a File Grant. A range past the end of the file returns the bytes that exist: shorter than asked, and empty at or past the end. Refused with file-missing when the file is gone or unreadable, or file-needs-permission on the web when the browser must ask the author again.",
    input: z.strictObject({
      grant: z.string().min(1),
      offset: z.int().min(0),
      length: z.int().min(1).max(FILE_READ_MAX_BYTES),
    }),
    output: arrayBuffer,
    permission: "files:pick",
    effect: "read",
  }),
  defineApiRow({
    id: "files.stat",
    description:
      "Reads a File Grant's name, size, and last-modified time without reading its bytes, so a Plugin can mark a missing file.",
    input: z.strictObject({ grant: z.string().min(1) }),
    output: z.strictObject({ name: z.string(), size: z.int(), modified: timestamp }),
    permission: "files:pick",
    effect: "read",
  }),
  defineApiRow({
    id: "files.requestAccess",
    description:
      "Asks for read access to a File Grant again, inside the author's click or Command run. On the web the browser asks the author; on desktop it always returns true.",
    input: z.strictObject({ grant: z.string().min(1) }),
    output: z.boolean(),
    permission: "files:pick",
    effect: "read",
    requiresUserAction: true,
  }),
  defineApiRow({
    id: "files.release",
    description: "Ends a File Grant. The author's file itself is never deleted or changed.",
    input: z.strictObject({ grant: z.string().min(1) }),
    output: ok,
    permission: "files:pick",
    effect: "write",
  }),
  defineApiRow({
    id: "files.list",
    description: "Lists this Plugin's live File Grants on this device.",
    input: none,
    output: z.array(z.strictObject({ grant: z.string().min(1), name: z.string(), size: z.int() })),
    permission: "files:pick",
    effect: "read",
  }),
] as const;

export const PLUGIN_API_EVENTS = [
  defineApiEvent({
    id: "library.changed",
    description:
      "A Book, Note, or Canvas was saved (Chapter edits arrive as their Book), or a bulk operation replaced the Library.",
    payload: z.union([
      z.strictObject({
        entity: z.enum(["book", "note", "canvas"]),
        id,
        origin: z.enum(["local", "remote"]),
        kind: z.enum(["content", "metadata"]),
      }),
      z.strictObject({
        scope: z.literal("all"),
        reason: z.enum(["restore", "resetLibrary", "databaseLoad"]),
      }),
    ]),
    permission: "library:read",
  }),
  defineApiEvent({
    id: "library.availabilityChanged",
    description: "The Library became available or unavailable (the Tutorial makes it unavailable).",
    payload: z.strictObject({
      available: z.boolean(),
      reason: z
        .literal("tutorial")
        .optional()
        .describe("Why availability changed; the Tutorial is the only reason today."),
    }),
    permission: null,
  }),
  defineApiEvent({
    id: "language.changed",
    description:
      "Maibuk's language changed. The current value is delivered on subscription, so a Plugin that starts after a change never misses it.",
    payload: z.strictObject({ language: z.string() }),
    permission: null,
    replays: true,
  }),
  defineApiEvent({
    id: "endpoint.addressChanged",
    description:
      "This Plugin's Plugin Endpoint address changed: the listener moved to another port or stopped. The current address is delivered on subscription, so a Plugin that starts after a change never misses it.",
    payload: z.strictObject({ url: z.string().nullable() }),
    permission: "serve",
    replays: true,
  }),
  defineApiEvent({
    id: "permissions.changed",
    description:
      "This Plugin's Plugin Permissions changed: one was granted or revoked. The current list is delivered on subscription, so a Plugin that starts after a change never misses it.",
    payload: z.strictObject({ permissions: z.array(z.string()) }),
    permission: null,
    replays: true,
  }),
  defineApiEvent({
    id: "editor.contentChanged",
    description: "The target editor's content or language changed; sent once per typing burst.",
    payload: z.strictObject({ entity: editorEntityRef }),
    permission: "editor:read",
  }),
  defineApiEvent({
    id: "editor.focusChanged",
    description:
      "The target editor changed: another took focus, or the only one on screen mounted or unmounted (entity is null when there is none).",
    payload: z.strictObject({ entity: editorEntityRef.nullable() }),
    permission: "editor:read",
  }),
] as const;

type JsonSchema = Record<string, unknown>;

function toJsonSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, {
    io,
    unrepresentable: (ctx) =>
      // `.describe()` wraps the custom schema, so the inner one arrives without
      // the description: every custom schema in this table is the file bytes.
      ctx.zodSchema._zod.def.type === "custom"
        ? { type: "object", description: ARRAY_BUFFER_SCHEMA_DESCRIPTION }
        : "throw",
  }) as JsonSchema;
  return rest;
}

export function inputJsonSchema(row: PluginApiRow): JsonSchema {
  return toJsonSchema(row.input, "input");
}

export function outputJsonSchema(row: PluginApiRow): JsonSchema {
  return toJsonSchema(row.output, "output");
}

export function chunkJsonSchema(row: PluginApiRow): JsonSchema | null {
  return row.chunk ? toJsonSchema(row.chunk, "output") : null;
}

export function payloadJsonSchema(event: PluginApiEventRow): JsonSchema {
  return toJsonSchema(event.payload, "output");
}

// MCP carries structured results as an object, so anything else becomes { result }.
function mcpOutputSchema(schema: JsonSchema): JsonSchema {
  if (schema.type === "object") return schema;
  return { type: "object", properties: { result: schema }, required: ["result"] };
}

/**
 * The table as an MCP-style tool list. No MCP server exists; this proves the
 * table can feed one without a second list (ADR 0022).
 */
export function projectMcpTools(table: readonly PluginApiRow[]): McpToolProjection[] {
  return table.map((row) => ({
    name: row.id,
    description: row.description,
    inputSchema: inputJsonSchema(row),
    outputSchema: mcpOutputSchema(outputJsonSchema(row)),
    annotations: { readOnlyHint: row.effect === "read" },
  }));
}
