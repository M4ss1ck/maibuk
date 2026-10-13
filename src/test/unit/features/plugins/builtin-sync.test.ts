/**
 * The launch sync of the shipped Built-in Plugins (#444): before the
 * management store first classifies Plugins, the app copies each Built-in whose
 * manifest supports this device into the Plugin Directory: a missing copy is
 * installed, an untouched copy is replaced on an app update, an edited copy is
 * left for the store's Modified + Update available, and a Built-in the author
 * removed is never reinstalled. One Built-in's failure never stops the rest.
 *
 * The sync is driven with an injected directory and Built-in source, the same
 * seam `launch.test.ts` and `management-actions.test.ts` use; the classification
 * it runs ahead of is the store's own `refresh()`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  getPluginApproval,
} from "@/features/plugins/approvals";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { PLUGIN_KNOWN_STORAGE_KEY, saveKnownPlugin } from "@/features/plugins/known";
import { syncBuiltInPlugins } from "@/features/plugins/launch";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import { createPluginManagementStore } from "@/features/plugins/management";
import type {
  BuiltInPlugin,
  BuiltInPluginSource,
  PluginFolder,
  PluginManifest,
} from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const ID = "maibuk-echoes";
const EVERYWHERE: PluginManifest["platforms"] = ["web", "desktop", "android"];
const PERMISSIONS: PluginManifest["permissions"] = {
  required: ["library:read"],
  optional: ["secrets"],
};

const decoder = new TextDecoder();

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  localStorage.removeItem(PLUGIN_KNOWN_STORAGE_KEY);
  resetPluginContributionsForTests();
});

/** A Built-in Plugin folder: the shipped copy the source reports. */
function builtInFolder(
  entries: Record<string, string> = {},
  overrides: Partial<PluginManifest> = {}
): PluginFolder {
  return pluginFolder(entries, {
    id: ID,
    name: "Echoes",
    permissions: PERMISSIONS,
    platforms: EVERYWHERE,
    ...overrides,
  });
}

/** The shipped Built-in entry the source reports for a folder. */
async function shippedOf(folder: PluginFolder): Promise<BuiltInPlugin> {
  const manifest = JSON.parse(
    decoder.decode(folder.files.find((file) => file.path === "manifest.json")?.bytes)
  ) as PluginManifest;
  return {
    id: manifest.id,
    manifest,
    hash: await hashPluginDirectory(folder.files),
    files: folder.files,
  };
}

/** A mutable Plugin Directory; `failIds` makes those ids' replace throw. */
function makeDirectory(
  kind: PluginDirectoryAdapter["kind"],
  folders: PluginFolder[] = [],
  options: { failIds?: readonly string[] } = {}
) {
  const map = new Map(folders.map((folder) => [folder.name, folder]));
  const writes: string[] = [];
  const adapter: PluginDirectoryAdapter = {
    kind,
    listFolders: async () => [...map.keys()],
    readFolder: async (name) => map.get(name) ?? null,
    replaceFolder: async (name, files) => {
      if (options.failIds?.includes(name)) throw new Error(`replace refused: ${name}`);
      map.set(name, { name, files: [...files] });
      writes.push(name);
      return true;
    },
  };
  return { adapter, map, writes };
}

/** A management store over the same directory and source, for classification. */
function makeStore(directory: PluginDirectoryAdapter, source: BuiltInPluginSource) {
  return createPluginManagementStore({
    directory,
    lifecycle: () => null,
    builtInSource: source,
  });
}

const TRACE = (installed: number, replaced: number, kept: number) =>
  `Built-in Plugins: installed ${installed}, replaced ${replaced}, kept modified ${kept}`;

describe("syncBuiltInPlugins(): install a missing Built-in", () => {
  it("writes the shipped copy, pre-grants it, and traces the install", async () => {
    const built = await shippedOf(builtInFolder());
    const dir = makeDirectory("web");
    const source: BuiltInPluginSource = { list: async () => [built] };
    const info: string[] = [];

    const result = await syncBuiltInPlugins({
      directory: dir.adapter,
      builtInSource: source,
      info: (message) => info.push(message),
    });

    expect(result).toEqual({ installed: 1, replaced: 0, keptModified: 0 });
    expect(dir.writes).toEqual([ID]);
    expect(dir.map.has(ID)).toBe(true);
    const approval = getPluginApproval(ID);
    expect(approval).toMatchObject({
      enabled: true,
      pinnedHash: built.hash,
      builtIn: { shippedHash: built.hash },
    });
    // Pre-granted: every declared Plugin Permission, still listed and revocable.
    expect(approval?.granted).toEqual(["library:read", "secrets"]);
    expect(approval?.approvedPermissions).toEqual({ required: ["library:read"], optional: ["secrets"] });
    expect(info).toEqual([TRACE(1, 0, 0)]);

    // The store's first classification finds it installed and approved.
    const store = makeStore(dir.adapter, source);
    await store.getState().refresh();
    expect(store.getState().plugins[ID]).toMatchObject({
      installed: true,
      builtIn: true,
      modified: false,
      updateAvailable: false,
      review: { status: "approved" },
    });
  });
});

describe("syncBuiltInPlugins(): untouched copy on update", () => {
  it("replaces it with the current shipped copy and re-pins its hash", async () => {
    const v1 = builtInFolder();
    const v1Shipped = await shippedOf(v1);
    const dir = makeDirectory("web", [v1]);
    const source: BuiltInPluginSource = { list: async () => [v1Shipped] };
    const store = makeStore(dir.adapter, source);
    await store.getState().refresh();
    // The author revokes an optional grant; the replace must keep it revoked.
    await store.getState().revoke(ID, "secrets");
    expect(getPluginApproval(ID)?.granted).toEqual(["library:read"]);

    const v2 = builtInFolder({ "index.js": "export const a = 2;" });
    const v2Shipped = await shippedOf(v2);
    source.list = async () => [v2Shipped];
    const info: string[] = [];

    const result = await syncBuiltInPlugins({
      directory: dir.adapter,
      builtInSource: source,
      info: (message) => info.push(message),
    });

    expect(result).toEqual({ installed: 0, replaced: 1, keptModified: 0 });
    const installed = dir.map.get(ID)!;
    const index = installed.files.find((file) => file.path === "index.js");
    expect(decoder.decode(index?.bytes)).toBe("export const a = 2;");
    const approval = getPluginApproval(ID);
    expect(approval?.pinnedHash).toBe(await hashPluginDirectory(installed.files));
    expect(approval?.builtIn?.shippedHash).toBe(v2Shipped.hash);
    expect(approval?.granted).toEqual(["library:read"]);
    expect(info).toEqual([TRACE(0, 1, 0)]);

    // No Modified and no Update available after the silent replace.
    await store.getState().refresh();
    expect(store.getState().plugins[ID]).toMatchObject({
      modified: false,
      updateAvailable: false,
      review: { status: "approved" },
    });
  });
});

describe("syncBuiltInPlugins(): edited copy", () => {
  it("keeps it untouched, and the store shows Modified with Update available", async () => {
    const v1 = builtInFolder();
    const v1Shipped = await shippedOf(v1);
    const dir = makeDirectory("web", [v1]);
    const source: BuiltInPluginSource = { list: async () => [v1Shipped] };
    const store = makeStore(dir.adapter, source);
    await store.getState().refresh();
    // The author edits the installed copy, then the app ships an update.
    dir.map.set(ID, builtInFolder({ "index.js": "export const a = 99;" }));
    const v2 = builtInFolder({ "index.js": "export const a = 2;" });
    const v2Shipped = await shippedOf(v2);
    source.list = async () => [v2Shipped];
    const info: string[] = [];

    const result = await syncBuiltInPlugins({
      directory: dir.adapter,
      builtInSource: source,
      info: (message) => info.push(message),
    });

    expect(result).toEqual({ installed: 0, replaced: 0, keptModified: 1 });
    expect(dir.writes).toEqual([]);
    // Keeping a modified copy changes nothing on disk, so no trace line.
    expect(info).toEqual([]);

    await store.getState().refresh();
    const entry = store.getState().plugins[ID];
    expect(entry.modified).toBe(true);
    expect(entry.updateAvailable).toBe(true);
    expect(entry.review.status).toBe("review-required");
  });
});

describe("syncBuiltInPlugins(): removal", () => {
  it("never reinstalls a removed Built-in, across repeated launches", async () => {
    const built = await shippedOf(builtInFolder());
    const dir = makeDirectory("web");
    saveKnownPlugin({ pluginId: ID, manifest: built.manifest, builtIn: true, removed: true });
    const info: string[] = [];

    const first = await syncBuiltInPlugins({
      directory: dir.adapter,
      builtInSource: { list: async () => [built] },
      info: (message) => info.push(message),
    });
    const second = await syncBuiltInPlugins({
      directory: dir.adapter,
      builtInSource: { list: async () => [built] },
      info: (message) => info.push(message),
    });

    expect(first).toEqual({ installed: 0, replaced: 0, keptModified: 0 });
    expect(second).toEqual({ installed: 0, replaced: 0, keptModified: 0 });
    expect(dir.writes).toEqual([]);
    expect(getPluginApproval(ID)).toBeNull();
    expect(info).toEqual([]);
  });
});

describe("syncBuiltInPlugins(): device platform", () => {
  it("skips a Built-in whose platforms exclude the device", async () => {
    const supported = await shippedOf(builtInFolder());
    const desktopOnly = await shippedOf(
      builtInFolder({}, { id: "maibuk-desktop", name: "Desktop only", platforms: ["desktop"] })
    );
    const dir = makeDirectory("web");
    const info: string[] = [];

    const result = await syncBuiltInPlugins({
      directory: dir.adapter,
      builtInSource: { list: async () => [desktopOnly, supported] },
      info: (message) => info.push(message),
    });

    expect(result).toEqual({ installed: 1, replaced: 0, keptModified: 0 });
    expect(dir.map.has(ID)).toBe(true);
    expect(dir.map.has("maibuk-desktop")).toBe(false);
  });
});

describe("syncBuiltInPlugins(): one failure does not block the rest", () => {
  it("keeps going to the next Built-in when a replace throws", async () => {
    const failing = await shippedOf(builtInFolder({}, { id: "maibuk-one", name: "One" }));
    const next = await shippedOf(builtInFolder({}, { id: "maibuk-two", name: "Two" }));
    const dir = makeDirectory("web", [], { failIds: ["maibuk-one"] });

    const result = await syncBuiltInPlugins({
      directory: dir.adapter,
      builtInSource: { list: async () => [failing, next] },
    });

    expect(result).toEqual({ installed: 1, replaced: 0, keptModified: 0 });
    expect(dir.map.has("maibuk-one")).toBe(false);
    expect(dir.map.has("maibuk-two")).toBe(true);
  });
});

describe("syncBuiltInPlugins(): zero Built-ins", () => {
  it("changes nothing and writes nothing", async () => {
    const dir = makeDirectory("web");
    const info: string[] = [];

    const result = await syncBuiltInPlugins({
      directory: dir.adapter,
      builtInSource: { list: async () => [] },
      info: (message) => info.push(message),
    });

    expect(result).toEqual({ installed: 0, replaced: 0, keptModified: 0 });
    expect(dir.writes).toEqual([]);
    expect(info).toEqual([]);
  });
});

describe("syncBuiltInPlugins(): at launch", () => {
  it("installs a missing Built-in before the store first classifies it", async () => {
    // An on-demand Built-in is pre-granted by the sync but not started at
    // launch, so no sandbox frame is needed here.
    const built = await shippedOf(builtInFolder({}, { lifecycle: "on-demand" }));
    const dir = makeDirectory("web");
    const source: BuiltInPluginSource = { list: async () => [built] };
    const lifecycle = createPluginLifecycle({
      directory: dir.adapter,
      builtInSource: source,
      scheduleIdle: (work) => work(),
      whenLaunchSettled: async () => undefined,
      dataVersions: { get: async () => null, set: async () => undefined },
    });

    try {
      await lifecycle.launch();

      // The sync copied the shipped folder into the Plugin Directory.
      expect(dir.map.has(ID)).toBe(true);
      // The store's first classification finds it installed and approved, not
      // mis-shown as Modified.
      const store = makeStore(dir.adapter, source);
      await store.getState().refresh();
      expect(store.getState().plugins[ID]).toMatchObject({
        installed: true,
        modified: false,
        updateAvailable: false,
        review: { status: "approved" },
      });
    } finally {
      lifecycle.dispose();
    }
  });
});
