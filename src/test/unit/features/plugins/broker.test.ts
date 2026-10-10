import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALL_BURST,
  THROTTLE_STOP_MS,
  type PluginApiHandlers,
  type PluginBrokerOptions,
  createPluginBroker,
} from "@/features/plugins/broker";
import { createPluginClient } from "@/plugin-sdk";
import {
  type HostToPluginMessage,
  PLUGIN_MESSAGE_MAX_BYTES,
  PluginApiError,
  utf8ByteLength,
} from "@/plugin-sdk/protocol";

const BOOK = {
  id: "b1",
  title: "Dune",
  subtitle: null,
  authorName: "Frank",
  language: "en",
  wordCount: 10,
  updatedAt: 0,
};

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

function setup(options: Partial<PluginBrokerOptions> & { grants?: Set<string> } = {}) {
  const channel = new MessageChannel();
  channels.push(channel);
  let time = 0;
  const grants = options.grants ?? new Set(options.declared ?? []);
  const onStop = vi.fn();
  const handlers: PluginApiHandlers = {
    "library.books.list": async () => [BOOK],
    "notifications.show": async () => null,
    "network.fetch": async () => ({ status: 200, statusText: "OK", headers: {} }),
    "storage.keys": async () => ["a"],
    "editor.getContent": async () => ({ status: "no-target" as const }),
    ...options.handlers,
  };
  const broker = createPluginBroker({
    pluginId: "fixture",
    port: channel.port1,
    declared: [],
    granted: () => grants,
    now: () => time,
    onStop,
    ...options,
    handlers,
  });
  const client = createPluginClient(channel.port2);
  return {
    broker,
    client,
    grants,
    onStop,
    port: channel.port2,
    advance(ms: number) {
      time += ms;
    },
  };
}

/** Sends a raw message from the Plugin side and waits for the broker's next message. */
function raw(port: MessagePort, data: unknown): Promise<HostToPluginMessage> {
  return new Promise((resolve) => {
    const previous = port.onmessage;
    port.onmessage = (event) => {
      port.onmessage = previous;
      resolve(event.data as HostToPluginMessage);
    };
    port.postMessage(data);
  });
}

async function refusal(promise: Promise<unknown>): Promise<PluginApiError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to be refused");
    },
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(PluginApiError);
  return error as PluginApiError;
}

describe("Plugin Permission checks", () => {
  it("runs a call whose Plugin Permission is declared and granted", async () => {
    const { client } = setup({ declared: ["library:read"] });
    await expect(client.library.books.list()).resolves.toEqual([BOOK]);
  });

  it("refuses a declared but ungranted Plugin Permission with its id, and keeps the Plugin running", async () => {
    const { client } = setup({ declared: ["library:read"], grants: new Set() });
    const error = await refusal(client.library.books.list());
    expect(error.code).toBe("permission-denied");
    expect(error.permission).toBe("library:read");
    expect(error.method).toBe("library.books.list");
    await expect(client.storage.keys()).resolves.toEqual(["a"]);
  });

  it("refuses a granted but undeclared Plugin Permission", async () => {
    const { client } = setup({ declared: [], grants: new Set(["library:read"]) });
    expect((await refusal(client.library.books.list())).code).toBe("permission-denied");
  });

  it("applies a revocation on the very next call and a re-grant the same way (T11)", async () => {
    const { client, grants } = setup({ declared: ["library:read"] });
    await expect(client.library.books.list()).resolves.toEqual([BOOK]);
    grants.delete("library:read");
    expect((await refusal(client.library.books.list())).code).toBe("permission-denied");
    grants.add("library:read");
    await expect(client.library.books.list()).resolves.toEqual([BOOK]);
  });

  it("runs ungated methods with no Plugin Permissions", async () => {
    const { client } = setup();
    await expect(client.storage.keys()).resolves.toEqual(["a"]);
  });

  it("checks a fetch against the granted network host", async () => {
    const { client } = setup({ declared: ["network:api.example.com"] });
    await expect(client.network.fetch({ url: "https://api.example.com/v1" })).resolves.toEqual({
      status: 200,
      statusText: "OK",
      headers: {},
    });
    const error = await refusal(client.network.fetch({ url: "https://evil.com/" }));
    expect(error.code).toBe("permission-denied");
    expect(error.permission).toBe("network:evil.com");
  });

  it("matches a wildcard host on subdomains only", async () => {
    const { client } = setup({ declared: ["network:*.example.com"] });
    await expect(client.network.fetch({ url: "https://a.b.example.com/" })).resolves.toBeTruthy();
    expect((await refusal(client.network.fetch({ url: "https://example.com/" }))).code).toBe(
      "permission-denied"
    );
    expect(
      (await refusal(client.network.fetch({ url: "https://notexample.com/" }))).permission
    ).toBe("network:notexample.com");
  });

  it("refuses a fetch URL that is not http or https", async () => {
    const { client } = setup({ declared: ["network:api.example.com"] });
    expect((await refusal(client.network.fetch({ url: "file:///etc/passwd" }))).code).toBe(
      "invalid-params"
    );
    expect((await refusal(client.network.fetch({ url: "not a url" }))).code).toBe("invalid-params");
  });

  it("re-reads network grants on every call", async () => {
    const { client, grants } = setup({ declared: ["network:api.example.com"] });
    await expect(client.network.fetch({ url: "https://api.example.com/" })).resolves.toBeTruthy();
    grants.clear();
    expect((await refusal(client.network.fetch({ url: "https://api.example.com/" }))).code).toBe(
      "permission-denied"
    );
  });
});

describe("typed errors", () => {
  it("refuses an unknown method", async () => {
    const { port } = setup();
    const reply = await raw(
      port,
      JSON.stringify({ kind: "call", id: 1, method: "library.books.burn", params: {} })
    );
    expect(reply).toMatchObject({
      kind: "result",
      id: 1,
      ok: false,
      error: { code: "unknown-method", method: "library.books.burn" },
    });
  });

  it("refuses every call into the reserved process namespace with not-implemented", async () => {
    const { port } = setup({ declared: ["process"] });
    for (const method of ["process.spawn", "process.anything.else"]) {
      const reply = await raw(port, JSON.stringify({ kind: "call", id: 2, method, params: {} }));
      expect(reply).toMatchObject({ ok: false, error: { code: "not-implemented", method } });
    }
  });

  it("refuses a declared method whose implementation has not landed with not-implemented", async () => {
    const { client } = setup({ declared: ["clipboard"] });
    expect((await refusal(client.clipboard.readText())).code).toBe("not-implemented");
  });

  it("checks the Plugin Permission before reporting not-implemented", async () => {
    const { client } = setup();
    expect((await refusal(client.clipboard.readText())).code).toBe("permission-denied");
  });

  it("refuses params the row's schema rejects", async () => {
    const { client } = setup({ declared: ["library:read"] });
    const extra = { bookId: "b1", surprise: true } as unknown as { bookId: string };
    expect((await refusal(client.library.books.get(extra))).code).toBe("invalid-params");
    const wrong = { bookId: 7 } as unknown as { bookId: string };
    const error = await refusal(client.library.books.get(wrong));
    expect(error.code).toBe("invalid-params");
    expect(error.message).toContain("bookId");
  });

  it("refuses Library methods with library-unavailable while the Library is closed", async () => {
    let open = false;
    const { client } = setup({
      declared: ["library:read", "editor:read"],
      isLibraryAvailable: () => open,
    });
    expect((await refusal(client.library.books.list())).code).toBe("library-unavailable");
    expect((await refusal(client.storage.keys())).code).toBe("library-unavailable");
    await expect(client.editor.getContent()).resolves.toEqual({ status: "no-target" });
    open = true;
    await expect(client.library.books.list()).resolves.toEqual([BOOK]);
  });

  it("hides a handler's own failure behind internal-error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup({
      handlers: {
        "storage.keys": async () => {
          throw new Error("SQLITE_BUSY at /home/andy/library.db");
        },
      },
    });
    const error = await refusal(client.storage.keys());
    expect(error.code).toBe("internal-error");
    expect(error.message).not.toContain("SQLITE");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("passes a handler's typed error through", async () => {
    const { client } = setup({
      handlers: {
        "storage.keys": async () => {
          throw new PluginApiError({ code: "library-unavailable", message: "Restoring" });
        },
      },
    });
    expect((await refusal(client.storage.keys())).code).toBe("library-unavailable");
  });
});

describe("call rate", () => {
  it("accepts a burst of 500 calls and refuses the next with rate-limited", async () => {
    const { client } = setup();
    const results = await Promise.allSettled(
      Array.from({ length: CALL_BURST + 1 }, () => client.storage.keys())
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(CALL_BURST);
    const last = results[CALL_BURST];
    expect(last.status).toBe("rejected");
    expect((last as PromiseRejectedResult).reason.code).toBe("rate-limited");
  });

  it("refills at 100 calls per second", async () => {
    const { client, advance } = setup();
    await Promise.allSettled(Array.from({ length: CALL_BURST }, () => client.storage.keys()));
    expect((await refusal(client.storage.keys())).code).toBe("rate-limited");
    advance(10);
    await expect(client.storage.keys()).resolves.toEqual(["a"]);
    expect((await refusal(client.storage.keys())).code).toBe("rate-limited");
  });

  it("stops the Plugin after 30 s of sustained throttling", async () => {
    const { client, onStop, advance } = setup();
    await Promise.allSettled(Array.from({ length: CALL_BURST + 1 }, () => client.storage.keys()));
    for (let elapsed = 0; elapsed < THROTTLE_STOP_MS; elapsed += 500) {
      advance(500);
      // 50 tokens refill per 500 ms; 60 calls keep the Plugin throttled.
      await Promise.allSettled(Array.from({ length: 60 }, () => client.storage.keys()));
      if (onStop.mock.calls.length > 0) break;
    }
    expect(onStop).toHaveBeenCalledWith("throttled");
    expect(client.stopped).toBe(true);
    expect((await refusal(client.storage.keys())).code).toBe("plugin-stopped");
  });

  it("does not stop a Plugin whose throttling pauses for more than a second", async () => {
    const { client, onStop, advance } = setup();
    for (let round = 0; round < 3; round++) {
      // 20 s throttled, then a 2 s pause long enough to refill the bucket a bit.
      await Promise.allSettled(Array.from({ length: CALL_BURST + 1 }, () => client.storage.keys()));
      for (let i = 0; i < 40; i++) {
        advance(500);
        await Promise.allSettled(Array.from({ length: 60 }, () => client.storage.keys()));
      }
      advance(2000);
    }
    expect(onStop).not.toHaveBeenCalled();
    await expect(client.storage.keys()).resolves.toEqual(["a"]);
  });

  it("allows one notification every 5 s", async () => {
    const { client, advance } = setup();
    await expect(client.notifications.show({ variant: "info", message: "hi" })).resolves.toBe(null);
    advance(4999);
    expect(
      (await refusal(client.notifications.show({ variant: "info", message: "hi" }))).code
    ).toBe("rate-limited");
    advance(1);
    await expect(client.notifications.show({ variant: "info", message: "hi" })).resolves.toBe(null);
  });

  it("does not spend the notification slot on a refused call", async () => {
    const { client } = setup();
    const empty = { variant: "info", message: "" } as const;
    expect((await refusal(client.notifications.show(empty))).code).toBe("invalid-params");
    await expect(client.notifications.show({ variant: "info", message: "hi" })).resolves.toBe(null);
  });
});

describe("message cap", () => {
  it("measures UTF-8 bytes exactly as TextEncoder does", () => {
    const samples = ["", "abc", "ñ€", "😀x😀", "\ud800", "a\udc00b", "\ud800\ud800\udc00"];
    for (const sample of samples) {
      expect(utf8ByteLength(sample), JSON.stringify(sample)).toBe(
        new TextEncoder().encode(sample).length
      );
    }
  });

  it("refuses a Plugin message over 4 MB with message-too-large, without running it", async () => {
    const keys = vi.fn(async () => ["a"]);
    const { port } = setup({ handlers: { "storage.keys": keys } });
    const padding = "x".repeat(PLUGIN_MESSAGE_MAX_BYTES);
    const reply = await raw(
      port,
      JSON.stringify({ kind: "call", id: 9, method: "storage.keys", params: { padding } })
    );
    expect(reply).toMatchObject({ id: 9, ok: false, error: { code: "message-too-large" } });
    expect(keys).not.toHaveBeenCalled();
  });

  it("counts multi-byte characters in UTF-8 bytes", async () => {
    const { port } = setup();
    // 1.5 M three-byte characters: 1.5 M UTF-16 units, 4.5 MB of UTF-8.
    const padding = "€".repeat(1_500_000);
    const reply = await raw(
      port,
      JSON.stringify({ kind: "call", id: 3, method: "storage.keys", params: { padding } })
    );
    expect(reply).toMatchObject({ id: 3, ok: false, error: { code: "message-too-large" } });
  });

  it("accepts a message exactly at the cap", async () => {
    const { port } = setup();
    const head = JSON.stringify({ kind: "call", id: 4, method: "storage.keys", params: { p: "" } });
    const padding = "x".repeat(PLUGIN_MESSAGE_MAX_BYTES - head.length);
    const message = JSON.stringify({
      kind: "call",
      id: 4,
      method: "storage.keys",
      params: { p: padding },
    });
    expect(message.length).toBe(PLUGIN_MESSAGE_MAX_BYTES);
    // The size check passes, so the call reaches schema validation.
    const reply = await raw(port, message);
    expect(reply).toMatchObject({ id: 4, ok: false, error: { code: "invalid-params" } });
  });

  it("the SDK refuses an oversized call before sending it", async () => {
    const { client, port } = setup({ declared: ["clipboard"] });
    const post = vi.spyOn(port, "postMessage");
    const text = "x".repeat(PLUGIN_MESSAGE_MAX_BYTES);
    expect((await refusal(client.clipboard.writeText({ text }))).code).toBe("message-too-large");
    expect(post).not.toHaveBeenCalled();
  });
});

describe("malformed and spoofed messages", () => {
  it("ignores non-string and malformed messages and keeps serving", async () => {
    const { client, port } = setup();
    port.postMessage({ kind: "call", id: 1, method: "storage.keys", params: {} });
    port.postMessage("{not json");
    port.postMessage(JSON.stringify({ kind: "call", id: "x", method: "storage.keys" }));
    port.postMessage(JSON.stringify(null));
    await expect(client.storage.keys()).resolves.toEqual(["a"]);
  });

  it("ignores a Plugin reply to a request the host never sent", async () => {
    const { broker, client, port } = setup();
    client.onHostRequest(async () => "pong");
    // A forged reply for an id the host has not used yet.
    port.postMessage(JSON.stringify({ kind: "reply", id: 1, ok: true, result: "forged" }));
    await expect(client.storage.keys()).resolves.toEqual(["a"]);
    await expect(broker.request("health.check", {})).resolves.toBe("pong");
  });

  it("settles a host request once, ignoring a second reply with the same id", async () => {
    const { broker, port } = setup();
    const replies: unknown[] = [];
    port.onmessage = (event) => {
      const message = event.data as HostToPluginMessage;
      if (message.kind !== "request") return;
      replies.push(message.id);
      port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: true, result: 1 }));
      port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: true, result: 2 }));
    };
    await expect(broker.request("health.check", {})).resolves.toBe(1);
    await expect(broker.request("health.check", {})).resolves.toBe(1);
    expect(replies).toEqual([1, 2]);
  });

  it("the SDK ignores a result for a call it never made", async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    const client = createPluginClient(channel.port2);
    channel.port1.onmessage = (event) => {
      const call = JSON.parse(event.data as string) as { id: number };
      channel.port1.postMessage({ kind: "result", id: call.id + 100, ok: true, result: "forged" });
      channel.port1.postMessage({ kind: "result", id: call.id, ok: true, result: ["real"] });
    };
    await expect(client.storage.keys()).resolves.toEqual(["real"]);
  });

  it("rejects a host request with the Plugin's typed error", async () => {
    const { broker, client } = setup();
    client.onHostRequest(async () => {
      throw new Error("boom");
    });
    const error = await refusal(broker.request("health.check", {}));
    expect(error.code).toBe("internal-error");
  });
});

describe("stopping", () => {
  it("rejects calls in flight and every later call with plugin-stopped", async () => {
    let release: () => void = () => {};
    const { broker, client, onStop } = setup({
      handlers: {
        "storage.keys": () =>
          new Promise<string[]>((resolve) => {
            release = () => resolve(["late"]);
          }),
      },
    });
    const inFlight = client.storage.keys();
    await new Promise((r) => setTimeout(r, 0));
    broker.stop("requested");
    release();
    expect((await refusal(inFlight)).code).toBe("plugin-stopped");
    expect((await refusal(client.storage.keys())).code).toBe("plugin-stopped");
    expect(onStop).toHaveBeenCalledTimes(1);
    broker.stop("requested");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("rejects pending host requests with plugin-stopped", async () => {
    const { broker } = setup();
    const pending = broker.request("health.check", {});
    broker.stop("requested");
    expect((await refusal(pending)).code).toBe("plugin-stopped");
  });

  it("stops handling messages once stopped", async () => {
    const keys = vi.fn(async () => ["a"]);
    const { broker, port } = setup({ handlers: { "storage.keys": keys } });
    broker.stop("requested");
    port.postMessage(JSON.stringify({ kind: "call", id: 1, method: "storage.keys", params: {} }));
    await new Promise((r) => setTimeout(r, 10));
    expect(keys).not.toHaveBeenCalled();
    expect(broker.stopped).toBe(true);
  });
});
