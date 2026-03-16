import { createBackup as createBackupAdapter } from "../../lib/platform";
import { waitForDatabaseReady } from "../../lib/db";
import { useSettingsStore } from "../settings/store";
import { BackupService } from "./backup-service";

let dailyBackupStarted = false;
let closeBackupRegistered = false;

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

export async function createCloseBackup(): Promise<void> {
  try {
    const service = await createConfiguredBackupService();
    await service.createBackup("close");
    const retention = getRetention();
    await service.pruneBackups(retention);
  } catch (error) {
    console.warn("Failed to create close backup:", error);
  }
}

export async function runDailyBackupOnce(): Promise<void> {
  if (dailyBackupStarted) {
    return;
  }

  dailyBackupStarted = true;
  await waitForDatabaseReady();
  await createDailyBackup();
}

export async function registerCloseBackupHandlerOnce(): Promise<void> {
  if (closeBackupRegistered) {
    return;
  }

  closeBackupRegistered = true;

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();

  await currentWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    await createCloseBackup();
    currentWindow.destroy();
  });
}

export function resetBackupLifecycleForTests(): void {
  dailyBackupStarted = false;
  closeBackupRegistered = false;
}
