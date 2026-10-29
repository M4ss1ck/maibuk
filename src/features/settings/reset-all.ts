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
 * from its shipped defaults: pre-granted but off, so a Built-in that was running
 * stays stopped until the author turns it on again. Plugin files and Library data are never touched: nothing here writes
 * to the Plugin Directory or the Library.
 *
 * The dependencies are injectable so the flow is testable without the app's
 * singletons; production always uses the defaults.
 */

import { clearPluginApprovals } from "@/features/plugins/approvals";
import { getPluginFileGrantStore } from "@/features/plugins/file-grants";
import { clearKnownPlugins } from "@/features/plugins/known";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { usePluginManagementStore } from "@/features/plugins/management";
import { getPluginSecretStore } from "@/features/plugins/secret-store";
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
  /** Ends every File Grant on this device. */
  clearFileGrants?: () => Promise<void>;
  /** Stops every running Plugin. */
  stopPlugins?: () => void;
  /** Re-reads the Plugin Directory and re-seeds untouched Built-ins. */
  refreshPlugins?: () => Promise<void>;
}

/**
 * Deletes every saved Plugin credential through the registered secret store.
 * The keychain-backed store lands in #453 and registers itself; until then no
 * store is registered, so there is nothing to delete. A keychain failure rejects
 * so Reset settings reports it, but every other reset step still runs.
 */
async function clearPluginCredentials(): Promise<void> {
  await getPluginSecretStore()?.clearAll();
}

/**
 * Ends every File Grant through the registered store. Like credentials, a
 * store failure rejects so Reset settings reports it, but every other reset
 * step still runs.
 */
async function clearPluginFileGrants(): Promise<void> {
  await getPluginFileGrantStore()?.clearAll();
}

/** Stops every Plugin the lifecycle holds: none is approved after the reset. */
function stopRunningPlugins(): void {
  const lifecycle = getPluginLifecycle();
  if (lifecycle === null) return;
  for (const installed of lifecycle.installed()) lifecycle.uninstall(installed.pluginId);
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
  const clearGrants = options.clearFileGrants ?? clearPluginFileGrants;
  const refreshPlugins =
    options.refreshPlugins ?? (() => usePluginManagementStore.getState().refresh());

  // Stop first: a running frame must not outlive the approval it was given.
  stopPlugins();
  resetSettingsStore();
  resetShortcuts();
  clearApprovals();
  clearKnown();
  // Deleting credentials or ending File Grants can fail (a locked keychain, a
  // platform error). Every other step still runs so the reset is not left
  // half-applied; the first failure is reported once the rest is done, so the
  // UI can tell the author.
  let credentialsError: unknown;
  let credentialsFailed = false;
  try {
    await clearCredentials();
  } catch (error) {
    credentialsFailed = true;
    credentialsError = error;
  }
  try {
    await clearGrants();
  } catch (error) {
    if (!credentialsFailed) {
      credentialsFailed = true;
      credentialsError = error;
    }
  }
  // Re-seed the store: untouched Built-ins get fresh approvals (pre-granted, off),
  // modified copies stay review-required, and every third-party copy is
  // not-approved again.
  await refreshPlugins();
  if (credentialsFailed) throw credentialsError;
}
