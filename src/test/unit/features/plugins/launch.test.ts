import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { startApprovedPlugins } from "@/features/plugins/launch";
import {
  activateTutorialDatabase,
  resetLibrarySwitchForTests,
} from "@/features/tutorial/library-switch";
import { fakePluginFrame, PLUGIN_MANIFEST, pluginFolder } from "@/test/support/plugin-fixtures";
import type {
  DatabaseAdapter,
  PluginDirectoryAdapter,
  PluginFolder,
} from "@/lib/platform/types";

afterEach(() => {
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  resetLibrarySwitchForTests();
});

function fakeDirectory(folders: Record<string, PluginFolder>): PluginDirectoryAdapter & {
  listFolders: ReturnType<typeof vi.fn>;
  readFolder: ReturnType<typeof vi.fn>;
} {
  return {
    listFolders: vi.fn(async () => Object.keys(folders)),
    readFolder: vi.fn(async (name: string) => folders[name] ?? null),
  };
}

async function approve(folder: PluginFolder, overrides: Record<string, unknown> = {}) {
  savePluginApproval({
    pluginId: folder.name,
    pinnedHash: await hashPluginDirectory(folder.files),
    granted: [],
    ...overrides,
  });
}

describe("startApprovedPlugins()", () => {
  it("does nothing at all when no Plugin is approved: no scan, no frame", async () => {
    const directory = fakeDirectory({});
    const createFrame = vi.fn(() => fakePluginFrame());
    const result = await startApprovedPlugins({ directory, createFrame });
    expect(result).toEqual({ launched: [], refusals: [] });
    expect(directory.listFolders).not.toHaveBeenCalled();
    expect(createFrame).not.toHaveBeenCalled();
  });

  it("starts an approved Plugin whose folder matches its pin", async () => {
    const folder = pluginFolder({});
    await approve(folder);
    const frame = fakePluginFrame();
    const result = await startApprovedPlugins({
      directory: fakeDirectory({ tracer: folder }),
      createFrame: () => frame,
      handlers: () => ({}),
    });
    expect(result.refusals).toEqual([]);
    expect(result.launched).toHaveLength(1);
    expect(result.launched[0].manifest.id).toBe("tracer");
    expect(frame.requests).toEqual(["health.check"]);
  });

  it("refuses an approved Plugin whose files changed after approval", async () => {
    const folder = pluginFolder({});
    await approve(folder, { pinnedHash: "h1:stale" });
    const createFrame = vi.fn(() => fakePluginFrame());
    const result = await startApprovedPlugins({
      directory: fakeDirectory({ tracer: folder }),
      createFrame,
      handlers: () => ({}),
    });
    expect(result.launched).toEqual([]);
    expect(result.refusals).toEqual([
      { pluginId: "tracer", refusal: expect.objectContaining({ code: "hash-mismatch" }) },
    ]);
    expect(createFrame).not.toHaveBeenCalled();
  });

  it("skips an approval whose folder is not in the Plugin Directory", async () => {
    const folder = pluginFolder({});
    await approve(folder);
    const result = await startApprovedPlugins({
      directory: fakeDirectory({ other: folder }),
      createFrame: () => fakePluginFrame(),
      handlers: () => ({}),
    });
    expect(result).toEqual({ launched: [], refusals: [] });
  });

  it("starts with the Plugin's declared default name in its handlers", async () => {
    const folder = pluginFolder({}, { name: "Tracer Fixture" });
    await approve(folder);
    const handlers = vi.fn(() => ({}));
    await startApprovedPlugins({
      directory: fakeDirectory({ tracer: folder }),
      createFrame: () => fakePluginFrame(),
      handlers,
    });
    expect(handlers).toHaveBeenCalledWith(
      expect.objectContaining({ id: PLUGIN_MANIFEST.id, name: "Tracer Fixture" })
    );
  });

  it("keeps Library rows refused while the Tutorial Library is active (ADR 0008)", async () => {
    activateTutorialDatabase({} as DatabaseAdapter);
    try {
      const folder = pluginFolder({ "index.js": "export {};" });
      await approve(folder);
      const frame = fakePluginFrame();
      const result = await startApprovedPlugins({
        directory: fakeDirectory({ tracer: folder }),
        createFrame: () => frame,
        handlers: () => ({ "storage.get": vi.fn(async () => "value") }),
      });
      expect(result.launched).toHaveLength(1);
      await expect(frame.call("storage.get", { key: "a" })).rejects.toMatchObject({
        code: "library-unavailable",
      });
    } finally {
      resetLibrarySwitchForTests();
    }
  });
});
