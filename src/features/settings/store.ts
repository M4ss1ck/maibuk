import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n, { detectSystemLocale } from "../../i18n";
import type { Settings, FontSize, FontFamily, ExportFormat, Language } from "./types";

const STORAGE_KEY = "maibuk-settings";

// Check if this is first load (no persisted settings) - evaluated once at module load
const isFirstLoad = !localStorage.getItem(STORAGE_KEY);

interface SettingsStore extends Settings {
  setAppFontSize: (size: FontSize) => void;
  setAppFont: (font: FontFamily) => void;
  setAutoSave: (enabled: boolean) => void;
  setDefaultExportFormat: (format: ExportFormat) => void;
  setLanguage: (language: Language) => void;
}

const defaultSettings: Settings = {
  appFontSize: 16,
  appFont: "sans",
  autoSave: true,
  language: (i18n.language as Language) || "en",
  defaultExportFormat: "epub",
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,
      setAppFontSize: (appFontSize) => set({ appFontSize }),
      setAppFont: (appFont) => set({ appFont }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setDefaultExportFormat: (defaultExportFormat) => set({ defaultExportFormat }),
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
      },
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (isFirstLoad) {
          // First load: detect system locale and apply it
          detectSystemLocale().then((detectedLang) => {
            i18n.changeLanguage(detectedLang);
            // Update store with detected language
            useSettingsStore.setState({ language: detectedLang });
          });
        } else if (state?.language) {
          // Subsequent loads: always sync i18n with persisted language
          i18n.changeLanguage(state.language);
        }
      },
    }
  )
);

export function useSettings() {
  return useSettingsStore();
}
