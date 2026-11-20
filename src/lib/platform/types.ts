// Platform adapter interfaces for cross-platform compatibility

import type {
  EndpointListenerState,
  EndpointRequestMessage,
  PluginFolder,
  PluginFolderFile,
} from "@/features/plugins/types";

/** One statement of an atomic write: plain SQL, or SQL with `?` bind parameters. */
export type AtomicStatement = string | { sql: string; params: readonly (string | number | null)[] };

export interface DatabaseAdapter {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T = unknown[]>(sql: string, params?: unknown[]): Promise<T>;
  close(): Promise<void>;
  exportData(): Promise<Uint8Array>;
  /** Runs every statement in one transaction, or none: rejects with AtomicStatementError and leaves the Library unchanged. */
  executeAtomic(statements: readonly AtomicStatement[]): Promise<void>;
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
  /**
   * Reads the named UTF-8 text file from the app config dir, then the app data
   * dir. The Plugins bench seed lives there (issue #448); the product's `fs`
   * scope permits the config dir, so it is tried first. Null when neither holds
   * the file. The web build has no such directory, so it returns null.
   */
  readAppConfigTextFile(name: string): Promise<string | null>;
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

/** The install format of this build; `unknown` for Arch, the web, and anything the updater does not own. */
export type BundleType = "appimage" | "deb" | "rpm" | "nsis" | "unknown";

export type UpdateFailureReason =
  | "offline"
  | "cancelled-auth"
  | "not-writable"
  | "bad-signature"
  | "no-asset"
  | "other";

/** What an Update rejects with; the store maps it to the localized message. */
export class UpdateError extends Error {
  readonly reason: UpdateFailureReason;
  readonly cause: unknown;

  constructor(reason: UpdateFailureReason, cause?: unknown) {
    super(`Update failed: ${reason}`);
    this.name = "UpdateError";
    this.reason = reason;
    this.cause = cause;
  }
}

export type UpdateProgressEvent =
  | { kind: "started"; total?: number }
  | { kind: "progress"; bytes: number }
  | { kind: "finished" };

export interface UpdaterAdapter {
  bundleType(): Promise<BundleType>;
  /** The newest Release the updater feed lists for this install; null when none is newer. Rejects with UpdateError. */
  check(): Promise<{ version: string } | null>;
  /** Linux: download what `check()` found and install it. Rejects with UpdateError. */
  downloadAndInstall(onProgress: (event: UpdateProgressEvent) => void): Promise<void>;
  /** Windows: download and verify what `check()` found, and hold it for `install()`. Rejects with UpdateError. */
  download(onProgress: (event: UpdateProgressEvent) => void): Promise<void>;
  /** Windows: run the held installer, which quits the app and relaunches it. Rejects with UpdateError. */
  install(): Promise<void>;
  /** Drops the held download, if any (Windows Later). */
  close(): Promise<void>;
}

export interface ClipboardAdapter {
  /** The clipboard's plain text; `""` when it holds none. */
  readText(): Promise<string>;
  /** Replaces the clipboard with `text`. */
  writeText(text: string): Promise<void>;
  /**
   * The image file a file manager copied, which the page itself cannot read
   * (WebKitGTK hands it only an empty `text/uri-list`); null when the OS
   * clipboard names no image file. Rejects when the file is too large.
   */
  readCopiedImageFile(): Promise<Blob | null>;
}

export type SystemNotificationPermission = "granted" | "denied" | "default";

/** System Notifications: the OS banner, not the in-app toast (ADR 0042). */
export interface SystemNotificationAdapter {
  /** The OS's answer now; `"denied"` where the platform has no notifications. */
  permission(): Promise<SystemNotificationPermission>;
  /** Asks the OS. The web needs a user gesture, so call it from one. */
  requestPermission(): Promise<SystemNotificationPermission>;
  /**
   * Shows one now. A second show with the same `tag` replaces the first.
   * Rejects when the platform cannot show one.
   */
  show(notification: { tag: string; title: string; body: string }): Promise<void>;
  /**
   * Shows one at `at` (ms since the epoch). A second with the same `tag` replaces
   * an earlier scheduled or shown one; an `at` already past fires on the next tick.
   */
  schedule(notification: { tag: string; title: string; body: string; at: number }): Promise<void>;
  /** Withdraws the one with `tag`, scheduled or shown; an unknown tag is not an error. */
  cancel(tag: string): Promise<void>;
  /** Withdraws every scheduled and shown one whose tag starts with `prefix`. */
  cancelAll(prefix: string): Promise<void>;
  /** Whether a scheduled one fires on time, rather than minutes late. */
  exactTiming(): Promise<boolean>;
  /**
   * Calls `handler` with the tag of a clicked one, after Maibuk came to the front;
   * returns the unsubscribe. Supports one or more handlers.
   */
  onClick(handler: (tag: string) => void): () => void;
  /** Whether the OS fires one while Maibuk is closed. True on Android only. */
  canScheduleWhileClosed(): boolean;
}

/**
 * Fetches a URL on a host the broker already allowed. The web build uses the
 * browser's own `fetch`, so its request is subject to CORS like any page; the
 * desktop build uses the http plugin's `fetch`, which runs outside the webview
 * and so has no CORS. The broker's host check, not this adapter, is the gate.
 */
export type PluginFetchAdapter = (url: string, init: RequestInit) => Promise<Response>;

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

/** What `files.pick` returns and `files.list` lists: a live grant, named and sized. */
export interface PluginFileGrant {
  grant: string;
  name: string;
  size: number;
}

/**
 * One file the author dropped on the host, as the platform can describe it: a
 * browser hands over the dropped `File` and the handle promise taken from
 * `DataTransferItem.getAsFileSystemHandle()` inside the drop event (null where
 * the browser has no such call), while desktop reports the path Tauri saw.
 */
export type PluginDroppedFile =
  | { file: File; handle: Promise<FileSystemHandle | null> | null }
  | { path: string };

/** What `files.stat` reads without opening the file's bytes. */
export interface PluginFileStat {
  name: string;
  size: number;
  /** Milliseconds since the Unix epoch. */
  modified: number;
}

/** Where a Plugin's file goes: the host's platform saving, behind one call (ADR 0040). */
export interface PluginFileSaver {
  /**
   * Writes one file under the cleaned base name. `saved` means the host wrote
   * it (on the web, once it is handed to the browser); `cancelled` means the
   * author closed the dialog without choosing a place.
   */
  save(name: string, mimeType: string, blob: Blob): Promise<"saved" | "cancelled">;
}

export interface PluginFileGrantStore {
  /**
   * Shows the host's file dialog filtered to `extensions`, returning the picked
   * file's grant, or null when the author cancelled. Picking a file this Plugin
   * already holds a grant for returns the same grant id.
   */
  pick(pluginId: string, extensions: readonly string[]): Promise<PluginFileGrant | null>;
  /**
   * Mints one File Grant per dropped file the store can grant, in order, with
   * the same per-Plugin scoping and the same dedupe as `pick`: a file this
   * Plugin already holds a grant for returns that grant id rather than a new
   * one. An entry it cannot grant (the wrong kind for this platform, or
   * unreadable) is left out. Not a user-action call: the drop event already
   * carried the author's intent.
   */
  drop(pluginId: string, files: readonly PluginDroppedFile[]): Promise<PluginFileGrant[]>;
  /**
   * Reads `length` bytes from `offset`. A range past the end returns the bytes
   * that exist: shorter than asked, empty at or past the end of the file.
   */
  read(pluginId: string, grant: string, offset: number, length: number): Promise<ArrayBuffer>;
  /** The grant's name, size, and last-modified time; cheap enough for a Shelf. */
  stat(pluginId: string, grant: string): Promise<PluginFileStat>;
  /**
   * Asks the browser for read access again, inside a user action. Desktop
   * always answers true; the web store asks the author's browser.
   */
  requestAccess(pluginId: string, grant: string): Promise<boolean>;
  /** Ends the grant. */
  release(pluginId: string, grant: string): Promise<void>;
  /** Every live grant the Plugin holds on this device. */
  list(pluginId: string): Promise<PluginFileGrant[]>;
  /** Ends every grant the Plugin holds, and no other Plugin's. */
  clearPlugin(pluginId: string): Promise<void>;
  /** Ends every File Grant on this device. */
  clearAll(): Promise<void>;
}

/**
 * The Plugin Endpoint's listener, as the host drives it. Desktop binds
 * `127.0.0.1` in Rust and hands every inbound request to `onRequest`; the web
 * and Android adapters report `off` and never deliver. The host decides which
 * Plugins serve, not this adapter.
 */
export interface EndpointAdapter {
  /**
   * Replaces the serving set and the `onRequest` sink. A non-empty set binds
   * when nothing is bound; an empty one unbinds, failing requests still
   * waiting for an answer. Resolves the listener's state; a failed bind is
   * reported once and never retried.
   */
  sync(
    ids: readonly string[],
    onRequest: (message: EndpointRequestMessage) => void
  ): Promise<EndpointListenerState>;
  /** Answers one request with its whole body, or with `streaming: true` before the first chunk. */
  respond(
    requestId: string,
    status: number,
    headers: [string, string][],
    body: string | undefined,
    streaming: boolean
  ): Promise<void>;
  /** One base64 body piece of a streamed answer; false once the caller hung up. */
  chunk(requestId: string, chunk: string): Promise<boolean>;
  /** Closes a streamed answer, whether it finished or not. */
  end(requestId: string): Promise<void>;
}

export type { ModelFiles, RecognizerHost } from "@/features/dictation/types";
export type {
  EndpointListenerState,
  EndpointRequestMessage,
  PluginFolder,
  PluginFolderFile,
} from "@/features/plugins/types";

/**
 * The tray menu's lines in the app language. Each usage line is a template
 * with a `{value}` placeholder that Rust fills with the number it formats.
 */
export interface TrayLabels {
  show: string;
  quit: string;
  cpu: string;
  ram: string;
  storage: string;
  app: string;
  data: string;
  backups: string;
  plugins: string;
  /** Shown in place of a number that could not be read. */
  unknown: string;
  decimalSeparator: string;
}

/** CPU, RAM, and the storage total, each a whole line worded like the tray. */
export interface ResourceUsageSummary {
  cpu: string;
  ram: string;
  storage: string;
}

/** What `configure_tray` sends to Rust (src-tauri/src/resource_usage/mod.rs). */
export interface TrayConfig {
  labels: TrayLabels;
  resourceUsage: boolean;
  /** The resolved Backup Directory, so the Backups line follows a custom one. */
  backupDirectory: string | null;
}
