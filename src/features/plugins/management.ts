/**
 * The Plugin management store (#442): the orchestrator the Settings UI talks
 * to. It lists every Plugin the Plugin Directory holds with its review state,
 * approves or re-reviews a copy, revokes a Plugin Permission, enables or
 * disables a Plugin, and — when a copy's files change — shows one non-blocking
 * notification per (Plugin, changed hash).
 *
 * It also lists the Built-in Plugins the app ships (plan decision 5). An
 * untouched Built-in with no record is pre-granted on first sight; a copy whose
 * files differ from the shipped one is "modified" and stays off until
 * reviewed; and a shipped hash that changed while the copy is modified offers
 * an update, resolved by Keep my copy or a confirmed replace. A Built-in's
 * grants are listed and revoked exactly like a third-party Plugin's, and a
 * revoked grant is never restored by a refresh.
 *
 * It never creates a frame itself: a start goes through the lifecycle, whose
 * review gate (#442) refuses a copy that changed (or was never approved) before
 * any frame exists. Disabling or revoking a required grant stops a running
 * Plugin through the lifecycle's `stop`; revoking an optional grant leaves it
 * running, and the broker refuses the next call because it reads the live
 * record.
 *
 * It also lists every Plugin the app has ever seen, from the known list (#443):
 * a row stays after the files are deleted, a removed Plugin keeps its row, a
 * Built-in with no folder becomes available to install, a manifest that
 * excludes this device is unsupported and never enableable, and two folders
 * that declare the same id collapse into one entry that names both. A limit or
 * crash stop shows Stopped with its reason and a `restart` action, and the
 * filter helpers below group the list for the Settings filters.
 *
 * The same store performs the management actions (#443): adding a Plugin from a
 * `.zip` or a picked folder, removing one (optionally deleting its retained
 * data), reinstalling a removed Built-in from the bundled copy, and reading a
 * Plugin's stored data size, warning once when it passes 50 MB (#401). Removal
 * stops the Plugin, deletes its files, approval, startup error, and saved
 * credentials, and keeps its row; it never touches Custom Shortcuts or Voice
 * Commands. An app update
 * never silently reinstalls a removed Built-in: the pre-grant path skips a
 * Plugin whose known record is removed.
 */

import { create } from "zustand";
import {
  approveBuiltInCopy,
  approvePluginCopy,
  clearStartupError,
  disablePlugin,
  enablePlugin,
  getPluginApproval,
  recordStartupError,
  removePluginApproval,
  revokePermission,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { createBuiltInPluginSource } from "@/features/plugins/builtin";
import { hashPluginDirectory, pluginFileDigests } from "@/features/plugins/directory-hash";
import {
  getKnownPlugin,
  listKnownPlugins,
  markPluginDataSizeWarned,
  markPluginRemoved,
  saveKnownPlugin,
} from "@/features/plugins/known";
import { manifestRunsOn } from "@/features/plugins/host-platform";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { planPluginModules } from "@/features/plugins/modules";
import { applyPluginLocale } from "@/features/plugins/manifest-constants";
import { reviewPluginCopy } from "@/features/plugins/review";
import { getPluginFileGrantStore } from "@/features/plugins/file-grants";
import { getPluginSecretStore } from "@/features/plugins/secret-store";
import { clearPluginStorage, getPluginDataSize } from "@/features/plugins/storage";
import type {
  BuiltInPlugin,
  PluginActivationResult,
  PluginApproval,
  PluginFolder,
  PluginLifecycleStopReason,
  PluginLocale,
  PluginManagement,
  PluginManagementEntry,
  PluginManagementOptions,
  PluginManifest,
  PluginNotification,
  PluginPermissionId,
} from "@/features/plugins/types";
import { useSettingsStore } from "@/features/settings/store";
import type { Language } from "@/features/settings/types";
import { getPluginDirectory } from "@/lib/platform";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";

/**
 * The device platform the Plugin Directory serves, used to decide whether a
 * manifest's declared `platforms` include this device (the adapter reports
 * `web`, `desktop`, or `android` from the build).
 */
type DevicePlatform = PluginDirectoryAdapter["kind"];

/**
 * A Plugin's stored data at or past this many bytes warns once, naming the
 * cost to saving and Backups (#401). The figure is the decision's 50 MB; the
 * warning is persisted on the known record so it shows once ever per Plugin.
 */
export const PLUGIN_DATA_SIZE_WARNING_BYTES = 50 * 1024 * 1024;

/**
 * The platforms the host runs no Plugin on, re-exported next to
 * {@link isSupported} so the whole platform rule reads in one place. The source
 * of truth is `host-platform.ts`, a leaf the Built-in build script also imports
 * (#447).
 */
export {
  PLUGIN_HOST_UNSUPPORTED_PLATFORMS,
  manifestRunsOn,
  pluginsRunOn,
} from "@/features/plugins/host-platform";

/**
 * True when a manifest may run on this device: the Plugin Platforms rule (#517).
 * A manifest that omits `platforms` runs on desktop and web; a declared list
 * runs only where it names the device, so Android needs "android" listed. Shared
 * with the launch sync (#444) and the launch scan (#436) through
 * {@link manifestRunsOn}, so all read the same platform rule.
 */
export function isSupported(manifest: PluginManifest, platform: DevicePlatform): boolean {
  return manifestRunsOn(manifest.platforms as readonly string[] | undefined, platform);
}

/**
 * The stop reason Settings shows as Stopped. `requested` (disable) and `idle`
 * (an on-demand Plugin with no work) are normal lifecycle events, not a state
 * the author needs to act on.
 */
function stopShownReason(
  reason: PluginLifecycleStopReason | null
): PluginLifecycleStopReason | null {
  if (reason === null || reason === "requested" || reason === "idle") return null;
  return reason;
}

/** The notification text for a changed copy or a Built-in update, localized. */
function defaultNotify(_notification: PluginNotification): void {
  // The app renders the store's `notifications` through its Plugin notice
  // surface (`PluginChangeNotices`), which carries the Review and Dismiss
  // actions a toast cannot. Notifying here as well would double-notify.
}

/**
 * Loads the runtime module on first use. Its manifest validator (zod) must stay
 * out of the entry chunk (#437, `entry-chunk.test.ts`): the Settings screen
 * reaches this module statically, so the validator is read behind `import()`
 * only when a Plugin folder is actually parsed.
 */
let runtimeModule: Promise<typeof import("@/features/plugins/runtime")> | null = null;
function loadRuntime(): Promise<typeof import("@/features/plugins/runtime")> {
  runtimeModule ??= import("@/features/plugins/runtime");
  return runtimeModule;
}

/**
 * The Plugin-locale reader, loaded on demand. It lives in the contributions
 * write side with the manifest validator, which must stay out of the entry
 * chunk the Settings screen sits in (#437), so the locale map is read through a
 * dynamic import rather than a static one.
 */
let contributionsModule: Promise<typeof import("@/features/plugins/contributions")> | null = null;
function loadContributions(): Promise<typeof import("@/features/plugins/contributions")> {
  contributionsModule ??= import("@/features/plugins/contributions");
  return contributionsModule;
}

/** Reads the `locales/<lang>.json` overrides of one Plugin folder (#442). */
async function readFolderLocales(
  folder: PluginFolder,
  manifest: PluginManifest
): Promise<Partial<Record<Language, PluginLocale>>> {
  const { readPluginLocales } = await loadContributions();
  return readPluginLocales(folder, manifest);
}

/**
 * The Plugin's manifest with the UI-string overrides of `language` applied
 * (#442): the Settings card shows the manifest name localized to the current UI
 * language, falling back to the manifest's own literal when it has no locale.
 */
export function localizedPluginManifest(
  entry: Pick<PluginManagementEntry, "manifest" | "locales">,
  language: Language
): PluginManifest {
  return applyPluginLocale(entry.manifest, entry.locales[language] ?? {});
}

/** The current folder, manifest, digests, and hash for a Plugin id. */
export interface CurrentCopy {
  manifest: PluginManagementEntry["manifest"];
  digests: Map<string, string>;
  hash: string;
  /** The copy's UI-string overrides per language, read from its folder. */
  locales?: Partial<Record<Language, PluginLocale>>;
}

/**
 * The record after a Built-in's installed copy was replaced with the shipped
 * one: re-pinned to the new copy and its shipped hash, keeping the author's
 * Plugin Permissions, so a revoked grant stays revoked and no update is offered
 * for the shipped hash now installed. Shared by `replaceBuiltIn` and the launch
 * sync (#444), so both leave exactly the same state.
 */
export function repinnedBuiltInApproval(
  approval: PluginApproval,
  copy: CurrentCopy,
  builtIn: BuiltInPlugin
): PluginApproval {
  return {
    ...approval,
    pinnedHash: copy.hash,
    approvedVersion: copy.manifest.version,
    approvedPermissions: {
      required: [...copy.manifest.permissions.required],
      optional: [...copy.manifest.permissions.optional],
    },
    approvedFiles: Object.fromEntries(copy.digests),
    builtIn: { shippedHash: builtIn.hash },
    notifiedBuiltInHash: builtIn.hash,
  };
}

/**
 * Creates the management store. The app uses the {@link usePluginManagementStore}
 * singleton; tests inject a directory, a lifecycle, and a Built-in source.
 */
export function createPluginManagementStore(options: PluginManagementOptions = {}) {
  const getLifecycle = options.lifecycle ?? getPluginLifecycle;
  const notify = options.notify ?? defaultNotify;
  const builtInSource = options.builtInSource ?? createBuiltInPluginSource();
  const isDevelopmentMode =
    options.isDevelopmentMode ?? (() => useSettingsStore.getState().pluginDevelopmentMode);
  const debounceMs = options.debounceMs ?? 300;
  /** The last notified hash per Plugin, so a change notifies once even if two paths race. */
  const notified = new Map<string, string>();
  /** The last notified shipped hash per Built-in, for the same reason. */
  const notifiedBuiltIn = new Map<string, string>();

  async function readCopy(pluginId: string): Promise<CurrentCopy | null> {
    const directory = options.directory ?? (await getPluginDirectory());
    const folder = await directory.readFolder(pluginId);
    if (!folder) return null;
    // A Built-in may use the reserved `maibuk-` prefix, so it validates under
    // the Built-in schema; a third-party folder stays under the other one.
    const isBuiltIn = (await listBuiltIns()).has(pluginId);
    const { readPluginManifest } = await loadRuntime();
    const read = readPluginManifest(folder, { builtIn: isBuiltIn });
    if (!read.ok) return null;
    try {
      const digests = await pluginFileDigests(folder.files);
      const hash = await hashPluginDirectory(folder.files);
      const locales = await readFolderLocales(folder, read.manifest);
      return { manifest: read.manifest, digests, hash, locales };
    } catch {
      // A folder the hash scheme refuses cannot be reviewed or approved.
      return null;
    }
  }

  /** The shipped Built-in Plugins this platform reports, by id. */
  async function listBuiltIns(): Promise<Map<string, BuiltInPlugin>> {
    const list = await builtInSource.list();
    return new Map(list.map((entry) => [entry.id, entry]));
  }

  function running(pluginId: string): boolean {
    const state = getLifecycle()?.state(pluginId) ?? null;
    return state !== null && state.status !== "stopped";
  }

  /**
   * Tells a running Plugin its Plugin Permissions changed (#591). The broker
   * drops the event when the Plugin never subscribed, exactly like the
   * language and endpoint events the lifecycle emits host-side. Called by
   * every path that writes a new grant set while the Plugin may keep running.
   */
  function emitPermissionsChanged(pluginId: string): void {
    const broker = getLifecycle()?.runtime(pluginId)?.broker;
    const approval = getPluginApproval(pluginId);
    if (!broker || !approval) return;
    broker.emit("permissions.changed", { permissions: [...approval.granted] });
  }

  /** The stop Settings shows as Stopped for an installed Plugin, or null. */
  function stoppedOf(pluginId: string): PluginManagementEntry["stopped"] {
    const state = getLifecycle()?.state(pluginId) ?? null;
    if (state === null || state.status !== "stopped") return null;
    const reason = stopShownReason(state.reason);
    return reason === null ? null : { reason };
  }

  /** The device platform the Plugin Directory serves right now. */
  async function devicePlatform(): Promise<DevicePlatform> {
    return (options.directory ?? (await getPluginDirectory())).kind;
  }

  /**
   * One entry for a copy: its review, plus every state Settings shows. A
   * Built-in is "modified" when its installed hash differs from the shipped
   * one, and an update is available when a modified copy's shipped hash has
   * moved past the one its record pins.
   */
  function buildEntry(input: {
    pluginId: string;
    copy: CurrentCopy;
    approval: PluginApproval | null;
    builtIn: BuiltInPlugin | undefined;
    platform: DevicePlatform;
    installed: boolean;
    removed: boolean;
    available: boolean;
    duplicateFolders: string[];
  }): PluginManagementEntry {
    const { pluginId, copy, approval, builtIn, platform, installed } = input;
    const review = reviewPluginCopy({
      approval,
      digests: copy.digests,
      hash: copy.hash,
      manifest: copy.manifest,
    });
    const modified = installed && builtIn !== undefined && copy.hash !== builtIn.hash;
    const updateAvailable =
      builtIn !== undefined &&
      modified &&
      approval?.builtIn !== undefined &&
      approval.builtIn.shippedHash !== builtIn.hash;
    return {
      pluginId,
      manifest: copy.manifest,
      approval,
      review,
      running: installed ? running(pluginId) : false,
      builtIn: builtIn !== undefined,
      modified,
      updateAvailable,
      installed,
      removed: input.removed,
      available: input.available,
      unsupported: !isSupported(copy.manifest, platform),
      duplicateFolders: input.duplicateFolders,
      stopped: installed ? stoppedOf(pluginId) : null,
      locales: copy.locales ?? {},
    };
  }

  /** Builds an installed copy's entry, reading the device platform now. */
  async function installedEntry(
    pluginId: string,
    copy: CurrentCopy,
    approval: PluginApproval | null,
    builtIn: BuiltInPlugin | undefined
  ): Promise<PluginManagementEntry> {
    return buildEntry({
      pluginId,
      copy,
      approval,
      builtIn,
      platform: await devicePlatform(),
      installed: true,
      removed: false,
      available: false,
      duplicateFolders: [],
    });
  }

  /**
   * The record for a modified Built-in copy the author never approved: pinned
   * to the shipped copy so its review compares the installed files and
   * permissions against what shipped. It grants nothing and stays off until the
   * author reviews it (#442, plan decision 5).
   */
  async function modifiedBuiltInCopy(
    manifest: PluginManagementEntry["manifest"],
    builtIn: BuiltInPlugin
  ): Promise<PluginApproval> {
    const shippedDigests = await pluginFileDigests(builtIn.files);
    return {
      pluginId: manifest.id,
      pinnedHash: builtIn.hash,
      granted: [],
      enabled: false,
      approvedVersion: builtIn.manifest.version,
      approvedPermissions: {
        required: [...builtIn.manifest.permissions.required],
        optional: [...builtIn.manifest.permissions.optional],
      },
      approvedFiles: Object.fromEntries(shippedDigests),
      builtIn: { shippedHash: builtIn.hash },
    };
  }

  return create<PluginManagement>((set, get) => {
    let unsubscribe: (() => void) | null = null;
    let unwatch: (() => void) | null = null;
    const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /** Reports a changed copy the lifecycle refused to start. */
    async function reportChanged(pluginId: string): Promise<void> {
      const copy = await readCopy(pluginId);
      if (!copy) return;
      get().notifyChanged(pluginId, copy.hash);
    }

    /**
     * Warns once per Plugin when its refreshed data size passes 50 MB (#401).
     * The warning is recorded on the known row before it is shown, so a reload
     * or a second refresh never repeats it; a Plugin with no known row is
     * warned but cannot persist, which only happens outside the list.
     */
    function warnDataSizeOnce(pluginId: string, size: number): void {
      if (size < PLUGIN_DATA_SIZE_WARNING_BYTES) return;
      if (getKnownPlugin(pluginId)?.dataSizeWarned === true) return;
      markPluginDataSizeWarned(pluginId);
      const name = get().plugins[pluginId]?.manifest.name ?? pluginId;
      const notification: PluginNotification = { pluginId, name, hash: "", kind: "size" };
      set((state) => ({
        notifications: [
          ...state.notifications.filter((current) => current.pluginId !== pluginId),
          notification,
        ],
      }));
      notify(notification);
    }

    /**
     * Subscribes once to the lifecycle. A start the review gate refused is a
     * changed copy, reported here so it notifies even before Settings opens. A
     * limit or crash stop sets the entry's Stopped reason; a successful start
     * clears it.
     */
    function ensureSubscribed(): void {
      if (unsubscribe) return;
      const lifecycle = getLifecycle();
      if (!lifecycle) return;
      unsubscribe = lifecycle.subscribe((change) => {
        const state = change.state;
        const reason = state.status === "stopped" ? stopShownReason(state.reason) : null;
        set((current) => {
          const entry = current.plugins[change.pluginId];
          if (!entry) return {};
          const running = state.status !== "stopped";
          const stopped = reason === null ? null : { reason };
          if (entry.running === running && entry.stopped?.reason === stopped?.reason) return {};
          return {
            plugins: {
              ...current.plugins,
              [change.pluginId]: { ...entry, running, stopped },
            },
          };
        });
        if (state.status === "stopped" && state.refusal?.code === "review-required") {
          void reportChanged(change.pluginId);
        }
      });
    }

    /** Writes an entry into state from the copy, record, and Built-in info. */
    async function applyApproval(
      pluginId: string,
      copy: CurrentCopy,
      approval: PluginApproval,
      builtIn: BuiltInPlugin | undefined
    ): Promise<void> {
      const entry = await installedEntry(pluginId, copy, approval, builtIn);
      set((state) => ({ plugins: { ...state.plugins, [pluginId]: entry } }));
    }

    /** Registers and starts an installed Plugin through the lifecycle, then records liveness. */
    async function start(pluginId: string): Promise<void> {
      const lifecycle = getLifecycle();
      if (!lifecycle) return;
      const result = await lifecycle.install(pluginId, "enable");
      await applyStartResult(pluginId, result);
      set((state) => {
        const entry = state.plugins[pluginId];
        if (!entry) return {};
        return {
          plugins: {
            ...state.plugins,
            [pluginId]: {
              ...entry,
              approval: getPluginApproval(pluginId) ?? entry.approval,
              running: running(pluginId),
              stopped: stoppedOf(pluginId),
            },
          },
        };
      });
    }

    /**
     * Records a startup failure on the approval record, or clears a stale one
     * on a successful start, so Settings shows the last error until the Plugin
     * runs again (#442). The two writes are the shared approvals helpers.
     */
    async function applyStartResult(
      pluginId: string,
      result: PluginActivationResult
    ): Promise<void> {
      if (!result.ok) {
        recordStartupError(pluginId, result.refusal);
        return;
      }
      clearStartupError(pluginId);
    }

    /** Stops watching the Plugin Directory and drops any pending reload. */
    function stopWatching(): void {
      if (unwatch !== null) {
        unwatch();
        unwatch = null;
      }
      for (const timer of changeTimers.values()) clearTimeout(timer);
      changeTimers.clear();
    }

    /** Subscribes or unsubscribes the watch so it matches development mode (#442). */
    function syncWatcher(directory: PluginDirectoryAdapter): void {
      if (!isDevelopmentMode()) {
        stopWatching();
        return;
      }
      if (unwatch !== null || !directory.watch) return;
      unwatch = directory.watch((pluginId) => scheduleChange(pluginId));
    }

    /** Debounces a folder change; the last event in a burst is the one read. */
    function scheduleChange(pluginId: string): void {
      const existing = changeTimers.get(pluginId);
      if (existing !== undefined) clearTimeout(existing);
      changeTimers.set(
        pluginId,
        setTimeout(() => {
          changeTimers.delete(pluginId);
          void reloadDevelopmentCopy(pluginId);
        }, debounceMs)
      );
    }

    /**
     * Reloads one Plugin after a watched folder changed in development mode
     * (#442). It is a completed build only when two reads agree on the hash,
     * the manifest validates, and every module the entry reaches is present;
     * anything else keeps the previous running build and re-pins nothing. A
     * completed build skips file-change review (its hash is re-pinned) but a
     * new required Plugin Permission the author never granted still blocks.
     */
    async function reloadDevelopmentCopy(pluginId: string): Promise<void> {
      if (!isDevelopmentMode()) return;
      const approval = getPluginApproval(pluginId);
      // A disabled or unknown Plugin never reloads on a folder change.
      if (!approval || !approval.enabled) return;
      const directory = options.directory ?? (await getPluginDirectory());
      const first = await directory.readFolder(pluginId);
      if (!first) return;
      const second = await directory.readFolder(pluginId);
      if (!second) return;
      let firstHash: string;
      let secondHash: string;
      try {
        firstHash = await hashPluginDirectory(first.files);
        secondHash = await hashPluginDirectory(second.files);
      } catch {
        // A folder the hash scheme refuses cannot be loaded.
        return;
      }
      // A half-written generation: the two reads disagree.
      if (firstHash !== secondHash) return;
      const builtIn = (await listBuiltIns()).get(pluginId);
      const { readPluginManifest } = await loadRuntime();
      const read = readPluginManifest(second, { builtIn: builtIn !== undefined });
      if (!read.ok) return;
      // Every module the entry reaches must be present: a missing entry or a
      // missing import is a partial build.
      const plan = await planPluginModules(second.files, read.manifest.entry);
      if (!plan.ok) return;
      const digests = await pluginFileDigests(second.files);
      const locales = await readFolderLocales(second, read.manifest);
      // A new required Plugin Permission the author never granted blocks the
      // reload: review-required, and the previous build keeps running.
      const missing = read.manifest.permissions.required.filter(
        (permission) => !approval.granted.includes(permission as PluginPermissionId)
      );
      if (missing.length > 0) {
        const entry = await installedEntry(
          pluginId,
          { manifest: read.manifest, digests, hash: secondHash, locales },
          approval,
          builtIn
        );
        set((state) => ({ plugins: { ...state.plugins, [pluginId]: entry } }));
        return;
      }
      // A completed build: re-pin the hash, digests, version, and permissions,
      // keeping the author's grants and the Plugin's stored data.
      const next: PluginApproval = {
        ...approval,
        pinnedHash: secondHash,
        approvedVersion: read.manifest.version,
        approvedPermissions: {
          required: [...read.manifest.permissions.required],
          optional: [...read.manifest.permissions.optional],
        },
        approvedFiles: Object.fromEntries(digests),
      };
      delete next.startupError;
      savePluginApproval(next);
      const lifecycle = getLifecycle();
      if (lifecycle) {
        // Restart the running build: stop first, then install again, so the
        // new generation is the one that runs (stored data is untouched).
        lifecycle.stop(pluginId);
        const result = await lifecycle.install(pluginId, "update");
        await applyStartResult(pluginId, result);
      }
      const refreshed = await installedEntry(
        pluginId,
        { manifest: read.manifest, digests, hash: secondHash, locales },
        getPluginApproval(pluginId) ?? next,
        builtIn
      );
      set((state) => ({ plugins: { ...state.plugins, [pluginId]: refreshed } }));
    }

    /**
     * Offers one Built-in update per (Plugin, shipped hash). A shipped hash the
     * author chose to keep never prompts again; "Update available" still shows.
     */
    function notifyBuiltInUpdate(pluginId: string, name: string, shippedHash: string): void {
      const approval = getPluginApproval(pluginId);
      if (!approval) return;
      if (approval.builtIn?.keptModifiedHash === shippedHash) return;
      if (
        approval.notifiedBuiltInHash === shippedHash ||
        notifiedBuiltIn.get(pluginId) === shippedHash
      ) {
        return;
      }
      notifiedBuiltIn.set(pluginId, shippedHash);
      const record: PluginApproval = { ...approval, notifiedBuiltInHash: shippedHash };
      savePluginApproval(record);
      set((state) => ({
        plugins: state.plugins[pluginId]
          ? { ...state.plugins, [pluginId]: { ...state.plugins[pluginId], approval: record } }
          : state.plugins,
        notifications: [
          ...state.notifications.filter((current) => current.pluginId !== pluginId),
          { pluginId, name, hash: shippedHash, kind: "available" },
        ],
      }));
      notify({ pluginId, name, hash: shippedHash, kind: "available" });
    }

    const store: PluginManagement = {
      plugins: {},
      notifications: [],
      dataSizes: {},
      endpoint: { state: "off" },

      setEndpoint(state) {
        set({ endpoint: state });
      },

      async refresh() {
        ensureSubscribed();
        const directory = options.directory ?? (await getPluginDirectory());
        syncWatcher(directory);
        const platform = directory.kind;
        const names = await directory.listFolders();
        const builtIns = await listBuiltIns();
        const { readPluginManifest } = await loadRuntime();
        const plugins: Record<string, PluginManagementEntry> = {};
        const changed: { pluginId: string; hash: string }[] = [];
        const available: { pluginId: string; name: string; hash: string }[] = [];

        // Group every readable folder by the id its manifest declares, so two
        // folders that declare the same id become one entry naming both.
        const copiesById = new Map<string, { name: string; copy: CurrentCopy }[]>();
        for (const name of names) {
          const folder = await directory.readFolder(name);
          if (!folder) continue;
          // The source id is the folder name; a declared Built-in validates
          // under the Built-in schema, so a reserved `maibuk-` id is allowed.
          const shipped = builtIns.get(name);
          const read = readPluginManifest(folder, { builtIn: shipped !== undefined });
          if (!read.ok) continue;
          let digests: Map<string, string>;
          let hash: string;
          try {
            digests = await pluginFileDigests(folder.files);
            hash = await hashPluginDirectory(folder.files);
          } catch {
            continue;
          }
          const copies = copiesById.get(read.manifest.id) ?? [];
          copies.push({
            name,
            copy: {
              manifest: read.manifest,
              digests,
              hash,
              locales: await readFolderLocales(folder, read.manifest),
            },
          });
          copiesById.set(read.manifest.id, copies);
        }

        for (const [pluginId, copies] of copiesById) {
          const duplicateFolders = copies.length > 1 ? copies.map((entry) => entry.name) : [];
          const copy = copies[0].copy;
          const manifest = copy.manifest;
          const builtIn = builtIns.get(pluginId);
          let approval = getPluginApproval(pluginId);
          // A Plugin the author explicitly removed is never silently
          // reinstalled: an app update that restores a Built-in's folder must
          // not pre-grant it again, so removal survives until the author
          // reinstalls it (reinstallBuiltIn clears the mark first) (#443).
          const knownRemoved = getKnownPlugin(pluginId)?.removed === true;
          // First sight of a Built-in: an untouched copy is pre-granted but left
          // off (a later enable needs no review), while a modified copy is
          // recorded against the shipped one
          // so it reads "review-required" (with its file and permission diff)
          // instead of "never approved". Nothing is granted until review, a
          // duplicated id is never pre-granted, and a removed Built-in stays
          // off until an explicit reinstall.
          if (builtIn && approval === null && duplicateFolders.length === 0 && !knownRemoved) {
            approval =
              copy.hash === builtIn.hash
                ? approveBuiltInCopy(manifest, copy.hash, copy.digests, builtIn.hash)
                : await modifiedBuiltInCopy(manifest, builtIn);
            savePluginApproval(approval);
          }
          // A removed copy that is present again keeps its removed mark while
          // no approval exists, so the next refresh cannot pre-grant it: an app
          // update that restores a Built-in's folder must not silently
          // reinstall it. Only `reinstallBuiltIn` (which clears the mark first)
          // or approving through the approval flow (manual add + approve,
          // which leaves an approval behind) clears it (#443).
          const stillRemoved = knownRemoved && approval === null;
          saveKnownPlugin({
            pluginId,
            manifest,
            builtIn: builtIn !== undefined,
            removed: stillRemoved,
          });
          const entry = buildEntry({
            pluginId,
            copy,
            approval,
            builtIn,
            platform,
            installed: true,
            removed: stillRemoved,
            available: false,
            duplicateFolders,
          });
          plugins[pluginId] = entry;
          if (builtIn) {
            // A modified Built-in shows its own state; only an update notifies.
            if (entry.updateAvailable) {
              available.push({ pluginId, name: manifest.name, hash: builtIn.hash });
            }
          } else if (entry.review.status === "review-required") {
            changed.push({ pluginId, hash: copy.hash });
          }
        }

        // A known Plugin whose files are gone keeps its row: last-seen manifest,
        // not installed, not running. A Built-in with a shipped copy that is
        // absent also becomes available to install.
        for (const known of listKnownPlugins()) {
          if (plugins[known.pluginId]) continue;
          const builtIn = builtIns.get(known.pluginId);
          plugins[known.pluginId] = buildEntry({
            pluginId: known.pluginId,
            copy: { manifest: known.manifest, digests: new Map(), hash: "", locales: {} },
            approval: getPluginApproval(known.pluginId),
            builtIn,
            platform,
            installed: false,
            removed: known.removed,
            available: builtIn !== undefined && isSupported(known.manifest, platform),
            duplicateFolders: [],
          });
        }

        // A Built-in the app ships whose folder is absent and was never seen: a
        // row that offers to install it.
        for (const [id, builtIn] of builtIns) {
          if (plugins[id]) continue;
          plugins[id] = buildEntry({
            pluginId: id,
            copy: { manifest: builtIn.manifest, digests: new Map(), hash: "", locales: {} },
            approval: getPluginApproval(id),
            builtIn,
            platform,
            installed: false,
            removed: false,
            available: isSupported(builtIn.manifest, platform),
            duplicateFolders: [],
          });
        }

        set({ plugins });
        if (isDevelopmentMode()) {
          // Development mode at launch: a copy that changed while the app was
          // closed goes through the dev reload policy — a completed build is
          // re-pinned and started, a partial one is left alone — instead of a
          // change notification (#442, plan decision 6).
          for (const entry of Object.values(plugins)) {
            if (entry.installed && entry.review.status === "review-required") {
              await reloadDevelopmentCopy(entry.pluginId);
            }
          }
        } else {
          for (const { pluginId, hash } of changed) get().notifyChanged(pluginId, hash);
        }
        for (const { pluginId, name, hash } of available) {
          notifyBuiltInUpdate(pluginId, name, hash);
        }
      },

      async addFromZip() {
        const directory = options.directory ?? (await getPluginDirectory());
        // An adapter that cannot install returns null, like a cancelled picker;
        // one that throws rejects, for the UI to toast.
        const pluginId = directory.addFromZip ? await directory.addFromZip() : null;
        await get().refresh();
        return pluginId;
      },

      async addFromFolder() {
        const directory = options.directory ?? (await getPluginDirectory());
        const pluginId = directory.addFromFolder ? await directory.addFromFolder() : null;
        await get().refresh();
        return pluginId;
      },

      async approve(pluginId, optionalGranted = []) {
        const copy = await readCopy(pluginId);
        if (!copy) return { ok: false, reason: "copy-unavailable" };
        const current = getPluginApproval(pluginId);
        const review = reviewPluginCopy({
          approval: current,
          digests: copy.digests,
          hash: copy.hash,
          manifest: copy.manifest,
        });
        // Only a copy that matches the author's pin may be approved here. A
        // changed copy must be reviewed through `markReviewed` (the dialog), so
        // an inline permission toggle can never re-pin and start it (#442).
        if (review.status === "review-required") {
          return { ok: false, reason: "review-required" };
        }
        const approval = approvePluginCopy(copy.manifest, copy.hash, copy.digests, optionalGranted);
        const builtIn = (await listBuiltIns()).get(pluginId);
        // A Built-in keeps its shipped record through a re-approval.
        if (builtIn) approval.builtIn = { shippedHash: builtIn.hash };
        savePluginApproval(approval);
        await applyApproval(pluginId, copy, approval, builtIn);
        await start(pluginId);
        // A re-approval may rewrite the grant set of a Plugin that keeps
        // running (its start is a no-op once ready): it hears the new list (#591).
        emitPermissionsChanged(pluginId);
        return { ok: true };
      },

      async revoke(pluginId, permission: PluginPermissionId) {
        const entry = get().plugins[pluginId];
        if (!entry?.approval) return;
        const next = revokePermission(entry.approval, permission, entry.manifest);
        if (next === entry.approval) return;
        // Revoking `files:pick` ends every File Grant the Plugin held: without
        // the Plugin Permission there is no reason to keep a way to the files.
        if (permission === "files:pick") {
          await getPluginFileGrantStore()?.clearPlugin(pluginId);
        }
        savePluginApproval(next);
        if (!next.enabled) {
          // A required grant is gone: the Plugin is disabled and unregistered.
          getLifecycle()?.uninstall(pluginId);
        } else {
          // An optional grant is gone but the Plugin keeps running: it hears
          // the new list now, and the broker refuses the next gated call (#591).
          emitPermissionsChanged(pluginId);
        }
        set((state) => ({
          plugins: {
            ...state.plugins,
            [pluginId]: {
              ...state.plugins[pluginId],
              approval: next,
              running: next.enabled ? state.plugins[pluginId].running : false,
            },
          },
        }));
      },

      async enable(pluginId) {
        const entry = get().plugins[pluginId];
        if (!entry?.approval) return;
        // A Plugin that is not installed, is duplicated by folder, or the
        // manifest excludes this device can never be enabled (#443).
        if (!entry.installed || entry.duplicateFolders.length > 0 || entry.unsupported) return;
        const result = enablePlugin(entry.approval, entry.manifest);
        if (!result.ok) return;
        savePluginApproval(result.approval);
        set((state) => ({
          plugins: {
            ...state.plugins,
            [pluginId]: {
              ...state.plugins[pluginId],
              approval: result.approval,
              stopped: null,
            },
          },
        }));
        await start(pluginId);
      },

      disable(pluginId) {
        const entry = get().plugins[pluginId];
        if (!entry?.approval) return;
        const next = disablePlugin(entry.approval);
        savePluginApproval(next);
        getLifecycle()?.uninstall(pluginId);
        set((state) => ({
          plugins: {
            ...state.plugins,
            [pluginId]: {
              ...state.plugins[pluginId],
              approval: next,
              running: false,
              stopped: null,
            },
          },
        }));
      },

      async restart(pluginId) {
        const lifecycle = getLifecycle();
        if (!lifecycle) return;
        const result = await lifecycle.start(pluginId, "restart");
        if (!result.ok) return;
        set((state) => {
          const entry = state.plugins[pluginId];
          if (!entry) return {};
          return {
            plugins: {
              ...state.plugins,
              [pluginId]: {
                ...entry,
                approval: getPluginApproval(pluginId) ?? entry.approval,
                running: running(pluginId),
                stopped: null,
              },
            },
          };
        });
      },

      async markReviewed(pluginId, optionalGranted) {
        const copy = await readCopy(pluginId);
        if (!copy) return;
        const approval = getPluginApproval(pluginId);
        if (!approval) return;
        // Keep the author's revoked optional grants, or use the ones the review
        // dialog chose; grant every required one either way.
        const keptOptional: PluginPermissionId[] =
          optionalGranted === undefined
            ? approval.granted.filter((permission) =>
                copy.manifest.permissions.optional.includes(permission)
              )
            : (copy.manifest.permissions.optional.filter((permission) =>
                optionalGranted.includes(permission as PluginPermissionId)
              ) as PluginPermissionId[]);
        const next = approvePluginCopy(copy.manifest, copy.hash, copy.digests, keptOptional);
        const builtIn = (await listBuiltIns()).get(pluginId);
        // A Built-in keeps its shipped record: the copy is still "modified"
        // versus the shipped one, and any update stays offered.
        if (builtIn) next.builtIn = approval.builtIn ?? { shippedHash: builtIn.hash };
        savePluginApproval(next);
        await applyApproval(pluginId, copy, next, builtIn);
        await start(pluginId);
        // The review may grant or drop an optional Permission of a Plugin that
        // keeps running: it hears the new list (#591).
        emitPermissionsChanged(pluginId);
      },

      async keepMyCopy(pluginId) {
        const entry = get().plugins[pluginId];
        const approval = getPluginApproval(pluginId);
        if (!entry?.builtIn || !approval?.builtIn) return;
        const builtIn = (await listBuiltIns()).get(pluginId);
        if (!builtIn) return;
        // Keep the installed files and grants; record the shipped hash so that
        // shipped hash never prompts again. "Update available" still shows.
        const next: PluginApproval = {
          ...approval,
          builtIn: { ...approval.builtIn, keptModifiedHash: builtIn.hash },
        };
        savePluginApproval(next);
        set((state) => ({
          plugins: {
            ...state.plugins,
            [pluginId]: { ...state.plugins[pluginId], approval: next },
          },
        }));
      },

      async replaceBuiltIn(pluginId, confirmed) {
        if (!confirmed) return false;
        const entry = get().plugins[pluginId];
        if (!entry?.builtIn) return false;
        const approval = getPluginApproval(pluginId);
        if (!approval) return false;
        const builtIn = (await listBuiltIns()).get(pluginId);
        if (!builtIn) return false;
        const directory = options.directory ?? (await getPluginDirectory());
        if (!directory.replaceFolder) return false;
        let replaced: boolean;
        try {
          replaced = await directory.replaceFolder(pluginId, builtIn.files);
        } catch {
          return false;
        }
        if (!replaced) return false;
        const copy = await readCopy(pluginId);
        if (!copy) return false;
        // Re-pin the shipped copy; keep the author's grants, so a revoked
        // Permission stays revoked. The record now knows this shipped hash, so
        // no update is offered for it.
        const next = repinnedBuiltInApproval(approval, copy, builtIn);
        savePluginApproval(next);
        await applyApproval(pluginId, copy, next, builtIn);
        return true;
      },

      async remove(pluginId, { deleteData: deleteDataOption }) {
        const entry = get().plugins[pluginId];
        // Stop the runtime and withdraw the Plugin's contributions first, by
        // reusing disable (a Plugin with no approval has nothing running).
        get().disable(pluginId);
        const directory = options.directory ?? (await getPluginDirectory());
        if (directory.removeFolder) {
          // A duplicated id names every folder that declares it; otherwise the
          // Plugin id is the folder name.
          const folders =
            entry && entry.duplicateFolders.length > 0 ? entry.duplicateFolders : [pluginId];
          for (const folder of folders) await directory.removeFolder(folder);
        }
        // The approval (grants and pin) goes; a startup error lives on it, so
        // clearing it after the removal is a no-op kept for the decided order.
        removePluginApproval(pluginId);
        clearStartupError(pluginId);
        markPluginRemoved(pluginId);
        // The Plugin's saved credentials always go, not only when the "also
        // delete this Plugin's data" choice is on: that choice covers Library
        // data, and secrets are never Library data. Its File Grants go for the
        // same reason: a way to the author's files is not Library data either.
        // A store failure rejects the removal, like the folder and data steps
        // above. Custom Shortcuts and custom Voice Commands are never touched:
        // they stay, inactive until the Plugin returns.
        await getPluginSecretStore()?.clearPlugin(pluginId);
        await getPluginFileGrantStore()?.clearPlugin(pluginId);
        if (deleteDataOption) await clearPluginStorage(pluginId);
        await get().refresh();
        // Refresh the shown data size after the removal: `refresh()` rebuilds the
        // entries but the row's size effect does not re-run (its deps are
        // unchanged), so a removal that erased the data would still show the old
        // size and offer Delete data (#443).
        await get().refreshDataSize(pluginId);
      },

      async deleteData(pluginId) {
        // Erase the retained namespace but keep the known row and its Command
        // preferences; the shown size drops to zero.
        await clearPluginStorage(pluginId);
        await get().refreshDataSize(pluginId);
      },

      async reinstallBuiltIn(pluginId) {
        const entry = get().plugins[pluginId];
        if (!entry?.builtIn) return false;
        const builtIn = (await listBuiltIns()).get(pluginId);
        if (!builtIn) return false;
        const directory = options.directory ?? (await getPluginDirectory());
        if (!directory.replaceFolder) return false;
        let replaced: boolean;
        try {
          replaced = await directory.replaceFolder(pluginId, builtIn.files);
        } catch {
          return false;
        }
        if (!replaced) return false;
        // Clear the removal mark before the refresh, so the untouched shipped
        // copy is pre-granted again by the existing Built-in first-sight path.
        // No previous approval is restored: removal deleted it, so this is a
        // fresh pre-grant, and retained Library data stays untouched.
        const known = getKnownPlugin(pluginId);
        if (known) saveKnownPlugin({ ...known, removed: false });
        await get().refresh();
        return true;
      },

      async dataSize(pluginId) {
        return getPluginDataSize(pluginId);
      },

      async refreshDataSize(pluginId) {
        const size = await getPluginDataSize(pluginId);
        set((state) => ({ dataSizes: { ...state.dataSizes, [pluginId]: size } }));
        warnDataSizeOnce(pluginId, size);
      },

      notifyChanged(pluginId, hash) {
        const approval = getPluginApproval(pluginId);
        if (!approval) return;
        // One notification per (Plugin, changed hash): the persisted record
        // survives a reload, the in-memory guard closes a same-session race.
        if (approval.notifiedHash === hash || notified.get(pluginId) === hash) return;
        notified.set(pluginId, hash);
        const name = get().plugins[pluginId]?.manifest.name ?? pluginId;
        const record = { ...approval, notifiedHash: hash };
        savePluginApproval(record);
        set((state) => ({
          plugins: state.plugins[pluginId]
            ? {
                ...state.plugins,
                [pluginId]: { ...state.plugins[pluginId], approval: record },
              }
            : state.plugins,
          notifications: [
            ...state.notifications.filter((current) => current.pluginId !== pluginId),
            { pluginId, name, hash, kind: "changed" },
          ],
        }));
        notify({ pluginId, name, hash, kind: "changed" });
      },

      dismissNotification(pluginId) {
        set((state) => ({
          notifications: state.notifications.filter((current) => current.pluginId !== pluginId),
        }));
      },
    };
    // The app's lifecycle may already exist; refresh() subscribes too, for one
    // that installs later.
    ensureSubscribed();
    return store;
  });
}

/** The app's one Plugin management store. */
export const usePluginManagementStore = createPluginManagementStore();

/**
 * The Settings Plugin filters (#443), mirroring the Books filter: multiple
 * selections with counts, matching ANY selected category, none selected shows
 * an empty list. Categories overlap.
 */
export type PluginFilterCategory =
  | "installed"
  | "available"
  | "builtIn"
  | "disabled"
  | "removed"
  | "unsupported";

/** The filters in display order. */
export const PLUGIN_FILTER_CATEGORIES = [
  "installed",
  "available",
  "builtIn",
  "disabled",
  "removed",
  "unsupported",
] as const satisfies readonly PluginFilterCategory[];

/** Every category an entry belongs to; categories overlap. */
export function pluginFilterCategories(
  entry: PluginManagementEntry
): PluginFilterCategory[] {
  const categories: PluginFilterCategory[] = [];
  if (entry.installed) categories.push("installed");
  if (entry.available) categories.push("available");
  if (entry.builtIn) categories.push("builtIn");
  if (entry.installed && entry.approval?.enabled !== true) categories.push("disabled");
  if (entry.removed) categories.push("removed");
  if (entry.unsupported) categories.push("unsupported");
  return categories;
}

/** How many entries fall in each category. */
export function countPluginsByCategory(
  entries: readonly PluginManagementEntry[]
): Record<PluginFilterCategory, number> {
  const counts: Record<PluginFilterCategory, number> = {
    installed: 0,
    available: 0,
    builtIn: 0,
    disabled: 0,
    removed: 0,
    unsupported: 0,
  };
  for (const entry of entries) {
    for (const category of pluginFilterCategories(entry)) counts[category] += 1;
  }
  return counts;
}

/**
 * The entries matching ANY selected category, sorted by name. An empty
 * selection matches nothing, like the Books filter.
 */
export function filterPluginsByCategories(
  entries: readonly PluginManagementEntry[],
  selected: readonly PluginFilterCategory[]
): PluginManagementEntry[] {
  if (selected.length === 0) return [];
  const chosen = new Set(selected);
  return entries
    .filter((entry) => pluginFilterCategories(entry).some((category) => chosen.has(category)))
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}
