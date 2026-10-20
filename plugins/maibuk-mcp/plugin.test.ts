/**
 * The MCP Server's Plugin-level behavior through the supported Plugin test
 * kit: the real broker and method table over an in-process channel, driven
 * only through the Plugin Endpoint the way an Agent reaches it. Every test
 * asserts what the Agent sees (status, headers, JSON-RPC result); no test
 * imports Plugin internals other than `startMcp` (through `test-support`)
 * and `SERVER_INSTRUCTIONS`.
 */

import { describe, expect, it } from "vitest";
import { SERVER_INSTRUCTIONS } from "./server";
import {
  answerHeader,
  connect,
  mcpRequest,
  modernHeaders,
  modernParams,
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

/** The tools/list result the Agent sees, as name/annotation pairs. */
function gateOf(answer: McpAnswer) {
  return answer.json.result.tools.map((tool: any) => ({
    name: tool.name,
    annotations: tool.annotations,
  }));
}

describe("MCP Server protocol", () => {
  it("answers the legacy initialize handshake with the server name and instructions", async () => {
    const { host, key } = await connect();
    try {
      const answer = await mcpRequest(host, key, initializeBody());
      expect(answer.status).toBe(200);
      expect(answer.json.result.serverInfo.name).toBe("maibuk");
      expect(answer.json.result.instructions).toBe(SERVER_INSTRUCTIONS);
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
      ]);
    } finally {
      host.stop();
    }
  });

  it("answers a modern server/discover request with versions, instructions, and cache hints", async () => {
    const { host, key } = await connect();
    try {
      const answer = await mcpRequest(host, key, discoverBody(), modernHeaders("server/discover"));
      expect(answer.status).toBe(200);
      expect(answer.json.result.supportedVersions).toContain("2026-07-28");
      expect(answer.json.result.instructions).toBe(SERVER_INSTRUCTIONS);
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

  it("keeps the server instructions under 500 characters", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(500);
  });

  it("advertises exactly list_books then get_book, both read-only", async () => {
    const { host, key } = await connect();
    try {
      const answer = await mcpRequest(host, key, toolsListBody());
      expect(answer.status).toBe(200);
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
