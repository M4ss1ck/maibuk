import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PluginEndpointSupervisorOptions,
  dispatchEndpointRequest,
  startPluginEndpoint,
} from "@/features/plugins/endpoint";
import { usePluginManagementStore } from "@/features/plugins/management";
import type {
  EndpointListenerState,
  EndpointRequestMessage,
  PluginApproval,
  PluginEndpointSink,
  PluginManifest,
  PluginPermissionId,
  PluginRuntime,
} from "@/features/plugins/types";
import type { EndpointAdapter } from "@/lib/platform/types";

const REQUEST = {
  method: "GET",
  path: "/plugin/acme/mcp?x=1",
  headers: [["accept", "application/json"]] as [string, string][],
  body: "",
};

function manifest(pluginId: string, permissions: string[] = ["serve"]): PluginManifest {
  return {
    id: pluginId,
    name: pluginId,
    version: "1.0.0",
    description: "",
    author: { name: "Test" },
    license: "MIT",
    engines: { maibuk: "^1.0.0" },
    lifecycle: "persistent",
    defaultLanguage: "en",
    permissions: { required: permissions, optional: [] },
    contributes: {},
  } as unknown as PluginManifest;
}

function approval(pluginId: string, overrides: Partial<PluginApproval> = {}): PluginApproval {
  return {
    pluginId,
    pinnedHash: "h1:test",
    granted: ["serve"] as PluginPermissionId[],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: ["serve"], optional: [] },
    approvedFiles: {},
    ...overrides,
  } as PluginApproval;
}

function runtime(
  pluginId: string,
  permissions: string[],
  requestEndpoint: (request: unknown, sink: PluginEndpointSink) => void
): PluginRuntime {
  return {
    manifest: manifest(pluginId, permissions),
    broker: { requestEndpoint },
    files: [],
    sendFrame: () => {},
    stop: () => {},
  } as unknown as PluginRuntime;
}

function message(pluginId: string, requestId = "1"): EndpointRequestMessage {
  return { requestId, pluginId, request: REQUEST };
}

function recordingSink() {
  const calls = {
    responses: [] as {
      status: number;
      headers: [string, string][];
      body?: string;
      streaming: boolean;
    }[],
    chunks: [] as string[],
    ends: 0,
  };
  const sink: PluginEndpointSink = {
    respond(status, headers, body, streaming) {
      calls.responses.push({ status, headers, body, streaming });
    },
    chunk(chunk) {
      calls.chunks.push(chunk);
      return true;
    },
    end() {
      calls.ends += 1;
    },
  };
  return { sink, calls };
}

function fakeAdapter(state: EndpointListenerState = { state: "listening", port: 29217 }) {
  const sync = vi.fn<
    (
      ids: readonly string[],
      onRequest: (message: EndpointRequestMessage) => void
    ) => Promise<EndpointListenerState>
  >(async () => state);
  const respond = vi.fn(async () => {});
  const chunk = vi.fn(async () => true);
  const end = vi.fn(async () => {});
  return { adapter: { sync, respond, chunk, end } as EndpointAdapter, sync, respond, chunk, end };
}

describe("dispatchEndpointRequest", () => {
  it("delivers to the running Plugin's broker when it holds serve", () => {
    const requestEndpoint = vi.fn();
    const deps = {
      runtime: (id: string) => (id === "acme" ? runtime(id, ["serve"], requestEndpoint) : null),
      approval: (id: string) => approval(id),
    };
    const { sink, calls } = recordingSink();

    dispatchEndpointRequest(deps, message("acme"), sink);

    expect(requestEndpoint).toHaveBeenCalledWith(REQUEST, sink);
    expect(calls.responses).toEqual([]);
  });

  it("answers 404 when the Plugin is not running", () => {
    const requestEndpoint = vi.fn();
    const deps = {
      runtime: () => null,
      approval: (id: string) => approval(id),
    };
    const { sink, calls } = recordingSink();

    dispatchEndpointRequest(deps, message("acme"), sink);

    expect(requestEndpoint).not.toHaveBeenCalled();
    expect(calls.responses).toEqual([
      { status: 404, headers: [], body: undefined, streaming: false },
    ]);
  });

  it("answers 404 when the author revoked serve", () => {
    const requestEndpoint = vi.fn();
    const deps = {
      runtime: (id: string) => runtime(id, ["serve"], requestEndpoint),
      approval: (id: string) => approval(id, { granted: ["library:read"] as PluginPermissionId[] }),
    };
    const { sink, calls } = recordingSink();

    dispatchEndpointRequest(deps, message("acme"), sink);

    expect(requestEndpoint).not.toHaveBeenCalled();
    expect(calls.responses[0]?.status).toBe(404);
  });

  it("answers 404 when the manifest does not declare serve", () => {
    const requestEndpoint = vi.fn();
    const deps = {
      runtime: (id: string) => runtime(id, ["library:read"], requestEndpoint),
      approval: (id: string) => approval(id),
    };
    const { sink, calls } = recordingSink();

    dispatchEndpointRequest(deps, message("acme"), sink);

    expect(requestEndpoint).not.toHaveBeenCalled();
    expect(calls.responses[0]?.status).toBe(404);
  });

  it("answers 404 when the Plugin is disabled", () => {
    const requestEndpoint = vi.fn();
    const deps = {
      runtime: (id: string) => runtime(id, ["serve"], requestEndpoint),
      approval: (id: string) => approval(id, { enabled: false }),
    };
    const { sink, calls } = recordingSink();

    dispatchEndpointRequest(deps, message("acme"), sink);

    expect(requestEndpoint).not.toHaveBeenCalled();
    expect(calls.responses[0]?.status).toBe(404);
  });

  it("never routes a request for one Plugin into another", () => {
    const alice = vi.fn();
    const bob = vi.fn();
    const deps = {
      runtime: (id: string) =>
        id === "alice" ? runtime("alice", ["serve"], alice) : runtime("bob", ["serve"], bob),
      approval: (id: string) => approval(id),
    };
    const { sink } = recordingSink();

    dispatchEndpointRequest(deps, message("bob"), sink);

    expect(bob).toHaveBeenCalledTimes(1);
    expect(alice).not.toHaveBeenCalled();
  });
});

describe("startPluginEndpoint", () => {
  const stoppers: (() => void)[] = [];

  beforeEach(() => {
    usePluginManagementStore.getState().setEndpoint({ state: "off" });
  });

  afterEach(() => {
    for (const stop of stoppers.splice(0)) stop();
    vi.restoreAllMocks();
  });

  /**
   * A supervisor whose serving set the test moves by hand. The installed
   * manifest of an approved Plugin declares `serve` unless the test registers
   * another one in `manifests`; `running` moves the runtime alone.
   */
  function setup(options: PluginEndpointSupervisorOptions = {}) {
    const running = new Set<string>();
    const approvals = new Map<string, PluginApproval>();
    const manifests = new Map<string, PluginManifest>();
    const brokers = new Map<string, (request: unknown, sink: PluginEndpointSink) => void>();
    const listeners = new Set<() => void>();
    const fake = fakeAdapter();
    const adapter = options.adapter ?? fake.adapter;
    const sync = adapter.sync as typeof fake.sync;
    const supervisor = startPluginEndpoint({
      ...options,
      adapter,
      runtime: (id) =>
        running.has(id) ? runtime(id, ["serve"], brokers.get(id) ?? (() => {})) : null,
      approval: (id) => approvals.get(id) ?? null,
      approvals: () => [...approvals.values()],
      manifest: (id) => manifests.get(id) ?? (approvals.has(id) ? manifest(id) : null),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    stoppers.push(supervisor);
    return {
      adapter,
      sync,
      respond: adapter.respond as typeof fake.respond,
      running,
      approvals,
      manifests,
      brokers,
      changed: () => {
        for (const listener of [...listeners]) listener();
      },
    };
  }

  it("never binds while no Plugin serves", async () => {
    const { sync, running, approvals } = setup();
    approvals.set(
      "quiet",
      approval("quiet", { granted: ["library:read"] as PluginPermissionId[] })
    );
    running.add("quiet");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));

    expect(sync.mock.calls[0]?.[0]).toEqual([]);
  });

  it("syncs [id] when a serve Plugin is enabled, before it runs", async () => {
    const { sync, approvals, changed } = setup();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    expect(sync.mock.calls.at(-1)?.[0]).toEqual([]);

    approvals.set("acme", approval("acme"));
    changed();

    await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toEqual(["acme"]));
  });

  it("answers 404 for an enabled serve Plugin that is not running", async () => {
    const { sync, respond, approvals, brokers, changed } = setup();
    const requestEndpoint = vi.fn();
    brokers.set("acme", requestEndpoint);
    approvals.set("acme", approval("acme"));
    changed();
    await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toEqual(["acme"]));

    const onRequest = sync.mock.calls.at(-1)?.[1];
    onRequest?.(message("acme", "7"));

    expect(requestEndpoint).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith("7", 404, [], undefined, false);
  });

  it("syncs [] once the last serve Plugin is disabled, not when it stops", async () => {
    const { sync, running, approvals, changed } = setup();
    approvals.set("acme", approval("acme"));
    running.add("acme");
    changed();
    await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toEqual(["acme"]));
    const before = sync.mock.calls.length;

    // Stopping keeps the port bound: the Plugin is still enabled and serves.
    running.delete("acme");
    changed();
    approvals.set("acme", approval("acme", { enabled: false }));
    changed();

    await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toEqual([]));
    // The disable added the one unbind; the stop on its own added none.
    expect(sync.mock.calls.length).toBe(before + 1);
  });

  it("does not serve an approved Plugin whose installed manifest lacks serve", async () => {
    const { sync, approvals, manifests, changed } = setup();
    approvals.set("acme", approval("acme"));
    manifests.set("acme", manifest("acme", ["library:read"]));
    changed();

    // A later real change settles the chain; acme never reaches the adapter.
    approvals.set("beta", approval("beta"));
    changed();

    await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toEqual(["beta"]));
    expect(sync.mock.calls.every(([ids]) => !ids.includes("acme"))).toBe(true);
  });

  it("syncs both ids when two Plugins serve", async () => {
    const { sync, running, approvals, changed } = setup();
    approvals.set("zulu", approval("zulu"));
    approvals.set("acme", approval("acme"));
    running.add("zulu");
    running.add("acme");
    changed();

    await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toEqual(["acme", "zulu"]));
  });

  it("skips a change that leaves the serving set identical", async () => {
    const { sync, running, approvals, changed } = setup();
    approvals.set("acme", approval("acme"));
    running.add("acme");
    changed();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));

    // Two notifications with the same set cost no IPC; a real change after
    // them adds exactly one call.
    changed();
    changed();
    approvals.set("beta", approval("beta"));
    running.add("beta");
    changed();

    await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toEqual(["acme", "beta"]));
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("stores a failed listener state and logs it", async () => {
    const failed: EndpointListenerState = {
      state: "failed",
      port: 29217,
      reason: "address already in use",
    };
    const log = vi.fn();
    const { running, approvals, changed } = setup({ adapter: fakeAdapter(failed).adapter, log });

    approvals.set("acme", approval("acme"));
    running.add("acme");
    changed();

    await vi.waitFor(() => expect(usePluginManagementStore.getState().endpoint).toEqual(failed));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("29217"));
  });

  it("routes an inbound request through the dispatcher into the adapter", async () => {
    const requestEndpoint = vi.fn((_request: unknown, sink: PluginEndpointSink) => {
      sink.respond(200, [["content-type", "text/plain"]], "aGk=", false);
    });
    const { sync, respond, running, approvals, brokers, changed } = setup();
    brokers.set("acme", requestEndpoint);
    approvals.set("acme", approval("acme"));
    running.add("acme");
    changed();
    await vi.waitFor(() => expect(sync.mock.calls.at(-1)?.[0]).toEqual(["acme"]));

    const onRequest = sync.mock.calls.at(-1)?.[1];
    onRequest?.(message("acme"));

    expect(requestEndpoint).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("1", 200, [["content-type", "text/plain"]], "aGk=", false);
  });
});
