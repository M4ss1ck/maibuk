/**
 * Builds the per-request MCP server this Plugin answers Agents with. A fresh
 * instance serves every Connection request (the SDK's stateless legs share no
 * protocol state), so `startMcp` calls `buildMcpServer` from its factory for
 * each one; both eras serve the same tools, so they can never drift apart.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { PluginClient } from "@/plugin-sdk";
import { listBooks, getBook } from "./books";
import { readChapter } from "./chapters";
import { listNotes, readNote } from "./notes";

/**
 * What the server tells every Agent about the Library: what it holds, and
 * that ids may be shortened to an 8+ character prefix. The SDK advertises it
 * on both the legacy `initialize` result and the modern `server/discover`
 * result.
 */
const SERVER_INSTRUCTIONS =
  "Maibuk MCP Server. The Library holds the author's Books; each Book holds ordered Chapters and Notes with Tags. Tools take a Book, Chapter, or Note id, or an 8+ character prefix of one; an ambiguous prefix answers with its candidates. Lists are plain-text lines with a cursor and a total. Reads come in windows of characters; pass the returned next offset to continue.";

/**
 * Builds a fresh MCP server named `maibuk` with the final tool set. The
 * `tools/list` and `server/discover` results carry the SDK's cache hints
 * (`ttlMs`, `cacheScope`); the values repeat the SDK defaults, stated here so
 * the advertised caching is a choice rather than an accident.
 */
export function buildMcpServer(client: PluginClient): McpServer {
  const server = new McpServer(
    { name: "maibuk", version: "0.1.0" },
    {
      instructions: SERVER_INSTRUCTIONS,
      cacheHints: {
        "tools/list": { ttlMs: 0, cacheScope: "private" },
        "server/discover": { ttlMs: 0, cacheScope: "private" },
      },
    }
  );
  // list_books first, then get_book: the order `tools/list` advertises.
  server.registerTool(
    "list_books",
    {
      title: "List books",
      description:
        "List Books in the Library, optionally filtered by Book Status, at most 50 per page.",
      inputSchema: z.object({
        status: z.enum(["draft", "in-progress", "completed", "archived"]).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).optional(),
        detail: z.enum(["titles", "excerpts"]).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => listBooks(client, args as any)
  );
  server.registerTool(
    "get_book",
    {
      title: "Get book",
      description: "Read one Book with its ordered Chapter list and its Note titles.",
      inputSchema: z.object({
        book: z.string().min(8),
        detail: z.enum(["titles", "excerpts"]).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => getBook(client, args as any)
  );
  server.registerTool(
    "read_chapter",
    {
      title: "Read chapter",
      description:
        "Read one Chapter's content as text or HTML, in windows of at most 50,000 characters, with its Last Edited and where to continue.",
      inputSchema: z.object({
        chapter: z.string().min(8),
        format: z.enum(["text", "html"]).optional(),
        offset: z.number().int().min(0).optional(),
        length: z.number().int().min(1).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => readChapter(client, args as any)
  );
  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        "List Notes, optionally only one Book's or the Unfiled ones and only those with a Tag, at most 50 per page.",
      inputSchema: z.object({
        book: z.string().optional(),
        tag: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).optional(),
        detail: z.enum(["titles", "excerpts"]).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => listNotes(client, args as any)
  );
  server.registerTool(
    "read_note",
    {
      title: "Read note",
      description:
        "Read one Note's content as text or HTML with its Tags, in windows of at most 50,000 characters, with its Last Edited and where to continue.",
      inputSchema: z.object({
        note: z.string().min(8),
        format: z.enum(["text", "html"]).optional(),
        offset: z.number().int().min(0).optional(),
        length: z.number().int().min(1).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => readNote(client, args as any)
  );
  return server;
}
