import { createBackup as createBackupAdapter } from "../../lib/platform";
import { BackupService } from "./backup-service";

const DEFAULT_RETENTION = 20;

async function getRetention(): Promise<number> {
  // TODO: Read from settings store once retention is persisted.
  // For now, use the default. The BackupSection component manages
  // the retention value in local state — persisting it to the settings
  // table is a follow-up enhancement.
  return DEFAULT_RETENTION;
}

export async function createLaunchBackup(): Promise<void> {
  try {
    const adapter = await createBackupAdapter();
    const service = new BackupService(adapter);
    await service.createBackup("launch");
    const retention = await getRetention();
    await service.pruneBackups(retention);
  } catch (error) {
    console.warn("Failed to create launch backup:", error);
  }
}

export async function createCloseBackup(): Promise<void> {
  try {
    const adapter = await createBackupAdapter();
    const service = new BackupService(adapter);
    await service.createBackup("close");
    const retention = await getRetention();
    await service.pruneBackups(retention);
  } catch (error) {
    console.warn("Failed to create close backup:", error);
  }
}
