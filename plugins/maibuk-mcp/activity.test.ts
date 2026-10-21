/**
 * The Activity log through the Plugin test kit: one entry per tool call the
 * server answers, with none of the author's text, capped at the newest 500 and
 * kept across a restart of the Plugin. The recording function is driven
 * directly for the cap so 501 entries do not need 501 requests.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { ACTIVITY_LIMIT, activityEntries, recordActivity, subscribeActivity } from "./activity";
import { CONNECTION_WRITE_MS } from "./plugin";
import {
  connect,
  makeNote,
  mcpRequest,
  modernHeaders,
  modernParams,
  type McpAnswer,
} from "./test-support";

/** The distinctive text no Activity may ever hold. */
const SENTINEL_TEXT = "ZEBRA-SENTINEL-TEXT";

/** The distinctive title no Activity may ever hold. */
const SENTINEL_TITLE = "ZEBRA-TITLE-SENTINEL";

/** The fake clock the timed tests start at. */
const START = Date.UTC(2026, 9, 20, 9, 0, 0);

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

/** The Agent's legacy `tools/list` body. */
function toolsListBody(id: unknown = 2) {
  return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

/** The Agent's legacy `tools/call` body. */
function toolsCall(name: string, args: unknown, id: unknown = 2) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

/** Whether the Agent sees a refusal: a tool error result, or a JSON-RPC error. */
function refused(answer: McpAnswer): boolean {
  return answer.json?.result?.isError === true || answer.json?.error !== undefined;
}

/** A Book, its Chapter, and its Note, as the Agent finds them. */
function activityLibrary() {
  const books = [
    {
      id: "bookalpha1",
      title: "The Book",
      subtitle: null,
      authorName: "Author",
      genre: null,
      language: "en",
      wordCount: 100,
      targetWordCount: null,
      status: "draft" as const,
      updatedAt: 1000,
    },
  ];
  const chapters = [
    {
      id: "chapteralpha",
      bookId: "bookalpha1",
      title: "Chapter One",
      order: 1,
      parentId: null,
      chapterType: "chapter" as const,
      wordCount: 10,
      status: "draft" as const,
      updatedAt: Date.UTC(2026, 0, 1),
      content: { html: "<p>Alpha body.</p>", text: "Alpha body." },
    },
  ];
  const notes = [makeNote("notealpha1", "bookalpha1", "The Note")];
  return { books, chapters, notes } as any;
}

/**
 * Takes over the clock and the Plugin's own timers. The port's macrotasks
 * stay real, so a write the assertions wait on can land without moving the
 * clock they measure (mirrors `plugin.test.ts`).
 */
function freezeClock(at: number): void {
  vi.useFakeTimers({
    now: at,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
}

/** The entries Plugin storage holds, or none. */
function storedEntries(storage: Map<string, unknown>): unknown[] {
  const value = storage.get("activity");
  return Array.isArray(value) ? value : [];
}

/**
 * Waits until the Plugin's storage write lands, flushing the zero-delay timer
 * the in-process port delivers on (it is faked along with the clock) and a
 * real macrotask per turn.
 */
async function untilStored(storage: Map<string, unknown>, count: number): Promise<void> {
  for (let turn = 0; turn < 100 && storedEntries(storage).length !== count; turn += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (storedEntries(storage).length !== count) {
    throw new Error("The Plugin's Activity log was not stored");
  }
}

describe("MCP Server Activity log", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a named Agent's tool call with its time, tool, item, and result", async () => {
    const { host, key } = await connect({ library: activityLibrary() });
    try {
      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      const answer = await mcpRequest(host, key, toolsCall("read_note", { note: "notealpha1" }));
      expect(refused(answer)).toBe(false);
      expect(activityEntries()).toEqual([
        {
          at: START,
          agent: "Claude Code",
          tool: "read_note",
          item: "notealpha1",
          result: "ok",
        },
      ]);
    } finally {
      host.stop();
    }
  });

  it("records no Agent for a request that names none", async () => {
    const { host, key } = await connect({ library: activityLibrary() });
    try {
      freezeClock(START);
      const answer = await mcpRequest(
        host,
        key,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: modernParams({ name: "list_books", arguments: {} }),
        },
        modernHeaders("tools/call", { "mcp-name": "list_books" })
      );
      expect(refused(answer)).toBe(false);
      expect(activityEntries()).toEqual([
        { at: START, agent: null, tool: "list_books", item: null, result: "ok" },
      ]);
    } finally {
      host.stop();
    }
  });

  it("records a failing call as an error", async () => {
    const { host, key } = await connect({ library: activityLibrary() });
    try {
      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      const answer = await mcpRequest(host, key, toolsCall("read_note", { note: "missingnote" }));
      expect(refused(answer)).toBe(true);
      expect(activityEntries()).toEqual([
        {
          at: START,
          agent: "Claude Code",
          tool: "read_note",
          item: "missingnote",
          result: "error",
        },
      ]);
    } finally {
      host.stop();
    }
  });

  it("keeps none of the author's text, in memory or in storage", async () => {
    const { host, storage, key } = await connect({ library: activityLibrary() });
    try {
      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await mcpRequest(host, key, toolsCall("read_note", { note: "notealpha1" }, 2));
      await mcpRequest(
        host,
        key,
        toolsCall(
          "edit_chapter",
          { chapter: "chapteralpha", find: "Alpha body.", replace: SENTINEL_TEXT },
          3
        )
      );
      await mcpRequest(
        host,
        key,
        toolsCall(
          "write_chapter",
          { book: "bookalpha1", title: SENTINEL_TITLE, text: SENTINEL_TEXT },
          4
        )
      );
      await mcpRequest(
        host,
        key,
        toolsCall("write_note", { book: null, title: SENTINEL_TITLE, text: SENTINEL_TEXT }, 5)
      );
      expect(activityEntries()).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(CONNECTION_WRITE_MS);
      await untilStored(storage, 4);

      for (const serialized of [
        JSON.stringify(activityEntries()),
        JSON.stringify(storedEntries(storage)),
      ]) {
        expect(serialized).not.toContain(SENTINEL_TEXT);
        expect(serialized).not.toContain(SENTINEL_TITLE);
        expect(serialized).not.toContain("The Note");
        expect(serialized).not.toContain("Chapter One");
        expect(serialized).not.toContain("Old body.");
      }
    } finally {
      host.stop();
    }
  });

  it("keeps the newest five hundred entries, dropping the oldest first", async () => {
    const { host, storage, key } = await connect({ library: activityLibrary() });
    try {
      freezeClock(START);
      // Wait for the start's stored log to land before recording into it.
      await mcpRequest(host, key, toolsListBody());
      for (let index = 0; index < ACTIVITY_LIMIT + 1; index += 1) {
        recordActivity({
          at: START + index,
          agent: null,
          tool: "list_books",
          item: null,
          result: "ok",
        });
      }
      const entries = activityEntries();
      expect(entries).toHaveLength(ACTIVITY_LIMIT);
      expect(entries[0]?.at).toBe(START + 1);
      expect(entries[ACTIVITY_LIMIT - 1]?.at).toBe(START + ACTIVITY_LIMIT);

      await vi.advanceTimersByTimeAsync(CONNECTION_WRITE_MS);
      await untilStored(storage, ACTIVITY_LIMIT);
      expect((storedEntries(storage)[0] as { at: number }).at).toBe(START + 1);
    } finally {
      host.stop();
    }
  });

  it("reloads the stored log on a fresh start with the same storage", async () => {
    const storage = new Map<string, unknown>();
    const first = await connect({ storage, library: activityLibrary() });
    try {
      freezeClock(START);
      await mcpRequest(first.host, first.key, initializeFrom("Claude Code"));
      await mcpRequest(first.host, first.key, toolsCall("read_note", { note: "notealpha1" }));
      await untilStored(storage, 1);
    } finally {
      first.host.stop();
      vi.useRealTimers();
    }

    const second = await connect({ storage, library: activityLibrary() });
    try {
      // A request waits for the start's load, so the log is back in memory.
      await mcpRequest(second.host, second.key, toolsListBody());
      expect(activityEntries()).toEqual([
        {
          at: START,
          agent: "Claude Code",
          tool: "read_note",
          item: "notealpha1",
          result: "ok",
        },
      ]);
    } finally {
      second.host.stop();
    }
  });

  it("drops stored entries that are not Activities", async () => {
    const storage = new Map<string, unknown>([
      [
        "activity",
        [
          { at: START, agent: "Claude Code", tool: "list_books", item: null, result: "ok" },
          { at: "yesterday", agent: "Claude Code", tool: "list_books", item: null, result: "ok" },
          { at: START, agent: 7, tool: "list_books", item: null, result: "ok" },
          { at: START, agent: null, tool: "list_books", item: null, result: "maybe" },
          { at: START, agent: null, tool: "list_books", item: 5, result: "ok" },
          { tool: "list_books" },
          "not an entry",
          null,
          { at: START, agent: null, tool: "list_books", item: null, result: "error" },
        ],
      ],
    ]);
    const { host, key } = await connect({ storage, library: activityLibrary() });
    try {
      // A request waits for the start's load, so the log is back in memory.
      await mcpRequest(host, key, toolsListBody());
      expect(activityEntries()).toEqual([
        { at: START, agent: "Claude Code", tool: "list_books", item: null, result: "ok" },
        { at: START, agent: null, tool: "list_books", item: null, result: "error" },
      ]);
    } finally {
      host.stop();
    }
  });

  it("keeps the log when the author makes a new Key", async () => {
    const { host, key } = await connect({ library: activityLibrary() });
    try {
      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await mcpRequest(host, key, toolsCall("list_books", {}));
      const before = activityEntries();
      expect(before).toHaveLength(1);
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: "newKey" });
      expect(activityEntries()).toEqual(before);
    } finally {
      host.stop();
    }
  });

  it("tells its subscribers when a call lands", async () => {
    const { host, key } = await connect({ library: activityLibrary() });
    try {
      // The handshake waits for the start's load, so the listener below sees
      // only the entries the calls after it record.
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      const listener = vi.fn();
      const unsubscribe = subscribeActivity(listener);
      try {
        await mcpRequest(host, key, toolsCall("list_books", {}));
        expect(listener).toHaveBeenCalledTimes(1);
        await mcpRequest(host, key, toolsCall("list_books", {}, 3));
        expect(listener).toHaveBeenCalledTimes(2);
      } finally {
        unsubscribe();
      }
    } finally {
      host.stop();
    }
  });
});
