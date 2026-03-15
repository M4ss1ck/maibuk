import { createBackup as createBackupAdapter } from "../../lib/platform";
import { useSettingsStore } from "../settings/store";
import { BackupService } from "./backup-service";

async function getRetention(): Promise<number> {
  return useSettingsStore.getState().backupRetention;
}

async function createConfiguredBackupService(): Promise<BackupService> {
  const adapter = await createBackupAdapter(useSettingsStore.getState().backupDirectory);
  return new BackupService(adapter);
}

export async function createLaunchBackup(): Promise<void> {
  try {
    const service = await createConfiguredBackupService();
    await service.createBackup("launch");
    const retention = await getRetention();
    await service.pruneBackups(retention);
  } catch (error) {
    console.warn("Failed to create launch backup:", error);
  }
}

export async function createCloseBackup(): Promise<void> {
  try {
    const service = await createConfiguredBackupService();
    await service.createBackup("close");
    const retention = await getRetention();
    await service.pruneBackups(retention);
  } catch (error) {
    console.warn("Failed to create close backup:", error);
  }
}
