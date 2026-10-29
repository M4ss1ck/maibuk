/**
 * The launch scan: which enabled Plugins the Plugin Directory holds, each
 * with its manifest parsed and nothing else. No frame and no Worker is created
 * here; the lifecycle (#436) decides what starts and when, so on-demand
 * Plugins never start at launch. With no approvals this never touches the
 * Plugin Directory.
 *
 * It also carries the launch sync of the shipped Built-in Plugins (#444):
 * `syncBuiltInPlugins` runs before the scan (and so before the management store
 * first classifies Plugins), copying each Built-in this device supports into
 * the Plugin Directory. See that function for the rules.
 */

import {
  approveBuiltInCopy,
  getPluginApproval,
  listPluginApprovals,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { createBuiltInPluginSource } from "@/features/plugins/builtin";
import { hashPluginDirectory, pluginFileDigests } from "@/features/plugins/directory-hash";
import { manifestRunsOn, pluginsRunOn } from "@/features/plugins/host-platform";
import { getKnownPlugin } from "@/features/plugins/known";
import {
  isSupported,
  repinnedBuiltInApproval,
  type CurrentCopy,
} from "@/features/plugins/management";
import { readPluginManifest } from "@/features/plugins/runtime";
import type {
  BuiltInPlugin,
  BuiltInPluginSource,
  InstalledPlugin,
  PluginFolder,
  PluginFolderFile,
  PluginLaunchRefusal,
  PluginScanOptions,
  PluginScanResult,
} from "@/features/plugins/types";
import { getPluginDirectory } from "@/lib/platform";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";

/**
 * One launch's view of the Plugin Directory: a folder is read once however many
 * steps of the launch ask for it. The sync reads each Built-in folder to judge
 * it, and the scan reads the enabled ones again to parse them, so an enabled
 * Built-in's bundle (megabytes) was read twice before its Plugin could show.
 * A write (`replaceFolder`) drops that folder's read, so the scan never sees
 * the bytes the sync replaced, and a failed read is not kept: the next step
 * reads again. The view lives for one launch; the store reads the directory
 * directly afterwards.
 */
export function launchReads(directory: PluginDirectoryAdapter): PluginDirectoryAdapter {
  const reads = new Map<string, Promise<PluginFolder | null>>();
  return {
    ...directory,
    readFolder(name: string): Promise<PluginFolder | null> {
      const cached = reads.get(name);
      if (cached !== undefined) return cached;
      const read = directory.readFolder(name);
      reads.set(name, read);
      read.catch(() => {
        if (reads.get(name) === read) reads.delete(name);
      });
      return read;
    },
    replaceFolder: directory.replaceFolder
      ? async (name: string, files: readonly PluginFolderFile[]): Promise<boolean> => {
          reads.delete(name);
          return directory.replaceFolder!(name, files);
        }
      : undefined,
  };
}

export async function scanApprovedPlugins(
  options: PluginScanOptions = {}
): Promise<PluginScanResult> {
  // A disabled Plugin stays installed but off: it is never scanned, so it has
  // no entry and no Worker at launch (#442).
  const approvals = listPluginApprovals().filter((approval) => approval.enabled);
  if (approvals.length === 0) return { plugins: [], refusals: [] };

  const directory = options.directory ?? (await getPluginDirectory());
  // The host runs no Plugin on a platform it does not support (none today, see
  // PLUGIN_HOST_UNSUPPORTED_PLATFORMS): nothing is scanned there, so no contribution registers and no Worker
  // is ever queued, whatever the author approved.
  if (!pluginsRunOn(directory.kind)) return { plugins: [], refusals: [] };
  const folders = new Set(await directory.listFolders());
  // A reserved `maibuk-` id the shipped Built-in source lists parses under the
  // Built-in schema; a third-party folder stays under the other one (#442).
  const builtInSource = options.builtInSource ?? createBuiltInPluginSource();
  const builtInIds = new Set((await builtInSource.list()).map((entry) => entry.id));
  const plugins: InstalledPlugin[] = [];
  const refusals: PluginLaunchRefusal[] = [];

  for (const approval of approvals) {
    if (!folders.has(approval.pluginId)) continue;
    const folder = await directory.readFolder(approval.pluginId);
    if (!folder) continue;
    const manifest = readPluginManifest(folder, { builtIn: builtInIds.has(approval.pluginId) });
    if (!manifest.ok) {
      refusals.push({
        pluginId: approval.pluginId,
        refusal: { code: "manifest-invalid", problems: manifest.problems },
      });
      continue;
    }
    // The Plugin Platforms rule (#517): a manifest that does not run on this
    // device is not scanned, so no Worker is queued for it. Not a refusal: the
    // author did not break anything, the Plugin is simply not for this device.
    if (!manifestRunsOn(manifest.manifest.platforms, directory.kind)) continue;
    plugins.push({
      pluginId: approval.pluginId,
      approval,
      folder,
      manifest: manifest.manifest,
      builtIn: builtInIds.has(approval.pluginId),
    });
  }

  return { plugins, refusals };
}

/** The launch sync's dependencies; injected by tests. */
export interface BuiltInSyncOptions {
  /** Injected by tests; defaults to the platform's Plugin Directory. */
  directory?: PluginDirectoryAdapter;
  /**
   * The shipped Built-in Plugins; defaults to the production source (`[]` when
   * no index shipped).
   */
  builtInSource?: BuiltInPluginSource;
  /** The trace sink; defaults to `console.info`. Injected by tests. */
  info?: (message: string) => void;
}

/** What one launch's sync did, for the trace line and its tests. */
export interface BuiltInSyncResult {
  /** Missing Built-ins whose shipped copy was installed. */
  installed: number;
  /** Untouched Built-ins replaced with a newer shipped copy. */
  replaced: number;
  /** Edited Built-ins kept aside for the store's Modified + Update available. */
  keptModified: number;
}

/** What syncing one Built-in did. */
type BuiltInSyncOutcome = "installed" | "replaced" | "kept-modified" | "unchanged";

/**
 * The installed copy's manifest, per-file digests, and hash; null when the
 * folder is gone or the hash scheme refuses it. The manifest is read under the
 * Built-in schema, like the store's own read of a Built-in folder.
 */
async function readInstalledCopy(
  directory: PluginDirectoryAdapter,
  pluginId: string
): Promise<CurrentCopy | null> {
  const folder = await directory.readFolder(pluginId);
  if (!folder) return null;
  const read = readPluginManifest(folder, { builtIn: true });
  if (!read.ok) return null;
  try {
    const digests = await pluginFileDigests(folder.files);
    const hash = await hashPluginDirectory(folder.files);
    return { manifest: read.manifest, digests, hash };
  } catch {
    return null;
  }
}

/**
 * Writes a Built-in's shipped copy over its installed folder. `false` when the
 * adapter cannot write, refuses, or throws: one Built-in never stops the rest.
 */
async function writeShippedCopy(
  directory: PluginDirectoryAdapter,
  builtIn: BuiltInPlugin
): Promise<boolean> {
  if (!directory.replaceFolder) return false;
  try {
    return await directory.replaceFolder(builtIn.id, builtIn.files);
  } catch {
    return false;
  }
}

/**
 * Brings a Built-in's approval record in line after its folder was installed
 * or replaced. A copy the author never approved is pre-granted but left off
 * from the shipped manifest (`approveBuiltInCopy`, the store's first sight); an
 * existing record is re-pinned to the shipped copy keeping its grants
 * (`repinnedBuiltInApproval`, what `replaceBuiltIn` leaves). A folder that
 * cannot be read leaves the record alone.
 */
async function syncInstalledApproval(
  directory: PluginDirectoryAdapter,
  builtIn: BuiltInPlugin
): Promise<void> {
  const copy = await readInstalledCopy(directory, builtIn.id);
  if (!copy) return;
  const approval = getPluginApproval(builtIn.id);
  if (approval === null) {
    savePluginApproval(
      approveBuiltInCopy(copy.manifest, copy.hash, copy.digests, builtIn.hash)
    );
    return;
  }
  savePluginApproval(repinnedBuiltInApproval(approval, copy, builtIn));
}

/**
 * Makes one Built-in's folder hold the copy this device should run: a missing
 * folder is installed, an untouched folder whose hash is the shipped hash a
 * previous version recorded is replaced, and an edited folder is left for the
 * store. A copy the adapter refuses reports `unchanged`.
 */
async function syncBuiltIn(
  directory: PluginDirectoryAdapter,
  builtIn: BuiltInPlugin
): Promise<BuiltInSyncOutcome> {
  const folder = await directory.readFolder(builtIn.id);
  if (folder === null) {
    if (!(await writeShippedCopy(directory, builtIn))) return "unchanged";
    await syncInstalledApproval(directory, builtIn);
    return "installed";
  }
  let hash: string;
  try {
    hash = await hashPluginDirectory(folder.files);
  } catch {
    // A folder the hash scheme refuses cannot be judged or replaced.
    return "unchanged";
  }
  // Already the shipped copy: nothing to do, and the store pre-grants it.
  if (hash === builtIn.hash) return "unchanged";
  // Untouched: the installed hash is the shipped hash a previous version left
  // recorded, so this is an app update. Any other hash (including one with no
  // recorded shipped hash) is an edited copy the author must review.
  const approval = getPluginApproval(builtIn.id);
  if (approval?.builtIn?.shippedHash !== hash) return "kept-modified";
  if (!(await writeShippedCopy(directory, builtIn))) return "unchanged";
  await syncInstalledApproval(directory, builtIn);
  return "replaced";
}

/**
 * The launch sync (#444): with the shipped Built-in Plugins in hand, makes the
 * Plugin Directory hold what each one supporting this device should run, before
 * the management store first classifies Plugins, so an untouched copy is
 * replaced silently on an app update instead of showing as Modified. A missing
 * copy is installed, an untouched copy is replaced on update (its record
 * re-pinned), an edited copy is left for the store's Modified + Update
 * available, and a Built-in the author removed is never reinstalled. One
 * Built-in's failure never stops the rest or the launch; the app runs with zero
 * Built-ins. Emits one trace line per launch only when a copy was installed or replaced.
 */
export async function syncBuiltInPlugins(
  options: BuiltInSyncOptions = {}
): Promise<BuiltInSyncResult> {
  const result: BuiltInSyncResult = { installed: 0, replaced: 0, keptModified: 0 };
  let builtIns: BuiltInPlugin[];
  try {
    const source = options.builtInSource ?? createBuiltInPluginSource();
    builtIns = await source.list();
  } catch (error) {
    // The list is best-effort: an unreadable source ships no Built-ins.
    console.warn("Built-in Plugins could not be listed; shipping none", error);
    return result;
  }
  if (builtIns.length === 0) return result;

  let directory: PluginDirectoryAdapter;
  try {
    directory = options.directory ?? (await getPluginDirectory());
  } catch (error) {
    console.warn("The Built-in Plugins could not be synced", error);
    return result;
  }

  for (const builtIn of builtIns) {
    // A manifest that excludes this device never installs here, and a Built-in
    // the author removed is never silently reinstalled.
    if (!isSupported(builtIn.manifest, directory.kind)) continue;
    if (getKnownPlugin(builtIn.id)?.removed === true) continue;
    try {
      const outcome = await syncBuiltIn(directory, builtIn);
      if (outcome === "installed") result.installed += 1;
      else if (outcome === "replaced") result.replaced += 1;
      else if (outcome === "kept-modified") result.keptModified += 1;
    } catch (error) {
      // One Built-in's failure must never skip the next one or the launch.
      console.warn(`Built-in Plugin ${builtIn.id} could not be synced`, error);
    }
  }

  const { installed, replaced, keptModified } = result;
  if (installed + replaced > 0) {
    (options.info ?? console.info)(
      `Built-in Plugins: installed ${installed}, replaced ${replaced}, kept modified ${keptModified}`
    );
  }
  return result;
}
