import { writeFile, readFile } from "@tauri-apps/plugin-fs";
import type { FileSystemAdapter } from "../types";

export const tauriFileSystem: FileSystemAdapter = {
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await writeFile(path, data);
  },

  async readFile(path: string): Promise<Uint8Array> {
    return await readFile(path);
  },

  downloadFile(_filename: string, _data: Uint8Array, _mimeType: string): void {
    // Not used in Tauri - use writeFile with save dialog instead
    throw new Error(
      "downloadFile is not supported in Tauri. Use save dialog + writeFile instead."
    );
  },
};
