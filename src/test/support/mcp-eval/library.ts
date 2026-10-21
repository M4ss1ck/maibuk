// The fixture Library the MCP Server Agent eval serves (#595). It starts the
// real MCP Server Plugin on the Plugin test kit (`createTestHost`, the real
// broker and method table over an in-memory Library), answers Plugin Endpoint
// requests the way the app's listener hands them over, records every JSON-RPC
// exchange, plays the author typing into a Chapter, and reads the Library back
// afterwards. `e2e/run-mcp-eval.ts` puts a real HTTP listener in front of it;
// `src/test/integration/mcp-eval-tasks.test.ts` drives it with scripted Agents.

import { connect, mcpRequest } from "../../../../plugins/maibuk-mcp/test-support";
import { htmlToPlainText } from "@/features/plugins/library";
import type { TestHost } from "@/features/plugins/types";
import {
  parseMcpBody,
  parseRequestBody,
  type ChapterState,
  type LibrarySnapshot,
  type WireEntry,
} from "./report";
import { evalLibrary, type EvalTask } from "./tasks";

/** The Plugin Endpoint path the app's listener routes to MCP Server. */
export const ENDPOINT_PREFIX = "/plugin/maibuk-mcp";

/** One HTTP request as the listener receives it. */
export interface EvalRequest {
  method: string;
  /** The full path, `/plugin/maibuk-mcp/mcp` for the MCP Server. */
  path: string;
  headers: [string, string][];
  body: Uint8Array;
}

/** The head of an answer; the body follows through `write`. */
export interface EvalAnswerSink {
  head(status: number, headers: [string, string][]): void;
  write(chunk: Uint8Array): void;
  end(): void;
  /** Resolves when the Agent hangs up on a long-lived stream. */
  closed: Promise<void>;
}

export interface EvalLibrary {
  key: string;
  host: TestHost;
  /** Every JSON-RPC exchange the Agent made, in order. */
  wire: WireEntry[];
  /** Answers one request on the Plugin Endpoint into `sink`. */
  handle(request: EvalRequest, sink: EvalAnswerSink): Promise<void>;
  /** Reads the Library back: Books, every Chapter in order, Notes, Checkpoints. */
  snapshot(): Promise<LibrarySnapshot>;
  stop(): void;
}

const READ_ONLY_PERMISSIONS = ["serve", "library:read", "clipboard"] as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function headerValue(headers: readonly [string, string][], name: string): string | null {
  for (const [key, value] of headers) if (key.toLowerCase() === name) return value;
  return null;
}

/** Whether an answer is a long-lived stream the listener must pump, not wait out. */
function opensStream(method: string, rpcMethod: string | null): boolean {
  return method === "GET" || rpcMethod === "subscriptions/listen";
}

/**
 * Starts MCP Server over a fresh copy of the fixture Library, set up for one
 * task: read-only when the task says so, and with the author's typing armed.
 */
export async function startEvalLibrary(task: EvalTask): Promise<EvalLibrary> {
  const fixture = evalLibrary();
  const { host, key } = await connect({ library: fixture });
  if (task.readOnly === true) host.setGranted([...READ_ONLY_PERMISSIONS]);
  const wire: WireEntry[] = [];
  let authorTyped = false;

  /** Plays the author typing once, right after the Agent first reads that Chapter. */
  function afterExchange(entry: WireEntry): void {
    const typing = task.authorTypes;
    if (typing === undefined || authorTyped || entry.method !== "tools/call") return;
    const params = entry.request?.params ?? {};
    const ref = String(params.arguments?.chapter ?? "").trim();
    const ok = entry.response?.result !== undefined && entry.response.result.isError !== true;
    if (
      params.name === "read_chapter" &&
      ok &&
      ref.length >= 8 &&
      typing.chapterId.startsWith(ref)
    ) {
      authorTyped = true;
      host.setPendingEdit(typing.chapterId, typing.html);
    }
  }

  async function handle(request: EvalRequest, sink: EvalAnswerSink): Promise<void> {
    if (request.path !== ENDPOINT_PREFIX && !request.path.startsWith(`${ENDPOINT_PREFIX}/`)) {
      sink.head(404, []);
      sink.end();
      return;
    }
    const tail = request.path.slice(ENDPOINT_PREFIX.length) || "/";
    const bodyText = decoder.decode(request.body);
    const parsed = parseRequestBody(bodyText);
    const rpcMethod = typeof parsed?.method === "string" ? (parsed.method as string) : null;
    const forwarded = {
      method: request.method,
      path: tail,
      headers: request.headers,
      ...(request.body.length > 0 ? { body: request.body } : {}),
    };

    if (opensStream(request.method, rpcMethod)) {
      const stream = host.endpointStream(forwarded);
      const head = await stream.head;
      sink.head(head.status, head.headers);
      let sent = 0;
      const pump = setInterval(() => {
        const chunks = stream.chunks();
        for (; sent < chunks.length; sent += 1) sink.write(chunks[sent]);
      }, 20);
      await sink.closed;
      clearInterval(pump);
      stream.close();
      wire.push({ method: rpcMethod, request: parsed, response: null, status: head.status });
      return;
    }

    const answer = await host.endpoint(forwarded);
    const text = answer.text();
    sink.head(answer.status, answer.headers);
    if (answer.body.length > 0) sink.write(answer.body);
    sink.end();
    const entry: WireEntry = {
      method: rpcMethod,
      request: parsed,
      response:
        headerValue(answer.headers, "content-type") === null && text === ""
          ? null
          : parseMcpBody(text),
      status: answer.status,
    };
    wire.push(entry);
    afterExchange(entry);
  }

  /** One inspector tool call, outside the Agent's wire log. */
  async function inspect(name: string, args: Record<string, unknown>): Promise<any> {
    await mcpRequest(host, key, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "eval-inspector", version: "0.0.0" },
      },
    });
    const answer = await mcpRequest(host, key, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const result = answer.json?.result;
    if (result === undefined || result.isError === true) {
      throw new Error(`The eval could not read the Library back (${name}): ${answer.text}`);
    }
    return result;
  }

  /**
   * Reads every Book's Chapters back through `get_book` (the only view of a
   * Chapter the Agent created) and each Chapter's stored HTML through
   * `read_chapter`, unwindowed. Books and Notes are the fixture rows the test
   * kit writes in place; Checkpoints are what the host recorded.
   */
  async function snapshot(): Promise<LibrarySnapshot> {
    const fixtureChapterIds = (fixture.chapters ?? []).map((entry) => entry.id);
    const chapters: ChapterState[] = [];
    for (const book of fixture.books ?? []) {
      const listing = String(
        (await inspect("get_book", { book: book.id })).content?.[0]?.text ?? ""
      );
      for (const line of listing.split("\n")) {
        const match = /^(\d+)\. (\S+) {2}(.*) {2}\d+ words$/.exec(line);
        if (match === null) continue;
        const [, position, shortId, title] = match;
        const read = await inspect("read_chapter", {
          chapter: shortId,
          format: "html",
          length: 50_000,
        });
        const html = String(read.content?.[1]?.text ?? "");
        chapters.push({
          bookId: book.id,
          position: Number(position),
          id: fixtureChapterIds.find((id) => id.startsWith(shortId)) ?? shortId,
          title,
          html,
          text: htmlToPlainText(html),
        });
      }
    }
    return {
      books: (fixture.books ?? []).map(({ id, title, authorName, genre, status }) => ({
        id,
        title,
        authorName,
        genre,
        status,
      })),
      chapters,
      notes: (fixture.notes ?? []).map((entry) => ({
        id: entry.id,
        bookId: entry.bookId,
        title: entry.title,
        tags: [...entry.tags],
        html: entry.content?.html ?? "",
      })),
      checkpoints: host.checkpoints.map(({ bookId, label }) => ({ bookId, label })),
    };
  }

  return { key, host, wire, handle, snapshot, stop: () => host.stop() };
}

/** Encodes a string body for `EvalRequest`. */
export function bodyOf(text: string): Uint8Array {
  return encoder.encode(text);
}
