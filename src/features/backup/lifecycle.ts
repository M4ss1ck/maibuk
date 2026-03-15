import { createBackup as createBackupAdapter } from "../../lib/platform";
import { useSettingsStore } from "../settings/store";
import { BackupService } from "./backup-service";

let launchBackupStarted = false;
let closeBackupRegistered = false;

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

export async function runLaunchBackupOnce(): Promise<void> {
  if (launchBackupStarted) {
    return;
  }

  launchBackupStarted = true;
  await createLaunchBackup();
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
  launchBackupStarted = false;
  closeBackupRegistered = false;
}
