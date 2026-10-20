/**
 * The MCP Server runtime (Built-in Plugin). `startMcp` answers the Plugin
 * Endpoint with the MCP SDK: one fresh MCP server per request on
 * `/plugin/maibuk-mcp/mcp`, behind the Connection's Key and the Tutorial
 * refusal. Tool behavior lives in `./server`; this module owns only the
 * request path (path, Key, Tutorial, SDK bridging).
 */

import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import {
  type PluginClient,
  type PluginEndpointAnswer,
  type PluginEndpointRequest,
} from "@/plugin-sdk";
import { buildMcpServer } from "./server";

/** The storage key holding the Connection's Key. */
const KEY_STORAGE_KEY = "key";

/** The only Plugin Endpoint path this Plugin answers; anything else is a 404. */
const MCP_PATH = "/plugin/maibuk-mcp/mcp";

/** The 401 body sentence: the Key is missing or old, and where to copy a new one. */
const KEY_REFUSED_MESSAGE =
  "The Key is missing or old; copy the setup snippet from the MCP Server page again.";

/** The 503 body sentence: the Library is unavailable while the Tutorial runs. */
const LIBRARY_UNAVAILABLE_MESSAGE =
  "The Library is unavailable while the Tutorial runs; try again when it ends.";

/** Makes a fresh Key: 32 random bytes, hex-encoded to 64 characters. */
function makeKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether a Plugin API failure refuses with `library-unavailable`. */
function isLibraryUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "library-unavailable"
  );
}

/**
 * Reads the stored Key, making one first when the Plugin was just turned on
 * (`enable`) or none is stored yet. Requests that arrive before the Key
 * exists wait on the returned promise; a Tutorial running at startup leaves
 * the Key for the per-request probe to refuse.
 */
async function ensureKey(client: PluginClient): Promise<void> {
  // The host posts its init message before any other host message, but the
  // SDK exposes it asynchronously; wait briefly so a fresh `enable` still
  // rotates the Key instead of keeping a stale one.
  for (let attempt = 0; attempt < 20 && client.activation === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  let stored: unknown;
  try {
    stored = await client.storage.get({ key: KEY_STORAGE_KEY });
  } catch (error) {
    if (!isLibraryUnavailable(error)) throw error;
  }
  if (client.activation?.startReason === "enable" || typeof stored !== "string" || stored === "") {
    const fresh = makeKey();
    try {
      await client.storage.set({ key: KEY_STORAGE_KEY, value: fresh });
    } catch (error) {
      if (!isLibraryUnavailable(error)) throw error;
    }
  }
}

/** The Bearer Key the Agent sent, or null when the header is missing or malformed. */
function bearerKey(request: PluginEndpointRequest): string | null {
  for (const [name, value] of request.headers) {
    if (name.toLowerCase() !== "authorization") continue;
    const prefix = "Bearer ";
    if (!value.startsWith(prefix)) return null;
    return value.slice(prefix.length);
  }
  return null;
}

/** The 401 answer for a missing or old Key. */
function keyRefusal(): PluginEndpointAnswer {
  return {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer", "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: KEY_REFUSED_MESSAGE },
    }),
  };
}

/** The 503 answer while the Library is unavailable. */
function tutorialRefusal(): PluginEndpointAnswer {
  return {
    status: 503,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: LIBRARY_UNAVAILABLE_MESSAGE },
    }),
  };
}

/** Converts one Plugin Endpoint request into a web Request for the MCP SDK. */
function toWebRequest(request: PluginEndpointRequest): Request {
  const headers = new Headers();
  for (const [name, value] of request.headers) headers.append(name, value);
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body.length > 0) {
    init.body = request.text();
  }
  return new Request(`http://127.0.0.1${request.path}`, init);
}

/** Converts the SDK's web Response back into a Plugin Endpoint answer. */
async function fromWebResponse(response: Response): Promise<PluginEndpointAnswer> {
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => {
    headers.push([name, value]);
  });
  return { status: response.status, headers, body: new Uint8Array(await response.arrayBuffer()) };
}

/**
 * Starts the MCP Server on the Plugin Endpoint. One fresh MCP server answers
 * every request through the SDK handler, which serves both the legacy
 * `initialize` era and the modern 2026-07-28 era.
 *
 * Each request runs the same order: path (anything but the `/mcp` path is a
 * 404), the stored Key (missing or old is a 401), then the Tutorial (503).
 * The Key check runs before the Tutorial check, so a missing Key is refused
 * even while the Library is available; when the Library is unavailable the
 * stored Key cannot be read, and the Tutorial refusal is answered instead.
 */
export function startMcp(client: PluginClient): void {
  // One factory for both eras, so the two can never drift apart.
  const handler: McpHttpHandler = createMcpHandler(() => buildMcpServer(), {
    legacy: "stateless",
  });
  // The Tutorial flips availability through this event; a refusal from any
  // library call flips it too (see the per-request probe below).
  let libraryAvailable = true;
  void client
    .on("library.availabilityChanged", (payload) => {
      libraryAvailable = payload.available;
    })
    .catch(() => {
      // No subscription (denied or stopped): the per-request probe still
      // notices the Tutorial, so startup continues without it.
    });
  // Requests that arrive before the Key exists wait for it here.
  const ready = ensureKey(client);

  client.onEndpointRequest(async (request: PluginEndpointRequest) => {
    await ready;
    const pathname = request.path.split("?", 1)[0];
    if (pathname !== MCP_PATH) {
      return { status: 404, headers: { "content-type": "text/plain" }, body: "Not found" };
    }
    let stored: unknown;
    try {
      stored = await client.storage.get({ key: KEY_STORAGE_KEY });
      // Storage answered, so the Library is available again.
      libraryAvailable = true;
    } catch (error) {
      // The stored Key is unreadable while the Library is unavailable.
      if (!isLibraryUnavailable(error)) throw error;
      libraryAvailable = false;
      return tutorialRefusal();
    }
    if (typeof stored !== "string" || stored === "" || bearerKey(request) !== stored) {
      return keyRefusal();
    }
    if (!libraryAvailable) {
      return tutorialRefusal();
    }
    return fromWebResponse(await handler.fetch(toWebRequest(request)));
  });
}
