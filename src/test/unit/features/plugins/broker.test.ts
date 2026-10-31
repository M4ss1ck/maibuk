import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALL_BURST,
  COMMAND_RUN_EXEMPTION_MS,
  THROTTLE_GAP_MS,
  THROTTLE_STOP_MS,
  createPluginBroker,
} from "@/features/plugins/broker";
import { pluginFetch } from "@/features/plugins/network";
import {
  type MemoryPluginFileGrantStore,
  createMemoryPluginFileGrantStore,
} from "@/features/plugins/file-grants";
import { createMemoryPluginSecretStore } from "@/features/plugins/secret-store";
import type {
  PluginApiHandlers,
  PluginBrokerOptions,
  PluginPermissionId,
} from "@/features/plugins/types";
import { createPluginClient } from "@/plugin-sdk";
import {
  type HostToPluginMessage,
  FILE_READ_MAX_BYTES,
  PLUGIN_MESSAGE_MAX_BYTES,
  PLUGIN_STREAM_CHUNK_MAX_BYTES,
  PluginApiError,
  utf8ByteLength,
} from "@/plugin-sdk/protocol";

const BOOK = {
  id: "b1",
  title: "Dune",
  subtitle: null,
  authorName: "Frank",
  genre: null,
  language: "en",
  wordCount: 10,
  targetWordCount: null,
  status: "draft" as const,
  updatedAt: 0,
};

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

type SetupOptions = Partial<PluginBrokerOptions> & {
  /** The Plugin Permissions granted at the start; defaults to every declared one. */
  grantedAtStart?: PluginPermissionId[];
};

function setup({ grantedAtStart, ...options }: SetupOptions = {}) {
  const channel = new MessageChannel();
  channels.push(channel);
  let time = 0;
  const granted = new Set<PluginPermissionId>(grantedAtStart ?? options.declared ?? []);
  const onStop = vi.fn();
  const handlers: PluginApiHandlers = {
    "library.books.list": async () => [BOOK],
    "notifications.show": async () => null,
    "network.fetch": async () => ({
      result: { status: 200, statusText: "OK", headers: {} },
      body: (async function* () {})(),
    }),
    "storage.keys": async () => ["a"],
    "editor.getContent": async () => ({ status: "no-target" as const }),
    ...options.handlers,
  };
  const broker = createPluginBroker({
    pluginId: "fixture",
    port: channel.port1,
    declared: [],
    granted: () => granted,
    now: () => time,
    onStop,
    ...options,
    handlers,
  });
  const client = createPluginClient(channel.port2);
  return {
    broker,
    client,
    granted,
    onStop,
    port: channel.port2,
    hostPort: channel.port1,
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

/**
 * Resolves once `data`, posted from the Plugin end, reaches the host end. Ports
 * deliver in order, so every message posted before it has been dispatched by then.
 */
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
    const { client } = setup({ declared: ["library:read"], grantedAtStart: [] });
    const error = await refusal(client.library.books.list());
    expect(error.code).toBe("permission-denied");
    expect(error.permission).toBe("library:read");
    expect(error.method).toBe("library.books.list");
    await expect(client.storage.keys()).resolves.toEqual(["a"]);
  });

  it("refuses a granted but undeclared Plugin Permission", async () => {
    const { client } = setup({ declared: [], grantedAtStart: ["library:read"] });
    expect((await refusal(client.library.books.list())).code).toBe("permission-denied");
  });

  it("applies a revocation on the very next call, and granting it again the same way (T11)", async () => {
    const { client, granted } = setup({ declared: ["library:read"] });
    await expect(client.library.books.list()).resolves.toEqual([BOOK]);
    granted.delete("library:read");
    expect((await refusal(client.library.books.list())).code).toBe("permission-denied");
    granted.add("library:read");
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
    await expect(client.network.fetch({ url: "https://api.example.com/" })).resolves.toBeTruthy();
    expect((await refusal(client.network.fetch({ url: "https://example.com/" }))).code).toBe(
      "permission-denied"
    );
    expect(
      (await refusal(client.network.fetch({ url: "https://evil-example.com/" }))).permission
    ).toBe("network:evil-example.com");
    expect(
      (await refusal(client.network.fetch({ url: "https://notexample.com/" }))).permission
    ).toBe("network:notexample.com");
  });

  it("refuses a fetch to a declared network host that is not granted", async () => {
    const { client } = setup({ declared: ["network:api.example.com"], grantedAtStart: [] });
    const error = await refusal(client.network.fetch({ url: "https://api.example.com/" }));
    expect(error.code).toBe("permission-denied");
    expect(error.permission).toBe("network:api.example.com");
  });

  it("refuses a fetch to a host no Plugin Permission declares", async () => {
    const { client } = setup({ declared: [] });
    const error = await refusal(client.network.fetch({ url: "https://undeclared.example.com/" }));
    expect(error.code).toBe("permission-denied");
    expect(error.permission).toBe("network:undeclared.example.com");
  });

  it("refuses a fetch URL that is not http or https", async () => {
    const { client } = setup({ declared: ["network:api.example.com"] });
    expect((await refusal(client.network.fetch({ url: "file:///etc/passwd" }))).code).toBe(
      "invalid-params"
    );
    expect((await refusal(client.network.fetch({ url: "not a url" }))).code).toBe("invalid-params");
  });

  it("re-reads the granted network Plugin Permissions on every call", async () => {
    const { client, granted } = setup({ declared: ["network:api.example.com"] });
    await expect(client.network.fetch({ url: "https://api.example.com/" })).resolves.toBeTruthy();
    granted.clear();
    expect((await refusal(client.network.fetch({ url: "https://api.example.com/" }))).code).toBe(
      "permission-denied"
    );
  });
});

describe("Library write Plugin Permissions", () => {
  const WRITE_HANDLERS: PluginApiHandlers = {
    "library.books.update": async () => null,
    "library.chapters.updateContent": async () => null,
    "library.notes.create": async () => ({ noteId: "n1" }),
    "library.notes.update": async () => null,
  };

  it("refuses every library:write row without the Plugin Permission", async () => {
    const { client } = setup({
      declared: ["library:write"],
      grantedAtStart: [],
      handlers: WRITE_HANDLERS,
    });

    const book = await refusal(client.library.books.update({ bookId: "b1", title: "T" }));
    expect(book.code).toBe("permission-denied");
    expect(book.permission).toBe("library:write");
    expect(book.method).toBe("library.books.update");

    const chapter = await refusal(
      client.library.chapters.updateContent({ chapterId: "c1", content: { text: "x" } })
    );
    expect(chapter.code).toBe("permission-denied");
    expect(chapter.permission).toBe("library:write");
    expect(chapter.method).toBe("library.chapters.updateContent");

    const create = await refusal(client.library.notes.create({ title: "T" }));
    expect(create.code).toBe("permission-denied");
    expect(create.method).toBe("library.notes.create");

    const update = await refusal(client.library.notes.update({ noteId: "n1", title: "T" }));
    expect(update.code).toBe("permission-denied");
    expect(update.method).toBe("library.notes.update");
  });

  it("applies a revoked library:write on the next call (T11)", async () => {
    const { client, granted } = setup({ declared: ["library:write"], handlers: WRITE_HANDLERS });

    await expect(client.library.books.update({ bookId: "b1", title: "T" })).resolves.toBeNull();
    await expect(
      client.library.chapters.updateContent({ chapterId: "c1", content: { text: "x" } })
    ).resolves.toBeNull();
    await expect(client.library.notes.create({ title: "T" })).resolves.toEqual({ noteId: "n1" });
    await expect(client.library.notes.update({ noteId: "n1", title: "T" })).resolves.toBeNull();

    granted.delete("library:write");

    expect((await refusal(client.library.books.update({ bookId: "b1", title: "T" }))).code).toBe(
      "permission-denied"
    );
    expect(
      (
        await refusal(
          client.library.chapters.updateContent({ chapterId: "c1", content: { text: "x" } })
        )
      ).code
    ).toBe("permission-denied");
    expect((await refusal(client.library.notes.create({ title: "T" }))).code).toBe(
      "permission-denied"
    );
    expect((await refusal(client.library.notes.update({ noteId: "n1", title: "T" }))).code).toBe(
      "permission-denied"
    );
  });
});

describe("Editor write Plugin Permissions", () => {
  const WRITE_HANDLERS: PluginApiHandlers = {
    "editor.insert": async () => ({ status: "applied" as const }),
    "editor.replace": async () => ({ status: "applied" as const }),
  };

  it("refuses every editor:write row without the Plugin Permission", async () => {
    const { client } = setup({
      declared: ["editor:write"],
      grantedAtStart: [],
      handlers: WRITE_HANDLERS,
    });

    const insert = await refusal(client.editor.insert({ content: { text: "x" } }));
    expect(insert.code).toBe("permission-denied");
    expect(insert.permission).toBe("editor:write");
    expect(insert.method).toBe("editor.insert");

    const replace = await refusal(
      client.editor.replace({ range: { from: 0, to: 1 }, content: { text: "x" } })
    );
    expect(replace.code).toBe("permission-denied");
    expect(replace.method).toBe("editor.replace");
  });

  it("applies a revoked editor:write on the next call (T11)", async () => {
    const { client, granted } = setup({ declared: ["editor:write"], handlers: WRITE_HANDLERS });

    await expect(client.editor.insert({ content: { text: "x" } })).resolves.toEqual({
      status: "applied",
    });

    granted.delete("editor:write");

    expect((await refusal(client.editor.insert({ content: { text: "x" } }))).code).toBe(
      "permission-denied"
    );
    expect(
      (await refusal(client.editor.replace({ range: { from: 0, to: 1 }, content: { text: "x" } })))
        .code
    ).toBe("permission-denied");
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

  it("refuses secrets and clipboard calls whose Plugin Permission is not granted", async () => {
    const { client } = setup({ declared: ["secrets", "clipboard"], grantedAtStart: [] });
    expect((await refusal(client.secrets.set({ name: "token", value: "v" }))).code).toBe(
      "permission-denied"
    );
    expect((await refusal(client.secrets.listNames())).code).toBe("permission-denied");
    expect((await refusal(client.clipboard.writeText({ text: "x" }))).code).toBe(
      "permission-denied"
    );
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

  it("refuses Library and editor methods with library-unavailable while the Library is closed", async () => {
    let open = false;
    const { client } = setup({
      declared: ["library:read", "editor:read"],
      isLibraryAvailable: () => open,
    });
    expect((await refusal(client.library.books.list())).code).toBe("library-unavailable");
    expect((await refusal(client.storage.keys())).code).toBe("library-unavailable");
    expect((await refusal(client.editor.getContent())).code).toBe("library-unavailable");
    open = true;
    await expect(client.library.books.list()).resolves.toEqual([BOOK]);
    await expect(client.editor.getContent()).resolves.toEqual({ status: "no-target" });
  });

  it("tracks every requiresLibrary call so a Library switch can settle accepted work", async () => {
    const tracked: Promise<unknown>[] = [];
    const { client } = setup({
      declared: ["library:read"],
      trackLibraryWork: (work) => {
        tracked.push(work);
        return work;
      },
      handlers: { "library.books.list": async () => [BOOK] },
    });
    await expect(client.library.books.list()).resolves.toEqual([BOOK]);
    expect(tracked).toHaveLength(1);
    await expect(tracked[0]).resolves.toEqual([BOOK]);
  });

  it("does not track a call that does not read the Library", async () => {
    const tracked: Promise<unknown>[] = [];
    const { client } = setup({
      trackLibraryWork: (work) => {
        tracked.push(work);
        return work;
      },
    });
    await client.notifications.show({ variant: "info", message: "hi" });
    expect(tracked).toEqual([]);
  });

  it("refuses a requiresLibrary result that resolves after the Library left", async () => {
    // The handler starts against the author's Library and flips availability
    // before it returns, as the Tutorial switch does (ADR 0008, #398).
    let open = true;
    const { client } = setup({
      declared: ["library:read"],
      isLibraryAvailable: () => open,
      handlers: {
        "library.books.list": async () => {
          open = false;
          return [BOOK];
        },
      },
    });
    expect((await refusal(client.library.books.list())).code).toBe("library-unavailable");
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

  /** Floods for `floodMs` (throttled throughout), then pauses `pauseMs`, `rounds` times. */
  async function floodWithPauses(
    { client, advance }: ReturnType<typeof setup>,
    { floodMs, pauseMs, rounds }: { floodMs: number; pauseMs: number; rounds: number }
  ) {
    for (let round = 0; round < rounds; round++) {
      await Promise.allSettled(Array.from({ length: CALL_BURST + 1 }, () => client.storage.keys()));
      for (let elapsed = 0; elapsed < floodMs; elapsed += 500) {
        advance(500);
        await Promise.allSettled(Array.from({ length: 60 }, () => client.storage.keys()));
        if (client.stopped) return;
      }
      advance(pauseMs);
    }
  }

  it("still stops a Plugin whose throttling pauses for less than a full refill", async () => {
    const harness = setup();
    // 20 s throttled, then just over 1 s of quiet, repeated: still sustained.
    await floodWithPauses(harness, { floodMs: 20_000, pauseMs: 1_100, rounds: 3 });
    expect(harness.onStop).toHaveBeenCalledWith("throttled");
  });

  it("does not stop a Plugin that pauses long enough for the bucket to refill", async () => {
    const harness = setup();
    expect(THROTTLE_GAP_MS).toBe(5_000);
    await floodWithPauses(harness, { floodMs: 20_000, pauseMs: THROTTLE_GAP_MS, rounds: 3 });
    expect(harness.onStop).not.toHaveBeenCalled();
    await expect(harness.client.storage.keys()).resolves.toEqual(["a"]);
  });

  it("names the refused method on rate-limited", async () => {
    const { client } = setup();
    await Promise.allSettled(Array.from({ length: CALL_BURST }, () => client.storage.keys()));
    const error = await refusal(client.storage.keys());
    expect(error.code).toBe("rate-limited");
    expect(error.method).toBe("storage.keys");
  });

  it("lets a reply to a host request through while the Plugin is throttled", async () => {
    const { broker, client } = setup();
    client.onHostRequest(async () => "pong");
    await Promise.allSettled(Array.from({ length: CALL_BURST + 1 }, () => client.storage.keys()));
    expect((await refusal(client.storage.keys())).code).toBe("rate-limited");
    await expect(broker.request("health.check", {})).resolves.toBe("pong");
  });

  it("never runs a call smuggled behind an awaited reply's head with duplicate keys", async () => {
    const keys = vi.fn(async () => ["a"]);
    const { broker, port } = setup({ handlers: { "storage.keys": keys } });
    port.onmessage = null; // the Plugin side never answers on its own
    const request = broker.request("health.check", {});
    // The regex reads a reply to request 1; JSON.parse keeps the later call.
    port.postMessage(
      '{"kind":"reply","id":1,"kind":"call","id":7,"method":"storage.keys","params":{}}'
    );
    const error = await refusal(request);
    expect(error.code).toBe("internal-error");
    expect(keys).not.toHaveBeenCalled();
  });

  it("settles the host request on a malformed reply, so it buys only one unmetered message", async () => {
    const { broker, client, port } = setup();
    const keys = () => client.storage.keys();
    // Leave exactly one token.
    await Promise.allSettled(Array.from({ length: CALL_BURST - 1 }, keys));
    port.onmessage = null;
    const request = refusal(broker.request("health.check", {}));
    port.postMessage('{"kind":"reply","id":1,not json');
    // The same head again: no longer awaited, so it spends the last token.
    port.postMessage('{"kind":"reply","id":1,not json');
    expect((await request).code).toBe("internal-error");
    const fresh = createPluginClient(port);
    expect((await refusal(fresh.storage.keys())).code).toBe("rate-limited");
  });

  it("still charges a forged reply while throttled", async () => {
    const { client, port } = setup();
    await Promise.allSettled(Array.from({ length: CALL_BURST }, () => client.storage.keys()));
    // Not awaited by the host, so it spends a token like any other message.
    port.postMessage(JSON.stringify({ kind: "reply", id: 99, ok: true, result: "forged" }));
    expect((await refusal(client.storage.keys())).code).toBe("rate-limited");
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

describe("Command run exemption", () => {
  /**
   * Starts hosting a `command.run` the Plugin keeps in flight: `reached`
   * resolves once the Plugin received it, and `finish`/`fail` settle it.
   */
  function holdRun(client: ReturnType<typeof setup>["client"]) {
    let reached: () => void = () => {};
    let settle: (error?: Error) => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    client.onHostRequest(
      () =>
        new Promise<null>((resolve, reject) => {
          reached();
          settle = (error) => (error ? reject(error) : resolve(null));
        })
    );
    return {
      arrived,
      finish: () => settle(),
      fail: () => settle(new Error("Command failed")),
    };
  }

  it("still refuses an unsolicited second notification within the window", async () => {
    const { client } = setup();
    await expect(client.notifications.show({ variant: "info", message: "one" })).resolves.toBe(
      null
    );
    const error = await refusal(client.notifications.show({ variant: "info", message: "two" }));
    expect(error.code).toBe("rate-limited");
  });

  it("accepts two notifications while the Plugin answers a Command run", async () => {
    const { broker, client } = setup();
    const { arrived, finish } = holdRun(client);
    const run = broker.request("command.run", { id: "nextEcho" });
    await arrived;

    await expect(client.notifications.show({ variant: "info", message: "one" })).resolves.toBe(
      null
    );
    await expect(client.notifications.show({ variant: "info", message: "two" })).resolves.toBe(
      null
    );

    finish();
    await expect(run).resolves.toBeNull();
  });

  it("applies the limit again once the Command run settles", async () => {
    const { broker, client } = setup();
    await expect(client.notifications.show({ variant: "info", message: "own" })).resolves.toBe(
      null
    );
    const { arrived, finish } = holdRun(client);
    const run = broker.request("command.run", { id: "nextEcho" });
    await arrived;
    // The solicited announcements come through the exemption and do not reset
    // the unsolicited slot, so the first unsolicited call still owns it.
    await expect(client.notifications.show({ variant: "info", message: "step 1" })).resolves.toBe(
      null
    );
    await expect(client.notifications.show({ variant: "info", message: "step 2" })).resolves.toBe(
      null
    );
    finish();
    await expect(run).resolves.toBeNull();

    const error = await refusal(
      client.notifications.show({ variant: "info", message: "own again" })
    );
    expect(error.code).toBe("rate-limited");
  });

  it("ends the exemption for a Command run left unanswered past its window", async () => {
    const { broker, client, advance } = setup();
    const { arrived, finish } = holdRun(client);
    const run = broker.request("command.run", { id: "nextEcho" });
    await arrived;
    await expect(client.notifications.show({ variant: "info", message: "step" })).resolves.toBe(
      null
    );

    advance(COMMAND_RUN_EXEMPTION_MS);
    await expect(client.notifications.show({ variant: "info", message: "own" })).resolves.toBe(
      null
    );
    const error = await refusal(client.notifications.show({ variant: "info", message: "spam" }));
    expect(error.code).toBe("rate-limited");

    finish();
    await expect(run).resolves.toBeNull();
  });

  it("releases the exemption when the Command run fails", async () => {
    const { broker, client } = setup();
    await expect(client.notifications.show({ variant: "info", message: "own" })).resolves.toBe(
      null
    );
    const { arrived, fail } = holdRun(client);
    const run = refusal(broker.request("command.run", { id: "nextEcho" }));
    await arrived;
    await expect(client.notifications.show({ variant: "info", message: "step" })).resolves.toBe(
      null
    );
    fail();
    expect((await run).code).toBe("internal-error");

    const error = await refusal(
      client.notifications.show({ variant: "info", message: "own again" })
    );
    expect(error.code).toBe("rate-limited");
  });

  it("releases the exemption when the Plugin stops with a Command run in flight", async () => {
    const { broker, client, onStop } = setup();
    const { arrived } = holdRun(client);
    const run = refusal(broker.request("command.run", { id: "nextEcho" }));
    await arrived;
    await expect(client.notifications.show({ variant: "info", message: "step" })).resolves.toBe(
      null
    );

    broker.stop("requested");
    expect((await run).code).toBe("plugin-stopped");
    expect(onStop).toHaveBeenCalledWith("requested");
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
    expect(reply).toMatchObject({
      id: 9,
      ok: false,
      error: { code: "message-too-large", method: "storage.keys" },
    });
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

  it("rejects a host request whose reply is over 4 MB with message-too-large", async () => {
    const { broker, client } = setup();
    client.onHostRequest(async () => "x".repeat(PLUGIN_MESSAGE_MAX_BYTES));
    const error = await refusal(broker.request("health.check", {}));
    expect(error.code).toBe("message-too-large");
    expect(error.method).toBe("health.check");
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

  it("rejects a host request with internal-error when the Plugin's handler throws", async () => {
    const { broker, client } = setup();
    client.onHostRequest(async () => {
      throw new Error("boom");
    });
    const error = await refusal(broker.request("health.check", {}));
    expect(error.code).toBe("internal-error");
    expect(error.message).toBe("boom");
    expect(error.method).toBe("health.check");
  });

  it("keeps the Plugin Permission a typed error names", async () => {
    const { broker, client } = setup();
    client.onHostRequest(async () => {
      throw new PluginApiError({
        code: "permission-denied",
        message: "Needs clipboard",
        permission: "clipboard",
      });
    });
    const error = await refusal(broker.request("command.run", {}));
    expect(error.code).toBe("permission-denied");
    expect(error.permission).toBe("clipboard");
  });

  it("keeps the code of a typed error the Plugin answers with", async () => {
    const { broker, client } = setup();
    client.onHostRequest(async () => {
      throw new PluginApiError({ code: "not-implemented", message: "No such Command" });
    });
    const error = await refusal(broker.request("command.run", {}));
    expect(error.code).toBe("not-implemented");
    expect(error.message).toBe("No such Command");
    expect(error.method).toBe("command.run");
  });

  it("turns an error code outside the protocol into internal-error", async () => {
    const { broker, port } = setup();
    port.onmessage = (event) => {
      const message = event.data as HostToPluginMessage;
      if (message.kind !== "request") return;
      const error = { code: "teapot", message: "short and stout" };
      port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: false, error }));
    };
    expect((await refusal(broker.request("health.check", {}))).code).toBe("internal-error");
  });
});

describe("host requests", () => {
  it("delivers a transferred MessagePort nested in a request's params", async () => {
    const { broker, port } = setup();
    const inner = new MessageChannel();
    channels.push(inner);
    const delivered = new Promise<MessagePort>((resolve) => {
      port.onmessage = (event) => {
        const message = event.data as HostToPluginMessage;
        if (message.kind !== "request") return;
        resolve((message.params as { port: MessagePort }).port);
        port.postMessage(JSON.stringify({ kind: "reply", id: message.id, ok: true, result: null }));
      };
    });
    await expect(broker.request("x", { port: inner.port1 }, [inner.port1])).resolves.toBeNull();
    const pluginPort = await delivered;
    const hostEnd = new Promise<string>((resolve) => {
      inner.port2.onmessage = (event) => resolve(event.data as string);
    });
    pluginPort.postMessage("over the transferred port");
    await expect(hostEnd).resolves.toBe("over the transferred port");
  });

  it("still settles a request sent without a transfer list", async () => {
    const { broker, client } = setup();
    client.onHostRequest(async () => "pong");
    await expect(broker.request("health.check", {})).resolves.toBe("pong");
  });
});

describe("stopping", () => {
  it("rejects calls in flight and every later call with plugin-stopped", async () => {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const handlerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { broker, client, onStop } = setup({
      handlers: {
        "storage.keys": () => {
          entered();
          return new Promise<string[]>((resolve) => {
            release = () => resolve(["late"]);
          });
        },
      },
    });
    const inFlight = client.storage.keys();
    await handlerEntered;
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
    const { broker, port, hostPort } = setup({ handlers: { "storage.keys": keys } });
    broker.stop("requested");
    const witnessed = reachesHost(hostPort, "witness");
    port.postMessage(JSON.stringify({ kind: "call", id: 1, method: "storage.keys", params: {} }));
    port.postMessage("witness");
    await witnessed;
    expect(keys).not.toHaveBeenCalled();
    expect(broker.stopped).toBe(true);
  });
});

describe("events", () => {
  const CHANGE = { entity: "book", id: "b1", origin: "local", kind: "content" } as const;

  it("delivers an event the Plugin subscribed to and holds the Plugin Permission for", async () => {
    const { broker, client } = setup({ declared: ["library:read"] });
    const received: unknown[] = [];
    await client.on("library.changed", (payload) => received.push(payload));
    expect(broker.emit("library.changed", CHANGE)).toBe(true);
    await vi.waitFor(() => expect(received).toEqual([CHANGE]));
  });

  it("delivers nothing the Plugin did not subscribe to", () => {
    const { broker } = setup({ declared: ["library:read"] });
    expect(broker.emit("library.changed", CHANGE)).toBe(false);
  });

  it("refuses a subscription without the event's Plugin Permission", async () => {
    const { broker, client } = setup({ declared: ["library:read"], grantedAtStart: [] });
    const error = await refusal(client.on("library.changed", () => {}));
    expect(error.code).toBe("permission-denied");
    expect(error.permission).toBe("library:read");
    expect(error.method).toBe("library.changed");
    expect(broker.emit("library.changed", CHANGE)).toBe(false);
  });

  it("stops delivering once the Plugin Permission is revoked, and resumes once granted again", async () => {
    const { broker, client, granted } = setup({ declared: ["editor:read"] });
    const listener = vi.fn();
    await client.on("editor.focusChanged", listener);
    granted.delete("editor:read");
    expect(broker.emit("editor.focusChanged", { entity: null })).toBe(false);
    granted.add("editor:read");
    expect(broker.emit("editor.focusChanged", { entity: null })).toBe(true);
  });

  it("lets any Plugin subscribe to Library availability", async () => {
    const { broker, client } = setup();
    const payload = new Promise((resolve) => {
      void client.on("library.availabilityChanged", resolve).then(() => {
        broker.emit("library.availabilityChanged", { available: false });
      });
    });
    await expect(payload).resolves.toEqual({ available: false });
  });

  it("replays a replaying event's current value on subscription, then delivers changes", async () => {
    const { broker, client } = setup({
      eventSnapshot: (event) => (event === "language.changed" ? { language: "en" } : undefined),
    });
    const seen: string[] = [];
    const first = new Promise<void>((resolve) => {
      void client.on("language.changed", (payload) => {
        seen.push(payload.language);
        resolve();
      });
    });
    await first;
    expect(seen).toEqual(["en"]);

    broker.emit("language.changed", { language: "es" });
    await vi.waitFor(() => expect(seen).toEqual(["en", "es"]));
  });

  it("does not replay an event without a snapshot", async () => {
    const { broker, client } = setup();
    const seen: unknown[] = [];
    await client.on("library.availabilityChanged", (payload) => seen.push(payload));
    expect(broker.emit("library.availabilityChanged", { available: false })).toBe(true);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen).toEqual([{ available: false }]);
  });

  it("refuses an unknown event with unknown-method", async () => {
    const { client } = setup();
    const on = client.on as (event: string, fn: () => void) => Promise<unknown>;
    const error = await refusal(on("library.burned", () => {}));
    expect(error.code).toBe("unknown-method");
    expect(error.method).toBe("library.burned");
  });

  it("shares one subscription between listeners and ends it with the last one", async () => {
    const { broker, client } = setup({ declared: ["library:read"] });
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = await client.on("library.changed", first);
    const offSecond = await client.on("library.changed", second);
    await offFirst();
    expect(broker.emit("library.changed", CHANGE)).toBe(true);
    // second's call is the witness: the shared delivery reached every listener, first's included.
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
    await offSecond();
    expect(broker.emit("library.changed", CHANGE)).toBe(false);
  });

  it("refuses to emit a payload with content in it", async () => {
    const { broker, client } = setup({ declared: ["editor:read"] });
    await client.on("editor.contentChanged", () => {});
    const leaky = { entity: { kind: "chapter", id: "c1" }, text: "secret draft" };
    expect(() => broker.emit("editor.contentChanged", leaky as never)).toThrow();
  });

  it("delivers nothing once the Plugin is stopped", async () => {
    const { broker, client } = setup({ declared: ["library:read"] });
    await client.on("library.changed", () => {});
    broker.stop("requested");
    expect(broker.emit("library.changed", CHANGE)).toBe(false);
  });
});

describe("streamed bodies", () => {
  async function* chunks(...texts: string[]) {
    for (const text of texts) yield { text };
  }

  function stream(client: ReturnType<typeof setup>["client"], url = "https://api.example.com/sse") {
    const received: string[] = [];
    const ended = new Promise<PluginApiError | undefined>((resolve) => {
      void client.network.fetch(
        { url },
        { onChunk: (chunk) => received.push(chunk.text), onEnd: resolve }
      );
    });
    return { received, ended };
  }

  it("resolves with the response head, then sends the body in order and ends it", async () => {
    const { client } = setup({
      declared: ["network:api.example.com"],
      handlers: {
        "network.fetch": async () => ({
          result: {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "text/event-stream" },
          },
          body: chunks("data: a\n\n", "data: b\n\n"),
        }),
      },
    });
    const head = await client.network.fetch({ url: "https://api.example.com/sse" });
    expect(head.status).toBe(200);
    const { received, ended } = stream(client);
    await expect(ended).resolves.toBeUndefined();
    expect(received).toEqual(["data: a\n\n", "data: b\n\n"]);
  });

  it("streams a network.fetch body larger than 64 KB through the real broker with no error", async () => {
    const text = "line of text\n".repeat(8_000);
    const fetch = async () => {
      const bytes = new TextEncoder().encode(text);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        { status: 200, statusText: "OK" }
      );
    };
    const { client } = setup({
      declared: ["network:api.example.com"],
      handlers: {
        "network.fetch": (params) =>
          pluginFetch(params, {
            pluginId: "fixture",
            store: createMemoryPluginSecretStore(),
            fetch,
          }),
      },
    });

    const received: string[] = [];
    const ended = new Promise<PluginApiError | undefined>((resolve) => {
      void client.network.fetch(
        { url: "https://api.example.com/big" },
        { onChunk: (chunk) => received.push(chunk.text), onEnd: resolve }
      );
    });

    await expect(ended).resolves.toBeUndefined();
    expect(received.length).toBeGreaterThan(1);
    for (const chunk of received) {
      expect(utf8ByteLength(JSON.stringify({ text: chunk }))).toBeLessThanOrEqual(
        PLUGIN_STREAM_CHUNK_MAX_BYTES
      );
    }
    expect(received.join("")).toBe(text);
  });

  it("ends the body with internal-error when the host's stream fails, hiding the detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup({
      declared: ["network:api.example.com"],
      handlers: {
        "network.fetch": async () => ({
          result: { status: 200, statusText: "OK", headers: {} },
          body: (async function* () {
            yield { text: "partial" };
            throw new Error("ECONNRESET 10.0.0.7");
          })(),
        }),
      },
    });
    const { received, ended } = stream(client);
    const error = await ended;
    expect(received).toEqual(["partial"]);
    expect(error?.code).toBe("internal-error");
    expect(error?.message).not.toContain("10.0.0.7");
    vi.restoreAllMocks();
  });

  function fetchHandler(body: AsyncIterable<unknown>): PluginApiHandlers {
    return {
      "network.fetch": async () => ({
        result: { status: 200, statusText: "OK", headers: {} },
        body: body as AsyncIterable<{ text: string }>,
      }),
    };
  }

  it("ends the body with internal-error when a chunk is over 64 KB, before sending it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const big = "x".repeat(PLUGIN_STREAM_CHUNK_MAX_BYTES);
    const { client } = setup({
      declared: ["network:api.example.com"],
      handlers: fetchHandler(chunks("ok", big)),
    });
    const { received, ended } = stream(client);
    expect((await ended)?.code).toBe("internal-error");
    expect(received).toEqual(["ok"]);
    vi.restoreAllMocks();
  });

  it("accepts a chunk exactly at 64 KB serialized", async () => {
    const overhead = JSON.stringify({ text: "" }).length;
    const exact = "x".repeat(PLUGIN_STREAM_CHUNK_MAX_BYTES - overhead);
    const { client } = setup({
      declared: ["network:api.example.com"],
      handlers: fetchHandler(chunks(exact)),
    });
    const { received, ended } = stream(client);
    await expect(ended).resolves.toBeUndefined();
    expect(received).toEqual([exact]);
  });

  it("ends the body with internal-error when a chunk breaks the row's chunk schema", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup({
      declared: ["network:api.example.com"],
      handlers: fetchHandler(
        (async function* () {
          yield { text: "ok", secret: "sk-123" };
        })()
      ),
    });
    const { received, ended } = stream(client);
    expect((await ended)?.code).toBe("internal-error");
    expect(received).toEqual([]);
    vi.restoreAllMocks();
  });

  it("refuses a streaming handler that returns no body with internal-error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup({
      declared: ["network:api.example.com"],
      handlers: {
        "network.fetch": (async () => ({ status: 200, statusText: "OK", headers: {} })) as never,
      },
    });
    const error = await refusal(client.network.fetch({ url: "https://api.example.com/" }));
    expect(error.code).toBe("internal-error");
    vi.restoreAllMocks();
  });

  it("cancels an idle body as soon as the Plugin stops", async () => {
    const cancel = vi.fn(async () => ({ done: true as const, value: undefined }));
    let sent = false;
    const idle: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (sent) return new Promise<IteratorResult<unknown>>(() => {});
          sent = true;
          return Promise.resolve({ done: false, value: { text: "first" } });
        },
        return: cancel,
      }),
    };
    const { broker, client } = setup({
      declared: ["network:api.example.com"],
      handlers: fetchHandler(idle),
    });
    const { received, ended } = stream(client);
    await vi.waitFor(() => expect(received).toEqual(["first"]));
    broker.stop("requested");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect((await ended)?.code).toBe("plugin-stopped");
  });

  it("ends an open body with plugin-stopped when the Plugin stops", async () => {
    let release: () => void = () => {};
    const { broker, client } = setup({
      declared: ["network:api.example.com"],
      handlers: {
        "network.fetch": async () => ({
          result: { status: 200, statusText: "OK", headers: {} },
          body: (async function* () {
            yield { text: "first" };
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            yield { text: "after stop" };
          })(),
        }),
      },
    });
    const { received, ended } = stream(client);
    await vi.waitFor(() => expect(received).toEqual(["first"]));
    broker.stop("requested");
    release();
    expect((await ended)?.code).toBe("plugin-stopped");
    expect(received).toEqual(["first"]);
  });
});

describe("File Grants (ADR 0036)", () => {
  const FILE = { name: "a.pdf", bytes: new Uint8Array([1, 2, 3, 4, 5]) };

  /** The six `files.*` handlers over one in-memory store, in the broker's shape. */
  function fileHandlers(store: MemoryPluginFileGrantStore): PluginApiHandlers {
    return {
      "files.pick": ({ extensions }, { pluginId }) => store.pick(pluginId, extensions),
      "files.read": ({ grant, offset, length }, { pluginId }) =>
        store.read(pluginId, grant, offset, length),
      "files.stat": ({ grant }, { pluginId }) => store.stat(pluginId, grant),
      "files.requestAccess": ({ grant }, { pluginId }) => store.requestAccess(pluginId, grant),
      "files.release": async ({ grant }, { pluginId }) => {
        await store.release(pluginId, grant);
        return null;
      },
      "files.list": (_params, { pluginId }) => store.list(pluginId),
    };
  }

  /** Holds one `command.run` in flight: the author's Command is running. */
  function holdCommandRun(client: ReturnType<typeof setup>["client"]) {
    let reached: () => void = () => {};
    let settle: (error?: Error) => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    client.onHostRequest(
      () =>
        new Promise<null>((resolve, reject) => {
          reached();
          settle = (error) => (error ? reject(error) : resolve(null));
        })
    );
    return { arrived, finish: () => settle() };
  }

  it("refuses every files.* without files:pick", async () => {
    const store = createMemoryPluginFileGrantStore();
    const { client } = setup({
      declared: ["files:pick"],
      grantedAtStart: [],
      handlers: fileHandlers(store),
    });

    const calls = [
      () => client.files.pick({ extensions: ["pdf"] }),
      () => client.files.read({ grant: "g", offset: 0, length: 1 }),
      () => client.files.stat({ grant: "g" }),
      () => client.files.requestAccess({ grant: "g" }),
      () => client.files.release({ grant: "g" }),
      () => client.files.list(),
    ];
    for (const call of calls) {
      const error = await refusal(call());
      expect(error.code).toBe("permission-denied");
      expect(error.permission).toBe("files:pick");
    }
  });

  it("refuses files.pick with user-action-required outside the author's action", async () => {
    const store = createMemoryPluginFileGrantStore();
    const { client } = setup({
      declared: ["files:pick"],
      hasUserActivation: () => false,
      handlers: fileHandlers(store),
    });
    store.queuePick("fixture", FILE);

    const error = await refusal(client.files.pick({ extensions: ["pdf"] }));

    expect(error.code).toBe("user-action-required");
    await expect(client.files.list()).resolves.toEqual([]);
  });

  it("accepts files.pick inside the author's click", async () => {
    const store = createMemoryPluginFileGrantStore();
    const { client } = setup({
      declared: ["files:pick"],
      hasUserActivation: () => true,
      handlers: fileHandlers(store),
    });
    store.queuePick("fixture", FILE);

    await expect(client.files.pick({ extensions: ["pdf"] })).resolves.toMatchObject({
      name: "a.pdf",
      size: 5,
    });
  });

  it("accepts files.pick while the Plugin answers a Command run", async () => {
    const store = createMemoryPluginFileGrantStore();
    const { broker, client } = setup({
      declared: ["files:pick"],
      hasUserActivation: () => false,
      handlers: fileHandlers(store),
    });
    store.queuePick("fixture", FILE);
    const { arrived, finish } = holdCommandRun(client);
    const run = broker.request("command.run", { id: "openFile" });
    await arrived;

    await expect(client.files.pick({ extensions: ["pdf"] })).resolves.toMatchObject({
      name: "a.pdf",
    });

    finish();
    await expect(run).resolves.toBeNull();
  });

  it("refuses files.requestAccess outside the author's action too", async () => {
    const store = createMemoryPluginFileGrantStore([{ pluginId: "fixture", ...FILE }]);
    const { client } = setup({
      declared: ["files:pick"],
      hasUserActivation: () => false,
      handlers: fileHandlers(store),
    });
    const [grant] = await store.list("fixture");

    const error = await refusal(client.files.requestAccess({ grant: grant.grant }));

    expect(error.code).toBe("user-action-required");
  });

  it("refuses a negative offset, a zero length, and a range over the cap", async () => {
    const store = createMemoryPluginFileGrantStore([{ pluginId: "fixture", ...FILE }]);
    const { client } = setup({ declared: ["files:pick"], handlers: fileHandlers(store) });
    const [grant] = await store.list("fixture");

    for (const input of [
      { grant: grant.grant, offset: -1, length: 1 },
      { grant: grant.grant, offset: 0, length: 0 },
      { grant: grant.grant, offset: 0, length: FILE_READ_MAX_BYTES + 1 },
    ]) {
      const error = await refusal(client.files.read(input));
      expect(error.code, JSON.stringify(input)).toBe("invalid-params");
    }
  });

  it("reads a range as a transferred ArrayBuffer, short and empty past the end", async () => {
    const store = createMemoryPluginFileGrantStore([{ pluginId: "fixture", ...FILE }]);
    const { client } = setup({ declared: ["files:pick"], handlers: fileHandlers(store) });
    const [grant] = await store.list("fixture");

    const three = await client.files.read({ grant: grant.grant, offset: 1, length: 10 });
    // The bytes cross the port by transfer, so they arrive as an ArrayBuffer
    // (not a view or a copied JSON shape).
    expect(Object.prototype.toString.call(three)).toBe("[object ArrayBuffer]");
    expect(three.byteLength).toBe(4);
    expect([...new Uint8Array(three)]).toEqual([2, 3, 4, 5]);

    const empty = await client.files.read({ grant: grant.grant, offset: 5, length: 10 });
    expect(Object.prototype.toString.call(empty)).toBe("[object ArrayBuffer]");
    expect(empty.byteLength).toBe(0);
  });

  it("scopes grant ids by Plugin: another Plugin's grant is file-missing", async () => {
    const store = createMemoryPluginFileGrantStore([{ pluginId: "alpha", ...FILE }]);
    const [alphaGrant] = await store.list("alpha");
    const handlers = fileHandlers(store);
    const alpha = setup({ pluginId: "alpha", declared: ["files:pick"], handlers });
    const beta = setup({ pluginId: "beta", declared: ["files:pick"], handlers });

    await expect(alpha.client.files.stat({ grant: alphaGrant.grant })).resolves.toMatchObject({
      name: "a.pdf",
    });
    const error = await refusal(
      beta.client.files.read({ grant: alphaGrant.grant, offset: 0, length: 1 })
    );
    expect(error.code).toBe("file-missing");
  });

  it("ends a grant on release", async () => {
    const store = createMemoryPluginFileGrantStore();
    store.queuePick("fixture", FILE);
    const { client } = setup({
      declared: ["files:pick"],
      hasUserActivation: () => true,
      handlers: fileHandlers(store),
    });
    const picked = await client.files.pick({ extensions: ["pdf"] });
    if (!picked) throw new Error("the pick resolved to null");

    await expect(client.files.release({ grant: picked.grant })).resolves.toBeNull();

    await expect(client.files.list()).resolves.toEqual([]);
    const error = await refusal(client.files.read({ grant: picked.grant, offset: 0, length: 1 }));
    expect(error.code).toBe("file-missing");
  });
});

describe("open work", () => {
  it("reports no open work on a fresh broker", () => {
    const { broker } = setup();
    expect(broker.hasOpenWork()).toBe(false);
  });

  it("ignores the heartbeat: an unanswered health check is not open work", async () => {
    const { broker, client } = setup();
    client.onHostRequest(() => new Promise<null>(() => {}));
    const beat = broker.request("health.check", {});
    expect(broker.hasOpenWork()).toBe(false);
    broker.stop("requested");
    await expect(beat).rejects.toBeTruthy();
  });

  it("reports a host request as open work until the Plugin answers it", async () => {
    const { broker, client } = setup();
    let settle: () => void = () => {};
    let reached: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    client.onHostRequest(
      () =>
        new Promise<null>((resolve) => {
          reached();
          settle = () => resolve(null);
        })
    );
    const run = broker.request("command.run", { id: "nextEcho" });
    await arrived;
    expect(broker.hasOpenWork()).toBe(true);

    settle();
    await run;
    expect(broker.hasOpenWork()).toBe(false);
  });

  it("reports a Plugin call as open work until its handler finishes", async () => {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const handlerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { broker, client } = setup({
      handlers: {
        "storage.keys": () => {
          entered();
          return new Promise<string[]>((resolve) => {
            release = () => resolve(["a"]);
          });
        },
      },
    });
    const keys = client.storage.keys();
    await handlerEntered;
    expect(broker.hasOpenWork()).toBe(true);

    release();
    await keys;
    expect(broker.hasOpenWork()).toBe(false);
  });
});
