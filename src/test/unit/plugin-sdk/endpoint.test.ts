import { describe, expect, it, vi } from "vitest";
import { createPluginClient } from "@/plugin-sdk";
import {
  PLUGIN_ENDPOINT_REQUEST,
  PLUGIN_STREAM_CHUNK_MAX_BYTES,
  type PluginMessagePort,
  base64ToBytes,
  bytesToBase64,
} from "@/plugin-sdk/protocol";

interface StubPort {
  sent: unknown[];
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

function stubPort(): StubPort {
  const port: StubPort = {
    sent: [],
    onmessage: null,
    postMessage(message: unknown) {
      port.sent.push(message);
    },
  };
  return port;
}

function client(port: StubPort) {
  return createPluginClient(port as unknown as PluginMessagePort);
}

function receive(port: StubPort, data: unknown) {
  port.onmessage?.({ data } as MessageEvent);
}

function request(id: number, overrides: Record<string, unknown> = {}) {
  return {
    kind: "request",
    id,
    method: PLUGIN_ENDPOINT_REQUEST,
    params: {
      method: "GET",
      path: "/plugin/acme/mcp?x=1",
      headers: [["accept", "text/plain"]],
      body: "",
      ...overrides,
    },
  };
}

function sent(port: StubPort): Record<string, unknown>[] {
  return port.sent.map((message) => JSON.parse(message as string) as Record<string, unknown>);
}

function decode(bytes: unknown): string {
  return new TextDecoder().decode(base64ToBytes(bytes as string));
}

describe("endpoint requests in the SDK", () => {
  it("answers 404 when the Plugin registered no endpoint handler", async () => {
    const port = stubPort();
    client(port);
    receive(port, request(1));
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));
    expect(sent(port)[0]).toEqual({
      kind: "reply",
      id: 1,
      ok: true,
      result: { status: 404, headers: [], streaming: false },
    });
  });

  it("gives the handler the decoded body and its text", async () => {
    const port = stubPort();
    const received: { body: Uint8Array; text: string; path: string }[] = [];
    client(port).onEndpointRequest((endpoint) => {
      received.push({ body: endpoint.body, text: endpoint.text(), path: endpoint.path });
      return { status: 200, headers: { "content-type": "application/json" }, body: "{}" };
    });
    receive(
      port,
      request(2, { method: "POST", body: bytesToBase64(new TextEncoder().encode("héllo")) })
    );
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));
    expect(received[0].path).toBe("/plugin/acme/mcp?x=1");
    expect(received[0].body).toBeInstanceOf(Uint8Array);
    expect(Array.from(received[0].body)).toEqual(Array.from(new TextEncoder().encode("héllo")));
    expect(received[0].text).toBe("héllo");
    expect(sent(port)[0]).toEqual({
      kind: "reply",
      id: 2,
      ok: true,
      result: {
        status: 200,
        headers: [["content-type", "application/json"]],
        body: bytesToBase64(new TextEncoder().encode("{}")),
        streaming: false,
      },
    });
  });

  it("keeps a header array as given and omits a missing body", async () => {
    const port = stubPort();
    client(port).onEndpointRequest(() => ({
      status: 204,
      headers: [
        ["x", "1"],
        ["x", "2"],
      ],
    }));
    receive(port, request(3));
    await vi.waitFor(() => expect(port.sent).toHaveLength(1));
    expect(sent(port)[0]).toEqual({
      kind: "reply",
      id: 3,
      ok: true,
      result: {
        status: 204,
        headers: [
          ["x", "1"],
          ["x", "2"],
        ],
        streaming: false,
      },
    });
  });

  it("streams an AsyncIterable body as reply, chunks, then end", async () => {
    const port = stubPort();
    client(port).onEndpointRequest(() => ({
      status: 200,
      headers: [["content-type", "text/event-stream"]],
      body: (async function* () {
        yield "data: a\n\n";
        yield new TextEncoder().encode("data: b\n\n");
      })(),
    }));
    receive(port, request(4));
    await vi.waitFor(() => expect(sent(port).at(-1)?.kind).toBe("end"));
    expect(sent(port)[0]).toEqual({
      kind: "reply",
      id: 4,
      ok: true,
      result: {
        status: 200,
        headers: [["content-type", "text/event-stream"]],
        streaming: true,
      },
    });
    expect(
      sent(port)
        .slice(1, -1)
        .map((message) => message.kind)
    ).toEqual(["chunk", "chunk"]);
    expect(
      sent(port)
        .slice(1, -1)
        .map((message) => decode(message.chunk))
    ).toEqual(["data: a\n\n", "data: b\n\n"]);
    expect(sent(port).at(-1)).toEqual({ kind: "end", id: 4 });
  });

  it("splits a chunk bigger than the stream cap into cap-sized base64 chunks", async () => {
    const port = stubPort();
    const big = "x".repeat(PLUGIN_STREAM_CHUNK_MAX_BYTES + 10);
    client(port).onEndpointRequest(() => ({
      status: 200,
      body: (async function* () {
        yield big;
      })(),
    }));
    receive(port, request(5));
    await vi.waitFor(() => expect(sent(port).at(-1)?.kind).toBe("end"));
    const chunks = sent(port).filter((message) => message.kind === "chunk");
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(base64ToBytes(chunk.chunk as string).length).toBeLessThanOrEqual(
        PLUGIN_STREAM_CHUNK_MAX_BYTES
      );
    }
    expect(chunks.map((chunk) => decode(chunk.chunk)).join("")).toBe(big);
  });

  it("ends a stream when the iterator throws, without reporting it as a failed reply", async () => {
    const port = stubPort();
    client(port).onEndpointRequest(() => ({
      status: 200,
      body: (async function* () {
        yield "first";
        throw new Error("The stream broke");
      })(),
    }));
    receive(port, request(6));
    await vi.waitFor(() => expect(sent(port).at(-1)?.kind).toBe("end"));
    expect(sent(port)[0].ok).toBe(true);
    expect(sent(port).some((message) => message.kind === "reply" && message.ok === false)).toBe(
      false
    );
    expect(
      sent(port)
        .filter((message) => message.kind === "chunk")
        .map((m) => decode(m.chunk))
    ).toEqual(["first"]);
    expect(sent(port).at(-1)).toEqual({ kind: "end", id: 6 });
  });
});
