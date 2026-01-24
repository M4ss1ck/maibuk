// Platform detection and factory exports
import type {
  DatabaseAdapter,
  FileSystemAdapter,
  DialogAdapter,
  OSAdapter,
  WebDialogAdapter,
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
} from "./types";

// Database factory
export async function createDatabase(
  path: string
): Promise<DatabaseAdapter> {
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
