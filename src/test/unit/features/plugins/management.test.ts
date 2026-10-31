import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  getPluginApproval,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { PLUGIN_KNOWN_STORAGE_KEY } from "@/features/plugins/known";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import { createPluginManagementStore } from "@/features/plugins/management";
import type {
  PluginLifecycle,
  PluginManifest,
  PluginNotification,
  PluginPermissionId,
} from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import {
  fakePluginFrame,
  installMicrotaskMessageChannel,
  pluginFolder,
  sourceFolder,
  PLUGIN_MANIFEST,
  type FakePluginFrame,
} from "@/test/support/plugin-fixtures";

const lifecycles: PluginLifecycle[] = [];
let restoreMessageChannel: (() => void) | null = null;

beforeEach(() => {
  restoreMessageChannel = installMicrotaskMessageChannel();
});

afterEach(() => {
  for (const lifecycle of lifecycles.splice(0)) lifecycle.dispose();
  restoreMessageChannel?.();
  restoreMessageChannel = null;
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  localStorage.removeItem(PLUGIN_KNOWN_STORAGE_KEY);
  resetPluginContributionsForTests();
});

interface SetupOptions {
  manifest?: Partial<PluginManifest>;
  /** Save an enabled approval pinned to the folder's current hash before launch. */
  approve?: boolean;
  /** Save an enabled approval pinned to a stale hash: the copy's files changed. */
  changed?: boolean;
  granted?: PluginPermissionId[];
}

async function setup(options: SetupOptions = {}) {
  const id = "tracer";
  const folder = pluginFolder({}, { id, name: id, ...options.manifest });
  const folders = new Map([[folder.name, folder]]);
  const directory: PluginDirectoryAdapter = {
    kind: "web",
    listFolders: async () => [...folders.keys()],
    readFolder: async (name) => folders.get(name) ?? null,
  };
  const frames: FakePluginFrame[] = [];
  const lifecycle = createPluginLifecycle({
    directory,
    createFrame: () => {
      const frame = fakePluginFrame();
      frames.push(frame);
      return frame;
    },
    scheduleIdle: (work) => work(),
    whenLaunchSettled: async () => undefined,
    dataVersions: { get: async () => null, set: async () => undefined },
  });
  lifecycles.push(lifecycle);

  if (options.approve || options.changed) {
    savePluginApproval({
      pluginId: id,
      pinnedHash: options.changed ? "h1:stale" : await hashPluginDirectory(folder.files),
      granted: options.granted ?? [],
      enabled: true,
      approvedVersion: "",
      approvedPermissions: {
        required: [...(options.manifest?.permissions?.required ?? [])],
        optional: [...(options.manifest?.permissions?.optional ?? [])],
      },
      approvedFiles: {},
    });
  }

  const notified: PluginNotification[] = [];
  const store = createPluginManagementStore({
    directory,
    lifecycle: () => lifecycle,
    notify: (notification) => notified.push(notification),
  });

  return { id, folder, lifecycle, store, frames, notified };
}

describe("Plugin management: approve", () => {
  it("stores the pinned hash and grants and enables the copy", async () => {
    const h = await setup({
      manifest: { permissions: { required: ["library:read"], optional: ["editor:read"] } },
    });
    await h.store.getState().refresh();
    expect(h.store.getState().plugins.tracer.review.status).toBe("not-approved");

    await h.store.getState().approve("tracer", ["editor:read"]);

    const approval = getPluginApproval("tracer");
    expect(approval).toMatchObject({
      pinnedHash: await hashPluginDirectory(h.folder.files),
      granted: ["library:read", "editor:read"],
      enabled: true,
      approvedPermissions: { required: ["library:read"], optional: ["editor:read"] },
    });
    expect(approval?.approvedFiles).toHaveProperty("manifest.json");
    expect(h.store.getState().plugins.tracer.review.status).toBe("approved");
  });

  it("refuses to approve a copy that requires review, re-pinning and starting nothing", async () => {
    const h = await setup({ changed: true });
    await h.lifecycle.launch();
    await h.store.getState().refresh();
    expect(h.store.getState().plugins.tracer.review.status).toBe("review-required");
    const pinned = getPluginApproval("tracer")?.pinnedHash;

    const result = await h.store.getState().approve("tracer", []);

    expect(result).toMatchObject({ ok: false, reason: "review-required" });
    // The changed hash is never re-pinned, and no copy starts.
    expect(getPluginApproval("tracer")?.pinnedHash).toBe(pinned);
    expect(h.frames).toHaveLength(0);
    expect(h.lifecycle.state("tracer")?.status).not.toBe("ready");
  });

  it("registers and starts a never-approved Plugin without a relaunch", async () => {
    const h = await setup({ manifest: { permissions: { required: [], optional: [] } } });
    // No launch: the Plugin is not installed yet.
    await h.store.getState().refresh();
    expect(h.lifecycle.installed()).toEqual([]);

    await h.store.getState().approve("tracer");

    expect(h.lifecycle.installed().map((plugin) => plugin.pluginId)).toContain("tracer");
    expect(h.frames).toHaveLength(1);
    expect(h.lifecycle.state("tracer")?.status).toBe("ready");
    expect(h.store.getState().plugins.tracer.running).toBe(true);
  });
});

describe("Plugin management: revoke", () => {
  it("keeps an optional revoke running and refuses the next broker call", async () => {
    const h = await setup({
      manifest: { permissions: { required: ["library:read"], optional: ["editor:read"] } },
      approve: true,
      granted: ["library:read", "editor:read"],
    });
    await h.lifecycle.launch();
    expect(h.lifecycle.state("tracer")?.status).toBe("ready");
    await h.store.getState().refresh();
    expect(h.store.getState().plugins.tracer.running).toBe(true);

    // The grant is live: the call succeeds while it is held.
    await expect(h.frames[0].call("editor.getSelection")).resolves.toBeDefined();

    await h.store.getState().revoke("tracer", "editor:read");

    expect(getPluginApproval("tracer")?.granted).toEqual(["library:read"]);
    expect(getPluginApproval("tracer")?.enabled).toBe(true);
    expect(h.lifecycle.state("tracer")?.status).toBe("ready");
    await expect(h.frames[0].call("editor.getSelection")).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("disables the Plugin and stops it when a required grant is revoked", async () => {
    const h = await setup({
      manifest: { permissions: { required: ["library:read"], optional: [] } },
      approve: true,
      granted: ["library:read"],
    });
    await h.lifecycle.launch();
    expect(h.lifecycle.state("tracer")?.status).toBe("ready");
    await h.store.getState().refresh();

    await h.store.getState().revoke("tracer", "library:read");

    expect(getPluginApproval("tracer")?.granted).toEqual([]);
    expect(getPluginApproval("tracer")?.enabled).toBe(false);
    expect(h.lifecycle.state("tracer")).toBeNull();
    expect(h.frames[0].stopped).toBe(true);
    expect(h.store.getState().plugins.tracer.running).toBe(false);
  });

  it("emits permissions.changed to a running Plugin when an optional grant is revoked (#591)", async () => {
    const h = await setup({
      manifest: { permissions: { required: ["library:read"], optional: ["editor:read"] } },
      approve: true,
      granted: ["library:read", "editor:read"],
    });
    await h.lifecycle.launch();
    expect(h.lifecycle.state("tracer")?.status).toBe("ready");
    await h.store.getState().refresh();
    const port = h.frames[0].pluginPort;
    if (!port) throw new Error("tracer has no plugin port");

    // Records the host's events, forwarding everything else to the fake Plugin.
    const events: { event: string; payload: unknown }[] = [];
    const original = port.onmessage;
    port.onmessage = (event) => {
      const data = event.data as { kind?: string; event?: string; payload?: unknown } | null;
      if (data && data.kind === "event" && data.event) {
        events.push({ event: data.event, payload: data.payload });
        return;
      }
      original?.call(port, event);
    };
    port.postMessage(JSON.stringify({ kind: "subscribe", id: 1001, event: "permissions.changed" }));

    // The replay delivers the current grants on subscription.
    await vi.waitFor(() =>
      expect(events).toEqual([
        {
          event: "permissions.changed",
          payload: { permissions: ["library:read", "editor:read"] },
        },
      ])
    );

    await h.store.getState().revoke("tracer", "editor:read");

    expect(getPluginApproval("tracer")?.granted).toEqual(["library:read"]);
    expect(h.lifecycle.state("tracer")?.status).toBe("ready");
    await vi.waitFor(() =>
      expect(events).toEqual([
        {
          event: "permissions.changed",
          payload: { permissions: ["library:read", "editor:read"] },
        },
        { event: "permissions.changed", payload: { permissions: ["library:read"] } },
      ])
    );
    // The method reads the new list through the public surface too.
    await expect(h.frames[0].call("permissions.granted", {})).resolves.toEqual({
      permissions: ["library:read"],
    });
  });
});

describe("Plugin management: changed files", () => {
  it("is review-required, never starts, and notifies once", async () => {
    const h = await setup({ changed: true });
    await h.lifecycle.launch();
    expect(h.frames).toHaveLength(0);
    expect(h.lifecycle.state("tracer")).toEqual({
      status: "stopped",
      reason: null,
      refusal: { code: "review-required", status: "review-required" },
    });

    await h.store.getState().refresh();

    expect(h.store.getState().plugins.tracer.review.status).toBe("review-required");
    expect(h.store.getState().notifications).toHaveLength(1);
    expect(h.store.getState().notifications[0]).toMatchObject({ pluginId: "tracer" });
    expect(h.notified).toHaveLength(1);
  });

  it("never notifies twice for the same changed hash", async () => {
    const h = await setup({ changed: true });

    await h.store.getState().refresh();
    await h.store.getState().refresh();

    expect(h.store.getState().notifications).toHaveLength(1);
    expect(h.notified).toHaveLength(1);
  });

  it("markReviewed re-pins the current copy and starts it", async () => {
    const h = await setup({ changed: true });
    await h.lifecycle.launch();
    expect(h.frames).toHaveLength(0);
    await h.store.getState().refresh();

    await h.store.getState().markReviewed("tracer");

    expect(getPluginApproval("tracer")?.pinnedHash).toBe(await hashPluginDirectory(h.folder.files));
    expect(h.store.getState().plugins.tracer.review.status).toBe("approved");
    expect(h.frames).toHaveLength(1);
    expect(h.lifecycle.state("tracer")?.status).toBe("ready");
  });
});

describe("Plugin management: enable and disable", () => {
  it("disables a running Plugin and stops it, then enables and starts it again", async () => {
    const h = await setup({ approve: true });
    await h.lifecycle.launch();
    expect(h.lifecycle.state("tracer")?.status).toBe("ready");
    await h.store.getState().refresh();

    h.store.getState().disable("tracer");
    expect(getPluginApproval("tracer")?.enabled).toBe(false);
    expect(h.lifecycle.state("tracer")).toBeNull();
    expect(h.store.getState().plugins.tracer.running).toBe(false);

    await h.store.getState().enable("tracer");
    expect(getPluginApproval("tracer")?.enabled).toBe(true);
    expect(h.lifecycle.state("tracer")?.status).toBe("ready");
    expect(h.store.getState().plugins.tracer.running).toBe(true);
  });
});

describe("Plugin management: zero Plugins", () => {
  it("refreshes to an empty list without touching anything", async () => {
    const directory: PluginDirectoryAdapter = {
      kind: "web",
      listFolders: async () => [],
      readFolder: async () => null,
    };
    const store = createPluginManagementStore({ directory, lifecycle: () => null });

    await store.getState().refresh();

    expect(store.getState().plugins).toEqual({});
    expect(store.getState().notifications).toEqual([]);
  });
});

describe("Plugin management: startup error codes", () => {
  it("records an incompatible start as its code", async () => {
    const h = await setup({ manifest: { apiVersion: "^99.0" } });
    await h.store.getState().refresh();

    await h.store.getState().approve("tracer");

    expect(getPluginApproval("tracer")?.startupError).toBe("incompatible");
    expect(h.store.getState().plugins.tracer.approval?.startupError).toBe("incompatible");
  });

  it("records a refused module as its code", async () => {
    // A valid manifest whose declared entry file is missing: the start refuses
    // it as `module-refused` and the code is recorded on the row's record.
    const folder = sourceFolder({
      "manifest.json": JSON.stringify({ ...PLUGIN_MANIFEST, id: "tracer", name: "tracer" }),
    });
    const folders = new Map([[folder.name, folder]]);
    const directory: PluginDirectoryAdapter = {
      kind: "web",
      listFolders: async () => [...folders.keys()],
      readFolder: async (name) => folders.get(name) ?? null,
    };
    const lifecycle = createPluginLifecycle({
      directory,
      createFrame: () => fakePluginFrame(),
      scheduleIdle: (work) => work(),
      whenLaunchSettled: async () => undefined,
      dataVersions: { get: async () => null, set: async () => undefined },
    });
    lifecycles.push(lifecycle);
    const store = createPluginManagementStore({ directory, lifecycle: () => lifecycle });
    await store.getState().refresh();

    await store.getState().approve("tracer");

    expect(getPluginApproval("tracer")?.startupError).toBe("module-refused");
    expect(store.getState().plugins.tracer.approval?.startupError).toBe("module-refused");
  });
});
