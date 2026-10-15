import { describe, expect, it, vi } from "vitest";
import { pluginFetch } from "@/features/plugins/network";
import { createMemoryPluginSecretStore } from "@/features/plugins/secret-store";
import type { PluginFetchAdapter } from "@/lib/platform/types";
import { PLUGIN_STREAM_CHUNK_MAX_BYTES, utf8ByteLength } from "@/plugin-sdk/protocol";

const URL_ = "https://api.example.com/data";

/** A ReadableStream that hands out one piece per read, so reads stay separate. */
function dripStream(...pieces: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= pieces.length) {
        controller.close();
        return;
      }
      const piece = pieces[index++];
      controller.enqueue(typeof piece === "string" ? encoder.encode(piece) : piece);
    },
  });
}

async function collect(body: AsyncIterable<{ text: string }>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of body) chunks.push(chunk.text);
  return chunks;
}

/** Asserts every chunk's serialized `{"text":"…"}` sits within the stream cap. */
function expectWithinSerializedCap(chunks: string[]): void {
  for (const chunk of chunks) {
    expect(utf8ByteLength(JSON.stringify({ text: chunk }))).toBeLessThanOrEqual(
      PLUGIN_STREAM_CHUNK_MAX_BYTES
    );
  }
}

function storeWith(entries: Record<string, string> = {}) {
  const store = createMemoryPluginSecretStore();
  for (const [name, value] of Object.entries(entries)) {
    void store.set("p1", name, value);
  }
  return store;
}

describe("pluginFetch(): secret header injection", () => {
  it("injects the named secret into the declared header, and never returns the value", async () => {
    const value = "sk-live-not-a-real-token-123";
    const store = storeWith({ token: value });
    let received: Headers | undefined;
    const fetch = vi.fn<PluginFetchAdapter>(async (_url, init) => {
      received = new Headers(init.headers);
      return new Response(dripStream("hello"), { status: 200, statusText: "OK" });
    });

    const stream = await pluginFetch(
      { url: URL_, secretHeaders: { authorization: "token" } },
      { pluginId: "p1", store, fetch }
    );
    expect(received?.get("authorization")).toBe(value);

    const chunks = await collect(stream.body);
    expect(chunks.join("")).toBe("hello");
    // The value is written into the request only: not the head, a chunk, or an error.
    expect(JSON.stringify(stream.result)).not.toContain(value);
    for (const chunk of chunks) expect(JSON.stringify({ text: chunk })).not.toContain(value);
  });

  it("refuses invalid-params and sends nothing when a named secret is not set", async () => {
    const fetch = vi.fn<PluginFetchAdapter>();
    await expect(
      pluginFetch(
        { url: URL_, secretHeaders: { authorization: "token" } },
        { pluginId: "p1", store: storeWith(), fetch }
      )
    ).rejects.toMatchObject({ name: "PluginApiError", code: "invalid-params" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses invalid-params when a secret header collides with one the Plugin set", async () => {
    const fetch = vi.fn<PluginFetchAdapter>();
    await expect(
      pluginFetch(
        {
          url: URL_,
          headers: { Authorization: "Bearer explicit" },
          secretHeaders: { authorization: "token" },
        },
        { pluginId: "p1", store: storeWith({ token: "v" }), fetch }
      )
    ).rejects.toMatchObject({ name: "PluginApiError", code: "invalid-params" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never leaks a secret value in a transport error message", async () => {
    const value = "sk-live-not-a-real-token-123";
    const fetch = vi.fn<PluginFetchAdapter>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await pluginFetch(
      { url: URL_, secretHeaders: { authorization: "token" } },
      { pluginId: "p1", store: storeWith({ token: value }), fetch }
    ).then(
      () => {
        throw new Error("expected a refusal");
      },
      (e: unknown) => e as { message?: string; code?: string }
    );
    expect(error.code).toBe("network-error");
    expect(String(error.message)).not.toContain(value);
  });
});

describe("pluginFetch(): the request", () => {
  it("passes the method, body, and Plugin headers through", async () => {
    let init: RequestInit | undefined;
    const fetch = vi.fn<PluginFetchAdapter>(async (_url, request) => {
      init = request;
      return new Response(null, { status: 200, statusText: "OK" });
    });
    await pluginFetch(
      {
        url: URL_,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"a":1}',
      },
      { pluginId: "p1", store: storeWith(), fetch }
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"a":1}');
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("refuses redirects on every request", async () => {
    let init: RequestInit | undefined;
    const fetch = vi.fn<PluginFetchAdapter>(async (_url, request) => {
      init = request;
      return new Response(null, { status: 200, statusText: "OK" });
    });
    await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    expect(init?.redirect).toBe("error");
  });
});

describe("pluginFetch(): streaming", () => {
  it("returns the head, and no error, for an HTTP 404", async () => {
    const fetch = vi.fn<PluginFetchAdapter>(
      async () => new Response(dripStream("missing"), { status: 404, statusText: "Not Found" })
    );
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    expect(stream.result).toMatchObject({ status: 404, statusText: "Not Found" });
    expect((await collect(stream.body)).join("")).toBe("missing");
  });

  it("yields nothing for a response with no body", async () => {
    const fetch = vi.fn<PluginFetchAdapter>(
      async () => new Response(null, { status: 204, statusText: "No Content" })
    );
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    expect(stream.result.status).toBe(204);
    expect(await collect(stream.body)).toEqual([]);
  });

  it("splits a 200 KB body into chunks each within 64 KB that rejoin to the body", async () => {
    const text = "a".repeat(200 * 1024);
    const fetch = vi.fn<PluginFetchAdapter>(
      async () => new Response(dripStream(text), { status: 200, statusText: "OK" })
    );
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    const chunks = await collect(stream.body);
    expect(chunks.length).toBeGreaterThan(1);
    expectWithinSerializedCap(chunks);
    expect(chunks.join("")).toBe(text);
  });

  it("counts JSON escaping: a body of newlines and backslashes stays within the cap", async () => {
    const text = "\n\\".repeat(100_000);
    const fetch = vi.fn<PluginFetchAdapter>(
      async () => new Response(dripStream(text), { status: 200, statusText: "OK" })
    );
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    const chunks = await collect(stream.body);
    expect(chunks.length).toBeGreaterThan(1);
    expectWithinSerializedCap(chunks);
    expect(chunks.join("")).toBe(text);
  });

  it("keeps an emoji-heavy 200 KB body within the cap and never cuts a surrogate pair", async () => {
    const text = "😀".repeat(50_000);
    const fetch = vi.fn<PluginFetchAdapter>(
      async () => new Response(dripStream(text), { status: 200, statusText: "OK" })
    );
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    const chunks = await collect(stream.body);
    expect(chunks.length).toBeGreaterThan(1);
    expectWithinSerializedCap(chunks);
    expect(chunks.join("")).toBe(text);
    expect(chunks.join("")).not.toContain("\uFFFD");
  });

  it("keeps a multi-byte character whole when a read splits its bytes", async () => {
    const text = "café 😀 — fin";
    const bytes = new TextEncoder().encode(text);
    const fetch = vi.fn<PluginFetchAdapter>(
      async () =>
        new Response(dripStream(bytes.slice(0, 4), bytes.slice(4)), {
          status: 200,
          statusText: "OK",
        })
    );
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    const chunks = await collect(stream.body);
    expect(chunks.join("")).toBe(text);
    expect(chunks.join("")).not.toContain("\uFFFD");
  });

  it("delivers each read as its own chunk, so SSE events arrive in order and live", async () => {
    const fetch = vi.fn<PluginFetchAdapter>(
      async () =>
        new Response(dripStream("data: a\n\n", "data: b\n\n"), {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/event-stream" },
        })
    );
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    expect(await collect(stream.body)).toEqual(["data: a\n\n", "data: b\n\n"]);
  });

  it("throws network-error when a read fails mid-stream, after the chunks already sent", async () => {
    const encoder = new TextEncoder();
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("first"));
      },
      pull(controller) {
        controller.error(new Error("ECONNRESET"));
      },
    });
    const fetch = vi.fn<PluginFetchAdapter>(
      async () => new Response(failing, { status: 200, statusText: "OK" })
    );
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });

    const received: string[] = [];
    const error = await (async () => {
      try {
        for await (const chunk of stream.body) received.push(chunk.text);
        return null;
      } catch (e) {
        return e as { code?: string };
      }
    })();
    expect(received).toEqual(["first"]);
    expect(error?.code).toBe("network-error");
  });

  it("aborts the request when the consumer stops iterating", async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn<PluginFetchAdapter>(async (_url, init) => {
      signals.push(init.signal as AbortSignal);
      return new Response(dripStream("one", "two"), { status: 200, statusText: "OK" });
    });
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    for await (const _chunk of stream.body) break;
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe("pluginFetch(): redirects", () => {
  it("refuses a 302 as network-error and aborts the request", async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn<PluginFetchAdapter>(async (_url, init) => {
      signals.push(init.signal as AbortSignal);
      return new Response("moved", {
        status: 302,
        statusText: "Found",
        headers: { location: "https://other.example.com/" },
      });
    });
    await expect(
      pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch })
    ).rejects.toMatchObject({
      name: "PluginApiError",
      code: "network-error",
      message: "redirect refused",
    });
    expect(signals[0]?.aborted).toBe(true);
  });

  it("refuses any other 3xx, with or without a Location", async () => {
    const fetch = vi.fn<PluginFetchAdapter>(
      async () => new Response(null, { status: 300, statusText: "Multiple Choices" })
    );
    await expect(
      pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch })
    ).rejects.toMatchObject({ code: "network-error", message: "redirect refused" });
  });

  it("returns a 304 Not Modified as an ordinary head, not a redirect", async () => {
    const fetch = vi.fn<PluginFetchAdapter>(
      async () => new Response(null, { status: 304, statusText: "Not Modified" })
    );
    const stream = await pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch });
    expect(stream.result).toMatchObject({ status: 304, statusText: "Not Modified" });
    expect(await collect(stream.body)).toEqual([]);
  });
});

describe("pluginFetch(): transport failures", () => {
  it("turns a rejected fetch into a network-error", async () => {
    const fetch = vi.fn<PluginFetchAdapter>(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      pluginFetch({ url: URL_ }, { pluginId: "p1", store: storeWith(), fetch })
    ).rejects.toMatchObject({ name: "PluginApiError", code: "network-error" });
  });

  it("turns a refused redirect into a network-error, with no secret in the message", async () => {
    const value = "sk-live-not-a-real-token-123";
    // What `redirect: "error"` makes a real fetch reject with.
    const fetch = vi.fn<PluginFetchAdapter>(async () => {
      throw new TypeError("Failed to fetch: redirect mode is set to error");
    });
    const error = await pluginFetch(
      { url: URL_, secretHeaders: { authorization: "token" } },
      { pluginId: "p1", store: storeWith({ token: value }), fetch }
    ).then(
      () => {
        throw new Error("expected a refusal");
      },
      (e: unknown) => e as { message?: string; code?: string }
    );
    expect(error.code).toBe("network-error");
    expect(String(error.message)).not.toContain(value);
  });
});
