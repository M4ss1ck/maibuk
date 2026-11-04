import { create } from "zustand";
import { DICTIONARY_CATALOG, dictionaryFor } from "@/features/spell-check-dictionaries/catalog";
import {
  installDictionary,
  isDictionaryInstalled,
} from "@/features/spell-check-dictionaries/install";
import type { SpellCheckDictionary } from "@/features/spell-check-dictionaries/types";
import { getSpellCheckDictionaryFiles } from "@/lib/platform";
import { spellCheckService } from "@/lib/spellcheck";
import { baseLanguage } from "@/lib/writing-language";

export interface SpellCheckDictionariesState {
  installed: string[];
  downloading: string[];
  failed: string[];
  loaded: boolean;
  refresh: () => Promise<void>;
  download: (language: string) => Promise<void>;
  remove: (language: string) => Promise<void>;
}

// Not persisted: the installed files are the truth on this device.
export const useSpellCheckDictionaries = create<SpellCheckDictionariesState>((set, get) => ({
  installed: [],
  downloading: [],
  failed: [],
  loaded: false,

  async refresh() {
    const files = await getSpellCheckDictionaryFiles();
    const installed: string[] = [];
    for (const entry of DICTIONARY_CATALOG) {
      if (await isDictionaryInstalled(entry, files)) installed.push(entry.language);
    }
    set({ installed, loaded: true });
  },

  async download(language) {
    if (get().downloading.includes(language)) return;
    const entry = dictionaryFor(language);
    if (!entry) return;

    set((state) => ({
      downloading: [...state.downloading, language],
      failed: state.failed.filter((failed) => failed !== language),
    }));

    try {
      const files = await getSpellCheckDictionaryFiles();
      await installDictionary(entry, files);
      set((state) => ({
        installed: state.installed.includes(language)
          ? state.installed
          : [...state.installed, language],
      }));
    } catch {
      set((state) => ({
        failed: state.failed.includes(language) ? state.failed : [...state.failed, language],
      }));
    } finally {
      set((state) => ({
        downloading: state.downloading.filter((downloading) => downloading !== language),
      }));
    }
  },

  async remove(language) {
    if (get().downloading.includes(language)) return;
    const files = await getSpellCheckDictionaryFiles();
    await files.remove(language);
    spellCheckService.releaseLanguage(language);
    set((state) => ({
      installed: state.installed.filter((installed) => installed !== language),
      failed: state.failed.filter((failed) => failed !== language),
    }));
  },
}));

export type DictionaryStatus =
  | { kind: "ready" }
  | { kind: "downloading" }
  | { kind: "available"; entry: SpellCheckDictionary; failed: boolean }
  | { kind: "unavailable" };

type StatusState = Pick<SpellCheckDictionariesState, "installed" | "downloading" | "failed">;

export function dictionaryStatus(tag: string, state: StatusState): DictionaryStatus {
  const language = baseLanguage(tag);
  if (language === null) return { kind: "unavailable" };
  if (language === "en" || language === "es" || state.installed.includes(language)) {
    return { kind: "ready" };
  }

  const entry = dictionaryFor(language);
  if (!entry) return { kind: "unavailable" };
  if (state.downloading.includes(language)) return { kind: "downloading" };
  return { kind: "available", entry, failed: state.failed.includes(language) };
}
