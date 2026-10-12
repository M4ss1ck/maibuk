/**
 * The Plugin management store (#442): the orchestrator the Settings UI talks
 * to. It lists every Plugin the Plugin Directory holds with its review state,
 * approves or re-reviews a copy, revokes a Plugin Permission, enables or
 * disables a Plugin, and — when a copy's files change — shows one non-blocking
 * notification per (Plugin, changed hash).
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
  approvePluginCopy,
  disablePlugin,
  enablePlugin,
  getPluginApproval,
  revokePermission,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { hashPluginDirectory, pluginFileDigests } from "@/features/plugins/directory-hash";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { reviewPluginCopy } from "@/features/plugins/review";
import { readPluginManifest } from "@/features/plugins/runtime";
import type {
  PluginChangedNotification,
  PluginManagement,
  PluginManagementEntry,
  PluginManagementOptions,
  PluginPermissionId,
} from "@/features/plugins/types";
import { toast } from "@/components/ui/Toast";
import i18n from "@/i18n";
import { getPluginDirectory } from "@/lib/platform";

/** The notification text for a changed copy, localized, naming the Plugin. */
function defaultNotify(notification: PluginChangedNotification): void {
  toast.info(i18n.t("plugins.changedNotice", { name: notification.name }));
}

/** The current folder, manifest, digests, and hash for a Plugin id. */
interface CurrentCopy {
  manifest: PluginManagementEntry["manifest"];
  digests: Map<string, string>;
  hash: string;
}

/**
 * Creates the management store. The app uses the {@link usePluginManagementStore}
 * singleton; tests inject a directory and a lifecycle.
 */
export function createPluginManagementStore(options: PluginManagementOptions = {}) {
  const getLifecycle = options.lifecycle ?? getPluginLifecycle;
  const notify = options.notify ?? defaultNotify;
  /** The last notified hash per Plugin, so a change notifies once even if two paths race. */
  const notified = new Map<string, string>();

  async function readCopy(pluginId: string): Promise<CurrentCopy | null> {
    const directory = options.directory ?? (await getPluginDirectory());
    const folder = await directory.readFolder(pluginId);
    if (!folder) return null;
    const read = readPluginManifest(folder);
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

  function running(pluginId: string): boolean {
    const state = getLifecycle()?.state(pluginId) ?? null;
    return state !== null && state.status !== "stopped";
  }

  return create<PluginManagement>((set, get) => {
    let unsubscribe: (() => void) | null = null;

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

    /** Writes an approval into state, recomputing the review from the copy. */
    function applyApproval(
      pluginId: string,
      copy: CurrentCopy,
      approval: PluginManagementEntry["approval"]
    ): void {
      const review = reviewPluginCopy({
        approval,
        digests: copy.digests,
        hash: copy.hash,
        manifest: copy.manifest,
      });
      set((state) => ({
        plugins: {
          ...state.plugins,
          [pluginId]: {
            pluginId,
            manifest: copy.manifest,
            approval,
            review,
            running: running(pluginId),
          },
        },
      }));
    }

    /** Registers and starts an installed Plugin through the lifecycle, then records liveness. */
    async function start(pluginId: string): Promise<void> {
      const lifecycle = getLifecycle();
      if (!lifecycle) return;
      await lifecycle.install(pluginId, "enable");
      set((state) => {
        const entry = state.plugins[pluginId];
        if (!entry) return {};
        return {
          plugins: { ...state.plugins, [pluginId]: { ...entry, running: running(pluginId) } },
        };
      });
    }

    const store: PluginManagement = {
      plugins: {},
      notifications: [],

      async refresh() {
        ensureSubscribed();
        const directory = options.directory ?? (await getPluginDirectory());
        const names = await directory.listFolders();
        const plugins: Record<string, PluginManagementEntry> = {};
        const changed: { pluginId: string; hash: string }[] = [];
        for (const name of names) {
          const folder = await directory.readFolder(name);
          if (!folder) continue;
          const read = readPluginManifest(folder);
          if (!read.ok) continue;
          const manifest = read.manifest;
          let digests: Map<string, string>;
          let hash: string;
          try {
            digests = await pluginFileDigests(folder.files);
            hash = await hashPluginDirectory(folder.files);
          } catch {
            continue;
          }
          const approval = getPluginApproval(manifest.id);
          const review = reviewPluginCopy({ approval, digests, hash, manifest });
          plugins[manifest.id] = {
            pluginId: manifest.id,
            manifest,
            approval,
            review,
            running: running(manifest.id),
          };
          if (review.status === "review-required") changed.push({ pluginId: manifest.id, hash });
        }
        set({ plugins });
        for (const { pluginId, hash } of changed) get().notifyChanged(pluginId, hash);
      },

      async approve(pluginId, optionalGranted = []) {
        const copy = await readCopy(pluginId);
        if (!copy) return;
        const approval = approvePluginCopy(copy.manifest, copy.hash, copy.digests, optionalGranted);
        savePluginApproval(approval);
        applyApproval(pluginId, copy, approval);
        await start(pluginId);
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

      async markReviewed(pluginId) {
        const copy = await readCopy(pluginId);
        if (!copy) return;
        const approval = getPluginApproval(pluginId);
        if (!approval) return;
        // Keep the author's revoked optional grants; grant every required one.
        const keptOptional = approval.granted.filter((permission) =>
          copy.manifest.permissions.optional.includes(permission)
        );
        const next = approvePluginCopy(copy.manifest, copy.hash, copy.digests, keptOptional);
        savePluginApproval(next);
        applyApproval(pluginId, copy, next);
        await start(pluginId);
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
            { pluginId, name, hash },
          ],
        }));
        notify({ pluginId, name, hash });
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
