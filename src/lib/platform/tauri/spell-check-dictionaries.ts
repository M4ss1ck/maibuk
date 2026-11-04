import { BaseDirectory, mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import type { SpellCheckDictionaryFiles } from "@/features/spell-check-dictionaries/types";

const DIR = "spell-check-dictionaries";

function directory(language: string): string {
  return `${DIR}/${language}`;
}

export const tauriSpellCheckDictionaryFiles: SpellCheckDictionaryFiles = {
  async read(language, name) {
    try {
      return await readFile(`${directory(language)}/${name}`, {
        baseDir: BaseDirectory.AppConfig,
      });
    } catch {
      // A missing file has no separate exists path in this build's scope.
      return null;
    }
  },
  async write(language, name, data) {
    await mkdir(directory(language), { baseDir: BaseDirectory.AppConfig, recursive: true });
    await writeFile(`${directory(language)}/${name}`, data, { baseDir: BaseDirectory.AppConfig });
  },
  async remove(language) {
    try {
      await remove(directory(language), { baseDir: BaseDirectory.AppConfig, recursive: true });
    } catch {
      // Removing a folder that is already gone is the same as removing it.
    }
  },
};
