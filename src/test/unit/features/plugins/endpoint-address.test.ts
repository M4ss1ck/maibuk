/**
 * The Plugin Endpoint address a Plugin can read and watch (#587): the one
 * derivation both the host handler and the lifecycle emitter use, and the
 * lifecycle's rule that only a real port change reaches a subscribed Plugin
 * that holds `serve`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { endpointUrlFor } from "@/features/plugins/endpoint";
import { createPluginLifecycle, resetPluginLifecycleForTests } from "@/features/plugins/lifecycle";
import { usePluginManagementStore } from "@/features/plugins/management";
import type {
  EndpointListenerState,
  PluginFolder,
  PluginLifecycle,
  PluginPermissionId,
} from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import {
  fakePluginFrame,
  installMicrotaskMessageChannel,
  pluginFolder,
} from "@/test/support/plugin-fixtures";

describe("endpointUrlFor()", () => {
  it("names the Plugin's own path on the bound port", () => {
    expect(endpointUrlFor({ state: "listening", port: 41000 }, "acme")).toBe(
      "http://127.0.0.1:41000/plugin/acme/"
    );
  });

  it("is null while the endpoint is off or failed", () => {
    const off: EndpointListenerState = { state: "off" };
    const failed: EndpointListenerState = { state: "failed", port: 41000, reason: "in use" };
    expect(endpointUrlFor(off, "acme")).toBeNull();
    expect(endpointUrlFor(failed, "acme")).toBeNull();
  });
});

// jsdom's MessagePort delivers on a task the fake timers do not control; a real
// macrotask flush lets each broker round trip land while timers stay fake.
const realSetTimeout = globalThis.setTimeout;

function flushTasks(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 0));
}

async function advance(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flushTasks();
  await vi.advanceTimersByTimeAsync(0);
  await flushTasks();
}

/** One message a Plugin's port received, as the fake Plugin sees it. */
type PortMessage = {
  kind?: string;
  event?: string;
  payload?: { url?: string | null };
  ok?: boolean;
  error?: { code?: string; permission?: string };
};

/** Reads every event and reply on a Plugin's port, forwarding other traffic. */
function watchPort(port: MessagePort) {
  const messages: PortMessage[] = [];
  const original = port.onmessage;
  port.onmessage = (message) => {
    const data = message.data as PortMessage | null;
    if (data && (data.kind === "event" || data.kind === "result")) {
      messages.push(data);
      return;
    }
    original?.call(port, message);
  };
  return {
    messages,
    urls: () =>
      messages
        .filter(
          (message) => message.kind === "event" && message.event === "endpoint.addressChanged"
        )
        .map((message) => message.payload?.url ?? null),
    subscribe: (id: number, event: string) =>
      port.postMessage(JSON.stringify({ kind: "subscribe", id, event })),
  };
}

const lifecycles: PluginLifecycle[] = [];

interface Harness {
  lifecycle: PluginLifecycle;
  port(pluginId: string): MessagePort;
}

async function createHarness(folders: PluginFolder[], granted: PluginPermissionId[]) {
  const byName = new Map(folders.map((folder) => [folder.name, folder]));
  for (const folder of folders) {
    savePluginApproval({
      pluginId: folder.name,
      pinnedHash: await hashPluginDirectory(folder.files),
      granted,
      enabled: true,
      approvedVersion: "",
      approvedPermissions: { required: ["serve"], optional: [] },
      approvedFiles: {},
    });
  }
  const ports = new Map<string, MessagePort>();
  const directory: PluginDirectoryAdapter = {
    kind: "web",
    listFolders: async () => [...byName.keys()],
    readFolder: async (name) => byName.get(name) ?? null,
  };
  const lifecycle = createPluginLifecycle({
    directory,
    createFrame: (_document, manifest) => {
      const frame = fakePluginFrame();
      // The host end of the Plugin's port is handed over when the frame starts.
      const startWorker = frame.startWorker.bind(frame);
      frame.startWorker = (entryUrl, port, quickJs) => {
        ports.set(manifest.id, port);
        return startWorker(entryUrl, port, quickJs);
      };
      return frame;
    },
    scheduleIdle: (work) => setTimeout(work, 0),
    whenLaunchSettled: async () => undefined,
    dataVersions: { get: async () => null, set: async () => undefined },
    builtInSource: { list: async () => [] },
    stopMessage: () => null,
  });
  lifecycles.push(lifecycle);
  return {
    lifecycle,
    ports,
    port(pluginId: string): MessagePort {
      const port = ports.get(pluginId);
      if (!port) throw new Error(`${pluginId} has no plugin port`);
      return port;
    },
  } satisfies Harness & { ports: Map<string, MessagePort> };
}

async function launchAll(h: Harness): Promise<void> {
  let settled = false;
  void h.lifecycle.launch().then(() => {
    settled = true;
  });
  for (let pass = 0; pass < 500 && !settled; pass += 1) await advance(0);
  if (!settled) throw new Error("lifecycle.launch() did not settle");
  await advance(0);
}

function serveFolder(pluginId: string): PluginFolder {
  return pluginFolder(
    {},
    {
      id: pluginId,
      name: pluginId,
      permissions: { required: ["serve"], optional: [] },
    }
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  restoreMessageChannel = installMicrotaskMessageChannel();
  usePluginManagementStore.getState().setEndpoint({ state: "off" });
});

let restoreMessageChannel: () => void;

afterEach(() => {
  for (const lifecycle of lifecycles.splice(0)) lifecycle.dispose();
  restoreMessageChannel?.();
  vi.useRealTimers();
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  resetPluginLifecycleForTests();
});

describe("Plugin Endpoint address events", () => {
  it("emits once per real port change and never to a Plugin without serve", async () => {
    const serving = serveFolder("alpha");
    const unprivileged = pluginFolder(
      {},
      {
        id: "beta",
        name: "beta",
        permissions: { required: [], optional: [] },
      }
    );
    const h = await createHarness([serving, unprivileged], ["serve"]);
    await launchAll(h);

    const alpha = watchPort(h.port("alpha"));
    const beta = watchPort(h.port("beta"));
    alpha.subscribe(1, "endpoint.addressChanged");
    beta.subscribe(1, "endpoint.addressChanged");
    await advance(0);

    // The replay says the endpoint is not bound yet; the unprivileged Plugin
    // is refused the subscription itself, so no event can ever reach it.
    expect(alpha.urls()).toEqual([null]);
    expect(beta.messages).toHaveLength(1);
    expect(beta.messages[0]).toMatchObject({
      kind: "result",
      ok: false,
      error: { code: "permission-denied", permission: "serve" },
    });

    usePluginManagementStore.getState().setEndpoint({ state: "listening", port: 41000 });
    await advance(0);
    expect(alpha.urls()).toEqual([null, "http://127.0.0.1:41000/plugin/alpha/"]);

    // The same port recorded again is not a move: no second event.
    usePluginManagementStore.getState().setEndpoint({ state: "listening", port: 41000 });
    await advance(0);
    expect(alpha.urls()).toEqual([null, "http://127.0.0.1:41000/plugin/alpha/"]);

    usePluginManagementStore.getState().setEndpoint({ state: "listening", port: 42000 });
    await advance(0);
    usePluginManagementStore.getState().setEndpoint({ state: "off" });
    await advance(0);
    expect(alpha.urls()).toEqual([
      null,
      "http://127.0.0.1:41000/plugin/alpha/",
      "http://127.0.0.1:42000/plugin/alpha/",
      null,
    ]);

    // A Plugin without `serve` heard nothing the whole time.
    expect(beta.messages.filter((message) => message.kind === "event")).toEqual([]);
  });
});
