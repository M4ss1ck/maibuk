import { BaseDirectory, writeFile, readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import type { FileSystemAdapter } from "@/lib/platform/types";

export const tauriFileSystem: FileSystemAdapter = {
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await writeFile(path, data);
  },

  async readFile(path: string): Promise<Uint8Array> {
    return await readFile(path);
  },

  async readAppConfigTextFile(name: string): Promise<string | null> {
    const attempts: (() => Promise<string>)[] = [
      () => readTextFile(name, { baseDir: BaseDirectory.AppConfig }),
      async () => readTextFile(await join(await appDataDir(), name)),
      () => readTextFile(name, { baseDir: BaseDirectory.AppData }),
    ];
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch {
        // The file is missing or the scope refuses this location; try the next.
      }
    }
    return null;
  },

  downloadFile(_filename: string, _data: Uint8Array, _mimeType: string): void {
    // Not used in Tauri - use writeFile with save dialog instead
    throw new Error("downloadFile is not supported in Tauri. Use save dialog + writeFile instead.");
  },
};
