import { useSettingsStore } from "@/features/settings/store";
import { useSyncStore } from "@/features/sync/store";
import { getPassphrase } from "@/features/sync/crypto";
import { onLocalChange } from "@/features/sync/local-changes";
import { flushPendingEdits } from "@/features/sync/pending-edits";
import type { ConflictResolver } from "@/features/sync/types";

/** Quiet period after the last local change before an automatic sync runs. */
export const AUTO_SYNC_IDLE_DELAY_MS = 30_000;

export type AutoSyncTrigger = "launch" | "idle";
export type AutoSyncResult = "synced" | "disabled" | "ineligible" | "busy";

// Automatic syncs never prompt. A true conflict (both sides changed) is left
// for a manual sync; everything else keeps syncing.
const deferConflicts: ConflictResolver = async () => "skip";

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let uninstall: (() => void) | null = null;

export function scheduleAutoSync(delayMs = AUTO_SYNC_IDLE_DELAY_MS): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void runAutoSync("idle");
  }, delayMs);
}

/**
 * Sync now if automatic sync is enabled and possible: logged in, a passphrase
 * available, online. While another sync runs, retries after the idle delay
 * instead of queueing behind it.
 */
export async function runAutoSync(_trigger: AutoSyncTrigger): Promise<AutoSyncResult> {
  if (!useSettingsStore.getState().autoSync) return "disabled";

  const { authStatus, passphrase: storedPassphrase, syncStatus } = useSyncStore.getState();
  const passphrase = getPassphrase() ?? storedPassphrase;
  if (authStatus !== "logged-in" || !passphrase || !navigator.onLine) return "ineligible";

  if (running || syncStatus === "syncing" || syncStatus === "awaiting-confirmation") {
    scheduleAutoSync();
    return "busy";
  }

  running = true;
  try {
    await flushPendingEdits();
    await useSyncStore.getState().syncAll(passphrase, deferConflicts, { trigger: "auto" });
  } catch {
    // syncAll records the failure in the store (syncStatus/syncError).
  } finally {
    running = false;
  }
  return "synced";
}

/**
 * Wire automatic sync: an idle-delayed sync after local changes, and a launch
 * sync once the session is verified (at startup, after an offline start comes
 * back online, or after logging in). Idempotent; returns an uninstaller.
 */
export function installAutoSync(): () => void {
  if (uninstall) return uninstall;

  const stopChanges = onLocalChange(() => scheduleAutoSync());
  const stopAuth = useSyncStore.subscribe((state, previous) => {
    if (state.authVerified && !previous.authVerified) void runAutoSync("launch");
  });
  if (useSyncStore.getState().authVerified) void runAutoSync("launch");

  uninstall = () => {
    stopChanges();
    stopAuth();
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    uninstall = null;
  };
  return uninstall;
}

export function resetAutoSyncForTests(): void {
  uninstall?.();
  running = false;
}
