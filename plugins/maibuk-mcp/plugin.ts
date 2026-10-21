/**
 * The MCP Server runtime (Built-in Plugin). `startMcp` answers the Plugin
 * Endpoint with the MCP SDK: one fresh MCP server per request on
 * `/plugin/maibuk-mcp/mcp`, behind the Connection's Key and the Tutorial
 * refusal. It also serves the MCP Server page and answers its Commands in the
 * same Worker. Tool behavior lives in `./server`; this module owns the request
 * path (path, Key, Connections, Tutorial, SDK bridging) and the Command
 * handlers the page and the page's Commands share.
 */

import type { ComponentType } from "react";
import {
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  type McpHttpHandler,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  type HostRequestHandler,
  type PluginClient,
  type PluginEndpointAnswer,
  type PluginEndpointRequest,
} from "@/plugin-sdk";
import { recordActivity, startActivityLog, type ActivityRecorder } from "./activity";
import { isLibraryUnavailable, LIBRARY_UNAVAILABLE_TEXT } from "./books";
import type { WriteGuard } from "./edits";
import { errorResult, isWritePermissionDenied, readOnlyResult } from "./library";
import { publishConnections, type ConnectionRecord } from "./live";
import {
  CONNECT_PAGE_ID,
  createConnectPage,
  createConnectStore,
} from "./page";
import { buildMcpServer } from "./server";
import { mcpUrl, snippet, type SnippetKind } from "./snippets";

/** The storage key holding the Connection's Key. */
const KEY_STORAGE_KEY = "key";

/** The storage key holding the live Connections. */
const CONNECTIONS_STORAGE_KEY = "connections";

/** How long a Connection stays live without a request, and then ends. */
export const CONNECTION_IDLE_MS = 600_000;

/**
 * How far a live Connection's stored `lastActivityAt` may fall behind its
 * latest request before storage is rewritten. A start and an end write at
 * once; activity is throttled to stay under the broker's call rate. The
 * Activity log writes on the same window (see `./activity`).
 */
export const CONNECTION_WRITE_MS = 60_000;

/** The only Plugin Endpoint path this Plugin answers; anything else is a 404. */
const MCP_PATH = "/plugin/maibuk-mcp/mcp";

/** The Command-local ids the manifest declares. */
export const OPEN_CONNECT = "openConnect";
export const NEW_KEY = "newKey";
export const COPY_CLAUDE_CODE = "copyClaudeCode";
export const COPY_CODEX = "copyCodex";
export const COPY_OPEN_CODE = "copyOpenCode";
export const COPY_CURSOR = "copyCursor";

/** The Agent each copy Command copies a snippet for. */
export const COPY_COMMAND_SNIPPETS: Readonly<Record<string, SnippetKind>> = {
  [COPY_CLAUDE_CODE]: "claudeCode",
  [COPY_CODEX]: "codex",
  [COPY_OPEN_CODE]: "openCode",
  [COPY_CURSOR]: "cursor",
};

/**
 * The host's Remote UI entry (`servePluginUi`), Worker or test. The two SDK
 * entries share this shape, so the runtime takes whichever the caller supplies.
 */
export type McpServe = (
  client: Pick<PluginClient, "onHostRequest">,
  options: {
    pages: Record<string, ComponentType>;
    onHostRequest?: HostRequestHandler;
  }
) => void;

/**
 * The internal header carrying one request's resolved Connection name to the
 * MCP server factory. A legacy `tools/call` carries no client info itself
 * (only the `initialize` does; later requests borrow its name), so the tool
 * handlers cannot read the Connection from the SDK's request context on both
 * eras. Instead the entry resolves the name once per request — reusing the
 * borrowed-name logic below — and stamps it here; the factory (which the SDK
 * invokes once per HTTP request on both the modern and the legacy legs, with
 * the request attached) reads it back and binds the write tools' guard to
 * that Connection. Because the binding rides the per-request factory call and
 * never the handler's lifetime, it keeps working when `createMcpHandler` is
 * hoisted to module scope as one long-lived handler.
 */
const CALLER_HEADER = "x-maibuk-caller";

/** The 401 body sentence: the Key is missing or old, and where to copy a new one. */
const KEY_REFUSED_MESSAGE =
  "The Key is missing or old; copy the setup snippet from the MCP Server page again.";

/** Makes a fresh Key: 32 random bytes, hex-encoded to 64 characters. */
function makeKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Makes a fresh Key and stores it; a Library failure leaves it for the next
 * request. Returns the Key when it was stored, or null while the Library is
 * unavailable (the Tutorial), so the page never shows a Key an Agent cannot use.
 */
async function storeFreshKey(client: PluginClient): Promise<string | null> {
  const fresh = makeKey();
  try {
    await client.storage.set({ key: KEY_STORAGE_KEY, value: fresh });
  } catch (error) {
    if (!isLibraryUnavailable(error)) throw error;
    return null;
  }
  return fresh;
}

/**
 * Reads the stored Key, making one first when the Plugin was just turned on
 * (`enable`) or none is stored yet. Returns the Key now in storage, or null
 * while the Library is unavailable (the Tutorial), so the page knows when there
 * is one to show. Requests that arrive before the Key exists wait on the
 * returned promise; a Tutorial running at startup leaves the Key for the
 * per-request probe to make.
 */
async function ensureKey(client: PluginClient): Promise<string | null> {
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
    return null;
  }
  if (client.activation?.startReason === "enable" || typeof stored !== "string" || stored === "") {
    return storeFreshKey(client);
  }
  return stored;
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

/**
 * Whether the Agent's Key is the stored one. The comparison runs in constant
 * time (a length check, then an XOR over every character code) so the timing
 * of a refusal reveals nothing about how much of the Key matched.
 */
function keysMatch(candidate: string | null, stored: string): boolean {
  if (candidate === null || candidate.length !== stored.length) return false;
  let difference = 0;
  for (let index = 0; index < stored.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ stored.charCodeAt(index);
  }
  return difference === 0;
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
      error: { code: -32603, message: LIBRARY_UNAVAILABLE_TEXT },
    }),
  };
}

/** Converts one Plugin Endpoint request into a web Request for the MCP SDK. */
function toWebRequest(request: PluginEndpointRequest, caller: string | null): Request {
  const headers = new Headers();
  for (const [name, value] of request.headers) headers.append(name, value);
  // The factory reads the resolved Connection off this header (see
  // `CALLER_HEADER`): an Agent's own header of that name is dropped first, so
  // only the entry's resolution reaches the tools.
  headers.delete(CALLER_HEADER);
  if (caller !== null) headers.set(CALLER_HEADER, caller);
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body.length > 0) {
    init.body = request.text();
  }
  return new Request(`http://127.0.0.1${request.path}`, init);
}

/**
 * Converts the SDK's web Response back into a Plugin Endpoint answer. The body
 * streams chunk by chunk instead of buffering: a `subscriptions/listen` answer
 * is a long-lived SSE stream that never ends on its own, so buffering it with
 * `arrayBuffer()` would hang the request until the Agent hangs up. A bodyless
 * response (a bare 202, a 405) stays bodyless. Headers and status pass through
 * unchanged, so the existing answers keep their shape.
 */
function fromWebResponse(response: Response): PluginEndpointAnswer {
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => {
    headers.push([name, value]);
  });
  if (response.body === null) return { status: response.status, headers };
  return { status: response.status, headers, body: streamBody(response.body) };
}

/**
 * Reads one web body chunk by chunk as the Plugin Endpoint's streamed body.
 * The reader releases its lock when the stream ends or errors, so a cancelled
 * listen stream never holds the SDK's response open.
 */
async function* streamBody(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** A live Connection: its stored record plus what tracking needs. */
interface Connection extends ConnectionRecord {
  /** The `lastActivityAt` the last write attempt carried, for the throttle. */
  writtenAt: number;
  /** The idle timer that ends this Connection. */
  timer: ReturnType<typeof setTimeout> | null;
}

/** What one request body says about its Agent. */
interface Caller {
  /** The self-reported name, or null when the body names no Agent. */
  name: string | null;
  /** A legacy `initialize`: it opens the Connection later legacy requests borrow. */
  initialize: boolean;
  /** Whether the request is legacy-era, where a request without a name may borrow one. */
  legacy: boolean;
}

/** Whether a parsed JSON value is an object (and not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-blank `name` on a `{ name }` object, or null. */
function reportedName(value: unknown): string | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const name = value.name.trim();
  return name === "" ? null : name;
}

/**
 * Reads the Agent's self-reported name from one request body. The body is
 * parsed once here, before the SDK sees it, so both eras name their Connection
 * the same way: a legacy `initialize` carries `params.clientInfo`, a modern
 * request carries it under `_meta`; a batch or an unparsable body names none.
 */
function readCaller(body: string): Caller | null {
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(message)) return null;
  const params = isRecord(message.params) ? message.params : {};
  const meta = isRecord(params._meta) ? params._meta : null;
  const name =
    reportedName(params.clientInfo) ??
    (meta === null ? null : reportedName(meta[CLIENT_INFO_META_KEY]));
  return { name, initialize: message.method === "initialize", legacy: meta === null };
}

/**
 * Tracks the live Connections: one per Agent name, published in Plugin storage
 * so the MCP Server page can show who is connected, and ended after
 * `CONNECTION_IDLE_MS` without a request. Two Agents reporting the same name
 * at once share one Connection.
 *
 * Each Connection also remembers which Books it already checkpointed (#591):
 * the write tools take one Checkpoint per Book per Connection, and the memory
 * goes when the Connection ends, so a new Connection checkpoints again.
 * Requests that name no Agent share one separate memory instead, keyed by no
 * name at all: it is not a Connection, so it never reaches the live list or
 * storage, and it is cleared after the same idle time without a nameless
 * request, so a nameless Agent does not fill the Version history either.
 */
function createConnections(client: PluginClient): {
  count: (caller: Caller | null) => void;
  /** The Connection one request belongs to, with the legacy borrow applied. */
  resolve: (caller: Caller | null) => string | null;
  /** Whether the Connection (or the nameless memory) still owes the Book a Checkpoint. */
  needsCheckpoint: (name: string | null, bookId: string) => boolean;
  /** Remembers the Book checkpointed, whether the host took one or not. */
  markCheckpointed: (name: string | null, bookId: string) => void;
  /** Ends every live Connection at once: a new Key cut off the Agents they named. */
  endAll: () => void;
} {
  const live = new Map<string, Connection>();
  /** The name of the Connection the most recent legacy `initialize` opened. */
  let borrowed: string | null = null;
  /** The Books each live Connection already checkpointed, by Connection name. */
  const checkpointed = new Map<string, Set<string>>();
  /**
   * The Books the nameless requests already checkpointed. A private set, not a
   * Connection name an Agent could report; the idle timer below clears it.
   */
  const anonymousCheckpointed = new Set<string>();
  /** The idle timer that clears the nameless memory. */
  let anonymousTimer: ReturnType<typeof setTimeout> | null = null;
  // Writes queue behind each other, so storage always ends on the latest list.
  let writes: Promise<unknown> = Promise.resolve();

  /** The live Connections, sorted by name, as storage holds them. */
  function records(): ConnectionRecord[] {
    return [...live.values()]
      .map(({ name, startedAt, lastActivityAt }) => ({ name, startedAt, lastActivityAt }))
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  }

  /**
   * Stores the current list, and moves the activity throttle forward so a
   * burst of requests writes once per `CONNECTION_WRITE_MS`, not once per
   * request. A failed write (the Tutorial) is repeated by the next one.
   */
  function write(): void {
    const value = records();
    publishConnections(value);
    for (const connection of live.values()) connection.writtenAt = connection.lastActivityAt;
    writes = writes
      .then(() => client.storage.set({ key: CONNECTIONS_STORAGE_KEY, value }))
      .catch(() => {
        // The Library is unavailable (the Tutorial): the next write repeats the list.
      });
  }

  /** Ends one Connection: its idle timer ran out, so it leaves the list. */
  function end(name: string): void {
    const connection = live.get(name);
    if (connection === undefined) return;
    if (connection.timer !== null) clearTimeout(connection.timer);
    live.delete(name);
    checkpointed.delete(name);
    if (borrowed === name) borrowed = null;
    write();
  }

  /** Restarts a Connection's idle timer from now. */
  function arm(connection: Connection): void {
    if (connection.timer !== null) clearTimeout(connection.timer);
    connection.timer = setTimeout(() => end(connection.name), CONNECTION_IDLE_MS);
  }

  /**
   * Ends every live Connection at once. A new Key makes every Agent holding the
   * old one unable to reach the Plugin, so their Connections leave the list at
   * the same moment: each idle timer is cleared, each Connection's Checkpoint
   * memory is dropped with it, and the now-empty list is published and stored,
   * so the page and its indicator stop showing Agents the old Key cut off.
   */
  function endAll(): void {
    for (const connection of live.values()) {
      if (connection.timer !== null) clearTimeout(connection.timer);
    }
    live.clear();
    checkpointed.clear();
    borrowed = null;
    write();
  }

  /**
   * Restarts the nameless memory's idle timer from now: the books it holds are
   * forgotten once no request without a name arrives for `CONNECTION_IDLE_MS`,
   * the same window a named Connection lasts.
   */
  function armAnonymous(): void {
    if (anonymousTimer !== null) clearTimeout(anonymousTimer);
    anonymousTimer = setTimeout(() => {
      anonymousTimer = null;
      anonymousCheckpointed.clear();
    }, CONNECTION_IDLE_MS);
  }

  /** Counts one request: opens its Connection, or moves the one it shares. */
  function touch(name: string): void {
    const now = Date.now();
    const connection = live.get(name);
    if (connection === undefined) {
      const started: Connection = {
        name,
        startedAt: now,
        lastActivityAt: now,
        writtenAt: now,
        timer: null,
      };
      live.set(name, started);
      arm(started);
      write();
      return;
    }
    connection.lastActivityAt = now;
    arm(connection);
    if (now - connection.writtenAt >= CONNECTION_WRITE_MS) write();
    else publishConnections(records());
  }

  // No Connection survives a restart: the first write replaces the old list.
  write();

  // A legacy request after `initialize` names no Agent: it is credited to
  // the Connection that initialize opened, while that one is still live.
  function resolve(caller: Caller | null): string | null {
    if (caller === null) return null;
    return (
      caller.name ?? (caller.legacy && borrowed !== null && live.has(borrowed) ? borrowed : null)
    );
  }

  return {
    resolve,
    endAll,
    count(caller: Caller | null): void {
      if (caller === null) return;
      const name = resolve(caller);
      // A nameless request shares the anonymous memory instead of a
      // Connection: it keeps that memory alive, but appears nowhere.
      if (name === null) {
        armAnonymous();
        return;
      }
      if (caller.initialize) borrowed = name;
      touch(name);
    },
    needsCheckpoint(name: string | null, bookId: string): boolean {
      if (name === null) return !anonymousCheckpointed.has(bookId);
      return !checkpointed.get(name)?.has(bookId);
    },
    markCheckpointed(name: string | null, bookId: string): void {
      if (name === null) {
        anonymousCheckpointed.add(bookId);
        return;
      }
      // The Connection may have ended while the Checkpoint call was in
      // flight; its memory went with it, so nothing is remembered for it.
      if (!live.has(name)) return;
      const books = checkpointed.get(name);
      if (books === undefined) checkpointed.set(name, new Set([bookId]));
      else books.add(bookId);
    },
  };
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
 * Only a request that passes both refusals counts toward a Connection.
 */
export function startMcp(client: PluginClient, serve?: McpServe): void {
  const connections = createConnections(client);
  // The page's Key and address; the runtime fills it so the snippets repaint.
  const connect = createConnectStore();

  /**
   * The write tools' guard for one request's Connection (#591): the first
   * write to a Book takes a Checkpoint named after the Agent, later writes in
   * the same Connection skip it, and a failed Checkpoint refuses the write.
   * A request that named no Agent shares the anonymous memory instead, so
   * those requests also take one Checkpoint per Book, not one per write.
   *
   * A `library:write` `permission-denied` is a revoke that raced the call
   * (the tool was listed, but the host refused the Checkpoint): it answers
   * the read-only refusal, never the generic Checkpoint failure, so the Agent
   * learns the Plugin is read-only instead of retrying a doomed write.
   */
  function writeGuardFor(caller: string | null): WriteGuard {
    const agentName = caller ?? "an Agent";
    return {
      async ensureCheckpoint(bookId: string) {
        if (!connections.needsCheckpoint(caller, bookId)) return null;
        try {
          await client.library.books.checkpoint({ bookId, label: `Before ${agentName} edits` });
        } catch (error) {
          if (isLibraryUnavailable(error)) throw error;
          if (isWritePermissionDenied(error)) return readOnlyResult();
          return errorResult(
            "Could not take a Checkpoint of the Book before writing, so nothing changed; try again."
          );
        }
        // The Book is done whether the host took a Version or reported null
        // (unchanged since its last one).
        connections.markCheckpointed(caller, bookId);
        return null;
      },
    };
  }

  /** The Connection name the factory's request carries, or null when nameless. */
  function callerOf(context: McpRequestContext): string | null {
    const name = context.requestInfo?.headers.get(CALLER_HEADER)?.trim();
    return name === undefined || name === "" ? null : name;
  }

  /** The Activity recorder for one request's Connection, named when it has a name. */
  function recorderFor(agent: string | null): ActivityRecorder {
    return (call) => {
      recordActivity({ at: Date.now(), agent, ...call });
    };
  }

  // One factory for both eras, so the two can never drift apart.
  // Whether the author grants the write Plugin Permission right now: the
  // `permissions.changed` subscription below replays the current list on
  // subscribe and delivers every later change, and each request's server
  // registers the write tools only while it holds `library:write`. `null`
  // until the first delivery; the request path reads the list directly in
  // that window (see below), so the first request still serves the right set.
  let canWrite: boolean | null = null;
  // The last delivered list, so only a real change after the initial replay
  // fans out to the Agents (see the subscription below).
  let lastPermissions: readonly string[] | null = null;

  const handler: McpHttpHandler = createMcpHandler(
    (context) => {
      const caller = callerOf(context);
      return buildMcpServer(client, writeGuardFor(caller), recorderFor(caller), canWrite ?? false);
    },
    {
      legacy: "stateless",
    }
  );

  /**
   * Whether two Plugin Permission lists hold the same set, whatever their order.
   */
  function samePermissions(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((permission) => right.includes(permission));
  }

  // The write Plugin Permission is optional now (see the manifest): revoking
  // it leaves the Plugin running with only the read tools, and re-granting
  // brings the write tools back. Every delivery after the initial replay
  // publishes `notifications/tools/list_changed` to the Agents listening on a
  // modern `subscriptions/listen` stream, so they re-list instead of calling
  // a tool that is gone (or missing one that is back).
  void client
    .on("permissions.changed", (payload) => {
      const next = [...payload.permissions];
      const first = canWrite === null;
      const changed = lastPermissions === null || !samePermissions(lastPermissions, next);
      lastPermissions = next;
      canWrite = next.includes("library:write");
      if (!first && changed) handler.notify.toolsChanged();
    })
    .catch(() => {
      // No subscription (denied or stopped): each request reads the list
      // directly (see below), and the host's own `library:write` gate still
      // refuses the write with the read-only text, so nothing is lost but the
      // live list-changed signal.
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
  // Requests that arrive before the Key exists, or before the stored Activity
  // log is back in memory, wait for it here.
  const ready = Promise.all([ensureKey(client), startActivityLog(client, CONNECTION_WRITE_MS)]);
  // The page shows the Key the start made or found; a new Key replaces it. A
  // start that could store none (the Tutorial) says so instead of loading
  // forever: a Key a later request makes repaints the snippets.
  void ready
    .then(([key]) => {
      if (key !== null) connect.setKey(key);
      else connect.setKeyUnavailable();
    })
    .catch(() => {
      connect.setKeyUnavailable();
    });

  // The page shows the address the Plugin Endpoint is bound to, and refreshes
  // its snippets when a move raises `endpoint.addressChanged`. Without `serve`
  // both reads are refused; the page then shows its unavailable Status.
  void client.endpoint
    .address()
    .then(({ url }) => connect.setAddress(url))
    .catch(() => {});
  void client
    .on("endpoint.addressChanged", ({ url }) => connect.setAddress(url))
    .catch(() => {});

  /**
   * Makes a fresh Key, so the open page's snippets refresh and the old Key stops
   * working. Every live Connection ends with it: the Agents it named can no
   * longer reach the Plugin, so the page stops listing them.
   */
  async function makeNewKey(): Promise<void> {
    const fresh = await storeFreshKey(client);
    if (fresh === null) return;
    connections.endAll();
    connect.setKey(fresh);
  }

  /**
   * Copies one Agent's current snippet. The page's store holds what it shows;
   * a Command may run before the page ever opened, so an empty store reads the
   * address and Key live instead.
   */
  async function copyCurrentSnippet(kind: SnippetKind): Promise<void> {
    let { address, key } = connect.get();
    if (address === null) {
      try {
        address = (await client.endpoint.address()).url;
      } catch {
        return;
      }
    }
    if (key === null) {
      try {
        const stored = await client.storage.get({ key: KEY_STORAGE_KEY });
        if (typeof stored === "string" && stored !== "") key = stored;
      } catch {
        return;
      }
    }
    if (address === null || key === null) return;
    await client.clipboard.writeText({ text: snippet(kind, { url: mcpUrl(address), key }) });
  }

  /** Answers one Command: open the page, make a new Key, or copy a snippet. */
  async function runCommand(params: unknown): Promise<null> {
    const { id } = (params ?? {}) as { id?: string };
    if (id === OPEN_CONNECT) {
      await client.navigation.openPage({ pageId: CONNECT_PAGE_ID });
      return null;
    }
    if (id === NEW_KEY) {
      await makeNewKey();
      // The page shows the Key, so a run from the Command Palette lands there.
      await client.navigation.openPage({ pageId: CONNECT_PAGE_ID });
      return null;
    }
    const kind = id === undefined ? undefined : COPY_COMMAND_SNIPPETS[id];
    if (kind !== undefined) await copyCurrentSnippet(kind);
    return null;
  }

  function handleHostRequest(method: string, params: unknown): unknown {
    if (method === "health.check") return "pong";
    if (method === PLUGIN_COMMAND_RUN_REQUEST) return runCommand(params);
    throw new Error(`No handler for ${method}`);
  }

  // One host request handler answers the page's mount requests through the
  // supplied `serve`, then this Plugin's own health check and Commands. A test
  // that only drives the Endpoint may start this Plugin without a page.
  if (serve === undefined) {
    client.onHostRequest(handleHostRequest);
  } else {
    serve(client, {
      pages: {
        [CONNECT_PAGE_ID]: createConnectPage(client, connect, {
          makeNewKey,
          copy: copyCurrentSnippet,
        }),
      },
      onHostRequest: handleHostRequest,
    });
  }

  client.onEndpointRequest(async (request: PluginEndpointRequest) => {
    await ready;
    const pathname = request.path.split("?", 1)[0];
    if (pathname !== MCP_PATH) {
      return { status: 404, headers: { "content-type": "text/plain" }, body: "Not found" };
    }
    const body = request.text();
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
    if (typeof stored !== "string" || stored === "") {
      // The Key could not be stored at start (the Library was unavailable):
      // make one now, so the next setup snippet works, and refuse this request,
      // which cannot carry a Key made this moment.
      await makeNewKey();
      return keyRefusal();
    }
    // The page may have opened while the Library was unavailable; a stored Key
    // read here is the one its snippets should show.
    connect.setKey(stored);
    if (!keysMatch(bearerKey(request), stored)) {
      return keyRefusal();
    }
    if (!libraryAvailable) {
      return tutorialRefusal();
    }
    // Only a request that passed both refusals counts toward a Connection,
    // and only such a request carries its Connection to the write tools.
    const caller = readCaller(body);
    connections.count(caller);
    if (canWrite === null) {
      // The replayed `permissions.changed` delivery has not arrived yet (the
      // subscription is still settling): read the current list directly, so
      // the first request still serves the right tool set. A failed read
      // serves the read-only tool set until the replayed delivery arrives:
      // a read-only Plugin never lists write tools, even for one request.
      try {
        const granted = await client.permissions.granted();
        lastPermissions = [...granted.permissions];
        canWrite = granted.permissions.includes("library:write");
      } catch {
        canWrite = false;
      }
    }
    return fromWebResponse(await handler.fetch(toWebRequest(request, connections.resolve(caller))));
  });
}
