// Platform detection and factory exports
import type {
  DatabaseAdapter,
  FileSystemAdapter,
  DialogAdapter,
  OSAdapter,
  WebDialogAdapter,
  BackupAdapter,
} from "@/lib/platform/types";

// Build-time constant - Vite replaces this during build
export const IS_WEB = import.meta.env.VITE_BUILD_TARGET === "web";
export const IS_TAURI = !IS_WEB;
const TAURI_PLATFORM = import.meta.env.TAURI_ENV_PLATFORM;
export const IS_ANDROID = IS_TAURI && TAURI_PLATFORM === "android";
export const IS_MOBILE = IS_TAURI && (TAURI_PLATFORM === "android" || TAURI_PLATFORM === "ios");
export const IS_DESKTOP = IS_TAURI && !IS_MOBILE;

export { isMac } from "@/lib/platform/detect";

function isDesktopRuntime(): boolean {
  return IS_DESKTOP && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

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
} from "@/lib/platform/types";

// Database factory
export async function createDatabase(path: string): Promise<DatabaseAdapter> {
  if (IS_WEB) {
    const { createWebDatabase } = await import("@/lib/platform/web/database");
    return createWebDatabase(path);
  } else {
    const { createTauriDatabase } = await import("@/lib/platform/tauri/database");
    return createTauriDatabase(path);
  }
}

// File system factory
export async function getFileSystem(): Promise<FileSystemAdapter> {
  if (IS_WEB) {
    const { webFileSystem } = await import("@/lib/platform/web/filesystem");
    return webFileSystem;
  } else {
    const { tauriFileSystem } = await import("@/lib/platform/tauri/filesystem");
    return tauriFileSystem;
  }
}

// Dialog factory
export async function getDialog(): Promise<DialogAdapter> {
  if (IS_WEB) {
    const { webDialog } = await import("@/lib/platform/web/dialog");
    return webDialog;
  } else {
    const { tauriDialog } = await import("@/lib/platform/tauri/dialog");
    return tauriDialog;
  }
}

// Web-specific dialog with file data (for web only)
export async function getWebDialog(): Promise<WebDialogAdapter> {
  const { webDialog } = await import("@/lib/platform/web/dialog");
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

// Toggle main window "always on top" on supported desktop builds.
export async function setWindowAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setAlwaysOnTop(enabled);
}

// Swap the tray icon while a sync is running. No-op on web and on
// platforms without a tray (the Rust command handles that).
export async function setTraySyncing(syncing: boolean): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_tray_syncing", { syncing });
}

// Launch the app at login (hidden in the tray). No-op on web.
export async function setLaunchOnStartup(enabled: boolean): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  const { enable, disable } = await import("@tauri-apps/plugin-autostart");
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
}

// Whether the OS autostart entry is currently registered. False on web.
export async function isLaunchOnStartupEnabled(): Promise<boolean> {
  if (!isDesktopRuntime()) {
    return false;
  }
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled();
}

// OS factory
export async function getOS(): Promise<OSAdapter> {
  if (IS_WEB) {
    const { webOS } = await import("@/lib/platform/web/os");
    return webOS;
  } else {
    const { tauriOS } = await import("@/lib/platform/tauri/os");
    return tauriOS;
  }
}

// Backup factory
export async function createBackup(customDir?: string | null): Promise<BackupAdapter> {
  if (IS_WEB) {
    const { createWebBackup } = await import("@/lib/platform/web/backup");
    return createWebBackup();
  }
  // A custom directory restored from settings has no scope grant yet; a typed
  // one gets it here, before the first write.
  if (customDir) await allowBackupDirectory(customDir);
  const { createTauriBackup } = await import("@/lib/platform/tauri/backup");
  return createTauriBackup(customDir ?? undefined);
}

// The directory Backups live in when the author has not chosen one. Null on
// the web build, where Backups live in IndexedDB and there is no folder.
export async function getDefaultBackupDirectory(): Promise<string | null> {
  if (IS_WEB) return null;
  const { resolveTauriBackupDir } = await import("@/lib/platform/tauri/backup");
  return resolveTauriBackupDir();
}

// Grant a typeable Backup directory the filesystem access its Backups need.
// The dialog grants this for a picked folder; a typed path has no grant, and
// Tauri's fs scope denies writes outside it. Persisted across launches by the
// persisted-scope plugin.
export async function allowBackupDirectory(path: string): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("allow_backup_directory", { path });
}
