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
