import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n, { detectSystemLocale } from "@/i18n";
import {
  DEFAULT_SCENE_BREAK,
  type SceneBreakDescriptor,
} from "@/components/editor/extensions/scene-break-utils";
import {
  DEFAULT_METRICS_SETTINGS,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_BACKUP_LIST_PAGE,
  DEFAULT_BACKUP_LIST_PAGE_SIZE,
  BACKUP_LIST_PAGE_SIZE_OPTIONS,
  getDefaultBackupRetention,
  DEFAULT_EDITOR_ZOOM,
  DEFAULT_EDITOR_CONTENT_WIDTH,
  EDITOR_ZOOM_STEP,
  clampEditorZoom,
  clampEditorContentWidth,
  clampEditorPagePadding,
  DEFAULT_EDITOR_PAGE_PADDING,
  PASTE_CLEANUP_PRESETS,
  PASTE_CLEANUP_PRESET_VALUES,
  type Settings,
  type EditorPagePadding,
  type PasteCleanupSettings,
  type FontSize,
  type FontFamily,
  type ExportFormat,
  type Language,
  type HtmlEditorTheme,
  type ChapterListView,
  type NotesListViewMode,
  type NotesSortOption,
  type NotesTreeGroupMode,
  type BackupListPageSize,
  type PasteCleanupPreset,
  type PasteCleanupOptions,
  type PasteStructuralOptionKey,
  type PasteCleanupRule,
  type MetricsCategory,
} from "@/features/settings/types";
import { normalizeMetrics } from "@/features/metrics/settings";
import { DEFAULT_NOTES_SORT } from "@/components/notes/notes-list-model";
import { setLaunchOnStartup as applyLaunchOnStartup } from "@/lib/platform";

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
  setLaunchOnStartup: (enabled: boolean) => void;
  setCloseToTray: (enabled: boolean) => void;
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
  setBookSidePanelTab: (tab: "footnotes" | "notes") => void;
  setHideKeyboardHints: (enabled: boolean) => void;
  setMainSidebarWidth: (width: number) => void;
  setSidebarWidth: (width: number) => void;
  setNotesSidebarWidth: (width: number) => void;
  setToolbarExpanded: (expanded: boolean) => void;
  setChapterListView: (view: ChapterListView) => void;
  setShowChapterOutline: (enabled: boolean) => void;
  setNotesListView: (view: NotesListViewMode) => void;
  setNotesSort: (sort: NotesSortOption) => void;
  setNotesTreeGroupMode: (mode: NotesTreeGroupMode) => void;
  toggleNotesGroupCollapsed: (key: string) => void;
  toggleNotesEmptyGroupExpanded: (key: string) => void;
  setHtmlEditorLightTheme: (theme: HtmlEditorTheme) => void;
  setHtmlEditorDarkTheme: (theme: HtmlEditorTheme) => void;
  setHtmlPanelHeight: (height: number) => void;
  setEditorZoom: (percent: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setEditorContentWidth: (px: number) => void;
  setEditorPagePadding: (value: number | Partial<EditorPagePadding>) => void;
  resetEditorPagePadding: () => void;
  setEditorShowBorder: (show: boolean) => void;
  setPasteCleanupPreset: (preset: PasteCleanupPreset) => void;
  setPasteCleanupOption: <K extends PasteStructuralOptionKey>(
    key: K,
    value: PasteCleanupOptions[K]
  ) => void;
  addStrippedProperty: (property: string) => void;
  removeStrippedProperty: (property: string) => void;
  addPasteCleanupRule: (init?: Partial<Omit<PasteCleanupRule, "id">>) => string;
  updatePasteCleanupRule: (id: string, patch: Partial<Omit<PasteCleanupRule, "id">>) => void;
  removePasteCleanupRule: (id: string) => void;
  movePasteCleanupRule: (id: string, direction: "up" | "down") => void;
  setPromptMarkdownOnPaste: (enabled: boolean) => void;
  setMetricsCategoryEnabled: (category: MetricsCategory, enabled: boolean) => void;
  setMetricsSyncEnabled: (enabled: boolean) => void;
  setMetricsStreakDailyWordThreshold: (threshold: number) => void;
  setLastSceneBreak: (descriptor: SceneBreakDescriptor) => void;
  addSceneBreakPreset: (descriptor: SceneBreakDescriptor) => void;
  removeSceneBreakPreset: (index: number) => void;
  lastPath: string | null;
  setLastPath: (path: string | null) => void;
  lastNoteId: string | null;
  setLastNoteId: (id: string | null) => void;
}

const defaultSettings: Settings = {
  appFontSize: 16,
  appFont: "sans",
  primaryColor: DEFAULT_PRIMARY_COLOR,
  autoSave: true,
  alwaysOnTop: false,
  launchOnStartup: false,
  closeToTray: false,
  language: (i18n.language as Language) || "en",
  spellCheckEnabled: true,
  customDictionary: [],
  dictionaryOpenInBrowser: false,
  lastSceneBreak: DEFAULT_SCENE_BREAK,
  sceneBreakPresets: [],
  showInlineFootnotes: true,
  showNotesChapter: false,
  bookSidePanelTab: "footnotes",
  hideKeyboardHints: false,
  defaultExportFormat: "epub",
  backupRetention: getDefaultBackupRetention(isWebBuild),
  backupDirectory: null,
  backupListPage: DEFAULT_BACKUP_LIST_PAGE,
  backupListPageSize: DEFAULT_BACKUP_LIST_PAGE_SIZE,
  mainSidebarWidth: 280,
  sidebarWidth: 256,
  notesSidebarWidth: 256,
  toolbarExpanded: false,
  chapterListView: "normal",
  showChapterOutline: true,
  notesListView: "list",
  notesSort: DEFAULT_NOTES_SORT,
  notesTreeGroupMode: "book",
  notesCollapsedGroups: [],
  notesExpandedEmptyGroups: [],
  htmlEditorLightTheme: "default" as HtmlEditorTheme,
  htmlEditorDarkTheme: "default" as HtmlEditorTheme,
  htmlPanelHeight: 200,
  editorZoom: DEFAULT_EDITOR_ZOOM,
  editorContentWidth: DEFAULT_EDITOR_CONTENT_WIDTH,
  editorPagePadding: {
    top: DEFAULT_EDITOR_PAGE_PADDING,
    right: DEFAULT_EDITOR_PAGE_PADDING,
    bottom: DEFAULT_EDITOR_PAGE_PADDING,
    left: DEFAULT_EDITOR_PAGE_PADDING,
  },
  editorShowBorder: false,
  pasteCleanup: {
    preset: "keepAll",
    options: { ...PASTE_CLEANUP_PRESETS.keepAll },
    rules: [],
  },
  promptMarkdownOnPaste: false,
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

  const preset = PASTE_CLEANUP_PRESET_VALUES.includes(candidate.preset as PasteCleanupPreset)
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

  const raw = (
    candidate.options && typeof candidate.options === "object" ? candidate.options : {}
  ) as Record<string, unknown>;
  return {
    preset,
    options: {
      demoteHeadings: raw.demoteHeadings === true,
      stripLinks: raw.stripLinks === true,
      flattenLists: raw.flattenLists === true,
      removeImages: raw.removeImages === true,
      unwrapFormattingTags: raw.unwrapFormattingTags === true,
      strippedProperties: Array.isArray(raw.strippedProperties)
        ? raw.strippedProperties.filter((item): item is string => typeof item === "string")
        : [],
    },
    rules,
  };
}

export function normalizeSceneBreak(value: unknown): SceneBreakDescriptor {
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;

    if (candidate.kind === "image" && typeof candidate.src === "string" && candidate.src) {
      return {
        kind: "image",
        src: candidate.src,
        alt: typeof candidate.alt === "string" ? candidate.alt : undefined,
        assetId: typeof candidate.assetId === "string" ? candidate.assetId : undefined,
      };
    }

    if (candidate.kind === "text" && typeof candidate.symbols === "string" && candidate.symbols) {
      return {
        kind: "text",
        symbols: candidate.symbols,
        unit: typeof candidate.unit === "string" ? candidate.unit : undefined,
        count: typeof candidate.count === "number" ? candidate.count : undefined,
        spaced: typeof candidate.spaced === "boolean" ? candidate.spaced : undefined,
      };
    }
  }

  return DEFAULT_SCENE_BREAK;
}

export { normalizeMetrics };

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,
      lastPath: null,
      lastNoteId: null,
      setAppFontSize: (appFontSize) => set({ appFontSize }),
      setAppFont: (appFont) => set({ appFont }),
      setPrimaryColor: (primaryColor) => set({ primaryColor: normalizeHexColor(primaryColor) }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setAlwaysOnTop: (alwaysOnTop) => set({ alwaysOnTop }),
      setLaunchOnStartup: (launchOnStartup) => {
        set({ launchOnStartup });
        void applyLaunchOnStartup(launchOnStartup).catch((error) => {
          console.error("Failed to update launch-on-startup:", error);
        });
      },
      setCloseToTray: (closeToTray) => set({ closeToTray }),
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
      setPromptMarkdownOnPaste: (promptMarkdownOnPaste) => set({ promptMarkdownOnPaste }),
      setShowNotesChapter: (showNotesChapter) => set({ showNotesChapter }),
      setBookSidePanelTab: (bookSidePanelTab) => set({ bookSidePanelTab }),
      setHideKeyboardHints: (hideKeyboardHints) => set({ hideKeyboardHints }),
      setMainSidebarWidth: (mainSidebarWidth) =>
        set({ mainSidebarWidth: Math.max(200, Math.min(480, mainSidebarWidth)) }),
      setSidebarWidth: (sidebarWidth) =>
        set({ sidebarWidth: Math.max(200, Math.min(480, sidebarWidth)) }),
      setNotesSidebarWidth: (notesSidebarWidth) =>
        set({ notesSidebarWidth: Math.max(200, Math.min(480, notesSidebarWidth)) }),
      setToolbarExpanded: (toolbarExpanded) => set({ toolbarExpanded }),
      setChapterListView: (chapterListView) => set({ chapterListView }),
      setShowChapterOutline: (showChapterOutline) => set({ showChapterOutline }),
      setNotesListView: (notesListView) => set({ notesListView }),
      setNotesSort: (notesSort) => set({ notesSort }),
      setNotesTreeGroupMode: (notesTreeGroupMode) => set({ notesTreeGroupMode }),
      toggleNotesGroupCollapsed: (key) =>
        set((state) => ({
          notesCollapsedGroups: state.notesCollapsedGroups.includes(key)
            ? state.notesCollapsedGroups.filter((entry) => entry !== key)
            : [...state.notesCollapsedGroups, key],
        })),
      toggleNotesEmptyGroupExpanded: (key) =>
        set((state) => ({
          notesExpandedEmptyGroups: state.notesExpandedEmptyGroups.includes(key)
            ? state.notesExpandedEmptyGroups.filter((entry) => entry !== key)
            : [...state.notesExpandedEmptyGroups, key],
        })),
      setHtmlEditorLightTheme: (htmlEditorLightTheme) => set({ htmlEditorLightTheme }),
      setHtmlEditorDarkTheme: (htmlEditorDarkTheme) => set({ htmlEditorDarkTheme }),
      setHtmlPanelHeight: (htmlPanelHeight) =>
        set({
          htmlPanelHeight: Math.max(100, Math.min(window.innerHeight * 0.6, htmlPanelHeight)),
        }),
      setEditorZoom: (editorZoom) => set({ editorZoom: clampEditorZoom(editorZoom) }),
      zoomIn: () =>
        set((state) => ({
          editorZoom: clampEditorZoom(state.editorZoom + EDITOR_ZOOM_STEP),
        })),
      zoomOut: () =>
        set((state) => ({
          editorZoom: clampEditorZoom(state.editorZoom - EDITOR_ZOOM_STEP),
        })),
      resetZoom: () => set({ editorZoom: DEFAULT_EDITOR_ZOOM }),
      setEditorContentWidth: (editorContentWidth) =>
        set({ editorContentWidth: clampEditorContentWidth(editorContentWidth) }),
      setEditorPagePadding: (value) =>
        set((state) => {
          if (typeof value === "number") {
            const clamped = clampEditorPagePadding(value);
            return {
              editorPagePadding: {
                top: clamped,
                right: clamped,
                bottom: clamped,
                left: clamped,
              },
            };
          }
          return {
            editorPagePadding: {
              top: clampEditorPagePadding(value.top ?? state.editorPagePadding.top),
              right: clampEditorPagePadding(value.right ?? state.editorPagePadding.right),
              bottom: clampEditorPagePadding(value.bottom ?? state.editorPagePadding.bottom),
              left: clampEditorPagePadding(value.left ?? state.editorPagePadding.left),
            },
          };
        }),
      resetEditorPagePadding: () =>
        set({
          editorPagePadding: {
            top: DEFAULT_EDITOR_PAGE_PADDING,
            right: DEFAULT_EDITOR_PAGE_PADDING,
            bottom: DEFAULT_EDITOR_PAGE_PADDING,
            left: DEFAULT_EDITOR_PAGE_PADDING,
          },
        }),
      setEditorShowBorder: (editorShowBorder) => set({ editorShowBorder }),
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
      addPasteCleanupRule: (init) => {
        const id = crypto.randomUUID();
        set((state) => ({
          pasteCleanup: {
            ...state.pasteCleanup,
            rules: [
              ...state.pasteCleanup.rules,
              {
                id,
                enabled: true,
                label: "",
                target: "fontFamily",
                value: "",
                action: "removeStyle",
                ...init,
              },
            ],
          },
        }));
        return id;
      },
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
            streakDailyWordThreshold: Math.max(1, Math.floor(streakDailyWordThreshold)),
          },
        })),
      setLastSceneBreak: (lastSceneBreak) => set({ lastSceneBreak }),
      addSceneBreakPreset: (descriptor) =>
        set((state) => {
          const key = JSON.stringify(descriptor);
          if (state.sceneBreakPresets.some((preset) => JSON.stringify(preset) === key)) {
            return state;
          }
          return {
            sceneBreakPresets: [...state.sceneBreakPresets, descriptor],
          };
        }),
      removeSceneBreakPreset: (index) =>
        set((state) => ({
          sceneBreakPresets: state.sceneBreakPresets.filter(
            (_preset, presetIndex) => presetIndex !== index
          ),
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
      setLastNoteId: (lastNoteId) => set({ lastNoteId }),
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
          lastSceneBreak: normalizeSceneBreak(persisted.lastSceneBreak),
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
