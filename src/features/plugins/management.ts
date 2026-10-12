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
  revokePermission,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { createBuiltInPluginSource } from "@/features/plugins/builtin";
import { hashPluginDirectory, pluginFileDigests } from "@/features/plugins/directory-hash";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { planPluginModules } from "@/features/plugins/modules";
import { reviewPluginCopy } from "@/features/plugins/review";
import type {
  BuiltInPlugin,
  PluginActivationResult,
  PluginApproval,
  PluginManagement,
  PluginManagementEntry,
  PluginManagementOptions,
  PluginNotification,
  PluginPermissionId,
} from "@/features/plugins/types";
import { useSettingsStore } from "@/features/settings/store";
import { getPluginDirectory } from "@/lib/platform";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";

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

/** The current folder, manifest, digests, and hash for a Plugin id. */
interface CurrentCopy {
  manifest: PluginManagementEntry["manifest"];
  digests: Map<string, string>;
  hash: string;
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
      return { manifest: read.manifest, digests, hash };
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
   * One entry for a copy: its review, plus the Built-in state. A Built-in is
   * "modified" when its installed hash differs from the shipped one, and an
   * update is available when a modified copy's shipped hash has moved past the
   * one its record pins.
   */
  function buildEntry(
    pluginId: string,
    copy: CurrentCopy,
    approval: PluginApproval | null,
    builtIn: BuiltInPlugin | undefined
  ): PluginManagementEntry {
    const review = reviewPluginCopy({
      approval,
      digests: copy.digests,
      hash: copy.hash,
      manifest: copy.manifest,
    });
    const modified = builtIn !== undefined && copy.hash !== builtIn.hash;
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
      running: running(pluginId),
      builtIn: builtIn !== undefined,
      modified,
      updateAvailable,
    };
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
     * Subscribes once to the lifecycle: a start the review gate refused is a
     * changed copy, reported here so it notifies even before Settings opens.
     */
    function ensureSubscribed(): void {
      if (unsubscribe) return;
      const lifecycle = getLifecycle();
      if (!lifecycle) return;
      unsubscribe = lifecycle.subscribe((change) => {
        if (change.state.status === "stopped" && change.state.refusal?.code === "review-required") {
          void reportChanged(change.pluginId);
        }
      });
    }

    /** Writes an entry into state from the copy, record, and Built-in info. */
    function applyApproval(
      pluginId: string,
      copy: CurrentCopy,
      approval: PluginApproval,
      builtIn: BuiltInPlugin | undefined
    ): void {
      const entry = buildEntry(pluginId, copy, approval, builtIn);
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
      // A new required Plugin Permission the author never granted blocks the
      // reload: review-required, and the previous build keeps running.
      const missing = read.manifest.permissions.required.filter(
        (permission) => !approval.granted.includes(permission as PluginPermissionId)
      );
      if (missing.length > 0) {
        const entry = buildEntry(
          pluginId,
          { manifest: read.manifest, digests, hash: secondHash },
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
      const refreshed = buildEntry(
        pluginId,
        { manifest: read.manifest, digests, hash: secondHash },
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

      async refresh() {
        ensureSubscribed();
        const directory = options.directory ?? (await getPluginDirectory());
        syncWatcher(directory);
        const names = await directory.listFolders();
        const builtIns = await listBuiltIns();
        const { readPluginManifest } = await loadRuntime();
        const plugins: Record<string, PluginManagementEntry> = {};
        const changed: { pluginId: string; hash: string }[] = [];
        const available: { pluginId: string; name: string; hash: string }[] = [];
        for (const name of names) {
          const folder = await directory.readFolder(name);
          if (!folder) continue;
          // The source id is the folder name; a declared Built-in validates
          // under the Built-in schema, so a reserved `maibuk-` id is allowed.
          const shipped = builtIns.get(name);
          const read = readPluginManifest(folder, { builtIn: shipped !== undefined });
          if (!read.ok) continue;
          const manifest = read.manifest;
          const builtIn = builtIns.get(manifest.id) ?? shipped;
          let digests: Map<string, string>;
          let hash: string;
          try {
            digests = await pluginFileDigests(folder.files);
            hash = await hashPluginDirectory(folder.files);
          } catch {
            continue;
          }
          let approval = getPluginApproval(manifest.id);
          // First sight of a Built-in: an untouched copy is pre-granted and
          // enabled, while a modified copy is recorded against the shipped one
          // so it reads "review-required" (with its file and permission diff)
          // instead of "never approved". Nothing is granted until review.
          if (builtIn && approval === null) {
            approval =
              hash === builtIn.hash
                ? approveBuiltInCopy(manifest, hash, digests, builtIn.hash)
                : await modifiedBuiltInCopy(manifest, builtIn);
            savePluginApproval(approval);
          }
          const entry = buildEntry(manifest.id, { manifest, digests, hash }, approval, builtIn);
          plugins[manifest.id] = entry;
          if (builtIn) {
            // A modified Built-in shows its own state; only an update notifies.
            if (entry.updateAvailable) {
              available.push({ pluginId: manifest.id, name: manifest.name, hash: builtIn.hash });
            }
          } else if (entry.review.status === "review-required") {
            changed.push({ pluginId: manifest.id, hash });
          }
        }
        set({ plugins });
        if (isDevelopmentMode()) {
          // Development mode at launch: a copy that changed while the app was
          // closed goes through the dev reload policy — a completed build is
          // re-pinned and started, a partial one is left alone — instead of a
          // change notification (#442, plan decision 6).
          for (const entry of Object.values(plugins)) {
            if (entry.review.status === "review-required") {
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
        applyApproval(pluginId, copy, approval, builtIn);
        await start(pluginId);
        return { ok: true };
      },

      async revoke(pluginId, permission: PluginPermissionId) {
        const entry = get().plugins[pluginId];
        if (!entry?.approval) return;
        const next = revokePermission(entry.approval, permission, entry.manifest);
        if (next === entry.approval) return;
        savePluginApproval(next);
        if (!next.enabled) {
          // A required grant is gone: the Plugin is disabled and unregistered.
          getLifecycle()?.uninstall(pluginId);
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
        const result = enablePlugin(entry.approval, entry.manifest);
        if (!result.ok) return;
        savePluginApproval(result.approval);
        set((state) => ({
          plugins: {
            ...state.plugins,
            [pluginId]: { ...state.plugins[pluginId], approval: result.approval },
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
            [pluginId]: { ...state.plugins[pluginId], approval: next, running: false },
          },
        }));
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
        applyApproval(pluginId, copy, next, builtIn);
        await start(pluginId);
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
        const next: PluginApproval = {
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
        savePluginApproval(next);
        applyApproval(pluginId, copy, next, builtIn);
        return true;
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
