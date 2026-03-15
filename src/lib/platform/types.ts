// Platform adapter interfaces for cross-platform compatibility

export interface DatabaseAdapter {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T = unknown[]>(sql: string, params?: unknown[]): Promise<T>;
  close(): Promise<void>;
  exportData(): Promise<Uint8Array>;
  importData(sqlContent: string): Promise<void>;
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
}

// Web-specific: open file and get data in one operation
export interface FileWithData {
  name: string;
  data: Uint8Array;
}

export interface WebDialogAdapter extends DialogAdapter {
  openWithData(options: OpenDialogOptions): Promise<FileWithData | null>;
}

export interface OSAdapter {
  locale(): Promise<string | null>;
}

export interface BackupEntry {
  filename: string;
  trigger: "launch" | "close" | "pre-sync" | "pre-restore" | "manual" | "unknown";
  createdAt: Date;
  /** Stored as metadata alongside the backup content, not computed on read. */
  sizeBytes: number;
  /** SHA-256 hash of the SQL content, computed at save time. */
  checksum: string;
}

export interface BackupAdapter {
  saveBackup(filename: string, sqlContent: string): Promise<void>;
  listBackups(): Promise<BackupEntry[]>;
  readBackup(filename: string): Promise<string>;
  deleteBackup(filename: string): Promise<void>;
}
