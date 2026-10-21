/**
 * Test-only helpers shared by the MCP Server suites: the Note fixtures every
 * suite serves, plus the transport helpers that drive the Plugin through the
 * same kit the tests use (`createTestHost`), start it the way the Worker entry
 * does, and post JSON-RPC to its Plugin Endpoint the way an Agent would: only
 * what the Agent sees (status, headers, JSON-RPC result) is asserted. This file is never
 * imported by the runtime: the Built-in build bundles only the entry and its
 * import graph, and the import-boundary step skips this file the way it skips
 * a `.test` file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type userEvent from "@testing-library/user-event";
import { createTestHost } from "@/features/plugins/test-kit";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import type {
  PluginManifest,
  TestHost,
  TestHostOptions,
  TestEndpointAnswer,
  TestLibrary,
} from "@/features/plugins/types";
import { createPluginClient } from "@/plugin-sdk";
import { startMcp } from "./plugin";

/** The plain Book row the shared Note fixtures sit in. */
function fixtureBook(id: string, title: string) {
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
    updatedAt: 1000,
  };
}

/** A Note row with its stored content, the shape the test kit's Library serves. */
export function makeNote(
  id: string,
  bookId: string | null,
  title = `Note ${id}`,
  content = { text: "Old body.", html: "<p>Old body.</p>" },
  updatedAt = Date.UTC(2026, 0, 1),
  tags: string[] = []
) {
  return {
    id,
    bookId,
    title,
    language: "en",
    tags,
    wordCount: 10,
    updatedAt,
    content,
  };
}

/** A Note with plain text and the one-paragraph HTML the host makes of it. */
export function noteWithBody(
  id: string,
  bookId: string | null,
  title: string,
  text: string,
  tags: string[] = []
) {
  return makeNote(id, bookId, title, { text, html: `<p>${text}</p>` }, Date.UTC(2026, 0, 1), tags);
}

/** Two Books and one Note in the first, as the Agent finds them. */
export function noteLibrary() {
  const books = [fixtureBook("bookalpha1", "The Book"), fixtureBook("bookbeta12", "Other Book")];
  const notes = [makeNote("notealpha1", "bookalpha1", "The Note")];
  return { books, notes };
}

/** A `user-event` instance, as `userEvent.setup()` returns it. */
export type User = ReturnType<typeof userEvent.setup>;

/** Tabs forward until `element` has focus, so every action is reached by keyboard. */
export async function tabTo(user: User, element: HTMLElement, max = 40): Promise<void> {
  for (let i = 0; i < max && document.activeElement !== element; i++) await user.tab();
}

/** The MCP Server manifest the build ships, parsed with the host's Built-in rules. */
export function mcpManifest(): PluginManifest {
  const result = parsePluginManifest(
    readFileSync(join(import.meta.dirname, "manifest.json"), "utf8"),
    {
      builtIn: true,
    }
  );
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

/** Options for `connect`: shared storage and the activation reason. */
export interface ConnectOptions {
  storage?: Map<string, unknown>;
  startReason?: TestHostOptions["startReason"];
  /** Resolves only with a Key different from this one (for rotation tests). */
  changedFrom?: string;
  /** Starts with the Library unavailable, the way the Tutorial leaves it. */
  libraryUnavailable?: boolean;
  /** Makes `library.books.checkpoint` reject (#591); forwarded to the test host. */
  checkpointError?: string;
  /** In-memory Library the read handlers serve. */
  library?: TestLibrary;
}

/** Waits until the Plugin has stored its Key, so the suite can send it back. */
async function waitForKey(storage: Map<string, unknown>, changedFrom?: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = storage.get("key");
    if (typeof value === "string" && value !== "" && value !== changedFrom) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("The MCP Key was not stored");
}

/**
 * Waits until a Plugin started outside `connect` (on the suite's own client,
 * so the suite can use that client before driving MCP requests) has stored
 * its Key. Lives here rather than in the suite because the fixed-wait guard
 * forbids `setTimeout` polling in test files.
 */
export function waitForStoredKey(storage: Map<string, unknown>): Promise<string> {
  return waitForKey(storage);
}

/**
 * Starts the MCP Plugin on a test host and resolves with the host and its
 * storage, without waiting for the Key: a start with the Library unavailable
 * stores none until a request asks for one.
 */
export function startHost(options: ConnectOptions = {}): {
  host: TestHost;
  storage: Map<string, unknown>;
} {
  const storage = options.storage ?? new Map<string, unknown>();
  const host = createTestHost({
    manifest: mcpManifest(),
    ...(options.startReason !== undefined ? { startReason: options.startReason } : {}),
    storage,
    ...(options.library !== undefined ? { library: options.library } : {}),
    ...(options.checkpointError ? { checkpointError: options.checkpointError } : {}),
  });
  if (options.libraryUnavailable === true) host.setLibraryAvailable(false);
  startMcp(createPluginClient(host.port));
  return { host, storage };
}

/** Starts the MCP Plugin on a test host and resolves with the host and its Key. */
export async function connect(options: ConnectOptions = {}): Promise<{
  host: TestHost;
  storage: Map<string, unknown>;
  key: string;
}> {
  const { host, storage } = startHost(options);
  return { host, storage, key: await waitForKey(storage, options.changedFrom) };
}

/** One answered Plugin Endpoint request, with the body parsed as the Agent sees it. */
export interface McpAnswer {
  status: number;
  headers: [string, string][];
  text: string;
  json: any;
}

/** Parses an MCP answer body: plain JSON, or the SDK's SSE stream framing it. */
function parseMcpBody(text: string): any {
  const frames = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"));
  const payload =
    frames.length > 0 ? frames[frames.length - 1].slice("data:".length).trim() : text.trim();
  return payload === "" ? null : JSON.parse(payload);
}

/** Finds a response header by lowercase name. */
export function answerHeader(answer: McpAnswer | TestEndpointAnswer, name: string): string | null {
  for (const [headerName, value] of answer.headers) {
    if (headerName.toLowerCase() === name) return value;
  }
  return null;
}

/**
 * Posts one JSON-RPC body to `/mcp` with the Agent's headers (JSON content,
 * both SSE and JSON accepted) and the Key as a bearer header, and parses the
 * answer. Pass `key: null` to send no Key at all.
 */
export async function mcpRequest(
  host: TestHost,
  key: string | null,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<McpAnswer> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extraHeaders,
  };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const answer = await host.endpoint({
    method: "POST",
    path: "/mcp",
    headers,
    body: JSON.stringify(body),
  });
  const text = answer.text();
  return { status: answer.status, headers: answer.headers, text, json: parseMcpBody(text) };
}

/** The standard headers a modern (2026-07-28) request must carry. */
export function modernHeaders(
  method: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return { "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...extra };
}

/** Wraps params in the modern per-request envelope the SDK routes on. */
export function modernParams(params: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
}
