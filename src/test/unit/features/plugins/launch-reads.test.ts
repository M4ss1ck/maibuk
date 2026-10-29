/**
 * One launch's folder reads (issue #653, gate 1): the Built-in sync reads each
 * Built-in folder to judge it, and the scan reads the enabled folders again to
 * parse them. `launchReads` lets both steps of one launch share a read, so an
 * enabled Built-in's folder (its bundle is megabytes) is read once at start-up.
 * A write drops that folder's read, and a failed read is never kept.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  approveBuiltInCopy,
  getPluginApproval,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory, pluginFileDigests } from "@/features/plugins/directory-hash";
import { launchReads, scanApprovedPlugins, syncBuiltInPlugins } from "@/features/plugins/launch";
import type { BuiltInPlugin, BuiltInPluginSource, PluginFolder, PluginManifest } from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const ID = "maibuk-reader";
const PERMISSIONS: PluginManifest["permissions"] = { required: [], optional: [] };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  resetPluginContributionsForTests();
});

function builtInFolder(): PluginFolder {
  return pluginFolder(
    { "index.js": "export const a = 1;" },
    { id: ID, name: "Reader", permissions: PERMISSIONS, platforms: ["web", "desktop", "android"] }
  );
}

async function shippedOf(folder: PluginFolder): Promise<BuiltInPlugin> {
  const manifest = JSON.parse(
    new TextDecoder().decode(folder.files.find((file) => file.path === "manifest.json")?.bytes)
  ) as PluginManifest;
  return { id: ID, manifest, hash: await hashPluginDirectory(folder.files), files: folder.files };
}

/** A Plugin Directory that counts every folder read and can fail the first one. */
function countingDirectory(folders: PluginFolder[], failFirstRead = false) {
  const map = new Map(folders.map((folder) => [folder.name, folder]));
  const reads: string[] = [];
  let failed = false;
  const adapter: PluginDirectoryAdapter = {
    kind: "web",
    listFolders: async () => [...map.keys()],
    readFolder: async (name) => {
      reads.push(name);
      if (failFirstRead && !failed) {
        failed = true;
        throw new Error("read refused");
      }
      return map.get(name) ?? null;
    },
    replaceFolder: async (name, files) => {
      map.set(name, { name, files: [...files] });
      return true;
    },
  };
  return { adapter, reads };
}

describe("launchReads(): one folder read per launch", () => {
  it("serves the sync's read of an enabled Built-in to the scan", async () => {
    const folder = builtInFolder();
    const built = await shippedOf(folder);
    const source: BuiltInPluginSource = { list: async () => [built] };
    const dir = countingDirectory([folder]);
    const launch = launchReads(dir.adapter);
    // The installed copy is already the shipped one, so the sync reads it and
    // leaves the approval alone: the approval an enabled Built-in carries is
    // the one the store pinned, saved here as the sync would have saved it.
    savePluginApproval({
      ...approveBuiltInCopy(built.manifest, built.hash, await pluginFileDigests(folder.files), built.hash),
      enabled: true,
    });

    await syncBuiltInPlugins({ directory: launch, builtInSource: source, info: () => {} });
    const scan = await scanApprovedPlugins({ directory: launch, builtInSource: source });

    expect(scan.plugins.map((plugin) => plugin.pluginId)).toEqual([ID]);
    expect(dir.reads).toEqual([ID]);
  });

  it("reads the folder again after the sync replaced it, so the scan sees the shipped copy", async () => {
    const folder = builtInFolder();
    const built = await shippedOf(folder);
    const source: BuiltInPluginSource = { list: async () => [built] };
    const dir = countingDirectory([]);
    const launch = launchReads(dir.adapter);

    // The folder is missing, so the sync installs it: its read found nothing,
    // and the write must not leave that null in place for the scan.
    await syncBuiltInPlugins({ directory: launch, builtInSource: source, info: () => {} });
    savePluginApproval({ ...getPluginApproval(ID)!, enabled: true });
    const scan = await scanApprovedPlugins({ directory: launch, builtInSource: source });

    expect(dir.reads).toEqual([ID, ID]);
    expect(scan.plugins[0]?.folder.files.map((file) => file.path)).toEqual(
      folder.files.map((file) => file.path)
    );
  });

  it("does not keep a failed read: the next step reads the folder again", async () => {
    const folder = builtInFolder();
    const dir = countingDirectory([folder], true);
    const launch = launchReads(dir.adapter);

    await expect(launch.readFolder(ID)).rejects.toThrow("read refused");
    await expect(launch.readFolder(ID)).resolves.toEqual(folder);
    expect(dir.reads).toEqual([ID, ID]);
  });
});
