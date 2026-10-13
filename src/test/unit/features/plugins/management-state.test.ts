/**
 * The Plugin management store's state model (#443, unit U2): the known-Plugin
 * list that keeps a row after its files are gone, the Built-in availability, the
 * unsupported-device and duplicate-folder gates on enable, the Stopped reason
 * with Restart, and the pure filter helpers the Settings list uses.
 *
 * The store is created directly with an injected directory (and lifecycle), the
 * same seam `management.test.ts` uses; the directory's `kind` is the device
 * platform the unsupported check reads.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  getPluginApproval,
  savePluginApproval,
} from "@/features/plugins/approvals";
import {
  PLUGIN_FILTER_CATEGORIES,
  countPluginsByCategory,
  createPluginManagementStore,
  filterPluginsByCategories,
  pluginFilterCategories,
} from "@/features/plugins/management";
import {
  PLUGIN_KNOWN_STORAGE_KEY,
  getKnownPlugin,
  markPluginRemoved,
} from "@/features/plugins/known";
import type {
  BuiltInPluginSource,
  PluginFolder,
  PluginLifecycle,
  PluginLifecycleChange,
  PluginManagementEntry,
  PluginManifest,
  PluginReview,
  PluginStartReason,
} from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import { PLUGIN_MANIFEST, pluginFolder } from "@/test/support/plugin-fixtures";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  localStorage.removeItem(PLUGIN_KNOWN_STORAGE_KEY);
});

/** A mutable Plugin Directory of one `kind`; folders can be added and removed. */
function makeDirectory(kind: PluginDirectoryAdapter["kind"], folders: PluginFolder[] = []) {
  const map = new Map(folders.map((folder) => [folder.name, folder]));
  const adapter: PluginDirectoryAdapter = {
    kind,
    listFolders: async () => [...map.keys()],
    readFolder: async (name) => map.get(name) ?? null,
  };
  return {
    adapter,
    add(folder: PluginFolder): void {
      map.set(folder.name, folder);
    },
    remove(name: string): void {
      map.delete(name);
    },
  };
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

async function saveApproval(pluginId: string, enabled: boolean): Promise<void> {
  savePluginApproval({
    pluginId,
    pinnedHash: "h1:any",
    granted: [],
    enabled,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  });
}

interface StoreOptions {
  builtInSource?: BuiltInPluginSource;
  lifecycle?: PluginLifecycle;
}

function makeStore(directory: PluginDirectoryAdapter, options: StoreOptions = {}) {
  return createPluginManagementStore({
    directory,
    lifecycle: () => options.lifecycle ?? null,
    ...(options.builtInSource ? { builtInSource: options.builtInSource } : {}),
  });
}

/** A controlled lifecycle: the store reads its state and subscribes to it. */
function createFakeLifecycle() {
  const listeners = new Set<(change: PluginLifecycleChange) => void>();
  const startCalls: { pluginId: string; reason: PluginStartReason }[] = [];
  const lifecycle: PluginLifecycle = {
    launch: async () => {},
    installed: () => [],
    launchScanned: () => true,
    onLaunchScanned: () => () => {},
    surfaceReached: () => {},
    surfaceLeft: () => {},
    start: async (pluginId, reason) => {
      startCalls.push({ pluginId, reason });
      return { ok: true, startReason: reason };
    },
    install: async (pluginId, reason) => {
      startCalls.push({ pluginId, reason });
      return { ok: true, startReason: reason };
    },
    uninstall: () => {},
    stop: () => {},
    state: () => null,
    runtime: () => null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {},
  };
  return {
    lifecycle,
    startCalls,
    emit(change: PluginLifecycleChange): void {
      for (const listener of [...listeners]) listener(change);
    },
  };
}

const REVIEW: PluginReview = {
  status: "not-approved",
  files: { added: [], removed: [], changed: [] },
  permissions: { added: [], removed: [], nowRequired: [], nowOptional: [] },
  olderVersion: false,
};

/** A management entry for the pure filter tests. */
function entry(overrides: Partial<PluginManagementEntry> & { name?: string } = {}): PluginManagementEntry {
  const { name = "Plugin", ...rest } = overrides;
  return {
    pluginId: name.toLowerCase(),
    manifest: { ...PLUGIN_MANIFEST, id: name.toLowerCase(), name, platforms: ["web"] },
    approval: null,
    review: REVIEW,
    running: false,
    builtIn: false,
    modified: false,
    updateAvailable: false,
    installed: false,
    removed: false,
    available: false,
    unsupported: false,
    duplicateFolders: [],
    stopped: null,
    ...rest,
  };
}

function enabledApproval() {
  return {
    pluginId: "x",
    pinnedHash: "h1:x",
    granted: [],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  };
}

describe("Plugin management state: known Plugins", () => {
  it("records a Plugin on refresh and keeps its row when the folder is deleted", async () => {
    const dir = makeDirectory("web", [folderNamed("tracer", "tracer")]);
    const store = makeStore(dir.adapter);

    await store.getState().refresh();

    expect(store.getState().plugins.tracer.installed).toBe(true);
    expect(getKnownPlugin("tracer")).not.toBeNull();

    dir.remove("tracer");
    await store.getState().refresh();

    const entry = store.getState().plugins.tracer;
    expect(entry).toBeDefined();
    expect(entry.installed).toBe(false);
    expect(entry.manifest.id).toBe("tracer");
  });

  it("shows a removed Plugin as a retained row", async () => {
    const dir = makeDirectory("web", [folderNamed("tracer", "tracer")]);
    const store = makeStore(dir.adapter);
    await store.getState().refresh();

    markPluginRemoved("tracer");
    dir.remove("tracer");
    await store.getState().refresh();

    const entry = store.getState().plugins.tracer;
    expect(entry.removed).toBe(true);
    expect(entry.installed).toBe(false);
  });
});

describe("Plugin management state: availability and support", () => {
  it("lists an absent Built-in as available", async () => {
    const manifest: PluginManifest = { ...PLUGIN_MANIFEST, id: "maibuk-echoes", name: "Echoes" };
    const builtInSource: BuiltInPluginSource = {
      list: async () => [{ id: manifest.id, manifest, hash: "h1:ship", files: [] }],
    };
    const dir = makeDirectory("web", []);
    const store = makeStore(dir.adapter, { builtInSource });

    await store.getState().refresh();

    const entry = store.getState().plugins["maibuk-echoes"];
    expect(entry.available).toBe(true);
    expect(entry.installed).toBe(false);
    expect(entry.builtIn).toBe(true);
  });

  it("marks a manifest that excludes this device unsupported and refuses to enable it", async () => {
    const dir = makeDirectory("desktop", [
      folderNamed("tracer", "tracer", { platforms: ["web"] }),
    ]);
    await saveApproval("tracer", false);
    const store = makeStore(dir.adapter);

    await store.getState().refresh();

    expect(store.getState().plugins.tracer.unsupported).toBe(true);

    await store.getState().enable("tracer");
    expect(getPluginApproval("tracer")?.enabled).toBe(false);
  });

  it("collapses two folders with the same id into one entry and refuses to enable it", async () => {
    const dir = makeDirectory("web", [
      folderNamed("tracer-a", "tracer"),
      folderNamed("tracer-b", "tracer"),
    ]);
    await saveApproval("tracer", false);
    const store = makeStore(dir.adapter);

    await store.getState().refresh();

    expect(Object.keys(store.getState().plugins)).toEqual(["tracer"]);
    const entry = store.getState().plugins.tracer;
    expect([...entry.duplicateFolders].sort()).toEqual(["tracer-a", "tracer-b"]);

    await store.getState().enable("tracer");
    expect(getPluginApproval("tracer")?.enabled).toBe(false);
  });
});

describe("Plugin management state: stopped", () => {
  it("shows the stop reason, and restart clears it", async () => {
    const fake = createFakeLifecycle();
    const dir = makeDirectory("web", [folderNamed("tracer", "tracer")]);
    const store = makeStore(dir.adapter, { lifecycle: fake.lifecycle });
    await store.getState().refresh();

    expect(store.getState().plugins.tracer.stopped).toBeNull();

    fake.emit({
      pluginId: "tracer",
      name: "Tracer",
      state: { status: "stopped", reason: "unresponsive", refusal: null },
    });

    expect(store.getState().plugins.tracer.stopped).toEqual({ reason: "unresponsive" });
    expect(store.getState().plugins.tracer.running).toBe(false);

    await store.getState().restart("tracer");

    expect(fake.startCalls).toEqual([{ pluginId: "tracer", reason: "restart" }]);
    expect(store.getState().plugins.tracer.stopped).toBeNull();
  });

  it("ignores a normal stop as a Stopped state", async () => {
    const fake = createFakeLifecycle();
    const dir = makeDirectory("web", [folderNamed("tracer", "tracer")]);
    const store = makeStore(dir.adapter, { lifecycle: fake.lifecycle });
    await store.getState().refresh();

    fake.emit({
      pluginId: "tracer",
      name: "Tracer",
      state: { status: "stopped", reason: "idle", refusal: null },
    });

    expect(store.getState().plugins.tracer.stopped).toBeNull();
  });
});

describe("Plugin management state: filter helpers", () => {
  it("lists the categories in the decided order", () => {
    expect(PLUGIN_FILTER_CATEGORIES).toEqual([
      "installed",
      "available",
      "builtIn",
      "disabled",
      "removed",
      "unsupported",
    ]);
  });

  it("assigns overlapping categories", () => {
    const installedDisabled = entry({
      name: "One",
      installed: true,
      approval: { ...enabledApproval(), enabled: false },
    });
    const categories = pluginFilterCategories(installedDisabled);
    expect(categories).toContain("installed");
    expect(categories).toContain("disabled");
  });

  it("counts every category", () => {
    const entries = [
      entry({ name: "One", installed: true, approval: enabledApproval() }),
      entry({ name: "Two", installed: true, approval: { ...enabledApproval(), enabled: false } }),
      entry({ name: "Three", unsupported: true }),
      entry({ name: "Four", removed: true }),
    ];
    expect(countPluginsByCategory(entries)).toEqual({
      installed: 2,
      available: 0,
      builtIn: 0,
      disabled: 1,
      removed: 1,
      unsupported: 1,
    });
  });

  it("matches ANY selected category, sorted by name, and nothing when none is selected", () => {
    const unsupported = entry({ name: "Zeta", unsupported: true });
    const removed = entry({ name: "Alpha", removed: true });
    const installed = entry({ name: "Mid", installed: true, approval: enabledApproval() });

    const matched = filterPluginsByCategories(
      [unsupported, removed, installed],
      ["unsupported", "removed"]
    );
    expect(matched).toEqual([removed, unsupported]);
    expect(filterPluginsByCategories([unsupported, removed, installed], [])).toEqual([]);
  });
});

describe("Plugin management state: zero Plugins", () => {
  it("refreshes to an empty list and zero counts", async () => {
    const dir = makeDirectory("web", []);
    const store = makeStore(dir.adapter);

    await store.getState().refresh();

    expect(store.getState().plugins).toEqual({});
    expect(countPluginsByCategory([])).toEqual({
      installed: 0,
      available: 0,
      builtIn: 0,
      disabled: 0,
      removed: 0,
      unsupported: 0,
    });
  });
});
