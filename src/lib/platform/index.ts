// Platform detection and factory exports
import type {
  DatabaseAdapter,
  FileSystemAdapter,
  DialogAdapter,
  OSAdapter,
  WebDialogAdapter,
  BackupAdapter,
} from "./types";

// Build-time constant - Vite replaces this during build
export const IS_WEB = import.meta.env.VITE_BUILD_TARGET === "web";
export const IS_TAURI = !IS_WEB;

// Re-export types
export type {
  DatabaseAdapter,
  FileSystemAdapter,
  DialogAdapter,
  OSAdapter,
  WebDialogAdapter,
  SaveDialogOptions,
  OpenDialogOptions,
  FileWithData,
  BackupAdapter,
  BackupEntry,
} from "./types";

// Database factory
export async function createDatabase(path: string): Promise<DatabaseAdapter> {
  if (IS_WEB) {
    const { createWebDatabase } = await import("./web/database");
    return createWebDatabase(path);
  } else {
    const { createTauriDatabase } = await import("./tauri/database");
    return createTauriDatabase(path);
  }
}

// File system factory
export async function getFileSystem(): Promise<FileSystemAdapter> {
  if (IS_WEB) {
    const { webFileSystem } = await import("./web/filesystem");
    return webFileSystem;
  } else {
    const { tauriFileSystem } = await import("./tauri/filesystem");
    return tauriFileSystem;
  }
}

// Dialog factory
export async function getDialog(): Promise<DialogAdapter> {
  if (IS_WEB) {
    const { webDialog } = await import("./web/dialog");
    return webDialog;
  } else {
    const { tauriDialog } = await import("./tauri/dialog");
    return tauriDialog;
  }
}

// Web-specific dialog with file data (for web only)
export async function getWebDialog(): Promise<WebDialogAdapter> {
  const { webDialog } = await import("./web/dialog");
  return webDialog;
}

// Open external URL in the default browser
export async function openExternal(url: string): Promise<void> {
  if (IS_WEB) {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  }
}

// OS factory
export async function getOS(): Promise<OSAdapter> {
  if (IS_WEB) {
    const { webOS } = await import("./web/os");
    return webOS;
  } else {
    const { tauriOS } = await import("./tauri/os");
    return tauriOS;
  }
}

// Backup factory
export async function createBackup(customDir?: string | null): Promise<BackupAdapter> {
  if (IS_WEB) {
    const { createWebBackup } = await import("./web/backup");
    return createWebBackup();
  }
  const { createTauriBackup } = await import("./tauri/backup");
  return createTauriBackup(customDir ?? undefined);
}
