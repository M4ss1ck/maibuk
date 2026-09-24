import { useSettingsStore } from "@/features/settings/store";
import { useSyncStore } from "@/features/sync/store";
import { getPassphrase } from "@/features/sync/crypto";
import { onChange } from "@/features/sync/change-feed";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";
import type { ConflictResolver } from "@/features/sync/types";

/** Quiet period after the last local change before an automatic sync runs. */
export const AUTO_SYNC_IDLE_DELAY_MS = 30_000;

export type AutoSyncTrigger = "launch" | "idle";
export type AutoSyncResult = "synced" | "disabled" | "ineligible" | "busy" | "tutorial";

// Automatic syncs never prompt. A true conflict (both sides changed) is left
// for a manual sync; everything else keeps syncing.
const deferConflicts: ConflictResolver = async () => "skip";

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let uninstall: (() => void) | null = null;
let launchSettled = false;
const launchSettledListeners = new Set<() => void>();

function markLaunchSettled(): void {
  if (launchSettled) return;
  launchSettled = true;
  for (const listener of [...launchSettledListeners]) listener();
}

/**
 * Whether this launch's Auto Sync is behind us: it ran (whatever it
 * decided), or it never will because automatic sync is off or no Sync
 * Account is signed in. A device about to Pull the author's Books is not
 * treated as a new author before then.
 */
export function hasLaunchAutoSyncSettled(): boolean {
  if (launchSettled || !useSettingsStore.getState().autoSync) return true;
  return useSyncStore.getState().authStatus !== "logged-in";
}

export function onLaunchAutoSyncSettled(listener: () => void): () => void {
  launchSettledListeners.add(listener);
  return () => {
    launchSettledListeners.delete(listener);
  };
}

export function scheduleAutoSync(delayMs = AUTO_SYNC_IDLE_DELAY_MS): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void runAutoSync("idle");
  }, delayMs);
}

/**
 * Sync now if automatic sync is enabled and possible: logged in, a passphrase
 * available, online, and the Tutorial Library not active. While another sync runs, retries after the idle delay
 * instead of queueing behind it.
 */
export async function runAutoSync(trigger: AutoSyncTrigger): Promise<AutoSyncResult> {
  try {
    return await runAutoSyncOnce();
  } finally {
    if (trigger === "launch") markLaunchSettled();
  }
}

async function runAutoSyncOnce(): Promise<AutoSyncResult> {
  // The Tutorial Library never syncs; its sample Changes schedule nothing.
  if (isTutorialLibraryActive()) return "tutorial";
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
    // The sync run lands pending editor saves itself and stops if one fails.
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

  // Every local Change — content or metadata — schedules a sync; the kind
  // only decides whether Last Edited moves.
  const stopChanges = onChange((change) => {
    if (change.origin !== "local" || isTutorialLibraryActive()) return;
    scheduleAutoSync();
  });
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
  launchSettled = false;
  launchSettledListeners.clear();
}
