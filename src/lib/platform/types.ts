// Platform adapter interfaces for cross-platform compatibility

export interface DatabaseAdapter {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T = unknown[]>(sql: string, params?: unknown[]): Promise<T>;
  close(): Promise<void>;
  exportData(): Promise<Uint8Array>;
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface OpenDialogOptions {
  multiple?: boolean;
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
