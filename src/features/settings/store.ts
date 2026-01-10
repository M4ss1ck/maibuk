import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "../../i18n";
import type { Settings, FontSize, FontFamily, ExportFormat, Language } from "./types";

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
      name: "maibuk-settings",
      onRehydrateStorage: () => (state) => {
        // Sync i18n with persisted language on rehydration
        if (state?.language && state.language !== i18n.language) {
          i18n.changeLanguage(state.language);
        }
      },
    }
  )
);

export function useSettings() {
  return useSettingsStore();
}
