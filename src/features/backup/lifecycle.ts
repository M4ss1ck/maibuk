import { createBackup as createBackupAdapter, IS_ANDROID } from "@/lib/platform";
import { waitForDatabaseReady } from "@/lib/db";
import { useSettingsStore } from "@/features/settings/store";
import { BackupService } from "@/features/backup/backup-service";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";

let dailyBackupStarted = false;
let launchBackupSettled = false;
const launchBackupSettledListeners = new Set<() => void>();
let pendingDailyBackupTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDailyBackupIdleHandle: number | null = null;

const CLOSE_BACKUP_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Whether this launch's daily Backup is behind us (it ran, whatever it
 * decided). Plugin starts wait on it (#436): they never run ahead of the
 * launch Backup.
 */
export function hasLaunchBackupSettled(): boolean {
  return launchBackupSettled;
}

export function onLaunchBackupSettled(listener: () => void): () => void {
  launchBackupSettledListeners.add(listener);
  return () => {
    launchBackupSettledListeners.delete(listener);
  };
}

function markLaunchBackupSettled(): void {
  if (launchBackupSettled) return;
  launchBackupSettled = true;
  for (const listener of [...launchBackupSettledListeners]) listener();
}

function getRetention(): number {
  return useSettingsStore.getState().backupRetention;
}

async function createConfiguredBackupService(): Promise<BackupService> {
  const adapter = await createBackupAdapter(useSettingsStore.getState().backupDirectory);
  return new BackupService(adapter);
}

/**
 * Create at most one "daily" backup per calendar day (UTC).
 * If today's daily backup already exists, this is a no-op.
 */
export async function createDailyBackup(): Promise<void> {
  // A Backup holds the author's Library only (ADR 0008).
  if (isTutorialLibraryActive()) return;
  try {
    const service = await createConfiguredBackupService();
    if (await service.hasBackupForToday("daily")) {
      return;
    }
    await service.createBackup("daily");
    const retention = getRetention();
    await service.pruneBackups(retention);
  } catch (error) {
    console.warn("Failed to create daily backup:", error);
  }
}

// Best-effort backup when the mobile app is sent to the background. Uses the
// same backup service as daily/pre-sync; failures are swallowed like daily.
// Skips the dump when a "close" backup already exists within the last 6 hours.
export async function runBackgroundBackup(): Promise<void> {
  // Nothing the author can change happens during the Tutorial, so skipping
  // loses no work; the next background or daily Backup covers the Library.
  if (isTutorialLibraryActive()) return;
  try {
    const service = await createConfiguredBackupService();
    if (await service.hasRecentBackup("close", CLOSE_BACKUP_MIN_INTERVAL_MS)) {
      return;
    }
    await service.createBackup("close");
    await service.pruneBackups(getRetention());
  } catch (error) {
    console.warn("Failed to create background backup:", error);
  }
}

export async function runDailyBackupOnce(): Promise<void> {
  if (dailyBackupStarted) {
    return;
  }

  dailyBackupStarted = true;
  try {
    await waitForDatabaseReady();
    await createDailyBackup();
  } finally {
    markLaunchBackupSettled();
  }
}

export function resetBackupLifecycleForTests(): void {
  dailyBackupStarted = false;
  launchBackupSettled = false;
  launchBackupSettledListeners.clear();
  try {
    if (pendingDailyBackupTimer !== null) {
      clearTimeout(pendingDailyBackupTimer);
      pendingDailyBackupTimer = null;
    }
    if (pendingDailyBackupIdleHandle !== null) {
      if (typeof cancelIdleCallback === "function") {
        cancelIdleCallback(pendingDailyBackupIdleHandle);
      }
      pendingDailyBackupIdleHandle = null;
    }
  } catch {
    pendingDailyBackupTimer = null;
    pendingDailyBackupIdleHandle = null;
  }
}

/**
 * Schedule the daily backup without blocking app startup on Android.
 * On other platforms it starts immediately, exactly as before.
 */
export function scheduleDailyBackup(): void {
  try {
    if (!IS_ANDROID) {
      void runDailyBackupOnce();
      return;
    }
    const run = (): void => {
      pendingDailyBackupTimer = null;
      pendingDailyBackupIdleHandle = null;
      void runDailyBackupOnce();
    };
    if (typeof requestIdleCallback === "function") {
      pendingDailyBackupIdleHandle = requestIdleCallback(run, { timeout: 30000 });
    } else {
      pendingDailyBackupTimer = setTimeout(run, 10000);
    }
  } catch {
    // Never throw into the startup path.
  }
}
