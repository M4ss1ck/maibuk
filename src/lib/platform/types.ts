// Platform adapter interfaces for cross-platform compatibility

import type { PluginFolder, PluginFolderFile } from "@/features/plugins/types";

export interface DatabaseAdapter {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T = unknown[]>(sql: string, params?: unknown[]): Promise<T>;
  close(): Promise<void>;
  exportData(): Promise<Uint8Array>;
  /** Runs every statement in one transaction, or none: rejects with AtomicStatementError and leaves the Library unchanged. */
  executeAtomic(statements: string[]): Promise<void>;
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface OpenDialogOptions {
  multiple?: boolean;
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
}

export interface FileSystemAdapter {
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  downloadFile(filename: string, data: Uint8Array, mimeType: string): void;
}

export interface DialogAdapter {
  save(options: SaveDialogOptions): Promise<string | null>;
  open(options: OpenDialogOptions): Promise<string | null>;
  /** Every path the author picked; [] when cancelled. */
  openMany(options: OpenDialogOptions): Promise<string[]>;
}

// Web-specific: open file and get data in one operation
export interface FileWithData {
  name: string;
  data: Uint8Array;
}

export interface WebDialogAdapter extends DialogAdapter {
  openWithData(options: OpenDialogOptions): Promise<FileWithData | null>;
  /** Every file the author picked, as browser Files; [] when cancelled. */
  openFiles(options: OpenDialogOptions): Promise<File[]>;
}

export interface OSAdapter {
  locale(): Promise<string | null>;
}

export interface BackupEntry {
  filename: string;
  trigger: "daily" | "pre-sync" | "pre-restore" | "manual" | "close" | "unknown";
  createdAt: Date;
  /** Stored as metadata alongside the backup content, not computed on read. */
  sizeBytes: number;
  /** SHA-256 hash of the SQL content, computed at save time. */
  checksum: string;
}

export interface BackupPageOptions {
  page: number;
  pageSize: number;
}

export interface BackupPage {
  entries: BackupEntry[];
  totalCount: number;
  totalSizeBytes: number;
  page: number;
  pageSize: number;
}

export interface BackupAdapter {
  saveBackup(filename: string, sql: Uint8Array): Promise<void>;
  listBackups(): Promise<BackupEntry[]>;
  listBackupsPage(options: BackupPageOptions): Promise<BackupPage>;
  readBackup(filename: string): Promise<string>;
  deleteBackup(filename: string): Promise<void>;
}

export interface PluginDirectoryAdapter {
  /**
   * Which platform this adapter serves. The Tauri adapter reports `desktop` or
   * `android` from the build's platform; the web adapter reports `web`. The
   * Settings Plugins section reads it to offer "Open Plugin Directory", a
   * directory change, and a folder picker only where they exist.
   */
  readonly kind: "desktop" | "android" | "web";
  /** Folder names in the Plugin Directory; [] when there is none. */
  listFolders(): Promise<string[]>;
  /** A folder's files with the bytes they were hashed from; null when the folder is gone. */
  readFolder(name: string): Promise<PluginFolder | null>;
  /**
   * Replaces one folder's files, in the place `readFolder` reads (a Built-in
   * update, #442). `true` when the folder now holds the shipped copy. The web
   * adapter writes `files` into OPFS; the Tauri adapter ignores `files` and has
   * Rust resolve the shipped copy from the app's bundled resources, so no bytes
   * cross IPC and the webview cannot choose what a Built-in runs (ADR 0020).
   * Absent on an adapter that cannot write; a Built-in replace then refuses.
   */
  replaceFolder?(name: string, files: readonly PluginFolderFile[]): Promise<boolean>;
  /**
   * Watches the Plugin Directory for changes to a Plugin's files (development
   * mode, #442): calls `onChanged` with the folder id once a write settles.
   * Returns an unsubscribe that stops watching. Absent on an adapter that
   * cannot watch; development mode then reloads only on an explicit refresh.
   */
  watch?(onChanged: (id: string) => void): () => void;
  /**
   * Installs the Plugin a `.zip` carries. The author picks the file; this
   * resolves the installed folder name (the Plugin id), or `null` when the
   * picker is cancelled. It refuses any archive that is not one Plugin: no
   * manifest, several manifests, an invalid id, a path that leaves the folder,
   * an entry that is not regular, or files over the archive caps. The Tauri
   * adapter has Rust install it, so no archive byte crosses IPC (ADR 0020);
   * the web adapter unzips it into OPFS. Absent on an adapter that cannot
   * install.
   */
  addFromZip?(): Promise<string | null>;
  /**
   * Installs a Plugin from a folder the author picks. Desktop only: Android
   * installs from a `.zip` and the web folds this into `supportsFolderPicker`.
   * Resolves the installed folder name, or `null` when the picker is
   * cancelled.
   */
  addFromFolder?(): Promise<string | null>;
  /**
   * Deletes a Plugin folder and every file in it. `true` when it was there and
   * is now gone, `false` when it was already absent. A name that is not a
   * single safe folder name is refused. Absent on an adapter that cannot
   * write.
   */
  removeFolder?(name: string): Promise<boolean>;
  /** Opens the Plugin Directory in the system file manager. Desktop only. */
  openDirectory?(): Promise<void>;
  /**
   * Runs the native folder picker and switches the Plugin Directory when the
   * author picks one (ADR 0010: the picker is the only way a folder enters
   * reach, and Rust records the approval itself). `true` when the directory
   * changed, `false` when the picker was cancelled. Desktop only.
   */
  changeDirectory?(): Promise<boolean>;
  /**
   * Whether `addFromFolder` can open a folder picker. Present on the web, where
   * it is `true` only when the browser exposes `window.showDirectoryPicker`,
   * and `addFromFolder` is present exactly when it is. Absent where there is
   * no such choice.
   */
  supportsFolderPicker?: boolean;
}

export type { ModelFiles, RecognizerHost } from "@/features/dictation/types";
export type { PluginFolder, PluginFolderFile } from "@/features/plugins/types";
