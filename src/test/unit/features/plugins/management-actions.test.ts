/**
 * The Plugin management store's actions (#443, unit U3): adding a Plugin from
 * a `.zip` or a picked folder, removing one with or without its retained data,
 * reinstalling a removed Built-in, and the 50 MB data-size warning. The store
 * is created directly with an injected directory, lifecycle, and Built-in
 * source, the same seam `management.test.ts` and `management-state.test.ts`
 * use. Storage is mocked, so `clearPluginStorage` and `getPluginDataSize` can
 * be observed without a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  getPluginApproval,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import {
  PLUGIN_KNOWN_STORAGE_KEY,
  getKnownPlugin,
  saveKnownPlugin,
} from "@/features/plugins/known";
import {
  PLUGIN_DATA_SIZE_WARNING_BYTES,
  createPluginManagementStore,
} from "@/features/plugins/management";
import { clearPluginStorage, getPluginDataSize } from "@/features/plugins/storage";
import type {
  BuiltInPlugin,
  BuiltInPluginSource,
  PluginFolder,
  PluginLifecycle,
  PluginLifecycleChange,
  PluginLifecycleState,
  PluginManifest,
  PluginNotification,
  PluginStartReason,
} from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import { PLUGIN_MANIFEST, pluginFolder } from "@/test/support/plugin-fixtures";

vi.mock("@/features/plugins/storage", () => ({
  listPluginStorageKeys: vi.fn(async () => []),
  getPluginStorageValue: vi.fn(async () => undefined),
  setPluginStorageValue: vi.fn(async () => {}),
  deletePluginStorageValue: vi.fn(async () => {}),
  clearPluginStorage: vi.fn(async () => {}),
  getPluginDataVersion: vi.fn(async () => null),
  setPluginDataVersion: vi.fn(async () => {}),
  getPluginDataSize: vi.fn(async () => 0),
}));

const ID = "echoes";
const PERMISSIONS: PluginManifest["permissions"] = { required: ["library:read"], optional: ["secrets"] };

beforeEach(() => {
  localStorage.clear();
  vi.mocked(clearPluginStorage).mockClear();
  vi.mocked(getPluginDataSize).mockReset().mockResolvedValue(0);
});

afterEach(() => {
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  localStorage.removeItem(PLUGIN_KNOWN_STORAGE_KEY);
});

/** A mutable Plugin Directory of one `kind`; folders can be added and removed. */
function makeDirectory(
  kind: PluginDirectoryAdapter["kind"],
  folders: PluginFolder[] = [],
  options: { replaceFolder?: boolean } = {}
) {
  const map = new Map(folders.map((folder) => [folder.name, folder]));
  const removed: string[] = [];
  const adapter: PluginDirectoryAdapter = {
    kind,
    listFolders: async () => [...map.keys()],
    readFolder: async (name) => map.get(name) ?? null,
    removeFolder: async (name) => {
      if (!map.has(name)) return false;
      map.delete(name);
      removed.push(name);
      return true;
    },
  };
  if (options.replaceFolder !== false) {
    adapter.replaceFolder = async (name, files) => {
      map.set(name, { name, files: [...files] });
      return true;
    };
  }
  return { adapter, map, removed };
}

/** A folder with its own directory name while its manifest declares `id`. */
function folderNamed(
  folderName: string,
  id: string,
  manifest: Partial<PluginManifest> = {}
): PluginFolder {
  const base = pluginFolder({}, { id, name: id, ...manifest });
  return { name: folderName, files: base.files };
}

/** The shipped Built-in the folder stands for. */
async function shippedOf(folder: PluginFolder): Promise<BuiltInPlugin> {
  const manifest = JSON.parse(
    new TextDecoder().decode(folder.files.find((file) => file.path === "manifest.json")?.bytes)
  ) as PluginManifest;
  return {
    id: manifest.id,
    manifest,
    hash: await hashPluginDirectory(folder.files),
    files: folder.files,
  };
}

/** The Built-in folder used by the reinstall and removal tests. */
function builtInFolder(): PluginFolder {
  return pluginFolder({}, { id: ID, name: "Echoes", permissions: PERMISSIONS });
}

/** A controlled lifecycle: the store reads its state and calls uninstall. */
function createFakeLifecycle() {
  const uninstalled: string[] = [];
  const states = new Map<string, PluginLifecycleState>();
  const listeners = new Set<(change: PluginLifecycleChange) => void>();
  const lifecycle: PluginLifecycle = {
    launch: async () => {},
    installed: () => [],
    launchScanned: () => true,
    onLaunchScanned: () => () => {},
    surfaceReached: () => {},
    surfaceLeft: () => {},
    start: async (_pluginId: string, reason: PluginStartReason) => ({ ok: true, startReason: reason }),
    install: async (_pluginId: string, reason: PluginStartReason) => ({
      ok: true,
      startReason: reason,
    }),
    uninstall: (pluginId) => {
      uninstalled.push(pluginId);
      states.delete(pluginId);
    },
    stop: (pluginId) => {
      states.delete(pluginId);
    },
    state: (pluginId) => states.get(pluginId) ?? null,
    runtime: () => null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {},
  };
  return { lifecycle, uninstalled, states };
}

interface StoreOptions {
  lifecycle?: PluginLifecycle;
  builtInSource?: BuiltInPluginSource;
  notify?: (notification: PluginNotification) => void;
}

function makeStore(directory: PluginDirectoryAdapter, options: StoreOptions = {}) {
  return createPluginManagementStore({
    directory,
    lifecycle: () => options.lifecycle ?? null,
    ...(options.builtInSource ? { builtInSource: options.builtInSource } : {}),
    ...(options.notify ? { notify: options.notify } : {}),
  });
}

/** Saves an enabled approval pinned to the folder's current hash. */
async function approveFolder(folder: PluginFolder): Promise<void> {
  savePluginApproval({
    pluginId: folder.name,
    pinnedHash: await hashPluginDirectory(folder.files),
    granted: [],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  });
}

describe("Plugin management actions: adding", () => {
  it("addFromZip returns the installed id and refreshes the list", async () => {
    const folder = pluginFolder({}, { id: "tracer", name: "Tracer" });
    const dir = makeDirectory("web");
    const store = makeStore(dir.adapter);
    dir.adapter.addFromZip = async () => {
      dir.map.set(folder.name, folder);
      return folder.name;
    };

    const installed = await store.getState().addFromZip();

    expect(installed).toBe("tracer");
    expect(store.getState().plugins.tracer.installed).toBe(true);
  });

  it("addFromZip returns null when the picker is cancelled", async () => {
    const dir = makeDirectory("web");
    const store = makeStore(dir.adapter);
    dir.adapter.addFromZip = async () => null;

    await expect(store.getState().addFromZip()).resolves.toBeNull();
  });

  it("addFromZip returns null when the adapter cannot install", async () => {
    const dir = makeDirectory("web");
    const store = makeStore(dir.adapter);

    await expect(store.getState().addFromZip()).resolves.toBeNull();
  });

  it("addFromFolder returns null when the adapter has no folder picker", async () => {
    const dir = makeDirectory("web");
    const store = makeStore(dir.adapter);

    await expect(store.getState().addFromFolder()).resolves.toBeNull();
  });

  it("propagates an adapter error so the UI can toast it", async () => {
    const dir = makeDirectory("web");
    const store = makeStore(dir.adapter);
    dir.adapter.addFromZip = async () => {
      throw new Error("the .zip could not be read");
    };

    await expect(store.getState().addFromZip()).rejects.toThrow("the .zip could not be read");
  });

  it("re-adding a removed id clears removed and does not restore the approval", async () => {
    const folder = pluginFolder({}, { id: "tracer", name: "Tracer" });
    saveKnownPlugin({
      pluginId: "tracer",
      manifest: { ...PLUGIN_MANIFEST, id: "tracer", name: "Tracer" },
      builtIn: false,
      removed: true,
    });
    expect(getPluginApproval("tracer")).toBeNull();

    const dir = makeDirectory("web");
    const store = makeStore(dir.adapter);
    dir.adapter.addFromZip = async () => {
      dir.map.set(folder.name, folder);
      return folder.name;
    };

    await store.getState().addFromZip();

    expect(getKnownPlugin("tracer")?.removed).toBe(false);
    // Removal deleted the approval; re-adding never brings it back.
    expect(getPluginApproval("tracer")).toBeNull();
  });
});

describe("Plugin management actions: remove", () => {
  it("stops the runtime, deletes the folder and approval, and keeps the row", async () => {
    const folder = pluginFolder({}, { id: "tracer", name: "Tracer" });
    const dir = makeDirectory("web", [folder]);
    await approveFolder(folder);
    const fake = createFakeLifecycle();
    fake.states.set("tracer", { status: "ready", startReason: "enable" });
    const store = makeStore(dir.adapter, { lifecycle: fake.lifecycle });
    await store.getState().refresh();
    expect(store.getState().plugins.tracer.installed).toBe(true);

    await store.getState().remove("tracer", { deleteData: false });

    expect(dir.removed).toEqual(["tracer"]);
    expect(dir.map.has("tracer")).toBe(false);
    expect(getPluginApproval("tracer")).toBeNull();
    expect(getKnownPlugin("tracer")?.removed).toBe(true);
    const entry = store.getState().plugins.tracer;
    expect(entry.installed).toBe(false);
    expect(entry.removed).toBe(true);
    expect(entry.approval).toBeNull();
    // The runtime was stopped through the reused disable.
    expect(fake.uninstalled).toContain("tracer");
    // Library data is kept by default.
    expect(clearPluginStorage).not.toHaveBeenCalled();
  });

  it("clears the retained data when deleteData is true", async () => {
    const folder = pluginFolder({}, { id: "tracer", name: "Tracer" });
    const dir = makeDirectory("web", [folder]);
    await approveFolder(folder);
    const store = makeStore(dir.adapter);
    await store.getState().refresh();

    await store.getState().remove("tracer", { deleteData: true });

    expect(clearPluginStorage).toHaveBeenCalledWith("tracer");
  });

  it("refreshes the shown data size after erasing it, so the row offers no Delete data", async () => {
    const folder = pluginFolder({}, { id: "tracer", name: "Tracer" });
    const dir = makeDirectory("web", [folder]);
    await approveFolder(folder);
    const store = makeStore(dir.adapter);
    await store.getState().refresh();
    vi.mocked(getPluginDataSize).mockResolvedValue(4096);
    await store.getState().refreshDataSize("tracer");
    expect(store.getState().dataSizes.tracer).toBe(4096);

    // The erase zeroes the size; the store must read it again for the row,
    // which does not re-run its size effect when the entry's id is unchanged.
    vi.mocked(getPluginDataSize).mockResolvedValue(0);
    await store.getState().remove("tracer", { deleteData: true });

    expect(clearPluginStorage).toHaveBeenCalledWith("tracer");
    expect(store.getState().dataSizes.tracer).toBe(0);
  });

  it("removes every folder when two folders declare the same id", async () => {
    const dir = makeDirectory("web", [
      folderNamed("tracer-a", "tracer"),
      folderNamed("tracer-b", "tracer"),
    ]);
    const store = makeStore(dir.adapter);
    await store.getState().refresh();
    expect([...store.getState().plugins.tracer.duplicateFolders].sort()).toEqual([
      "tracer-a",
      "tracer-b",
    ]);

    await store.getState().remove("tracer", { deleteData: false });

    expect([...dir.removed].sort()).toEqual(["tracer-a", "tracer-b"]);
    expect(dir.map.has("tracer-a")).toBe(false);
    expect(dir.map.has("tracer-b")).toBe(false);
  });
});

describe("Plugin management actions: delete data", () => {
  it("clears the retained namespace and keeps the removed row", async () => {
    saveKnownPlugin({
      pluginId: "tracer",
      manifest: { ...PLUGIN_MANIFEST, id: "tracer", name: "Tracer" },
      builtIn: false,
      removed: true,
    });
    const dir = makeDirectory("web");
    const store = makeStore(dir.adapter);
    await store.getState().refresh();
    expect(store.getState().plugins.tracer.removed).toBe(true);

    await store.getState().deleteData("tracer");

    expect(clearPluginStorage).toHaveBeenCalledWith("tracer");
    const entry = store.getState().plugins.tracer;
    expect(entry).toBeDefined();
    expect(entry.removed).toBe(true);
    expect(entry.installed).toBe(false);
    expect(store.getState().dataSizes.tracer).toBe(0);
  });
});

describe("Plugin management actions: reinstall a Built-in", () => {
  async function builtInSetup() {
    const shipped = builtInFolder();
    const built = await shippedOf(shipped);
    const source: BuiltInPluginSource = { list: async () => [built] };
    const dir = makeDirectory("web", [shipped]);
    const fake = createFakeLifecycle();
    const store = makeStore(dir.adapter, { builtInSource: source, lifecycle: fake.lifecycle });
    return { shipped, built, dir, store };
  }

  it("writes the shipped copy, clears removed, and pre-grants afresh", async () => {
    const { dir, store } = await builtInSetup();
    await store.getState().refresh();
    expect(getPluginApproval(ID)?.granted).toEqual(["library:read", "secrets"]);
    // The author revokes an optional grant, then removes the Built-in.
    await store.getState().revoke(ID, "secrets");
    await store.getState().remove(ID, { deleteData: true });
    expect(getPluginApproval(ID)).toBeNull();
    expect(store.getState().plugins[ID].removed).toBe(true);

    const result = await store.getState().reinstallBuiltIn(ID);

    expect(result).toBe(true);
    expect(dir.map.has(ID)).toBe(true);
    const approval = getPluginApproval(ID);
    // A fresh pre-grant, not the old approval: every shipped grant is back.
    expect(approval).toMatchObject({ granted: ["library:read", "secrets"], enabled: true });
    expect(store.getState().plugins[ID]).toMatchObject({
      installed: true,
      removed: false,
      modified: false,
      review: { status: "approved" },
    });
  });

  it("returns false for a third-party Plugin", async () => {
    const folder = pluginFolder({}, { id: "tracer", name: "Tracer" });
    const dir = makeDirectory("web", [folder]);
    await approveFolder(folder);
    const store = makeStore(dir.adapter);
    await store.getState().refresh();

    await expect(store.getState().reinstallBuiltIn("tracer")).resolves.toBe(false);
  });

  it("returns false when the adapter cannot write a folder", async () => {
    const shipped = builtInFolder();
    const built = await shippedOf(shipped);
    const source: BuiltInPluginSource = { list: async () => [built] };
    const dir = makeDirectory("web", [shipped], { replaceFolder: false });
    const store = makeStore(dir.adapter, { builtInSource: source });
    await store.getState().refresh();

    await expect(store.getState().reinstallBuiltIn(ID)).resolves.toBe(false);
  });
});

describe("Plugin management actions: app updates respect removal", () => {
  it("does not pre-grant a removed Built-in whose folder is present again", async () => {
    const shipped = builtInFolder();
    const built = await shippedOf(shipped);
    const source: BuiltInPluginSource = { list: async () => [built] };
    const dir = makeDirectory("web", [shipped]);
    // The author removed it earlier; an app update left the shipped folder behind.
    saveKnownPlugin({
      pluginId: ID,
      manifest: built.manifest,
      builtIn: true,
      removed: true,
    });
    const store = makeStore(dir.adapter, { builtInSource: source });

    await store.getState().refresh();

    expect(getPluginApproval(ID)).toBeNull();
    expect(store.getState().plugins[ID].review.status).toBe("not-approved");
  });

  it("does not pre-grant a Built-in the app has not removed", async () => {
    // Contrast: without the removed mark, the same refresh pre-grants it.
    const shipped = builtInFolder();
    const built = await shippedOf(shipped);
    const source: BuiltInPluginSource = { list: async () => [built] };
    const dir = makeDirectory("web", [shipped]);
    const store = makeStore(dir.adapter, { builtInSource: source });

    await store.getState().refresh();

    expect(getPluginApproval(ID)).toMatchObject({ enabled: true });
  });
});

describe("Plugin management actions: data size and the 50 MB warning", () => {
  async function sizeSetup() {
    const folder = pluginFolder({}, { id: "tracer", name: "Tracer" });
    const dir = makeDirectory("web", [folder]);
    const notified: PluginNotification[] = [];
    const store = makeStore(dir.adapter, { notify: (notification) => notified.push(notification) });
    await store.getState().refresh();
    return { store, notified };
  }

  it("dataSize returns the stored data size", async () => {
    const { store } = await sizeSetup();
    vi.mocked(getPluginDataSize).mockResolvedValue(1234);

    await expect(store.getState().dataSize("tracer")).resolves.toBe(1234);
  });

  it("warns once when a refreshed size passes 50 MB", async () => {
    const { store, notified } = await sizeSetup();
    vi.mocked(getPluginDataSize).mockResolvedValue(PLUGIN_DATA_SIZE_WARNING_BYTES);

    await store.getState().refreshDataSize("tracer");

    expect(store.getState().dataSizes.tracer).toBe(PLUGIN_DATA_SIZE_WARNING_BYTES);
    expect(store.getState().notifications).toHaveLength(1);
    expect(store.getState().notifications[0]).toMatchObject({ pluginId: "tracer", kind: "size" });
    expect(notified).toHaveLength(1);
    expect(getKnownPlugin("tracer")?.dataSizeWarned).toBe(true);

    // A second refresh over the threshold adds no new notification.
    await store.getState().refreshDataSize("tracer");
    expect(store.getState().notifications).toHaveLength(1);
    expect(notified).toHaveLength(1);
  });

  it("adds no notification under 50 MB", async () => {
    const { store, notified } = await sizeSetup();
    vi.mocked(getPluginDataSize).mockResolvedValue(PLUGIN_DATA_SIZE_WARNING_BYTES - 1);

    await store.getState().refreshDataSize("tracer");

    expect(store.getState().dataSizes.tracer).toBe(PLUGIN_DATA_SIZE_WARNING_BYTES - 1);
    expect(store.getState().notifications).toHaveLength(0);
    expect(notified).toHaveLength(0);
  });
});
