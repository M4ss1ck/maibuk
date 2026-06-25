import type { MetricsCategory, MetricsSettings } from "../metrics/types";
import { DEFAULT_METRICS_SETTINGS } from "../metrics/settings";
import type { SceneBreakDescriptor } from "../../components/editor/extensions/scene-break-utils";
import type {
  NotesListViewMode,
  NotesSortOption,
  NotesTreeGroupMode,
} from "../../components/notes/notes-list-model";

export { DEFAULT_METRICS_SETTINGS };
export type { MetricsCategory, MetricsSettings };
export type { NotesListViewMode, NotesSortOption, NotesTreeGroupMode };

export type FontSize = 14 | 16 | 18 | 20;
export type FontFamily = "serif" | "sans" | "mono";
export type ExportFormat = "epub" | "pdf";
export type Language = "en" | "es";
export type HtmlEditorTheme = "default" | "one-dark" | "dracula" | "one-light";
export type ChapterListView = "normal" | "compact";
export type BackupListPageSize = 5 | 10 | 25 | 50;

export const DEFAULT_PRIMARY_COLOR = "#3B82F6";
export const DEFAULT_TAURI_BACKUP_RETENTION = 20;
export const DEFAULT_WEB_BACKUP_RETENTION = 5;
export const DEFAULT_BACKUP_LIST_PAGE = 1;
export const DEFAULT_BACKUP_LIST_PAGE_SIZE: BackupListPageSize = 10;
export const BACKUP_LIST_PAGE_SIZE_OPTIONS: BackupListPageSize[] = [5, 10, 25, 50];

export const EDITOR_ZOOM_MIN = 30;
export const EDITOR_ZOOM_MAX = 300;
export const EDITOR_ZOOM_STEP = 10;
export const DEFAULT_EDITOR_ZOOM = 100;

/** Snap a zoom percent to the 10% grid and clamp to [30, 300]. */
export function clampEditorZoom(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_EDITOR_ZOOM;
  const snapped = Math.round(percent / EDITOR_ZOOM_STEP) * EDITOR_ZOOM_STEP;
  return Math.max(EDITOR_ZOOM_MIN, Math.min(EDITOR_ZOOM_MAX, snapped));
}

export const EDITOR_CONTENT_WIDTH_MIN = 480;
export const EDITOR_CONTENT_WIDTH_MAX = 1400;
export const EDITOR_CONTENT_WIDTH_STEP = 20;
/** Sentinel meaning "fill the pane"; resolves to 100% via CSS min(). */
export const EDITOR_CONTENT_WIDTH_FULL = 100000;
export const DEFAULT_EDITOR_CONTENT_WIDTH = 720;

export type EditorContentWidthPresetLabelKey =
  | "editor.widthNarrow"
  | "editor.widthComfortable"
  | "editor.widthWide"
  | "editor.widthFull";

export interface EditorContentWidthPreset {
  labelKey: EditorContentWidthPresetLabelKey;
  value: number;
}

export const EDITOR_CONTENT_WIDTH_PRESETS: EditorContentWidthPreset[] = [
  { labelKey: "editor.widthNarrow", value: 600 },
  { labelKey: "editor.widthComfortable", value: DEFAULT_EDITOR_CONTENT_WIDTH },
  { labelKey: "editor.widthWide", value: 960 },
  { labelKey: "editor.widthFull", value: EDITOR_CONTENT_WIDTH_FULL },
];

/** Snap a width to the step grid and clamp to [MIN, MAX]; pass the Full sentinel through. */
export function clampEditorContentWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_EDITOR_CONTENT_WIDTH;
  if (px >= EDITOR_CONTENT_WIDTH_FULL) return EDITOR_CONTENT_WIDTH_FULL;
  const snapped =
    Math.round(px / EDITOR_CONTENT_WIDTH_STEP) * EDITOR_CONTENT_WIDTH_STEP;
  return Math.max(
    EDITOR_CONTENT_WIDTH_MIN,
    Math.min(EDITOR_CONTENT_WIDTH_MAX, snapped),
  );
}

export function getDefaultBackupRetention(isWeb: boolean): number {
  return isWeb ? DEFAULT_WEB_BACKUP_RETENTION : DEFAULT_TAURI_BACKUP_RETENTION;
}

export type PasteCleanupPreset = "keepAll" | "matchBook" | "plainText" | "custom";

export type PasteStructuralOptionKey =
  | "demoteHeadings"
  | "stripLinks"
  | "flattenLists"
  | "removeImages"
  | "unwrapFormattingTags";

export interface PasteCleanupOptions {
  demoteHeadings: boolean;
  stripLinks: boolean;
  flattenLists: boolean;
  removeImages: boolean;
  unwrapFormattingTags: boolean;
  strippedProperties: string[];
}

export type PasteRuleTarget =
  | "fontFamily"
  | "textColor"
  | "backgroundColor"
  | "styleDeclaration"
  | "cssClass"
  | "tag"
  | "cssSelector";

export type PasteRuleAction = "removeStyle" | "unwrap" | "delete";

export interface PasteCleanupRule {
  id: string;
  enabled: boolean;
  label: string;
  target: PasteRuleTarget;
  value: string;
  action: PasteRuleAction;
}

export interface PasteCleanupSettings {
  preset: PasteCleanupPreset;
  options: PasteCleanupOptions;
  rules: PasteCleanupRule[];
}

export interface Settings {
  // App UI settings
  appFontSize: FontSize;
  appFont: FontFamily;
  primaryColor: string;

  // General settings
  autoSave: boolean;
  alwaysOnTop: boolean;
  launchOnStartup: boolean;
  closeToTray: boolean;
  language: Language;
  spellCheckEnabled: boolean;
  customDictionary: string[];
  dictionaryOpenInBrowser: boolean;

  // Scene break settings
  lastSceneBreak: SceneBreakDescriptor;
  sceneBreakPresets: SceneBreakDescriptor[];

  // Footnote / side panel settings
  showInlineFootnotes: boolean;
  showNotesChapter: boolean;
  bookSidePanelTab: "footnotes" | "notes";
  hideKeyboardHints: boolean;

  // Export settings
  defaultExportFormat: ExportFormat;

  // Backup settings
  backupRetention: number;
  backupDirectory: string | null;
  backupListPage: number;
  backupListPageSize: BackupListPageSize;

  // Editor layout settings
  mainSidebarWidth: number;
  sidebarWidth: number;
  notesSidebarWidth: number;
  toolbarExpanded: boolean;
  editorContentWidth: number;
  editorShowBorder: boolean;
  chapterListView: ChapterListView;
  showChapterOutline: boolean;
  notesListView: NotesListViewMode;
  notesSort: NotesSortOption;
  notesTreeGroupMode: NotesTreeGroupMode;
  notesCollapsedGroups: string[];
  notesExpandedEmptyGroups: string[];
  htmlEditorLightTheme: HtmlEditorTheme;
  htmlEditorDarkTheme: HtmlEditorTheme;
  htmlPanelHeight: number;

  // Editor zoom (view-only, decoupled from content font size)
  editorZoom: number;

  // Paste cleanup settings
  pasteCleanup: PasteCleanupSettings;
  promptMarkdownOnPaste: boolean;

  // Writing metrics settings
  metrics: MetricsSettings;
}

export const PASTE_STRUCTURAL_OPTION_KEYS: PasteStructuralOptionKey[] = [
  "demoteHeadings",
  "stripLinks",
  "flattenLists",
  "removeImages",
  "unwrapFormattingTags",
];

export const PASTE_CLEANUP_PRESET_VALUES: PasteCleanupPreset[] = [
  "keepAll",
  "matchBook",
  "plainText",
  "custom",
];

export const PASTE_RULE_TARGET_VALUES: PasteRuleTarget[] = [
  "fontFamily",
  "textColor",
  "backgroundColor",
  "styleDeclaration",
  "cssClass",
  "tag",
  "cssSelector",
];

export const PASTE_RULE_ACTION_VALUES: PasteRuleAction[] = [
  "removeStyle",
  "unwrap",
  "delete",
];

/** A worked example for each rule target, shown as the value-input placeholder. */
export const PASTE_RULE_TARGET_META: Record<PasteRuleTarget, { example: string }> =
  {
    fontFamily: { example: "-webkit-standard" },
    textColor: { example: "rgb(51, 51, 51)" },
    backgroundColor: { example: "yellow" },
    styleDeclaration: { example: "span { font-size: medium; color: rgb(0, 0, 0); }" },
    cssClass: { example: "MsoNormal" },
    tag: { example: "span" },
    cssSelector: { example: 'span[style*="font-size"]' },
  };

/** CSS properties the matchBook preset strips from pasted content. */
export const BOOK_STRIP_PROPERTIES: string[] = [
  "color",
  "background-color",
  "font-family",
  "font-size",
  "line-height",
  "letter-spacing",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "padding-left",
  "text-indent",
];

/** Curated properties surfaced as labelled toggles in the strip-styles UI. */
export const PASTE_STRIP_COMMON_PROPERTIES = [
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-decoration",
  "text-indent",
  "text-transform",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "padding-left",
] as const;

function buildStructuralOptions(enabled: boolean) {
  return {
    demoteHeadings: enabled,
    stripLinks: enabled,
    flattenLists: enabled,
    removeImages: enabled,
    unwrapFormattingTags: enabled,
  };
}

export const PASTE_CLEANUP_PRESETS: Record<
  Exclude<PasteCleanupPreset, "custom">,
  PasteCleanupOptions
> = {
  keepAll: { ...buildStructuralOptions(false), strippedProperties: [] },
  matchBook: {
    ...buildStructuralOptions(false),
    strippedProperties: [...BOOK_STRIP_PROPERTIES],
  },
  plainText: {
    ...buildStructuralOptions(true),
    strippedProperties: [
      ...BOOK_STRIP_PROPERTIES,
      "font-weight",
      "font-style",
      "text-decoration",
    ],
  },
};

export const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: 14, label: "Small" },
  { value: 16, label: "Medium" },
  { value: 18, label: "Large" },
  { value: 20, label: "Extra Large" },
];

export const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: "serif", label: "Serif (Literata)" },
  { value: "sans", label: "Sans-serif (Inter)" },
  { value: "mono", label: "Monospace" },
];

export const EXPORT_FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "epub", label: "EPUB" },
  { value: "pdf", label: "PDF" },
];

export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

export function normalizeLanguage(value: string | null | undefined): Language {
  return value === "es" ? "es" : "en";
}
