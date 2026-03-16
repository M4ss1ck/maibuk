import { createBackup as createBackupAdapter } from "../../lib/platform";
import { waitForDatabaseReady } from "../../lib/db";
import { useSettingsStore } from "../settings/store";
import { BackupService } from "./backup-service";

let dailyBackupStarted = false;

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

export async function runDailyBackupOnce(): Promise<void> {
  if (dailyBackupStarted) {
    return;
  }

  dailyBackupStarted = true;
  await waitForDatabaseReady();
  await createDailyBackup();
}

export function resetBackupLifecycleForTests(): void {
  dailyBackupStarted = false;
}
