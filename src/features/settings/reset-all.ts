/**
 * Reset settings (#442, plan decision 7): one app-wide action that returns the
 * app to its shipped defaults. It clears the settings store (Development mode
 * included), every Custom Shortcut and custom Voice Command, the toolbar
 * config, every Plugin approval and grant, the known-Plugin list, and saved
 * Plugin credentials.
 *
 * It stops every running Plugin first — with no approval left, a third-party
 * Plugin needs approval again and a modified Built-in copy needs review — then
 * refreshes the Plugin management store so an untouched Built-in is re-seeded
 * from its shipped defaults, and starts an untouched Built-in that was running
 * again. Plugin files and Library data are never touched: nothing here writes
 * to the Plugin Directory or the Library.
 *
 * The dependencies are injectable so the flow is testable without the app's
 * singletons; production always uses the defaults.
 */

import { clearPluginApprovals } from "@/features/plugins/approvals";
import { clearKnownPlugins } from "@/features/plugins/known";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { usePluginManagementStore } from "@/features/plugins/management";
import { useSettingsStore } from "@/features/settings/store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";

export interface ResetAllSettingsOptions {
  /** Returns the settings store to its shipped defaults. */
  settings?: () => void;
  /** Clears Custom Shortcuts and custom Voice Commands. */
  shortcuts?: () => void;
  /** Clears every Plugin approval and grant. */
  approvals?: () => void;
  /** Clears the known-Plugin list, so no retained row survives the reset. */
  known?: () => void;
  /** Deletes saved Plugin credentials. */
  clearCredentials?: () => Promise<void>;
  /** Stops every running Plugin. */
  stopPlugins?: () => void;
  /** Re-reads the Plugin Directory and re-seeds untouched Built-ins. */
  refreshPlugins?: () => Promise<void>;
  /** Starts an untouched Built-in again by the normal warm-start rules. */
  restartBuiltIns?: (runningIds: readonly string[]) => Promise<void>;
}

/**
 * Deletes every saved Plugin credential. Nothing implements it yet: no Plugin
 * credential store exists (ADR 0023 keeps secrets in the OS keychain, and the
 * `secrets.*` API rows have no handler), so this is a documented no-op. Wire
 * the keychain delete here when that store lands.
 */
async function clearPluginCredentials(): Promise<void> {
  // No Plugin credential store exists yet.
}

/** Stops every Plugin the lifecycle holds: none is approved after the reset. */
function stopRunningPlugins(): void {
  const lifecycle = getPluginLifecycle();
  if (lifecycle === null) return;
  for (const installed of lifecycle.installed()) lifecycle.uninstall(installed.pluginId);
}

/** The Plugin ids the lifecycle is running now, before the reset stops them. */
function runningPluginIds(): string[] {
  const lifecycle = getPluginLifecycle();
  if (lifecycle === null) return [];
  return lifecycle
    .installed()
    .filter((plugin) => (lifecycle.state(plugin.pluginId)?.status ?? "stopped") !== "stopped")
    .map((plugin) => plugin.pluginId);
}

/**
 * Starts an untouched Built-in that was running again, so Reset settings leaves
 * it working now instead of waiting for the next launch. A third-party copy, or
 * a modified Built-in, needs review and is not restarted; `install` applies the
 * normal warm-start rules.
 */
async function restartRunningBuiltIns(ids: readonly string[]): Promise<void> {
  const lifecycle = getPluginLifecycle();
  if (lifecycle === null) return;
  const entries = usePluginManagementStore.getState().plugins;
  for (const id of ids) {
    const entry = entries[id];
    if (!entry?.builtIn || entry.modified || entry.review.status !== "approved") continue;
    await lifecycle.install(id, "update");
  }
}

export async function resetAllSettings(options: ResetAllSettingsOptions = {}): Promise<void> {
  const stopPlugins = options.stopPlugins ?? stopRunningPlugins;
  const resetSettingsStore =
    options.settings ?? (() => useSettingsStore.getState().resetSettings());
  const resetShortcuts =
    options.shortcuts ?? (() => useShortcutSettingsStore.getState().resetAllShortcuts());
  const clearApprovals = options.approvals ?? clearPluginApprovals;
  const clearKnown = options.known ?? clearKnownPlugins;
  const clearCredentials = options.clearCredentials ?? clearPluginCredentials;
  const refreshPlugins =
    options.refreshPlugins ?? (() => usePluginManagementStore.getState().refresh());
  const restartBuiltIns = options.restartBuiltIns ?? restartRunningBuiltIns;

  // Remember what is running before the reset stops it, so an untouched Built-in
  // can be started again afterwards.
  const running = runningPluginIds();
  // Stop first: a running frame must not outlive the approval it was given.
  stopPlugins();
  resetSettingsStore();
  resetShortcuts();
  clearApprovals();
  clearKnown();
  await clearCredentials();
  // Re-seed the store: untouched Built-ins get fresh approvals, modified copies
  // stay review-required, and every third-party copy is not-approved again.
  await refreshPlugins();
  // An untouched Built-in that was running keeps working; a changed or
  // third-party copy waits for review.
  await restartBuiltIns(running);
}
