import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Settings, FontSize, FontFamily, ExportFormat } from "./types";

interface SettingsStore extends Settings {
  setAppFontSize: (size: FontSize) => void;
  setAppFont: (font: FontFamily) => void;
  setAutoSave: (enabled: boolean) => void;
  setDefaultExportFormat: (format: ExportFormat) => void;
}

const defaultSettings: Settings = {
  appFontSize: 16,
  appFont: "sans",
  autoSave: true,
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
    }),
    {
      name: "maibuk-settings",
    }
  )
);

export function useSettings() {
  return useSettingsStore();
}
