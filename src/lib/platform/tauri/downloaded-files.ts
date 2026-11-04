import { BaseDirectory, mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import type { DownloadedFiles } from "@/lib/verified-download";

export function tauriDownloadedFiles(dir: string): DownloadedFiles {
  function directory(id: string): string {
    return `${dir}/${id}`;
  }

  return {
    async read(id, name) {
      try {
        return await readFile(`${directory(id)}/${name}`, {
          baseDir: BaseDirectory.AppConfig,
        });
      } catch {
        // A missing file has no separate exists path in this build's scope.
        return null;
      }
    },
    async write(id, name, data) {
      await mkdir(directory(id), { baseDir: BaseDirectory.AppConfig, recursive: true });
      await writeFile(`${directory(id)}/${name}`, data, { baseDir: BaseDirectory.AppConfig });
    },
    async remove(id) {
      try {
        await remove(directory(id), { baseDir: BaseDirectory.AppConfig, recursive: true });
      } catch {
        // Removing a folder that is already gone is the same as removing it.
      }
    },
  };
}
