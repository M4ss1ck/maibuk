export type FontSize = 14 | 16 | 18 | 20;
export type FontFamily = "serif" | "sans" | "mono";
export type ExportFormat = "epub" | "pdf";
export type Language = "en" | "es";

export const DEFAULT_PRIMARY_COLOR = "#3B82F6";

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

  // Export settings
  defaultExportFormat: ExportFormat;
}

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
