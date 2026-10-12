/**
 * Plugin development mode (#442, plan decision 6): a watched Plugin folder's
 * completed build reloads the Plugin automatically, while a partial or failed
 * build keeps the previous one running and records nothing. Development mode
 * skips file-change review but a new required Plugin Permission still blocks,
 * and turning development mode off ignores change events entirely.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  getPluginApproval,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import { createPluginManagementStore } from "@/features/plugins/management";
import * as pluginStorage from "@/features/plugins/storage";
import type {
  PluginFolder,
  PluginLifecycle,
  PluginManifest,
  PluginPermissionId,
} from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import {
  PLUGIN_MANIFEST,
  fakePluginFrame,
  installMicrotaskMessageChannel,
  pluginFolder,
  sourceFolder,
  type FakePluginFrame,
} from "@/test/support/plugin-fixtures";

const ID = "tracer";

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
  resetPluginContributionsForTests();
});

/** A mutable Plugin Directory whose watch is captured and whose reads are counted. */
function makeDirectory(initial: PluginFolder) {
  let current = initial;
  let queued: PluginFolder[] | null = null;
  let reads = 0;
  const watchers = new Set<(id: string) => void>();
  const adapter: PluginDirectoryAdapter = {
    listFolders: async () => [current.name],
    readFolder: async (name) => {
      if (name !== current.name) return null;
      reads += 1;
      if (queued && queued.length > 0) return queued.shift() as PluginFolder;
      return current;
    },
    watch: (onChanged) => {
      watchers.add(onChanged);
      return () => {
        watchers.delete(onChanged);
      };
    },
  };
  return {
    adapter,
    setFolder(folder: PluginFolder): void {
      current = folder;
    },
    queueReads(folders: PluginFolder[]): void {
      queued = [...folders];
    },
    fire(id: string): void {
      for (const watcher of [...watchers]) watcher(id);
    },
    reads: () => reads,
    watcherCount: () => watchers.size,
  };
}

interface SetupOptions {
  manifest?: Partial<PluginManifest>;
  granted?: PluginPermissionId[];
  devMode?: boolean;
  /** Builds each sandbox frame, so a test can make one start fail. */
  createFrame?: () => FakePluginFrame;
}

async function setup(options: SetupOptions = {}) {
  const folder = pluginFolder({}, { id: ID, name: ID, ...options.manifest });
  const dir = makeDirectory(folder);
  const frames: FakePluginFrame[] = [];
  const lifecycle = createPluginLifecycle({
    directory: dir.adapter,
    createFrame: () => {
      const frame = options.createFrame ? options.createFrame() : fakePluginFrame();
      frames.push(frame);
      return frame;
    },
    scheduleIdle: (work) => work(),
    whenLaunchSettled: async () => undefined,
    dataVersions: { get: async () => null, set: async () => undefined },
  });
  lifecycles.push(lifecycle);

  savePluginApproval({
    pluginId: ID,
    pinnedHash: await hashPluginDirectory(folder.files),
    granted: options.granted ?? [],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: {
      required: [...(options.manifest?.permissions?.required ?? [])],
      optional: [...(options.manifest?.permissions?.optional ?? [])],
    },
    approvedFiles: {},
  });

  let devMode = options.devMode ?? true;
  const store = createPluginManagementStore({
    directory: dir.adapter,
    lifecycle: () => lifecycle,
    isDevelopmentMode: () => devMode,
    debounceMs: 0,
  });

  return {
    dir,
    frames,
    lifecycle,
    store,
    setDevMode(value: boolean): void {
      devMode = value;
    },
  };
}

/** Fires one change and waits until the reload read the folder twice. */
async function fireChange(h: Awaited<ReturnType<typeof setup>>): Promise<void> {
  const before = h.dir.reads();
  h.dir.fire(ID);
  await vi.waitFor(() => expect(h.dir.reads()).toBeGreaterThanOrEqual(before + 2));
}

describe("Plugin development mode: completed build", () => {
  it("reloads a completed build, keeping the author's grants and stored data", async () => {
    const clearStorage = vi.spyOn(pluginStorage, "clearPluginStorage");
    const h = await setup({
      manifest: { permissions: { required: ["library:read"], optional: ["editor:read"] } },
      granted: ["library:read"],
    });
    await h.lifecycle.launch();
    await h.store.getState().refresh();
    expect(h.lifecycle.state(ID)?.status).toBe("ready");
    expect(h.frames).toHaveLength(1);
    expect(h.dir.watcherCount()).toBe(1);

    const next = pluginFolder(
      { "index.js": "export const a = 2;" },
      {
        id: ID,
        name: ID,
        version: "1.1.0",
        permissions: { required: ["library:read"], optional: ["editor:read"] },
      }
    );
    h.dir.setFolder(next);

    h.dir.fire(ID);
    await vi.waitFor(() => expect(h.frames).toHaveLength(2));

    const approval = getPluginApproval(ID);
    expect(approval?.pinnedHash).toBe(await hashPluginDirectory(next.files));
    expect(approval?.approvedVersion).toBe("1.1.0");
    // The author's grants survive the reload.
    expect(approval?.granted).toEqual(["library:read"]);
    expect(h.lifecycle.state(ID)?.status).toBe("ready");
    expect(h.store.getState().plugins[ID].review.status).toBe("approved");
    // The reload restarts the Plugin; it never clears its stored data.
    expect(clearStorage).not.toHaveBeenCalled();
    clearStorage.mockRestore();
  });
});

describe("Plugin development mode: launch reload", () => {
  it("reloads a copy that changed while the app was closed", async () => {
    const h = await setup();
    // The author edited the files while the app was closed: the launch scan
    // finds a copy its pin no longer matches.
    const next = pluginFolder(
      { "index.js": "export const a = 2;" },
      { id: ID, name: ID, version: "1.1.0" }
    );
    h.dir.setFolder(next);

    await h.lifecycle.launch();
    expect(h.frames).toHaveLength(0);

    // The dev-launch step picks the completed build up: re-pinned and started.
    await h.store.getState().refresh();

    expect(h.frames).toHaveLength(1);
    expect(h.lifecycle.state(ID)?.status).toBe("ready");
    expect(getPluginApproval(ID)?.pinnedHash).toBe(await hashPluginDirectory(next.files));
    expect(h.store.getState().plugins[ID].review.status).toBe("approved");
  });

  it("does not load a partial build at launch", async () => {
    const h = await setup();
    // A half-written build: the manifest is valid but its entry file is gone.
    h.dir.setFolder(
      sourceFolder({ "manifest.json": JSON.stringify({ ...PLUGIN_MANIFEST, id: ID, name: ID }) })
    );

    await h.lifecycle.launch();
    await h.store.getState().refresh();

    expect(h.frames).toHaveLength(0);
    expect(h.store.getState().plugins[ID].review.status).toBe("review-required");
    expect(h.lifecycle.state(ID)?.status).not.toBe("ready");
  });
});

describe("Plugin development mode: partial build", () => {
  it("keeps the previous build and re-pins nothing when the two reads disagree", async () => {
    const h = await setup();
    await h.lifecycle.launch();
    await h.store.getState().refresh();
    const pinned = getPluginApproval(ID)?.pinnedHash;

    const first = pluginFolder({ "index.js": "export const a = 2;" }, { id: ID, name: ID });
    const second = pluginFolder({ "index.js": "export const a = 3;" }, { id: ID, name: ID });
    h.dir.queueReads([first, second]);

    await fireChange(h);

    expect(h.frames).toHaveLength(1);
    expect(getPluginApproval(ID)?.pinnedHash).toBe(pinned);
    expect(h.lifecycle.state(ID)?.status).toBe("ready");
  });

  it("keeps the previous build when the manifest declares a missing entry file", async () => {
    const h = await setup();
    await h.lifecycle.launch();
    await h.store.getState().refresh();
    const pinned = getPluginApproval(ID)?.pinnedHash;

    const partial = sourceFolder({
      "manifest.json": JSON.stringify({ ...PLUGIN_MANIFEST, id: ID, name: ID }),
    });
    h.dir.setFolder(partial);

    await fireChange(h);

    expect(h.frames).toHaveLength(1);
    expect(getPluginApproval(ID)?.pinnedHash).toBe(pinned);
    expect(h.lifecycle.state(ID)?.status).toBe("ready");
  });

  it("keeps the previous build when the manifest is invalid", async () => {
    const h = await setup();
    await h.lifecycle.launch();
    await h.store.getState().refresh();
    const pinned = getPluginApproval(ID)?.pinnedHash;

    h.dir.setFolder(sourceFolder({ "manifest.json": "not json", "index.js": "export {}" }));

    await fireChange(h);

    expect(h.frames).toHaveLength(1);
    expect(getPluginApproval(ID)?.pinnedHash).toBe(pinned);
    expect(h.lifecycle.state(ID)?.status).toBe("ready");
  });
});

describe("Plugin development mode: permission gate", () => {
  it("skips file review but blocks a new required permission the author never granted", async () => {
    const h = await setup({
      manifest: { permissions: { required: ["library:read"], optional: [] } },
      granted: ["library:read"],
    });
    await h.lifecycle.launch();
    await h.store.getState().refresh();
    const pinned = getPluginApproval(ID)?.pinnedHash;

    const next = pluginFolder(
      { "index.js": "export const a = 2;" },
      {
        id: ID,
        name: ID,
        permissions: { required: ["library:read", "editor:write"], optional: [] },
      }
    );
    h.dir.setFolder(next);

    h.dir.fire(ID);
    await vi.waitFor(() =>
      expect(h.store.getState().plugins[ID].review.status).toBe("review-required")
    );

    // The previous build keeps running and nothing is re-pinned.
    expect(h.frames).toHaveLength(1);
    expect(h.lifecycle.state(ID)?.status).toBe("ready");
    expect(getPluginApproval(ID)?.pinnedHash).toBe(pinned);
  });
});

describe("Plugin development mode: startup failure", () => {
  it("stores the startup error until the next successful build clears it", async () => {
    let failing = false;
    const h = await setup({
      createFrame: () => (failing ? fakePluginFrame({ fail: "boom" }) : fakePluginFrame()),
    });
    await h.lifecycle.launch();
    await h.store.getState().refresh();
    expect(h.lifecycle.state(ID)?.status).toBe("ready");

    // A completed build whose restart fails: the error is recorded and it stays off.
    failing = true;
    h.dir.setFolder(pluginFolder({ "index.js": "export const a = 2;" }, { id: ID, name: ID }));
    h.dir.fire(ID);
    await vi.waitFor(() => expect(getPluginApproval(ID)?.startupError).toBe("boom"));

    expect(h.store.getState().plugins[ID].approval?.startupError).toBe("boom");
    expect(h.lifecycle.state(ID)?.status).toBe("stopped");

    // The next successful build clears the error and runs again.
    failing = false;
    h.dir.setFolder(pluginFolder({ "index.js": "export const a = 3;" }, { id: ID, name: ID }));
    h.dir.fire(ID);
    await vi.waitFor(() => expect(h.lifecycle.state(ID)?.status).toBe("ready"));

    expect(getPluginApproval(ID)?.startupError).toBeUndefined();
    expect(h.store.getState().plugins[ID].approval?.startupError).toBeUndefined();
  });

  it("records an incompatible completed build as its code", async () => {
    const h = await setup();
    await h.lifecycle.launch();
    await h.store.getState().refresh();
    expect(h.lifecycle.state(ID)?.status).toBe("ready");

    // A completed build whose manifest wants a newer Plugin API: the reload
    // restarts it, and the incompatible refusal is recorded as its code.
    h.dir.setFolder(
      pluginFolder({ "index.js": "export const a = 2;" }, { id: ID, name: ID, apiVersion: "^99.0" })
    );
    h.dir.fire(ID);
    await vi.waitFor(() => expect(getPluginApproval(ID)?.startupError).toBe("incompatible"));

    expect(h.store.getState().plugins[ID].approval?.startupError).toBe("incompatible");
  });
});

describe("Plugin development mode: off", () => {
  it("never subscribes, ignores change events, and leaves a changed copy review-required", async () => {
    const h = await setup({ devMode: false });
    await h.lifecycle.launch();
    await h.store.getState().refresh();
    expect(h.dir.watcherCount()).toBe(0);

    h.dir.setFolder(pluginFolder({ "index.js": "export const a = 2;" }, { id: ID, name: ID }));
    h.dir.fire(ID);

    await h.store.getState().refresh();

    expect(h.store.getState().plugins[ID].review.status).toBe("review-required");
    expect(h.frames).toHaveLength(1);
  });

  it("unsubscribes when development mode is turned off", async () => {
    const h = await setup({ devMode: true });
    await h.store.getState().refresh();
    expect(h.dir.watcherCount()).toBe(1);

    h.setDevMode(false);
    await h.store.getState().refresh();

    expect(h.dir.watcherCount()).toBe(0);
  });
});
