import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALL_BURST,
  ENDPOINT_ANSWER_DEADLINE_MS,
  createPluginBroker,
} from "@/features/plugins/broker";
import type {
  PluginApiHandlers,
  PluginBrokerOptions,
  PluginEndpointSink,
  PluginPermissionId,
} from "@/features/plugins/types";
import { createPluginClient } from "@/plugin-sdk";
import {
  type EndpointRequest,
  type HostToPluginMessage,
  PLUGIN_ENDPOINT_REQUEST,
  PLUGIN_STREAM_CHUNK_MAX_BYTES,
  base64ToBytes,
  bytesToBase64,
} from "@/plugin-sdk/protocol";

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
  vi.restoreAllMocks();
});

type SetupOptions = Partial<PluginBrokerOptions> & {
  /** The Plugin Permissions granted at the start; defaults to every declared one. */
  grantedAtStart?: PluginPermissionId[];
};

function setup({ grantedAtStart, ...options }: SetupOptions = {}) {
  const channel = new MessageChannel();
  channels.push(channel);
  const granted = new Set<PluginPermissionId>(grantedAtStart ?? options.declared ?? []);
  const handlers: PluginApiHandlers = {
    "storage.keys": async () => ["a"],
    ...options.handlers,
  };
  const broker = createPluginBroker({
    pluginId: "fixture",
    port: channel.port1,
    declared: [],
    granted: () => granted,
    ...options,
    handlers,
  });
  const client = createPluginClient(channel.port2);
  return {
    broker,
    client,
    granted,
    port: channel.port2,
    hostPort: channel.port1,
  };
}

interface RecordingSink {
  sink: PluginEndpointSink;
  respond: ReturnType<typeof vi.fn>;
  chunk: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function recordingSink(): RecordingSink {
  const respond = vi.fn(() => {});
  const chunk = vi.fn(() => true);
  const end = vi.fn(() => {});
  return {
    sink: { respond, chunk, end } as unknown as PluginEndpointSink,
    respond,
    chunk,
    end,
  };
}

function request(overrides: Partial<EndpointRequest> = {}): EndpointRequest {
  return {
    method: "GET",
    path: "/plugin/fixture/hi?x=1",
    headers: [["accept", "text/plain"]],
    body: "",
    ...overrides,
  };
}

/** Resolves once `data`, posted from the Plugin end, reaches the host end. */
function reachesHost(hostPort: MessagePort, data: string): Promise<void> {
  return new Promise((resolve) => {
    hostPort.addEventListener("message", function onWitness(event: MessageEvent) {
      if (event.data !== data) return;
      hostPort.removeEventListener("message", onWitness);
      resolve();
    });
    hostPort.start();
  });
}

/** Posts `data` from the Plugin end and resolves once the host has dispatched it. */
async function deliver(hostPort: MessagePort, port: MessagePort, data: string): Promise<void> {
  const witnessed = reachesHost(hostPort, "witness");
  port.postMessage(data);
  port.postMessage("witness");
  await witnessed;
}

function texts(calls: unknown[][]): string[] {
  return calls.map(([chunk]) => new TextDecoder().decode(base64ToBytes(chunk as string)));
}

describe("endpoint requests", () => {
  it("answers a non-streamed endpoint request with its status, headers and body", async () => {
    const { broker, client } = setup({ declared: ["serve"] });
    const handler = vi.fn(() => ({
      status: 201,
      headers: { "content-type": "text/plain" },
      body: "hello",
    }));
    client.onEndpointRequest(handler);
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    await vi.waitFor(() => expect(sink.respond).toHaveBeenCalledTimes(1));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/plugin/fixture/hi?x=1" })
    );
    expect(sink.respond).toHaveBeenCalledWith(
      201,
      [["content-type", "text/plain"]],
      bytesToBase64(new TextEncoder().encode("hello")),
      false
    );
    expect(sink.chunk).not.toHaveBeenCalled();
    expect(sink.end).not.toHaveBeenCalled();
  });

  it("sends the request body as bytes that decode back to the original", async () => {
    const { broker, client } = setup({ declared: ["serve"] });
    const received: { body: Uint8Array; text: string }[] = [];
    client.onEndpointRequest((endpoint) => {
      received.push({ body: endpoint.body, text: endpoint.text() });
      return { status: 204 };
    });
    const sink = recordingSink();
    broker.requestEndpoint(
      request({ method: "POST", body: bytesToBase64(new TextEncoder().encode("héllo")) }),
      sink.sink
    );
    await vi.waitFor(() => expect(sink.respond).toHaveBeenCalledTimes(1));
    expect(received[0].body).toBeInstanceOf(Uint8Array);
    expect(received[0].text).toBe("héllo");
    expect(sink.respond).toHaveBeenCalledWith(204, [], undefined, false);
  });

  it("streams an answer as chunks in order, then ends it", async () => {
    const { broker, client } = setup({ declared: ["serve"] });
    client.onEndpointRequest(() => ({
      status: 200,
      headers: [["content-type", "text/event-stream"]],
      body: (async function* () {
        yield "one";
        yield new TextEncoder().encode("two");
      })(),
    }));
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledTimes(1));
    expect(sink.respond).toHaveBeenCalledWith(
      200,
      [["content-type", "text/event-stream"]],
      undefined,
      true
    );
    expect(texts(sink.chunk.mock.calls)).toEqual(["one", "two"]);
    const respondOrder = sink.respond.mock.invocationCallOrder[0];
    expect(respondOrder).toBeLessThan(sink.chunk.mock.invocationCallOrder[0]);
    expect(sink.chunk.mock.invocationCallOrder[1]).toBeLessThan(
      sink.end.mock.invocationCallOrder[0]
    );
  });

  it("refuses with 404 without asking the Plugin when it does not hold serve", async () => {
    const { broker, client, port, hostPort } = setup({ declared: [] });
    const handler = vi.fn(() => ({ status: 200 }));
    client.onEndpointRequest(handler);
    const asked = vi.fn();
    const previous = port.onmessage;
    port.onmessage = (event) => {
      if (typeof event.data === "string" && event.data.includes('"kind":"request"')) asked();
      previous?.call(port, event);
    };
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    await deliver(
      hostPort,
      port,
      JSON.stringify({ kind: "reply", id: 99, ok: true, result: null })
    );
    expect(sink.respond).toHaveBeenCalledWith(404, [], undefined, false);
    expect(asked).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 404 when the Plugin registered no endpoint handler", async () => {
    const { broker, client } = setup({ declared: ["serve"] });
    // No handler registered: the client itself answers 404.
    expect(client).toBeDefined();
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    await vi.waitFor(() => expect(sink.respond).toHaveBeenCalledTimes(1));
    expect(sink.respond).toHaveBeenCalledWith(404, [], undefined, false);
    expect(sink.chunk).not.toHaveBeenCalled();
    expect(sink.end).not.toHaveBeenCalled();
  });

  it("answers 500 without streaming when the handler throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { broker, client } = setup({ declared: ["serve"] });
    client.onEndpointRequest(() => {
      throw new Error("boom");
    });
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    await vi.waitFor(() => expect(sink.respond).toHaveBeenCalledTimes(1));
    expect(sink.respond).toHaveBeenCalledWith(500, [], undefined, false);
    expect(sink.end).not.toHaveBeenCalled();
  });

  it("drops a chunk for an id no endpoint request is open under", async () => {
    const { broker, port, hostPort } = setup({ declared: ["serve"] });
    let requestId = 0;
    port.onmessage = (event) => {
      const message = event.data as HostToPluginMessage;
      if (message.kind !== "request") return;
      requestId = message.id;
      port.postMessage(
        JSON.stringify({
          kind: "reply",
          id: message.id,
          ok: true,
          result: { status: 200, headers: [], streaming: true },
        })
      );
      port.postMessage(
        JSON.stringify({
          kind: "chunk",
          id: message.id + 100,
          chunk: bytesToBase64(new Uint8Array([1])),
        })
      );
      port.postMessage(
        JSON.stringify({ kind: "chunk", id: message.id, chunk: bytesToBase64(new Uint8Array([2])) })
      );
      port.postMessage(JSON.stringify({ kind: "end", id: message.id }));
    };
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledTimes(1));
    expect(requestId).toBeGreaterThan(0);
    expect(sink.chunk).toHaveBeenCalledTimes(1);
    expect(texts(sink.chunk.mock.calls)).toEqual(["\u0002"]);
    await deliver(hostPort, port, JSON.stringify({ kind: "chunk", id: 9999, chunk: "aGk=" }));
    expect(sink.chunk).toHaveBeenCalledTimes(1);
  });

  it("refuses an oversize chunk and ends the answer", async () => {
    const { broker, port } = setup({ declared: ["serve"] });
    const oversized = bytesToBase64(new Uint8Array(PLUGIN_STREAM_CHUNK_MAX_BYTES + 1));
    port.onmessage = (event) => {
      const message = event.data as HostToPluginMessage;
      if (message.kind !== "request") return;
      port.postMessage(
        JSON.stringify({
          kind: "reply",
          id: message.id,
          ok: true,
          result: { status: 200, headers: [], streaming: true },
        })
      );
      port.postMessage(JSON.stringify({ kind: "chunk", id: message.id, chunk: oversized }));
      port.postMessage(JSON.stringify({ kind: "end", id: message.id }));
    };
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledTimes(1));
    expect(sink.chunk).not.toHaveBeenCalled();
  });

  it("answers 500 and forgets the request when the Plugin never replies", async () => {
    // Only the deadline is virtual: the port still delivers on its own.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { broker, port, hostPort } = setup({ declared: ["serve"] });
      const requestId = new Promise<number>((resolve) => {
        port.onmessage = (event) => {
          const message = event.data as HostToPluginMessage;
          if (message.kind === "request") resolve(message.id);
        };
      });
      const sink = recordingSink();
      broker.requestEndpoint(request(), sink.sink);
      const id = await requestId;

      vi.advanceTimersByTime(ENDPOINT_ANSWER_DEADLINE_MS);

      expect(sink.respond).toHaveBeenCalledWith(500, [], undefined, false);
      expect(sink.end).not.toHaveBeenCalled();

      // The entry is gone: a late chunk or end for it is dropped.
      vi.useRealTimers();
      await deliver(
        hostPort,
        port,
        JSON.stringify({ kind: "chunk", id, chunk: bytesToBase64(new Uint8Array([1])) })
      );
      await deliver(hostPort, port, JSON.stringify({ kind: "end", id }));
      expect(sink.chunk).not.toHaveBeenCalled();
      expect(sink.end).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the deadline once the Plugin answered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { broker, client } = setup({ declared: ["serve"] });
      client.onEndpointRequest(() => ({ status: 200 }));
      const sink = recordingSink();
      broker.requestEndpoint(request(), sink.sink);
      await vi.waitFor(() => expect(sink.respond).toHaveBeenCalledWith(200, [], undefined, false));

      vi.advanceTimersByTime(ENDPOINT_ANSWER_DEADLINE_MS);

      expect(sink.respond).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the stream when the caller hung up, ignoring its later chunks", async () => {
    const { broker, port } = setup({ declared: ["serve"] });
    port.onmessage = (event) => {
      const message = event.data as HostToPluginMessage;
      if (message.kind !== "request") return;
      port.postMessage(
        JSON.stringify({
          kind: "reply",
          id: message.id,
          ok: true,
          result: { status: 200, headers: [], streaming: true },
        })
      );
      for (const byte of [1, 2, 3]) {
        port.postMessage(
          JSON.stringify({
            kind: "chunk",
            id: message.id,
            chunk: bytesToBase64(new Uint8Array([byte])),
          })
        );
      }
      port.postMessage(JSON.stringify({ kind: "end", id: message.id }));
    };
    const chunk = vi.fn(async () => false);
    const sink = { respond: vi.fn(), chunk, end: vi.fn() } as unknown as PluginEndpointSink;
    broker.requestEndpoint(request(), sink);

    await vi.waitFor(() => expect(chunk).toHaveBeenCalledTimes(1));
    // Give the queued chunks and the end their turn before asserting they never land.
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(chunk).toHaveBeenCalledTimes(1);
    expect(sink.end).not.toHaveBeenCalled();
  });

  it("ends the sink when the runtime stops mid-stream", async () => {
    const { broker, port } = setup({ declared: ["serve"] });
    port.onmessage = (event) => {
      const message = event.data as HostToPluginMessage;
      if (message.kind !== "request") return;
      port.postMessage(
        JSON.stringify({
          kind: "reply",
          id: message.id,
          ok: true,
          result: { status: 200, headers: [], streaming: true },
        })
      );
      port.postMessage(
        JSON.stringify({ kind: "chunk", id: message.id, chunk: bytesToBase64(new Uint8Array([1])) })
      );
    };
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    await vi.waitFor(() => expect(sink.chunk).toHaveBeenCalledTimes(1));
    broker.stop("requested");
    expect(sink.end).toHaveBeenCalledTimes(1);
  });

  it("answers 500 when the runtime stops before the Plugin answered", () => {
    const { broker } = setup({ declared: ["serve"] });
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    broker.stop("requested");
    expect(sink.respond).toHaveBeenCalledWith(500, [], undefined, false);
    expect(sink.end).not.toHaveBeenCalled();
  });

  it("lets endpoint replies, chunks and end through while the Plugin is throttled", async () => {
    const { broker, client, port } = setup({ declared: ["serve"] });
    await Promise.allSettled(Array.from({ length: CALL_BURST }, () => client.storage.keys()));
    port.onmessage = (event) => {
      const message = event.data as HostToPluginMessage;
      if (message.kind !== "request") return;
      port.postMessage(
        JSON.stringify({
          kind: "reply",
          id: message.id,
          ok: true,
          result: { status: 200, headers: [], streaming: true },
        })
      );
      port.postMessage(
        JSON.stringify({ kind: "chunk", id: message.id, chunk: bytesToBase64(new Uint8Array([1])) })
      );
      port.postMessage(JSON.stringify({ kind: "end", id: message.id }));
    };
    const sink = recordingSink();
    broker.requestEndpoint(request(), sink.sink);
    await vi.waitFor(() => expect(sink.end).toHaveBeenCalledTimes(1));
    expect(sink.chunk).toHaveBeenCalledTimes(1);
  });

  it("does not spend a call token on the endpoint request itself", async () => {
    const { broker, client } = setup({ declared: ["serve"] });
    client.onEndpointRequest(() => ({ status: 200 }));
    broker.requestEndpoint(request(), recordingSink().sink);
    broker.requestEndpoint(request(), recordingSink().sink);
    broker.requestEndpoint(request(), recordingSink().sink);
    const results = await Promise.allSettled(
      Array.from({ length: CALL_BURST }, () => client.storage.keys())
    );
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  });

  it("uses the endpoint.request host request name", async () => {
    const { broker, port } = setup({ declared: ["serve"] });
    const method = new Promise<string>((resolve) => {
      port.onmessage = (event) => {
        const message = event.data as HostToPluginMessage;
        if (message.kind !== "request") return;
        resolve(message.method);
      };
    });
    broker.requestEndpoint(request(), recordingSink().sink);
    await expect(method).resolves.toBe(PLUGIN_ENDPOINT_REQUEST);
  });
});
