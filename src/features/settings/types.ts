import type { MetricsCategory, MetricsSettings } from "../metrics/types";
import { DEFAULT_METRICS_SETTINGS } from "../metrics/settings";

export { DEFAULT_METRICS_SETTINGS };
export type { MetricsCategory, MetricsSettings };

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

  // Footnote settings
  showInlineFootnotes: boolean;
  showNotesChapter: boolean;
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
  chapterListView: ChapterListView;
  showChapterOutline: boolean;
  htmlEditorLightTheme: HtmlEditorTheme;
  htmlEditorDarkTheme: HtmlEditorTheme;
  htmlPanelHeight: number;

  // Paste cleanup settings
  pasteCleanup: PasteCleanupSettings;

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
