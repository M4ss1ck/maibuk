/**
 * The Plugin API as data (ADR 0022). Every method a Plugin can call is one
 * row: id, description, input and output schema, the Plugin Permission it
 * needs, and whether it reads or writes. The SDK types, the API reference,
 * the MCP tool projection, and the broker's checks all come from these rows,
 * so adding a method is adding a row and running `pnpm generate:plugin-api`.
 *
 * Schemas are Zod so the broker validates input with the same definition the
 * JSON Schema is emitted from; nothing can drift between them.
 */

import { z } from "zod";
import type { PLUGIN_PERMISSION_NAMES } from "@/features/plugins/manifest-validate";

/** The Plugin API's own semver, separate from Maibuk's release number. */
export const PLUGIN_API_VERSION = "0.1.0";

export const PLUGIN_API_NAMESPACES = [
  "library",
  "editor",
  "navigation",
  "secrets",
  "network",
  "clipboard",
  "notifications",
  "storage",
] as const;

/** Names held for a later effort; every call into one refuses with `not-implemented`. */
export const PLUGIN_API_RESERVED_NAMESPACES = ["process"] as const;

/**
 * `network` means "a granted `network:<host>` matching the request URL";
 * `null` means ungated (rate-limited instead).
 */
export type PluginApiPermission = (typeof PLUGIN_PERMISSION_NAMES)[number] | "network" | null;

export type PluginApiEffect = "read" | "write";

export interface PluginApiRow<
  Id extends string = string,
  Input extends z.ZodType = z.ZodType,
  Output extends z.ZodType = z.ZodType,
> {
  id: Id;
  description: string;
  input: Input;
  output: Output;
  permission: PluginApiPermission;
  effect: PluginApiEffect;
  /** Refused with `library-unavailable` while the Library cannot be read or written. */
  requiresLibrary?: boolean;
  /** At most one accepted call per this many milliseconds, per Plugin. */
  minIntervalMs?: number;
}

export function defineApiRow<
  const Id extends string,
  Input extends z.ZodType,
  Output extends z.ZodType,
>(row: PluginApiRow<Id, Input, Output>): PluginApiRow<Id, Input, Output> {
  return row;
}

const id = z.string().min(1).max(128);
const timestamp = z.number().describe("Milliseconds since the Unix epoch.");
const none = z.strictObject({});
const ok = z.null();

const content = z.strictObject({
  text: z.string().describe("Plain text."),
  html: z.string().describe("Sanitized HTML."),
});

const book = z.strictObject({
  id,
  title: z.string(),
  subtitle: z.string().nullable(),
  authorName: z.string(),
  language: z.string(),
  wordCount: z.int(),
  updatedAt: timestamp,
});

const chapterSummary = z.strictObject({
  id,
  bookId: id,
  title: z.string(),
  order: z.int(),
  parentId: id.nullable(),
  wordCount: z.int(),
  updatedAt: timestamp,
});

const noteSummary = z.strictObject({
  id,
  bookId: id.nullable(),
  title: z.string(),
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
    id: "library.chapters.updateContent",
    description: "Replaces a Chapter's content through the Chapter write path.",
    input: z.strictObject({ chapterId: id, content: fragment }),
    output: ok,
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.notes.create",
    description: "Creates a Note through the Note write path and returns its id.",
    input: z.strictObject({
      title: z.string().max(500),
      bookId: id.nullable().optional(),
      content: fragment.optional(),
    }),
    output: z.strictObject({ noteId: id }),
    ...libraryWrite,
  }),
  defineApiRow({
    id: "library.notes.update",
    description: "Updates a Note's title or content through the Note write path.",
    input: z.strictObject({
      noteId: id,
      title: z.string().max(500).optional(),
      content: fragment.optional(),
    }),
    output: ok,
    ...libraryWrite,
  }),
  defineApiRow({
    id: "editor.getContent",
    description: "Reads the focused rich-text editor's content, or no-target when none is focused.",
    input: none,
    output: z.union([
      z.strictObject({ status: z.literal("ok"), entity: entityRef, content }),
      noTarget,
    ]),
    permission: "editor:read",
    effect: "read",
  }),
  defineApiRow({
    id: "editor.getSelection",
    description: "Reads the focused editor's selection as plain-text offsets.",
    input: none,
    output: z.union([
      z.strictObject({ status: z.literal("ok"), entity: entityRef, range, text: z.string() }),
      noTarget,
    ]),
    permission: "editor:read",
    effect: "read",
  }),
  defineApiRow({
    id: "editor.reveal",
    description: "Scrolls the focused editor to a range and places the caret there.",
    input: z.strictObject({ range }),
    output: applied,
    permission: "editor:read",
    effect: "read",
  }),
  defineApiRow({
    id: "editor.setHighlights",
    description:
      "Replaces this Plugin's whole set of highlights in the focused editor. Never changes text.",
    input: z.strictObject({
      kind: z.enum(["info", "warning", "repetition"]),
      ranges: z.array(z.strictObject({ ...range.shape, label: z.string().max(200).optional() })),
    }),
    output: applied,
    permission: "editor:decorate",
    effect: "write",
  }),
  defineApiRow({
    id: "editor.insert",
    description: "Inserts text or an HTML fragment at the caret as one undoable step.",
    input: z.strictObject({ content: fragment }),
    output: applied,
    permission: "editor:write",
    effect: "write",
  }),
  defineApiRow({
    id: "editor.replace",
    description: "Replaces a range with text or an HTML fragment as one undoable step.",
    input: z.strictObject({ range, content: fragment }),
    output: applied,
    permission: "editor:write",
    effect: "write",
  }),
  defineApiRow({
    id: "navigation.openEntity",
    description: "Opens a Book, Chapter, Note, or Canvas, optionally revealing a range.",
    input: z.strictObject({ entity: entityRef, reveal: range.optional() }),
    output: ok,
    permission: null,
    effect: "write",
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
      "Fetches a URL on a granted host. A header can name a stored secret the host injects.",
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
    output: z.strictObject({
      status: z.int(),
      statusText: z.string(),
      headers: z.record(z.string(), z.string()),
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
    description: "Shows a toast naming this Plugin. At most one every 5 seconds.",
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
] as const;

export type PluginApiTable = typeof PLUGIN_API_TABLE;
export type PluginApiMethodId = PluginApiTable[number]["id"];
type RowOf<M extends PluginApiMethodId> = Extract<PluginApiTable[number], { id: M }>;
export type PluginApiInput<M extends PluginApiMethodId> = z.output<RowOf<M>["input"]>;
export type PluginApiOutput<M extends PluginApiMethodId> = z.input<RowOf<M>["output"]>;

type JsonSchema = Record<string, unknown>;

function toJsonSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io }) as JsonSchema;
  return rest;
}

export function inputJsonSchema(row: PluginApiRow): JsonSchema {
  return toJsonSchema(row.input, "input");
}

export function outputJsonSchema(row: PluginApiRow): JsonSchema {
  return toJsonSchema(row.output, "output");
}

export interface McpToolProjection {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations: { readOnlyHint: boolean };
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
