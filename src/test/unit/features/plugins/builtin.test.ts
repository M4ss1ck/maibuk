import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  getPluginApproval,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import { createPluginManagementStore } from "@/features/plugins/management";
import type {
  BuiltInPlugin,
  BuiltInPluginSource,
  PluginFolder,
  PluginLifecycle,
  PluginManifest,
  PluginNotification,
} from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import {
  fakePluginFrame,
  installMicrotaskMessageChannel,
  pluginFolder,
  type FakePluginFrame,
} from "@/test/support/plugin-fixtures";

const ID = "echoes";
const PERMISSIONS: PluginManifest["permissions"] = {
  required: ["library:read"],
  optional: ["secrets"],
};

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

/** A Built-in Plugin folder: the touched copy with the id and permissions above. */
function builtInFolder(entries: Record<string, string> = {}): PluginFolder {
  return pluginFolder(entries, {
    id: ID,
    name: "Echoes",
    permissions: PERMISSIONS,
  });
}

/** The shipped copy the source reports for a folder. */
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

interface SetupOptions {
  /** The installed copy; defaults to an untouched copy of the shipped one. */
  installed?: PluginFolder;
  /** The device the Plugin Directory serves; defaults to web. */
  kind?: PluginDirectoryAdapter["kind"];
  /** Whether a Built-in source is injected; defaults to one that ships `installed`. */
  source?: BuiltInPluginSource;
}

async function setup(options: SetupOptions = {}) {
  const shipped = options.installed ?? builtInFolder();
  const name = shipped.name;
  let shippedCopy = await shippedOf(shipped);
  const folders = new Map<string, PluginFolder>([[name, shipped]]);
  const directory: PluginDirectoryAdapter = {
    kind: options.kind ?? "web",
    listFolders: async () => [...folders.keys()],
    readFolder: async (folderName) => folders.get(folderName) ?? null,
    replaceFolder: async (folderName, files) => {
      folders.set(folderName, { name: folderName, files: [...files] });
      return true;
    },
  };
  const source: BuiltInPluginSource = options.source ?? {
    list: async () => [shippedCopy],
  };
  const frames: FakePluginFrame[] = [];
  const lifecycle = createPluginLifecycle({
    directory,
    builtInSource: source,
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

  const notified: PluginNotification[] = [];
  const store = createPluginManagementStore({
    directory,
    lifecycle: () => lifecycle,
    builtInSource: source,
    notify: (notification) => notified.push(notification),
  });

  return {
    store,
    lifecycle,
    frames,
    notified,
    /** The installed copy the store reads. */
    installed: () => folders.get(name) ?? null,
    setInstalled(folder: PluginFolder): void {
      folders.set(name, folder);
    },
    /** The shipped copy the source reports now. */
    async ship(folder: PluginFolder): Promise<void> {
      shippedCopy = await shippedOf(folder);
    },
    async refresh() {
      await store.getState().refresh();
    },
    entry: () => store.getState().plugins[name],
  };
}

describe("Built-in Plugins: first sight", () => {
  it("pre-grants every declared permission on an untouched copy", async () => {
    const h = await setup();
    expect(getPluginApproval(ID)).toBeNull();

    await h.refresh();

    const approval = getPluginApproval(ID);
    expect(approval).toMatchObject({
      enabled: false,
      granted: ["library:read", "secrets"],
      builtIn: { shippedHash: await hashPluginDirectory(h.installed()!.files) },
    });
    expect(h.entry()).toMatchObject({
      builtIn: true,
      modified: false,
      updateAvailable: false,
      review: { status: "approved" },
    });
  });

  it("starts a pre-granted Built-in through the normal lifecycle at launch", async () => {
    const h = await setup();
    await h.refresh();
    // A Built-in starts off on first sight; turning it on needs no review, so
    // the next launch runs it like any enabled Plugin.
    savePluginApproval({ ...getPluginApproval(ID)!, enabled: true });

    await h.lifecycle.launch();

    expect(h.lifecycle.state(ID)?.status).toBe("ready");
    expect(h.frames).toHaveLength(1);
  });
});

describe("Built-in Plugins: revoke", () => {
  it("keeps an optional revoke across a refresh instead of restoring it", async () => {
    const h = await setup();
    await h.refresh();
    await h.store.getState().enable(ID);
    expect(getPluginApproval(ID)?.granted).toEqual(["library:read", "secrets"]);

    await h.store.getState().revoke(ID, "secrets");

    expect(getPluginApproval(ID)?.granted).toEqual(["library:read"]);
    expect(getPluginApproval(ID)?.enabled).toBe(true);

    await h.refresh();

    expect(getPluginApproval(ID)?.granted).toEqual(["library:read"]);
    expect(h.entry().approval?.granted).toEqual(["library:read"]);
  });

  it("disables a Built-in when a required grant is revoked, across a refresh", async () => {
    const h = await setup();
    await h.refresh();
    await h.store.getState().enable(ID);

    await h.store.getState().revoke(ID, "library:read");

    expect(getPluginApproval(ID)?.enabled).toBe(false);
    expect(getPluginApproval(ID)?.granted).toEqual(["secrets"]);

    await h.refresh();

    expect(getPluginApproval(ID)?.enabled).toBe(false);
    expect(getPluginApproval(ID)?.granted).toEqual(["secrets"]);
  });
});

describe("Built-in Plugins: modified copy", () => {
  it("is marked modified and review-required and never starts", async () => {
    const h = await setup();
    await h.refresh();
    // The Built-in was turned on (no review needed), then the author edits the
    // installed copy.
    savePluginApproval({ ...getPluginApproval(ID)!, enabled: true });
    h.setInstalled(builtInFolder({ "index.js": "export const a = 2;" }));

    await h.lifecycle.launch();
    expect(h.frames).toHaveLength(0);
    expect(h.lifecycle.state(ID)).toMatchObject({
      status: "stopped",
      refusal: { code: "review-required" },
    });

    await h.refresh();

    expect(h.entry()).toMatchObject({ builtIn: true, modified: true });
    expect(h.entry().review.status).toBe("review-required");
  });
});

describe("Built-in Plugins: update available", () => {
  it("shows Update available without repeating a prompt for a shipped hash", async () => {
    const h = await setup();
    await h.refresh();
    // The author edits the copy, then the app ships an update.
    h.setInstalled(builtInFolder({ "index.js": "export const a = 2;" }));
    await h.ship(builtInFolder({ "index.js": "export const a = 3;" }));

    await h.refresh();

    expect(h.entry().updateAvailable).toBe(true);
    expect(h.notified).toHaveLength(1);
    expect(h.notified[0]).toMatchObject({ pluginId: ID, kind: "available" });

    // A second refresh for the same shipped hash does not prompt again.
    await h.refresh();
    expect(h.notified).toHaveLength(1);
  });

  it("keeps Update available and stops prompting for the kept shipped hash", async () => {
    const h = await setup();
    await h.refresh();
    const update = builtInFolder({ "index.js": "export const a = 3;" });
    h.setInstalled(builtInFolder({ "index.js": "export const a = 2;" }));
    await h.ship(update);
    await h.refresh();
    expect(h.notified).toHaveLength(1);

    await h.store.getState().keepMyCopy(ID);

    expect(getPluginApproval(ID)?.builtIn?.keptModifiedHash).toBe(
      await hashPluginDirectory(update.files)
    );

    await h.refresh();

    expect(h.entry().updateAvailable).toBe(true);
    expect(h.notified).toHaveLength(1);
    // The installed files are kept, not replaced.
    expect(h.entry().modified).toBe(true);
  });

  it("prompts once for a newer shipped hash after a keep", async () => {
    const h = await setup();
    await h.refresh();
    h.setInstalled(builtInFolder({ "index.js": "export const a = 2;" }));
    await h.ship(builtInFolder({ "index.js": "export const a = 3;" }));
    await h.refresh();
    await h.store.getState().keepMyCopy(ID);

    // A newer shipped copy arrives.
    await h.ship(builtInFolder({ "index.js": "export const a = 4;" }));
    await h.refresh();

    expect(h.entry().updateAvailable).toBe(true);
    expect(h.notified).toHaveLength(2);

    await h.refresh();
    expect(h.notified).toHaveLength(2);
  });
});

describe("Built-in Plugins: reserved maibuk- ids", () => {
  it("lists and pre-grants a maibuk- Built-in the third-party schema would refuse", async () => {
    const folder = pluginFolder(
      {},
      { id: "maibuk-echoes", name: "Echoes", permissions: PERMISSIONS }
    );
    const h = await setup({ installed: folder });

    await h.refresh();

    expect(getPluginApproval("maibuk-echoes")).toMatchObject({
      enabled: false,
      granted: ["library:read", "secrets"],
      builtIn: { shippedHash: await hashPluginDirectory(folder.files) },
    });
    expect(h.entry()).toMatchObject({
      builtIn: true,
      modified: false,
      review: { status: "approved" },
    });
  });

  it("starts a maibuk- Built-in at launch through the Built-in schema", async () => {
    const folder = pluginFolder(
      {},
      { id: "maibuk-echoes", name: "Echoes", permissions: PERMISSIONS }
    );
    const h = await setup({ installed: folder });
    await h.refresh();
    // A Built-in starts off; turning it on needs no review.
    savePluginApproval({ ...getPluginApproval("maibuk-echoes")!, enabled: true });

    await h.lifecycle.launch();

    expect(h.lifecycle.state("maibuk-echoes")?.status).toBe("ready");
    expect(h.frames).toHaveLength(1);
  });

  it("installs a maibuk- Built-in through the lifecycle after an enable", async () => {
    const folder = pluginFolder(
      {},
      { id: "maibuk-echoes", name: "Echoes", permissions: PERMISSIONS }
    );
    const h = await setup({ installed: folder });
    await h.refresh();

    h.store.getState().disable("maibuk-echoes");
    await h.store.getState().enable("maibuk-echoes");

    expect(h.lifecycle.state("maibuk-echoes")?.status).toBe("ready");
    expect(h.frames).toHaveLength(1);
  });
});

describe("Built-in Plugins: Android (#517)", () => {
  it("lists, pre-grants, and enables a maibuk- Built-in that lists android", async () => {
    const folder = pluginFolder(
      {},
      {
        id: "maibuk-echoes",
        name: "Echoes",
        permissions: PERMISSIONS,
        platforms: ["web", "desktop", "android"],
      }
    );
    const h = await setup({ installed: folder, kind: "android" });

    await h.refresh();

    expect(h.entry()).toMatchObject({ builtIn: true, installed: true, unsupported: false });
    expect(getPluginApproval("maibuk-echoes")).toMatchObject({
      enabled: false,
      granted: ["library:read", "secrets"],
    });

    await h.store.getState().enable("maibuk-echoes");

    expect(getPluginApproval("maibuk-echoes")?.enabled).toBe(true);
    expect(h.lifecycle.state("maibuk-echoes")?.status).toBe("ready");
    expect(h.frames).toHaveLength(1);
  });
});

describe("Built-in Plugins: replace", () => {
  it("refuses to replace without an explicit confirmation", async () => {
    const h = await setup();
    await h.refresh();
    h.setInstalled(builtInFolder({ "index.js": "export const a = 2;" }));
    await h.ship(builtInFolder({ "index.js": "export const a = 3;" }));
    await h.refresh();

    const replaced = await h.store.getState().replaceBuiltIn(ID, false);

    expect(replaced).toBe(false);
    expect(h.entry().modified).toBe(true);
    expect(h.entry().updateAvailable).toBe(true);
  });

  it("replaces the files, keeps revoked grants revoked, and re-pins the hash", async () => {
    const h = await setup();
    await h.refresh();
    await h.store.getState().revoke(ID, "secrets");
    expect(getPluginApproval(ID)?.granted).toEqual(["library:read"]);
    // The author edits the copy and the app ships an update.
    h.setInstalled(builtInFolder({ "index.js": "export const a = 2;" }));
    await h.ship(builtInFolder({ "index.js": "export const a = 3;" }));
    await h.refresh();
    expect(h.entry().updateAvailable).toBe(true);

    const replaced = await h.store.getState().replaceBuiltIn(ID, true);

    expect(replaced).toBe(true);
    const approval = getPluginApproval(ID);
    expect(approval?.granted).toEqual(["library:read"]);
    expect(approval?.pinnedHash).toBe(await hashPluginDirectory(h.installed()!.files));
    expect(h.entry()).toMatchObject({
      modified: false,
      updateAvailable: false,
      review: { status: "approved" },
    });
    // The installed copy is now the shipped one.
    const index = h.installed()!.files.find((file) => file.path === "index.js");
    expect(new TextDecoder().decode(index?.bytes)).toBe("export const a = 3;");
  });
});
