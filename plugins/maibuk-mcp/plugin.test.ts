/**
 * The MCP Server's Plugin-level behavior through the supported Plugin test
 * kit: the real broker and method table over an in-process channel, driven
 * only through the Plugin Endpoint the way an Agent reaches it. Every test
 * asserts what the Agent sees (status, headers, JSON-RPC result); no test
 * imports Plugin internals other than `startMcp` (through `test-support`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import {
  answerHeader,
  connect,
  mcpRequest,
  modernHeaders,
  modernParams,
  startHost,
  type McpAnswer,
} from "./test-support";

/** The Agent's legacy `initialize` handshake body. */
function initializeBody(id: unknown = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-test", version: "0.0.0" },
    },
  };
}

/** The Agent's legacy `initialize` body, self-reporting `name`. */
function initializeFrom(name: string, id: unknown = 1) {
  const body = initializeBody(id);
  body.params.clientInfo.name = name;
  return body;
}

/** The Agent's legacy `tools/list` body. */
function toolsListBody(id: unknown = 2) {
  return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

/** The Agent's modern `server/discover` body, with the required envelope and headers. */
function discoverBody(id: unknown = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "server/discover",
    params: modernParams(),
  };
}

/** The Agent's modern `server/discover` body, self-reporting `name` under `_meta`. */
function discoverFrom(name: string, id: unknown = 1) {
  const body = discoverBody(id);
  (body.params._meta as Record<string, unknown>)["io.modelcontextprotocol/clientInfo"] = {
    name,
    version: "1.0.0",
  };
  return body;
}

/** The tools/list result the Agent sees, as name/annotation pairs. */
function gateOf(answer: McpAnswer) {
  return answer.json.result.tools.map((tool: any) => ({
    name: tool.name,
    annotations: tool.annotations,
  }));
}

describe("MCP Server protocol", () => {
  it("answers the legacy initialize handshake with the server name and short Library instructions", async () => {
    const { host, key } = await connect();
    try {
      const answer = await mcpRequest(host, key, initializeBody());
      expect(answer.status).toBe(200);
      expect(answer.json.result.serverInfo.name).toBe("maibuk");
      const instructions = answer.json.result.instructions as string;
      expect(instructions.length).toBeLessThan(500);
      expect(instructions).toContain("Library");
      expect(instructions).toContain("Book");
    } finally {
      host.stop();
    }
  });

  it("answers tools/list after the legacy handshake", async () => {
    const { host, key } = await connect();
    try {
      await mcpRequest(host, key, initializeBody());
      const notified = await host.endpoint({
        method: "POST",
        path: "/mcp",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      expect(notified.status).toBe(202);
      const answer = await mcpRequest(host, key, toolsListBody());
      expect(answer.status).toBe(200);
      expect(answer.json.result.tools.map((tool: any) => tool.name)).toEqual([
        "list_books",
        "get_book",
        "read_chapter",
        "list_notes",
        "read_note",
        "edit_chapter",
        "write_chapter",
        "manage_chapter",
      ]);
    } finally {
      host.stop();
    }
  });

  it("answers a modern server/discover request with versions, short Library instructions, and cache hints", async () => {
    const { host, key } = await connect();
    try {
      const answer = await mcpRequest(host, key, discoverBody(), modernHeaders("server/discover"));
      expect(answer.status).toBe(200);
      expect(answer.json.result.supportedVersions).toContain("2026-07-28");
      const instructions = answer.json.result.instructions as string;
      expect(instructions.length).toBeLessThan(500);
      expect(instructions).toContain("Library");
      expect(instructions).toContain("Book");
      expect(answer.json.result.ttlMs).toBe(0);
      expect(answer.json.result.cacheScope).toBe("private");
    } finally {
      host.stop();
    }
  });

  it("carries cache hints on a modern tools/list result", async () => {
    const { host, key } = await connect();
    try {
      const answer = await mcpRequest(
        host,
        key,
        { jsonrpc: "2.0", id: 3, method: "tools/list", params: modernParams() },
        modernHeaders("tools/list")
      );
      expect(answer.status).toBe(200);
      expect(answer.json.result.ttlMs).toBe(0);
      expect(answer.json.result.cacheScope).toBe("private");
    } finally {
      host.stop();
    }
  });

  it("advertises the tools in order with their annotations and without output schemas", async () => {
    const { host, key } = await connect();
    try {
      const answer = await mcpRequest(host, key, toolsListBody());
      expect(answer.status).toBe(200);
      for (const tool of answer.json.result.tools) {
        expect(tool.outputSchema).toBeUndefined();
      }
      expect(gateOf(answer)).toMatchInlineSnapshot(`
        [
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "list_books",
          },
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "get_book",
          },
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "read_chapter",
          },
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "list_notes",
          },
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "read_note",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "name": "edit_chapter",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "name": "write_chapter",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "name": "manage_chapter",
          },
        ]
      `);

      // Read-only variant: without library:write the Agent sees only the read
      // tools, in the same order and with the same annotations.
      host.setGranted(["serve", "library:read"]);
      let readonly: McpAnswer | undefined;
      await vi.waitFor(async () => {
        readonly = await mcpRequest(host, key, toolsListBody(3));
        expect(readonly.json.result.tools.map((tool: any) => tool.name)).toEqual([
          "list_books",
          "get_book",
          "read_chapter",
          "list_notes",
          "read_note",
        ]);
      });
      if (readonly === undefined) throw new Error("The read-only tools/list never arrived");
      for (const tool of readonly.json.result.tools) {
        expect(tool.outputSchema).toBeUndefined();
      }
      expect(gateOf(readonly)).toMatchInlineSnapshot(`
        [
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "list_books",
          },
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "get_book",
          },
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "read_chapter",
          },
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "list_notes",
          },
          {
            "annotations": {
              "readOnlyHint": true,
            },
            "name": "read_note",
          },
        ]
      `);
    } finally {
      host.stop();
    }
  });

  it("answers 404 off the /mcp path", async () => {
    const { host, key } = await connect();
    try {
      const answer = await host.endpoint({
        method: "GET",
        path: "/nope",
        headers: { authorization: `Bearer ${key}` },
      });
      expect(answer.status).toBe(404);
    } finally {
      host.stop();
    }
  });
});

describe("MCP Server Key", () => {
  it("makes a 64-character hex Key when turned on", async () => {
    const { host, key } = await connect();
    try {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      host.stop();
    }
  });

  it("refuses a missing Key with a 401 challenge", async () => {
    const { host } = await connect();
    try {
      const answer = await mcpRequest(host, null, initializeBody());
      expect(answer.status).toBe(401);
      expect(answerHeader(answer, "www-authenticate")).toBe("Bearer");
      expect(answer.json).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32001,
          message:
            "The Key is missing or old; copy the setup snippet from the MCP Server page again.",
        },
      });
    } finally {
      host.stop();
    }
  });

  it("refuses a wrong Key with a 401 challenge", async () => {
    const { host } = await connect();
    try {
      const answer = await mcpRequest(host, "0".repeat(64), initializeBody());
      expect(answer.status).toBe(401);
      expect(answerHeader(answer, "www-authenticate")).toBe("Bearer");
      expect(answer.json.error.code).toBe(-32001);
    } finally {
      host.stop();
    }
  });

  it("makes a Key on the first request when none could be stored at start", async () => {
    const { host, storage } = startHost({ libraryUnavailable: true });
    try {
      // Startup could not store a Key, and answers the Tutorial refusal.
      const unavailable = await mcpRequest(host, null, initializeBody());
      expect(unavailable.status).toBe(503);
      expect(storage.has("key")).toBe(false);
      host.setLibraryAvailable(true);
      const refused = await mcpRequest(host, null, initializeBody());
      expect(refused.status).toBe(401);
      const key = storage.get("key");
      expect(key).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      const accepted = await mcpRequest(host, key as string, initializeBody(2));
      expect(accepted.status).toBe(200);
      expect(accepted.json.result.serverInfo.name).toBe("maibuk");
    } finally {
      host.stop();
    }
  });

  it("rotates the Key on enable: the old Key fails and the new Key works", async () => {
    const storage = new Map<string, unknown>();
    const first = await connect({ storage });
    try {
      const oldKey = first.key;
      const second = await connect({ storage, startReason: "enable", changedFrom: oldKey });
      try {
        expect(second.key).not.toBe(oldKey);
        const refused = await mcpRequest(second.host, oldKey, initializeBody(11));
        expect(refused.status).toBe(401);
        expect(refused.json.error.code).toBe(-32001);
        const accepted = await mcpRequest(second.host, second.key, initializeBody(12));
        expect(accepted.status).toBe(200);
        expect(accepted.json.result.serverInfo.name).toBe("maibuk");
      } finally {
        second.host.stop();
      }
    } finally {
      first.host.stop();
    }
  });

  it("makes a new Key on the newKey Command: the old Key fails and the new Key works", async () => {
    const { host, storage, key } = await connect();
    try {
      const oldKey = key;
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: "newKey" });
      const fresh = storage.get("key");
      expect(fresh).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      expect(fresh).not.toBe(oldKey);
      const refused = await mcpRequest(host, oldKey, initializeBody(11));
      expect(refused.status).toBe(401);
      expect(refused.json.error.code).toBe(-32001);
      const accepted = await mcpRequest(host, fresh as string, initializeBody(12));
      expect(accepted.status).toBe(200);
      expect(accepted.json.result.serverInfo.name).toBe("maibuk");
    } finally {
      host.stop();
    }
  });
});

describe("MCP Server Tutorial refusal", () => {
  it("refuses with 503 while the Library is unavailable, then works again", async () => {
    const { host, key } = await connect();
    try {
      const before = await mcpRequest(host, key, toolsListBody());
      expect(before.status).toBe(200);
      host.setLibraryAvailable(false);
      const refused = await mcpRequest(host, key, toolsListBody());
      expect(refused.status).toBe(503);
      expect(refused.json.error.message).toBe(
        "The Library is unavailable while the Tutorial runs; try again when it ends."
      );
      host.setLibraryAvailable(true);
      const after = await mcpRequest(host, key, toolsListBody());
      expect(after.status).toBe(200);
    } finally {
      host.stop();
    }
  });
});

/** One Connection as storage holds it, in ms since the epoch. */
interface StoredConnection {
  name: string;
  startedAt: number;
  lastActivityAt: number;
}

/** The Connections the Plugin published, or none. */
function connectionsOf(storage: Map<string, unknown>): StoredConnection[] {
  return (storage.get("connections") as StoredConnection[] | undefined) ?? [];
}

/** The names of the live Connections, in storage order. */
function namesOf(storage: Map<string, unknown>): string[] {
  return connectionsOf(storage).map((connection) => connection.name);
}

const MINUTE_MS = 60_000;
/** The fake clock every Connections test starts at. */
const START = Date.UTC(2026, 9, 20, 9, 0, 0);

/**
 * Takes over the clock and the Connections' own timers. The port's macrotasks
 * stay real, so a write the assertions wait on can land without moving the
 * clock they measure (`vi.waitFor` would advance it).
 */
function freezeClock(at: number): void {
  vi.useFakeTimers({
    now: at,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
}

/** Waits until the Plugin's storage write lands, yielding a real macrotask per turn. */
async function untilWritten(check: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100 && !check(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!check()) throw new Error("The Plugin's storage write did not land");
}

describe("MCP Server Connections", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a Connection named by the legacy initialize handshake", async () => {
    const { host, storage, key } = await connect();
    try {
      freezeClock(START);
      const answer = await mcpRequest(host, key, initializeFrom("Claude Code"));
      expect(answer.status).toBe(200);
      await untilWritten(() => connectionsOf(storage).length === 1);
      expect(connectionsOf(storage)).toEqual([
        { name: "Claude Code", startedAt: START, lastActivityAt: START },
      ]);
    } finally {
      host.stop();
    }
  });

  it("opens a Connection named by a modern request's clientInfo meta", async () => {
    const { host, storage, key } = await connect();
    try {
      freezeClock(START);
      const answer = await mcpRequest(
        host,
        key,
        discoverFrom("Codex"),
        modernHeaders("server/discover")
      );
      expect(answer.status).toBe(200);
      await untilWritten(() => connectionsOf(storage).length === 1);
      expect(connectionsOf(storage)).toEqual([
        { name: "Codex", startedAt: START, lastActivityAt: START },
      ]);
    } finally {
      host.stop();
    }
  });

  it("ends a Connection after ten minutes without a request", async () => {
    const { host, storage, key } = await connect();
    try {
      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await untilWritten(() => namesOf(storage).length === 1);
      await vi.advanceTimersByTimeAsync(10 * MINUTE_MS - 1_000);
      expect(namesOf(storage)).toEqual(["Claude Code"]);
      await vi.advanceTimersByTimeAsync(1_001);
      await untilWritten(() => connectionsOf(storage).length === 0);
    } finally {
      host.stop();
    }
  });

  it("restarts the idle timer on every request", async () => {
    const { host, storage, key } = await connect();
    try {
      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await untilWritten(() => namesOf(storage).length === 1);
      await vi.advanceTimersByTimeAsync(9 * MINUTE_MS);
      await mcpRequest(host, key, toolsListBody());
      await untilWritten(() => connectionsOf(storage).length === 1);
      expect(connectionsOf(storage)).toEqual([
        { name: "Claude Code", startedAt: START, lastActivityAt: START + 9 * MINUTE_MS },
      ]);
      await vi.advanceTimersByTimeAsync(9 * MINUTE_MS + 59_000);
      expect(namesOf(storage)).toEqual(["Claude Code"]);
      await vi.advanceTimersByTimeAsync(1_001);
      await untilWritten(() => connectionsOf(storage).length === 0);
    } finally {
      host.stop();
    }
  });

  it("shares one Connection between two Agents reporting the same name, and ends it once", async () => {
    const { host, storage, key } = await connect();
    try {
      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Codex", 1));
      await untilWritten(() => namesOf(storage).length === 1);
      await vi.advanceTimersByTimeAsync(2 * MINUTE_MS);
      await mcpRequest(host, key, initializeFrom("Codex", 2));
      await untilWritten(() => connectionsOf(storage)[0]?.lastActivityAt === START + 2 * MINUTE_MS);
      expect(connectionsOf(storage)).toEqual([
        { name: "Codex", startedAt: START, lastActivityAt: START + 2 * MINUTE_MS },
      ]);
      await vi.advanceTimersByTimeAsync(10 * MINUTE_MS - 1);
      expect(namesOf(storage)).toEqual(["Codex"]);
      await vi.advanceTimersByTimeAsync(2);
      await untilWritten(() => connectionsOf(storage).length === 0);
    } finally {
      host.stop();
    }
  });

  it("opens no Connection for a refused request", async () => {
    const { host, storage } = await connect();
    try {
      freezeClock(START);
      // The start's own empty list lands first, so the assertion below is about
      // what the refused request did, not about the write it raced.
      await untilWritten(() => storage.has("connections"));
      const refused = await mcpRequest(host, "0".repeat(64), initializeFrom("Mallory"));
      expect(refused.status).toBe(401);
      expect(connectionsOf(storage)).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("keeps the initialize's Connection alive on a legacy follow-up without a name", async () => {
    const { host, storage, key } = await connect();
    try {
      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await untilWritten(() => namesOf(storage).length === 1);
      await vi.advanceTimersByTimeAsync(9 * MINUTE_MS);
      const followUp = await mcpRequest(host, key, toolsListBody());
      expect(followUp.status).toBe(200);
      await untilWritten(() => connectionsOf(storage).length === 1);
      expect(connectionsOf(storage)).toEqual([
        { name: "Claude Code", startedAt: START, lastActivityAt: START + 9 * MINUTE_MS },
      ]);
      await vi.advanceTimersByTimeAsync(9 * MINUTE_MS + 59_000);
      expect(namesOf(storage)).toEqual(["Claude Code"]);
      await vi.advanceTimersByTimeAsync(1_001);
      await untilWritten(() => connectionsOf(storage).length === 0);
    } finally {
      host.stop();
    }
  });

  it("credits a legacy follow-up to no Connection once the initialize's one has ended", async () => {
    const { host, storage, key } = await connect();
    try {
      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await untilWritten(() => namesOf(storage).length === 1);
      await vi.advanceTimersByTimeAsync(10 * MINUTE_MS + 1_000);
      await untilWritten(() => connectionsOf(storage).length === 0);
      await mcpRequest(host, key, toolsListBody());
      expect(connectionsOf(storage)).toEqual([]);
    } finally {
      host.stop();
    }
  });
});

/** The Agent's legacy `tools/call` body. */
function toolsCallBody(name: string, args: unknown, id: unknown = 2) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function readOnlyBook() {
  return {
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
  };
}

function readOnlyChapter(html = "<p>Alpha body.</p>") {
  return {
    id: "chapteralpha",
    bookId: "bookalpha1",
    title: "Chapter chapteralpha",
    order: 1,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount: 10,
    status: "draft" as const,
    updatedAt: Date.UTC(2026, 0, 1),
    content: { html, text: "Alpha body." },
  };
}

function readOnlyLibrary() {
  return { books: [readOnlyBook()], chapters: [readOnlyChapter()] } as any;
}

/** Whether the Agent sees a refusal: a tool error result, or a JSON-RPC error. */
function refused(answer: McpAnswer): boolean {
  return answer.json?.result?.isError === true || answer.json?.error !== undefined;
}

describe("MCP Server read-only mode", () => {
  it("drops the write tools when library:write is revoked and brings them back on re-grant", async () => {
    const { host, key } = await connect();
    try {
      const full = await mcpRequest(host, key, toolsListBody());
      expect(full.json.result.tools.map((tool: any) => tool.name)).toEqual([
        "list_books",
        "get_book",
        "read_chapter",
        "list_notes",
        "read_note",
        "edit_chapter",
        "write_chapter",
        "manage_chapter",
      ]);

      host.setGranted(["serve", "library:read"]);
      await vi.waitFor(async () => {
        const readonly = await mcpRequest(host, key, toolsListBody(3));
        expect(readonly.json.result.tools.map((tool: any) => tool.name)).toEqual([
          "list_books",
          "get_book",
          "read_chapter",
          "list_notes",
          "read_note",
        ]);
      });

      host.setGranted(["serve", "library:read", "library:write"]);
      await vi.waitFor(async () => {
        const back = await mcpRequest(host, key, toolsListBody(4));
        expect(back.json.result.tools.map((tool: any) => tool.name)).toEqual([
          "list_books",
          "get_book",
          "read_chapter",
          "list_notes",
          "read_note",
          "edit_chapter",
          "write_chapter",
          "manage_chapter",
        ]);
      });
    } finally {
      host.stop();
    }
  });

  it("refuses a write tool call while read-only, leaving the Chapter and history alone", async () => {
    const library = readOnlyLibrary();
    const { host, key } = await connect({ library });
    try {
      host.setGranted(["serve", "library:read"]);
      await vi.waitFor(async () => {
        const listed = await mcpRequest(host, key, toolsListBody(3));
        expect(listed.json.result.tools.map((tool: any) => tool.name)).toEqual([
          "list_books",
          "get_book",
          "read_chapter",
          "list_notes",
          "read_note",
        ]);
      });

      const answer = await mcpRequest(
        host,
        key,
        toolsCallBody("edit_chapter", { chapter: "chapteralpha", append: "More." }, 4)
      );
      // The tool is not listed, so the SDK refuses the call as an unknown tool.
      expect(answer.json).toEqual({
        jsonrpc: "2.0",
        id: 4,
        error: { code: -32602, message: "Tool edit_chapter not found" },
      });
      expect(library.chapters[0].content.html).toBe("<p>Alpha body.</p>");
      expect(host.checkpoints).toEqual([]);

      // The read tools keep working while read-only.
      const reread = await mcpRequest(
        host,
        key,
        toolsCallBody("read_chapter", { chapter: "chapteralpha" }, 5)
      );
      expect(refused(reread)).toBe(false);
      const blocks = reread.json.result.content.map((block: any) => block.text).join("\n");
      expect(blocks).toContain("Alpha body.");
    } finally {
      host.stop();
    }
  });

  it("refuses the write when a revoke races the call, changing nothing", async () => {
    const library = readOnlyLibrary();
    const { host, key } = await connect({ library });
    try {
      // The call reaches the Plugin while it still lists the write tools; the
      // revoke lands before its Library writes do. The Plugin processes the
      // delivered revoke before it builds the call's server, so the SDK
      // refuses the call as an unknown tool; the read-only text covers the
      // narrower window where the host itself refuses the write (see the
      // `libraryCall` and `edit_chapter` race tests).
      const pending = mcpRequest(
        host,
        key,
        toolsCallBody("edit_chapter", { chapter: "chapteralpha", append: "More." }, 2)
      );
      host.setGranted(["serve", "library:read"]);
      const answer = await pending;
      expect(answer.json).toEqual({
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32602, message: "Tool edit_chapter not found" },
      });
      expect(library.chapters[0].content.html).toBe("<p>Alpha body.</p>");
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("advertises listChanged and signals the tool-list change on a listen stream", async () => {
    const { host, key } = await connect();
    try {
      // Both eras advertise the listChanged capability the listen stream needs.
      const initialized = await mcpRequest(host, key, initializeBody());
      expect(initialized.json.result.capabilities).toEqual({ tools: { listChanged: true } });
      const discovered = await mcpRequest(
        host,
        key,
        discoverBody(),
        modernHeaders("server/discover")
      );
      expect(discovered.json.result.capabilities).toEqual({ tools: { listChanged: true } });

      // A modern Agent opens a subscriptions/listen stream for tool-list changes.
      const stream = host.endpointStream({
        method: "POST",
        path: "/mcp",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${key}`,
          ...modernHeaders("subscriptions/listen"),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 10,
          method: "subscriptions/listen",
          params: modernParams({ notifications: { toolsListChanged: true } }),
        }),
      });
      const head = await stream.head;
      expect(head.status).toBe(200);
      // The acknowledged filter honors the tool-list change ...
      await expect(
        stream.waitForText("notifications/subscriptions/acknowledged")
      ).resolves.toContain("notifications/subscriptions/acknowledged");
      await stream.waitForText('"toolsListChanged":true');
      // ... but no change has been signalled yet.
      expect(stream.text()).not.toContain("notifications/tools/list_changed");

      // Revoking the write Permission drops the write tools and signals it.
      host.setGranted(["serve", "library:read"]);
      await stream.waitForText("notifications/tools/list_changed");
      stream.close();
    } finally {
      host.stop();
    }
  });
});
