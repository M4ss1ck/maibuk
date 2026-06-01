import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n, { detectSystemLocale } from "../../i18n";
import {
  DEFAULT_METRICS_SETTINGS,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_BACKUP_LIST_PAGE,
  DEFAULT_BACKUP_LIST_PAGE_SIZE,
  BACKUP_LIST_PAGE_SIZE_OPTIONS,
  getDefaultBackupRetention,
  PASTE_CLEANUP_PRESETS,
  PASTE_CLEANUP_PRESET_VALUES,
  type Settings,
  type PasteCleanupSettings,
  type FontSize,
  type FontFamily,
  type ExportFormat,
  type Language,
  type HtmlEditorTheme,
  type ChapterListView,
  type BackupListPageSize,
  type PasteCleanupPreset,
  type PasteCleanupOptions,
  type PasteStructuralOptionKey,
  type PasteCleanupRule,
  type MetricsCategory,
} from "./types";
import { normalizeMetrics } from "../metrics/settings";

const STORAGE_KEY = "maibuk-settings";
const isWebBuild = import.meta.env.VITE_BUILD_TARGET === "web";

// Check if this is first load (no persisted settings) - evaluated once at module load
const isFirstLoad = !localStorage.getItem(STORAGE_KEY);

interface SettingsStore extends Settings {
  setAppFontSize: (size: FontSize) => void;
  setAppFont: (font: FontFamily) => void;
  setPrimaryColor: (color: string) => void;
  setAutoSave: (enabled: boolean) => void;
  setAlwaysOnTop: (enabled: boolean) => void;
  setDefaultExportFormat: (format: ExportFormat) => void;
  setBackupRetention: (retention: number) => void;
  setBackupDirectory: (directory: string | null) => void;
  setBackupListPage: (page: number) => void;
  setBackupListPageSize: (pageSize: number) => void;
  setLanguage: (language: Language) => void;
  setSpellCheckEnabled: (enabled: boolean) => void;
  addCustomWord: (word: string) => void;
  removeCustomWord: (word: string) => void;
  setDictionaryOpenInBrowser: (enabled: boolean) => void;
  setShowInlineFootnotes: (enabled: boolean) => void;
  setShowNotesChapter: (enabled: boolean) => void;
  setHideKeyboardHints: (enabled: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setNotesSidebarWidth: (width: number) => void;
  setToolbarExpanded: (expanded: boolean) => void;
  setChapterListView: (view: ChapterListView) => void;
  setHtmlEditorLightTheme: (theme: HtmlEditorTheme) => void;
  setHtmlEditorDarkTheme: (theme: HtmlEditorTheme) => void;
  setHtmlPanelHeight: (height: number) => void;
  setPasteCleanupPreset: (preset: PasteCleanupPreset) => void;
  setPasteCleanupOption: <K extends PasteStructuralOptionKey>(
    key: K,
    value: PasteCleanupOptions[K]
  ) => void;
  addStrippedProperty: (property: string) => void;
  removeStrippedProperty: (property: string) => void;
  addPasteCleanupRule: () => void;
  updatePasteCleanupRule: (
    id: string,
    patch: Partial<Omit<PasteCleanupRule, "id">>
  ) => void;
  removePasteCleanupRule: (id: string) => void;
  movePasteCleanupRule: (id: string, direction: "up" | "down") => void;
  setMetricsCategoryEnabled: (category: MetricsCategory, enabled: boolean) => void;
  setMetricsSyncEnabled: (enabled: boolean) => void;
  setMetricsStreakDailyWordThreshold: (threshold: number) => void;
  lastPath: string | null;
  setLastPath: (path: string | null) => void;
}

const defaultSettings: Settings = {
  appFontSize: 16,
  appFont: "sans",
  primaryColor: DEFAULT_PRIMARY_COLOR,
  autoSave: true,
  alwaysOnTop: false,
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
  backupListPage: DEFAULT_BACKUP_LIST_PAGE,
  backupListPageSize: DEFAULT_BACKUP_LIST_PAGE_SIZE,
  sidebarWidth: 256,
  notesSidebarWidth: 256,
  toolbarExpanded: false,
  chapterListView: "normal",
  htmlEditorLightTheme: "default" as HtmlEditorTheme,
  htmlEditorDarkTheme: "default" as HtmlEditorTheme,
  htmlPanelHeight: 200,
  pasteCleanup: {
    preset: "keepAll",
    options: { ...PASTE_CLEANUP_PRESETS.keepAll },
    rules: [],
  },
  metrics: {
    ...DEFAULT_METRICS_SETTINGS,
    enabled: { ...DEFAULT_METRICS_SETTINGS.enabled },
  },
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

/**
 * Coerce a persisted `pasteCleanup` blob into a valid PasteCleanupSettings.
 * Older or malformed shapes (e.g. a pre-strip-list blob with no
 * `strippedProperties`) self-heal here so a settings schema change can never
 * crash the editor. For a non-custom preset the options are rebuilt from the
 * preset table; a custom preset is coerced field by field.
 */
export function normalizePasteCleanup(value: unknown): PasteCleanupSettings {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<
    Record<keyof PasteCleanupSettings, unknown>
  >;

  const preset = PASTE_CLEANUP_PRESET_VALUES.includes(
    candidate.preset as PasteCleanupPreset
  )
    ? (candidate.preset as PasteCleanupPreset)
    : "keepAll";

  const rules: PasteCleanupRule[] = Array.isArray(candidate.rules)
    ? (candidate.rules.filter(
        (rule) =>
          typeof rule === "object" &&
          rule !== null &&
          typeof (rule as PasteCleanupRule).id === "string"
      ) as PasteCleanupRule[])
    : [];

  if (preset !== "custom") {
    return { preset, options: { ...PASTE_CLEANUP_PRESETS[preset] }, rules };
  }

  const raw = (candidate.options && typeof candidate.options === "object"
    ? candidate.options
    : {}) as Record<string, unknown>;
  return {
    preset,
    options: {
      demoteHeadings: raw.demoteHeadings === true,
      stripLinks: raw.stripLinks === true,
      flattenLists: raw.flattenLists === true,
      removeImages: raw.removeImages === true,
      unwrapFormattingTags: raw.unwrapFormattingTags === true,
      strippedProperties: Array.isArray(raw.strippedProperties)
        ? raw.strippedProperties.filter(
            (item): item is string => typeof item === "string"
          )
        : [],
    },
    rules,
  };
}

export { normalizeMetrics };

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,
      lastPath: null,
      setAppFontSize: (appFontSize) => set({ appFontSize }),
      setAppFont: (appFont) => set({ appFont }),
      setPrimaryColor: (primaryColor) => set({ primaryColor: normalizeHexColor(primaryColor) }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setAlwaysOnTop: (alwaysOnTop) => set({ alwaysOnTop }),
      setDefaultExportFormat: (defaultExportFormat) => set({ defaultExportFormat }),
      setBackupRetention: (backupRetention) =>
        set({ backupRetention: Math.max(1, Math.floor(backupRetention)) }),
      setBackupDirectory: (backupDirectory) =>
        set({ backupDirectory: backupDirectory?.trim() || null }),
      setBackupListPage: (backupListPage) =>
        set({ backupListPage: Math.max(1, Math.floor(backupListPage)) }),
      setBackupListPageSize: (backupListPageSize) => {
        const allowed = BACKUP_LIST_PAGE_SIZE_OPTIONS.includes(
          backupListPageSize as BackupListPageSize
        );
        set({
          backupListPage: DEFAULT_BACKUP_LIST_PAGE,
          backupListPageSize: allowed
            ? (backupListPageSize as BackupListPageSize)
            : DEFAULT_BACKUP_LIST_PAGE_SIZE,
        });
      },
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
      },
      setSpellCheckEnabled: (spellCheckEnabled) => set({ spellCheckEnabled }),
      setDictionaryOpenInBrowser: (dictionaryOpenInBrowser) => set({ dictionaryOpenInBrowser }),
      setShowInlineFootnotes: (showInlineFootnotes) => set({ showInlineFootnotes }),
      setShowNotesChapter: (showNotesChapter) => set({ showNotesChapter }),
      setHideKeyboardHints: (hideKeyboardHints) => set({ hideKeyboardHints }),
      setSidebarWidth: (sidebarWidth) =>
        set({ sidebarWidth: Math.max(200, Math.min(480, sidebarWidth)) }),
      setNotesSidebarWidth: (notesSidebarWidth) =>
        set({ notesSidebarWidth: Math.max(200, Math.min(480, notesSidebarWidth)) }),
      setToolbarExpanded: (toolbarExpanded) => set({ toolbarExpanded }),
      setChapterListView: (chapterListView) => set({ chapterListView }),
      setHtmlEditorLightTheme: (htmlEditorLightTheme) => set({ htmlEditorLightTheme }),
      setHtmlEditorDarkTheme: (htmlEditorDarkTheme) => set({ htmlEditorDarkTheme }),
      setHtmlPanelHeight: (htmlPanelHeight) =>
        set({
          htmlPanelHeight: Math.max(100, Math.min(window.innerHeight * 0.6, htmlPanelHeight)),
        }),
      setPasteCleanupPreset: (preset) =>
        set((state) => ({
          pasteCleanup: {
            ...state.pasteCleanup,
            preset,
            options:
              preset === "custom"
                ? state.pasteCleanup.options
                : { ...PASTE_CLEANUP_PRESETS[preset] },
          },
        })),
      setPasteCleanupOption: (key, value) =>
        set((state) => ({
          pasteCleanup: {
            ...state.pasteCleanup,
            preset: "custom",
            options: { ...state.pasteCleanup.options, [key]: value },
          },
        })),
      addStrippedProperty: (property) =>
        set((state) => {
          const normalized = property.trim().toLowerCase();
          const current = state.pasteCleanup.options.strippedProperties;
          if (!normalized || current.includes(normalized)) return state;
          return {
            pasteCleanup: {
              ...state.pasteCleanup,
              preset: "custom",
              options: {
                ...state.pasteCleanup.options,
                strippedProperties: [...current, normalized],
              },
            },
          };
        }),
      removeStrippedProperty: (property) =>
        set((state) => {
          const normalized = property.trim().toLowerCase();
          const current = state.pasteCleanup.options.strippedProperties;
          if (!current.includes(normalized)) return state;
          return {
            pasteCleanup: {
              ...state.pasteCleanup,
              preset: "custom",
              options: {
                ...state.pasteCleanup.options,
                strippedProperties: current.filter((p) => p !== normalized),
              },
            },
          };
        }),
      addPasteCleanupRule: () =>
        set((state) => ({
          pasteCleanup: {
            ...state.pasteCleanup,
            rules: [
              ...state.pasteCleanup.rules,
              {
                id: crypto.randomUUID(),
                enabled: true,
                label: "",
                target: "fontFamily",
                value: "",
                action: "removeStyle",
              },
            ],
          },
        })),
      updatePasteCleanupRule: (id, patch) =>
        set((state) => ({
          pasteCleanup: {
            ...state.pasteCleanup,
            rules: state.pasteCleanup.rules.map((rule) =>
              rule.id === id ? { ...rule, ...patch } : rule
            ),
          },
        })),
      removePasteCleanupRule: (id) =>
        set((state) => ({
          pasteCleanup: {
            ...state.pasteCleanup,
            rules: state.pasteCleanup.rules.filter((rule) => rule.id !== id),
          },
        })),
      movePasteCleanupRule: (id, direction) =>
        set((state) => {
          const rules = state.pasteCleanup.rules;
          const index = rules.findIndex((rule) => rule.id === id);
          if (index === -1) return state;
          const target = direction === "up" ? index - 1 : index + 1;
          if (target < 0 || target >= rules.length) return state;
          const next = [...rules];
          const [moved] = next.splice(index, 1);
          next.splice(target, 0, moved);
          return { pasteCleanup: { ...state.pasteCleanup, rules: next } };
        }),
      setMetricsCategoryEnabled: (category, enabled) =>
        set((state) => ({
          metrics: {
            ...state.metrics,
            enabled: { ...state.metrics.enabled, [category]: enabled },
          },
        })),
      setMetricsSyncEnabled: (syncMetrics) =>
        set((state) => ({ metrics: { ...state.metrics, syncMetrics } })),
      setMetricsStreakDailyWordThreshold: (streakDailyWordThreshold) =>
        set((state) => ({
          metrics: {
            ...state.metrics,
            streakDailyWordThreshold: Math.max(
              1,
              Math.floor(streakDailyWordThreshold),
            ),
          },
        })),
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
      // Normalise `pasteCleanup` on every rehydrate so a persisted blob from an
      // older settings schema (the only nested-object setting) self-heals
      // instead of crashing the editor. Other settings are flat primitives
      // that the default shallow merge handles safely.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<SettingsStore>;
        return {
          ...currentState,
          ...persisted,
          pasteCleanup: normalizePasteCleanup(persisted.pasteCleanup),
          metrics: normalizeMetrics(persisted.metrics),
        };
      },
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
