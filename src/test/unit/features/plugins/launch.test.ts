import { afterEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { scanApprovedPlugins } from "@/features/plugins/launch";
import { pluginFolder, sourceFolder } from "@/test/support/plugin-fixtures";
import type { PluginDirectoryAdapter, PluginFolder } from "@/lib/platform/types";
import type { BuiltInPlugin, PluginManifest } from "@/features/plugins/types";

afterEach(() => {
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
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
    enabled: true,
    approvedVersion: "",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
    ...overrides,
  });
}

describe("scanApprovedPlugins()", () => {
  it("does not scan the Plugin Directory when no Plugin is approved", async () => {
    const directory = fakeDirectory({});
    const result = await scanApprovedPlugins({ directory });
    expect(result).toEqual({ plugins: [], refusals: [] });
    expect(directory.listFolders).not.toHaveBeenCalled();
    expect(directory.readFolder).not.toHaveBeenCalled();
  });

  it("returns an approved Plugin with its folder and parsed manifest, starting nothing", async () => {
    const folder = pluginFolder({}, { lifecycle: "on-demand" });
    await approve(folder);
    const directory = fakeDirectory({ tracer: folder });
    const result = await scanApprovedPlugins({ directory });
    expect(result.refusals).toEqual([]);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].pluginId).toBe("tracer");
    expect(result.plugins[0].folder).toBe(folder);
    expect(result.plugins[0].approval.pinnedHash).toBe(await hashPluginDirectory(folder.files));
    expect(result.plugins[0].manifest.lifecycle).toBe("on-demand");
  });

  it("skips an approval whose folder is not in the Plugin Directory", async () => {
    await approve(pluginFolder({}));
    const result = await scanApprovedPlugins({
      directory: fakeDirectory({ other: pluginFolder({}) }),
    });
    expect(result).toEqual({ plugins: [], refusals: [] });
  });

  it("scans only enabled approvals, leaving a disabled one installed but off", async () => {
    const active = pluginFolder({}, { id: "active", name: "active" });
    const inactive = pluginFolder({}, { id: "inactive", name: "inactive" });
    await approve(active);
    await approve(inactive, { enabled: false });
    const directory = fakeDirectory({ active, inactive });
    const result = await scanApprovedPlugins({ directory });
    expect(result.plugins.map((plugin) => plugin.pluginId)).toEqual(["active"]);
    expect(directory.readFolder).toHaveBeenCalledTimes(1);
    expect(directory.readFolder).toHaveBeenCalledWith("active");
  });

  it("reports a manifest problem as a refusal instead of failing", async () => {
    const folder = sourceFolder({
      "manifest.json": JSON.stringify({ manifestVersion: 1, id: "tracer" }),
      "index.js": "export {};",
    });
    await approve(folder);
    const result = await scanApprovedPlugins({ directory: fakeDirectory({ tracer: folder }) });
    expect(result.plugins).toEqual([]);
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0].pluginId).toBe("tracer");
    expect(result.refusals[0].refusal.code).toBe("manifest-invalid");
  });

  it("parses a reserved maibuk- id with the Built-in schema when the source lists it", async () => {
    const folder = pluginFolder({}, { id: "maibuk-echoes", name: "Echoes" });
    await approve(folder);
    const shipped = await shippedOf(folder);

    const result = await scanApprovedPlugins({
      directory: fakeDirectory({ "maibuk-echoes": folder }),
      builtInSource: { list: async () => [shipped] },
    });

    expect(result.refusals).toEqual([]);
    expect(result.plugins.map((plugin) => plugin.pluginId)).toEqual(["maibuk-echoes"]);
  });

  it("refuses a reserved maibuk- id no Built-in source lists", async () => {
    const folder = pluginFolder({}, { id: "maibuk-echoes", name: "Echoes" });
    await approve(folder);

    const result = await scanApprovedPlugins({
      directory: fakeDirectory({ "maibuk-echoes": folder }),
    });

    expect(result.plugins).toEqual([]);
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0].refusal.code).toBe("manifest-invalid");
  });
});

/** The shipped Built-in entry the source reports for a folder. */
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
