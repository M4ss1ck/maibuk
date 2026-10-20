/**
 * Builds the per-request MCP server this Plugin answers Agents with. A fresh
 * instance serves every Connection request (the SDK's stateless legs share no
 * protocol state), so `startMcp` calls `buildMcpServer` from its factory for
 * each one; both eras serve the same tools, so they can never drift apart.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

/**
 * What the server tells every Agent about the Library: what it holds, and
 * that ids may be shortened to an 8+ character prefix. The SDK advertises it
 * on both the legacy `initialize` result and the modern `server/discover`
 * result.
 */
export const SERVER_INSTRUCTIONS =
  "Maibuk MCP Server. The Library holds the author's Books; each Book holds ordered Chapters and Notes with Tags. Tools take a Book, Chapter, or Note id, or an 8+ character prefix of one; an ambiguous prefix answers with its candidates. Lists are plain-text lines with a cursor and a total.";

/** The stub every tool answers with until its unit implements it. */
function notImplemented() {
  return {
    content: [{ type: "text" as const, text: "Not implemented yet." }],
    isError: true,
  };
}

/**
 * Builds a fresh MCP server named `maibuk` with the final tool set. The
 * `tools/list` and `server/discover` results carry the SDK's cache hints
 * (`ttlMs`, `cacheScope`); the values repeat the SDK defaults, stated here so
 * the advertised caching is a choice rather than an accident.
 */
export function buildMcpServer(): McpServer {
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
      description: "List Books in the Library, optionally filtered by Book Status.",
      inputSchema: z.object({
        status: z.enum(["draft", "in-progress", "completed", "archived"]).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async () => notImplemented()
  );
  server.registerTool(
    "get_book",
    {
      title: "Get book",
      description: "Read one Book with its ordered Chapter list and its Note titles.",
      inputSchema: z.object({
        book: z.string().min(8),
      }),
      annotations: { readOnlyHint: true },
    },
    async () => notImplemented()
  );
  return server;
}
