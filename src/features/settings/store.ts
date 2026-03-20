import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n, { detectSystemLocale } from "../../i18n";
import {
  DEFAULT_PRIMARY_COLOR,
  getDefaultBackupRetention,
  type Settings,
  type FontSize,
  type FontFamily,
  type ExportFormat,
  type Language,
  type HtmlEditorTheme,
} from "./types";

const STORAGE_KEY = "maibuk-settings";
const isWebBuild = import.meta.env.VITE_BUILD_TARGET === "web";

// Check if this is first load (no persisted settings) - evaluated once at module load
const isFirstLoad = !localStorage.getItem(STORAGE_KEY);

interface SettingsStore extends Settings {
  setAppFontSize: (size: FontSize) => void;
  setAppFont: (font: FontFamily) => void;
  setPrimaryColor: (color: string) => void;
  setAutoSave: (enabled: boolean) => void;
  setDefaultExportFormat: (format: ExportFormat) => void;
  setBackupRetention: (retention: number) => void;
  setBackupDirectory: (directory: string | null) => void;
  setLanguage: (language: Language) => void;
  setSpellCheckEnabled: (enabled: boolean) => void;
  addCustomWord: (word: string) => void;
  removeCustomWord: (word: string) => void;
  setDictionaryOpenInBrowser: (enabled: boolean) => void;
  setShowInlineFootnotes: (enabled: boolean) => void;
  setShowNotesChapter: (enabled: boolean) => void;
  setHideKeyboardHints: (enabled: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setToolbarExpanded: (expanded: boolean) => void;
  setHtmlEditorLightTheme: (theme: HtmlEditorTheme) => void;
  setHtmlEditorDarkTheme: (theme: HtmlEditorTheme) => void;
  lastPath: string | null;
  setLastPath: (path: string | null) => void;
}

const defaultSettings: Settings = {
  appFontSize: 16,
  appFont: "sans",
  primaryColor: DEFAULT_PRIMARY_COLOR,
  autoSave: true,
  language: (i18n.language as Language) || "en",
  spellCheckEnabled: true,
  customDictionary: [],
  dictionaryOpenInBrowser: false,
  showInlineFootnotes: true,
  showNotesChapter: false,
  hideKeyboardHints: false,
  defaultExportFormat: "epub",
  backupRetention: getDefaultBackupRetention(isWebBuild),
  backupDirectory: null,
  sidebarWidth: 256,
  toolbarExpanded: false,
  htmlEditorLightTheme: "default" as HtmlEditorTheme,
  htmlEditorDarkTheme: "default" as HtmlEditorTheme,
};

function normalizeHexColor(color: string): string {
  const normalized = color.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(normalized)) {
    return normalized;
  }
  if (/^#[0-9A-F]{3}$/.test(normalized)) {
    const [r, g, b] = normalized.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return DEFAULT_PRIMARY_COLOR;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,
      lastPath: null,
      setAppFontSize: (appFontSize) => set({ appFontSize }),
      setAppFont: (appFont) => set({ appFont }),
      setPrimaryColor: (primaryColor) => set({ primaryColor: normalizeHexColor(primaryColor) }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setDefaultExportFormat: (defaultExportFormat) => set({ defaultExportFormat }),
      setBackupRetention: (backupRetention) => set({ backupRetention: Math.max(1, Math.floor(backupRetention)) }),
      setBackupDirectory: (backupDirectory) => set({ backupDirectory: backupDirectory?.trim() || null }),
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
      },
      setSpellCheckEnabled: (spellCheckEnabled) => set({ spellCheckEnabled }),
      setDictionaryOpenInBrowser: (dictionaryOpenInBrowser) => set({ dictionaryOpenInBrowser }),
      setShowInlineFootnotes: (showInlineFootnotes) => set({ showInlineFootnotes }),
      setShowNotesChapter: (showNotesChapter) => set({ showNotesChapter }),
      setHideKeyboardHints: (hideKeyboardHints) => set({ hideKeyboardHints }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: Math.max(200, Math.min(480, sidebarWidth)) }),
      setToolbarExpanded: (toolbarExpanded) => set({ toolbarExpanded }),
      setHtmlEditorLightTheme: (htmlEditorLightTheme) => set({ htmlEditorLightTheme }),
      setHtmlEditorDarkTheme: (htmlEditorDarkTheme) => set({ htmlEditorDarkTheme }),
      addCustomWord: (word) => {
        const normalized = word.trim();
        if (!normalized) return;

        set((state) => {
          const exists = state.customDictionary.some(
            (entry) => entry.toLowerCase() === normalized.toLowerCase()
          );
          if (exists) return state;
          return { customDictionary: [...state.customDictionary, normalized] };
        });
      },
      removeCustomWord: (word) => {
        const normalized = word.trim();
        if (!normalized) return;

        set((state) => ({
          customDictionary: state.customDictionary.filter(
            (entry) => entry.toLowerCase() !== normalized.toLowerCase()
          ),
        }));
      },
      setLastPath: (lastPath) => set({ lastPath }),
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error("Failed to rehydrate settings:", error);
          }

          if (isFirstLoad) {
            // First load: detect system locale and apply it
            detectSystemLocale().then((detectedLang) => {
              i18n.changeLanguage(detectedLang);
              useSettingsStore.setState({ language: detectedLang });
            });
          } else if (state?.language) {
            // Subsequent loads: always sync i18n with persisted language
            i18n.changeLanguage(state.language);
          }
        };
      },
    }
  )
);

export function useSettings() {
  return useSettingsStore();
}
