export interface EpubExportOptions {
  includeTableOfContents: boolean;
  numberChapters: boolean;
  prependChapterTitles: boolean;
}

export interface ExportProgress {
  status: "idle" | "preparing" | "generating" | "saving" | "complete" | "error";
  message: string;
  progress?: number;
}

export const DEFAULT_EXPORT_OPTIONS: EpubExportOptions = {
  includeTableOfContents: true,
  numberChapters: true,
  prependChapterTitles: true,
};

// --- PDF Export ---

export type PdfPageSize = "A4" | "LETTER" | "A5";
export type PdfFontFamily = "Times-Roman" | "Helvetica" | "Courier";
export type PdfMarginPreset = "standard" | "wide" | "narrow";

export interface PdfExportOptions {
  includeTableOfContents: boolean;
  numberChapters: boolean;
  includePageNumbers: boolean;
  pageSize: PdfPageSize;
  fontFamily: PdfFontFamily;
  margins: PdfMarginPreset;
}

export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  includeTableOfContents: true,
  numberChapters: true,
  includePageNumbers: true,
  pageSize: "A4",
  fontFamily: "Times-Roman",
  margins: "standard",
};
