/**
 * The pre-write Checkpoint through the Plugin test kit: before a Connection's
 * first write to a Book, the Plugin takes a Checkpoint through the normal
 * Version path. Every test drives real MCP requests the way an Agent would
 * and asserts what the Agent sees plus what the host recorded.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginClient } from "@/plugin-sdk";
import { createTestHost } from "@/features/plugins/test-kit";
import { CONNECTION_IDLE_MS, startMcp } from "./plugin";
import {
  connect,
  mcpManifest,
  mcpRequest,
  modernHeaders,
  modernParams,
  waitForStoredKey,
  type McpAnswer,
} from "./test-support";

/** The Agent's legacy `initialize` handshake body, self-reporting `name`. */
function initializeFrom(name: string, id: unknown = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name, version: "0.0.0" },
    },
  };
}

/** The Agent's legacy `tools/call` body. */
function toolsCall(name: string, args: unknown, id: unknown = 2) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

/** The Agent's modern `tools/call` body, self-reporting `name` under `_meta`. */
function modernToolsCall(tool: string, args: unknown, name: string, id: unknown = 2) {
  const params = modernParams();
  (params._meta as Record<string, unknown>)["io.modelcontextprotocol/clientInfo"] = {
    name,
    version: "1.0.0",
  };
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: tool, arguments: args, ...params },
  };
}

/** The Agent's modern `server/discover` body, self-reporting `name` under `_meta`. */
function discoverFrom(name: string, id: unknown = 1) {
  const params = modernParams();
  (params._meta as Record<string, unknown>)["io.modelcontextprotocol/clientInfo"] = {
    name,
    version: "1.0.0",
  };
  return { jsonrpc: "2.0", id, method: "server/discover", params };
}

/** The headers a modern (2026-07-28) tools/call must carry: the method plus the tool name. */
function modernCallHeaders(tool: string): Record<string, string> {
  return { ...modernHeaders("tools/call"), "mcp-name": tool };
}

function textOf(answer: McpAnswer): string {
  if (answer.json?.error) return `ERROR:${answer.json.error.message}`;
  return answer.json?.result?.content?.[0]?.text ?? "";
}

function isError(answer: McpAnswer): boolean {
  return answer.json?.result?.isError === true || answer.json?.error !== undefined;
}

function lastEditedOf(text: string): string {
  const line = text.split("\n").find((entry) => entry.startsWith("Last Edited: "));
  if (line === undefined) throw new Error(`No Last Edited line in ${JSON.stringify(text)}`);
  return line.replace("Last Edited: ", "");
}

function makeBook(id: string, updatedAt: number, title = `Title ${id}`) {
  return {
    id,
    title,
    subtitle: null,
    authorName: "Author",
    genre: null,
    language: "en",
    wordCount: 100,
    targetWordCount: null,
    status: "draft" as const,
    updatedAt,
  };
}

const JANUARY_1 = Date.UTC(2026, 0, 1);

function makeChapter(id: string, bookId: string, html: string, updatedAt = JANUARY_1) {
  return {
    id,
    bookId,
    title: `Chapter ${id}`,
    order: 1,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount: 10,
    status: "draft" as const,
    updatedAt,
    content: { html, text: html },
  };
}

function twoBookLibrary() {
  const books = [makeBook("bookalpha1", 1000), makeBook("bookbeta12", 1000)];
  const chapters = [
    makeChapter("chapteralpha", "bookalpha1", "<p>Alpha body.</p>"),
    makeChapter("chapterbeta1", "bookbeta12", "<p>Beta body.</p>"),
  ];
  return { books, chapters };
}

describe("write checkpoints", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("first edit_chapter records one checkpoint before the content write", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      const answer = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "More." }, 2)
      );
      expect(isError(answer)).toBe(false);
      expect(host.checkpoints).toEqual([
        { bookId: "bookalpha1", label: "Before Claude Code edits", versionId: expect.any(String) },
      ]);
      expect(chapters[0].content.html).toContain("More.");
    } finally {
      host.stop();
    }
  });

  it("second write to the same Book in the same Connection takes no new checkpoint", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      const first = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "More." }, 2)
      );
      expect(isError(first)).toBe(false);
      const readCall = toolsCall("read_chapter", { chapter: "chapteralpha" }, 3);
      const reread = await mcpRequest(host, key, readCall);
      const second = await mcpRequest(
        host,
        key,
        toolsCall(
          "write_chapter",
          {
            chapter: "chapteralpha",
            expectedLastEdited: lastEditedOf(textOf(reread)),
            html: "<p>Replaced.</p>",
          },
          4
        )
      );
      expect(isError(second)).toBe(false);
      expect(chapters[0].content.html).toBe("<p>Replaced.</p>");
      expect(host.checkpoints).toHaveLength(1);
      expect(host.checkpoints[0].bookId).toBe("bookalpha1");
    } finally {
      host.stop();
    }
  });

  it("write to another Book in the same Connection checkpoints that Book", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "More." }, 2)
      );
      const answer = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapterbeta1", append: "More." }, 3)
      );
      expect(isError(answer)).toBe(false);
      expect(host.checkpoints).toHaveLength(2);
      expect(host.checkpoints[1]).toEqual({
        bookId: "bookbeta12",
        label: "Before Claude Code edits",
        versionId: expect.any(String),
      });
      expect(chapters[1].content.html).toContain("More.");
    } finally {
      host.stop();
    }
  });

  it("a different Agent checkpoints the same Book again", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "More." }, 2)
      );
      await mcpRequest(host, key, initializeFrom("Codex", 3));
      const answer = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "Even more." }, 4)
      );
      expect(isError(answer)).toBe(false);
      expect(host.checkpoints).toHaveLength(2);
      expect(host.checkpoints[1]).toEqual({
        bookId: "bookalpha1",
        label: "Before Codex edits",
        versionId: expect.any(String),
      });
    } finally {
      host.stop();
    }
  });

  it("a new Connection after the idle timeout checkpoints again", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      vi.useFakeTimers({
        now: Date.UTC(2026, 9, 20, 9, 0, 0),
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
      });
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "More." }, 2)
      );
      expect(host.checkpoints).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(CONNECTION_IDLE_MS + 1_000);
      // The old Connection ended with its checkpoint memory, so this
      // handshake opens a new one that checkpoints again.
      await mcpRequest(host, key, initializeFrom("Claude Code", 9));
      const answer = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "Later." }, 3)
      );
      expect(isError(answer)).toBe(false);
      expect(host.checkpoints).toHaveLength(2);
      expect(host.checkpoints[1]).toEqual({
        bookId: "bookalpha1",
        label: "Before Claude Code edits",
        versionId: expect.any(String),
      });
    } finally {
      host.stop();
    }
  });

  it("unchanged Book records nothing and the write still lands", async () => {
    const { books, chapters } = twoBookLibrary();
    // The kit starts every Book changed; seed it checkpointed through the
    // Plugin's own client (a second client would race its endpoint answers),
    // so the write's Checkpoint reports a null versionId.
    const storage = new Map<string, unknown>();
    const host = createTestHost({
      manifest: mcpManifest(),
      storage,
      library: { books, chapters } as any,
    });
    const client = createPluginClient(host.port);
    startMcp(client);
    const key = await waitForStoredKey(storage);
    try {
      await client.library.books.checkpoint({ bookId: "bookalpha1", label: "Before edits" });
      expect(host.checkpoints).toHaveLength(1);

      await mcpRequest(host, key, initializeFrom("Claude Code"));
      const answer = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "More." }, 2)
      );
      expect(isError(answer)).toBe(false);
      expect(host.checkpoints).toHaveLength(1);
      expect(chapters[0].content.html).toContain("More.");
    } finally {
      host.stop();
    }
  });

  it("a refused write takes no checkpoint", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      const answer = await mcpRequest(
        host,
        key,
        toolsCall(
          "write_chapter",
          {
            chapter: "chapteralpha",
            expectedLastEdited: new Date(Date.UTC(2020, 0, 1)).toISOString(),
            html: "<p>new</p>",
          },
          2
        )
      );
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toContain("changed since you read it");
      expect(host.checkpoints).toEqual([]);
      expect(chapters[0].content.html).toBe("<p>Alpha body.</p>");
    } finally {
      host.stop();
    }
  });

  it("checkpoint failure refuses the write and leaves content unchanged", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({
      library: { books, chapters } as any,
      checkpointError: "The Versions shelf is stuck.",
    });
    try {
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      const answer = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "More." }, 2)
      );
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe(
        "Could not take a Checkpoint of the Book before writing, so nothing changed; try again."
      );
      expect(host.checkpoints).toEqual([]);
      expect(chapters[0].content.html).toBe("<p>Alpha body.</p>");
    } finally {
      host.stop();
    }
  });

  it("nameless Agent labels Before an Agent edits", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      // No initialize at all: the request names no Agent.
      const answer = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "More." }, 2)
      );
      expect(isError(answer)).toBe(false);
      expect(host.checkpoints).toEqual([
        { bookId: "bookalpha1", label: "Before an Agent edits", versionId: expect.any(String) },
      ]);
      expect(chapters[0].content.html).toContain("More.");
    } finally {
      host.stop();
    }
  });

  it("nameless requests share one anonymous checkpoint memory, cleared after the idle time", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      vi.useFakeTimers({
        now: Date.UTC(2026, 9, 20, 9, 0, 0),
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
      });
      const first = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "One." }, 2)
      );
      expect(isError(first)).toBe(false);
      const second = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "Two." }, 3)
      );
      expect(isError(second)).toBe(false);
      expect(host.checkpoints).toEqual([
        { bookId: "bookalpha1", label: "Before an Agent edits", versionId: expect.any(String) },
      ]);

      // After a quiet window no nameless request keeps the memory alive.
      await vi.advanceTimersByTimeAsync(CONNECTION_IDLE_MS + 1_000);
      const third = await mcpRequest(
        host,
        key,
        toolsCall("edit_chapter", { chapter: "chapteralpha", append: "Three." }, 4)
      );
      expect(isError(third)).toBe(false);
      expect(host.checkpoints).toHaveLength(2);
      expect(host.checkpoints[1]).toEqual({
        bookId: "bookalpha1",
        label: "Before an Agent edits",
        versionId: expect.any(String),
      });
      expect(chapters[0].content.html).toContain("Three.");
    } finally {
      host.stop();
    }
  });

  it("modern request names its checkpoint from the clientInfo meta", async () => {
    const { books, chapters } = twoBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const discovered = await mcpRequest(
        host,
        key,
        discoverFrom("Codex"),
        modernHeaders("server/discover")
      );
      expect(discovered.status).toBe(200);
      const answer = await mcpRequest(
        host,
        key,
        modernToolsCall("edit_chapter", { chapter: "chapteralpha", append: "More." }, "Codex", 2),
        modernCallHeaders("edit_chapter")
      );
      expect(isError(answer)).toBe(false);
      expect(host.checkpoints).toEqual([
        { bookId: "bookalpha1", label: "Before Codex edits", versionId: expect.any(String) },
      ]);
      expect(chapters[0].content.html).toContain("More.");
    } finally {
      host.stop();
    }
  });
});
