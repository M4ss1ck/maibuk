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

export interface PasteCleanupOptions {
  removeTextColor: boolean;
  removeHighlight: boolean;
  removeFontFamily: boolean;
  removeFontSize: boolean;
  removeSourceSpacing: boolean;
  removeSourceIndent: boolean;
  demoteHeadings: boolean;
  stripLinks: boolean;
  flattenLists: boolean;
  removeImages: boolean;
  removeInlineFormatting: boolean;
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
  sidebarWidth: number;
  toolbarExpanded: boolean;
  chapterListView: ChapterListView;
  htmlEditorLightTheme: HtmlEditorTheme;
  htmlEditorDarkTheme: HtmlEditorTheme;
  htmlPanelHeight: number;

  // Paste cleanup settings
  pasteCleanup: PasteCleanupSettings;
}

export const PASTE_CLEANUP_OPTION_KEYS: (keyof PasteCleanupOptions)[] = [
  "removeTextColor",
  "removeHighlight",
  "removeFontFamily",
  "removeFontSize",
  "removeSourceSpacing",
  "removeSourceIndent",
  "demoteHeadings",
  "stripLinks",
  "flattenLists",
  "removeImages",
  "removeInlineFormatting",
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

function buildPasteCleanupOptions(enabled: boolean): PasteCleanupOptions {
  return {
    removeTextColor: enabled,
    removeHighlight: enabled,
    removeFontFamily: enabled,
    removeFontSize: enabled,
    removeSourceSpacing: enabled,
    removeSourceIndent: enabled,
    demoteHeadings: enabled,
    stripLinks: enabled,
    flattenLists: enabled,
    removeImages: enabled,
    removeInlineFormatting: enabled,
  };
}

export const PASTE_CLEANUP_PRESETS: Record<
  Exclude<PasteCleanupPreset, "custom">,
  PasteCleanupOptions
> = {
  keepAll: buildPasteCleanupOptions(false),
  plainText: buildPasteCleanupOptions(true),
  matchBook: {
    ...buildPasteCleanupOptions(false),
    removeTextColor: true,
    removeHighlight: true,
    removeFontFamily: true,
    removeFontSize: true,
    removeSourceSpacing: true,
    removeSourceIndent: true,
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
