import { useEffect, useState, useCallback } from "react";
import { Button, Modal, Switch, Select } from "@/components/ui";
import {
  generateEpub,
  getEpubFilename,
  generatePdf,
  getPdfFilename,
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_PDF_OPTIONS,
  type EpubExportOptions,
  type PdfExportOptions,
  type PdfPageSize,
  type PdfMarginPreset,
  type ExportProgress,
  type ProjectEpubExportOptions,
} from "@/features/export";
import { getEpubStructure, listBookStyles } from "@/features/import/epub-project-repo";
import type { Book } from "@/features/books/types";
import type { Chapter } from "@/features/chapters/types";
import { IS_WEB, getDialog, getFileSystem } from "@/lib/platform";
import { useTranslation } from "react-i18next";
import { SpinnerIcon, CheckIcon, XIcon } from "@/components/icons";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  chapters: Chapter[];
}

export function ExportDialog({ isOpen, onClose, book, chapters }: ExportDialogProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<"epub" | "pdf">("epub");
  const [epubOptions, setEpubOptions] = useState<EpubExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions>(DEFAULT_PDF_OPTIONS);
  const [projectEpubOptions, setProjectEpubOptions] = useState<ProjectEpubExportOptions>({
    includeImportedStyles: true,
    useMaibukStyles: true,
    generateMaibukToc: true,
  });
  const [hasProjectEpubData, setHasProjectEpubData] = useState(false);

  const [progress, setProgress] = useState<ExportProgress>({
    status: "idle",
    message: "",
  });

  useEffect(() => {
    if (!isOpen || format !== "epub") return;
    let cancelled = false;

    async function loadProjectEpubData() {
      try {
        const [structure, styles] = await Promise.all([
          getEpubStructure(book.id),
          listBookStyles(book.id),
        ]);
        if (!cancelled) {
          setHasProjectEpubData(Boolean(structure || styles.length > 0));
        }
      } catch {
        if (!cancelled) {
          setHasProjectEpubData(false);
        }
      }
    }

    loadProjectEpubData();
    return () => {
      cancelled = true;
    };
  }, [book.id, format, isOpen]);

  const handleExport = useCallback(async () => {
    try {
      setProgress({
        status: "preparing",
        message: t("export.preparingStatus"),
      });

      let blob: Blob;
      let suggestedFilename: string;
      let mimeType: string;
      let filterName: string;
      let filterExtension: string;

      if (format === "pdf") {
        blob = await generatePdf(book, chapters, pdfOptions, (message: string) => {
          setProgress((prev) => ({ ...prev, message }));
        });
        suggestedFilename = getPdfFilename(book);
        mimeType = "application/pdf";
        filterName = "PDF";
        filterExtension = "pdf";
      } else {
        blob = await generateEpub(book, chapters, epubOptions, (message) => {
          setProgress((prev) => ({ ...prev, message }));
        });
        suggestedFilename = getEpubFilename(book);
        mimeType = "application/epub+zip";
        filterName = "EPUB";
        filterExtension = "epub";
      }

      setProgress({ status: "saving", message: t("export.savingStatus") });

      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      if (IS_WEB) {
        const fs = await getFileSystem();
        fs.downloadFile(suggestedFilename, uint8Array, mimeType);
      } else {
        const dialog = await getDialog();
        const filePath = await dialog.save({
          defaultPath: suggestedFilename,
          filters: [{ name: filterName, extensions: [filterExtension] }],
        });

        if (!filePath) {
          setProgress({ status: "idle", message: "" });
          return;
        }

        const fs = await getFileSystem();
        await fs.writeFile(filePath, uint8Array);
      }

      setProgress({
        status: "complete",
        message: t("export.exportSuccess", { format: format.toUpperCase() }),
      });

      setTimeout(() => {
        onClose();
        setProgress({ status: "idle", message: "" });
      }, 1500);
    } catch (error) {
      console.error("Export failed:", error);
      setProgress({
        status: "error",
        message: error instanceof Error ? error.message : t("export.exportFailed"),
      });
    }
  }, [book, chapters, epubOptions, pdfOptions, format, onClose, t]);

  const handleClose = useCallback(() => {
    if (progress.status !== "generating" && progress.status !== "saving") {
      onClose();
      setProgress({ status: "idle", message: "" });
    }
  }, [onClose, progress.status]);

  const isExporting =
    progress.status === "preparing" ||
    progress.status === "generating" ||
    progress.status === "saving";

  const exportableChapters = chapters.filter((ch) => ch.isIncludedInExport);

  const pageSizeOptions: { value: PdfPageSize; label: string }[] = [
    { value: "A4", label: t("export.pageSizeA4") },
    { value: "LETTER", label: t("export.pageSizeLetter") },
    { value: "A5", label: t("export.pageSizeA5") },
  ];

  const marginOptions: { value: PdfMarginPreset; label: string }[] = [
    { value: "standard", label: t("export.marginsStandard") },
    { value: "wide", label: t("export.marginsWide") },
    { value: "narrow", label: t("export.marginsNarrow") },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("export.title")}
      unstyled
      panelClassName="bg-background rounded-t-xl sm:rounded-lg shadow-xl max-w-md w-full sm:mx-4 p-4 sm:p-6 border border-border max-h-[90vh] overflow-auto"
      titleClassName="text-lg sm:text-xl font-semibold text-foreground mb-4"
    >
          {/* Book info */}
          <div className="mb-6 p-3 bg-info-bg rounded-lg border border-border">
            <p className="font-medium text-foreground">{book.title}</p>
            <p className="text-sm text-muted-foreground">
              {t("common.by")} {book.authorName}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("export.chapter", { count: exportableChapters.length })}
            </p>
          </div>

          {/* Format selector */}
          <div className="mb-6">
            <label
              htmlFor="export-format"
              className="block text-sm font-medium text-foreground mb-2"
            >
              {t("export.format")}
            </label>
            <div className="flex gap-2" id="export-format">
              <button
                type="button"
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors border-2 ${
                  format === "epub"
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                }`}
                onClick={() => setFormat("epub")}
              >
                {t("export.epub")}
              </button>
              <button
                type="button"
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors border-2 ${
                  format === "pdf"
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                }`}
                onClick={() => setFormat("pdf")}
              >
                {t("export.pdf")}
              </button>
            </div>
          </div>

          {/* Export options */}
          <div className="space-y-4 mb-6">
            {format === "epub" ? (
              <>
                <div className="flex items-center justify-between">
                  <label htmlFor="include-toc" className="text-sm text-foreground">
                    {t("export.includeTOC")}
                  </label>
                  <Switch
                    id="include-toc"
                    checked={epubOptions.includeTableOfContents}
                    onChange={(checked) =>
                      setEpubOptions((prev) => ({
                        ...prev,
                        includeTableOfContents: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label htmlFor="number-chapters" className="text-sm text-foreground">
                    {t("export.numberedTOC")}
                  </label>
                  <Switch
                    id="number-chapters"
                    checked={epubOptions.numberChapters}
                    onChange={(checked) =>
                      setEpubOptions((prev) => ({
                        ...prev,
                        numberChapters: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label htmlFor="prepend-chapter-titles" className="text-sm text-foreground">
                    {t("export.prependChapterTitles")}
                  </label>
                  <Switch
                    id="prepend-chapter-titles"
                    checked={epubOptions.prependChapterTitles}
                    onChange={(checked) =>
                      setEpubOptions((prev) => ({
                        ...prev,
                        prependChapterTitles: checked,
                      }))
                    }
                  />
                </div>

                {hasProjectEpubData && (
                  <div className="rounded-lg border border-border bg-card p-3 space-y-3">
                    <h3 className="text-sm font-medium text-foreground">
                      {t("export.projectEpubOptions")}
                    </h3>
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="project-use-maibuk-styles"
                        className="text-sm text-foreground"
                      >
                        {t("export.useMaibukStyles")}
                      </label>
                      <Switch
                        id="project-use-maibuk-styles"
                        checked={projectEpubOptions.useMaibukStyles}
                        onChange={(checked) =>
                          setProjectEpubOptions((prev) => ({
                            ...prev,
                            useMaibukStyles: checked,
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="project-include-imported-styles"
                        className="text-sm text-foreground"
                      >
                        {t("export.includeImportedStyles")}
                      </label>
                      <Switch
                        id="project-include-imported-styles"
                        checked={projectEpubOptions.includeImportedStyles}
                        onChange={(checked) =>
                          setProjectEpubOptions((prev) => ({
                            ...prev,
                            includeImportedStyles: checked,
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="project-generate-maibuk-toc"
                        className="text-sm text-foreground"
                      >
                        {t("export.generateMaibukToc")}
                      </label>
                      <Switch
                        id="project-generate-maibuk-toc"
                        checked={projectEpubOptions.generateMaibukToc}
                        onChange={(checked) =>
                          setProjectEpubOptions((prev) => ({
                            ...prev,
                            generateMaibukToc: checked,
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              // PDF Options
              <>
                <div className="flex items-center justify-between">
                  <label htmlFor="include-toc" className="text-sm text-foreground">
                    {t("export.includeTOC")}
                  </label>
                  <Switch
                    id="include-toc"
                    checked={pdfOptions.includeTableOfContents}
                    onChange={(checked) =>
                      setPdfOptions((prev) => ({
                        ...prev,
                        includeTableOfContents: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label htmlFor="number-chapters" className="text-sm text-foreground">
                    {t("export.numberChapters")}
                  </label>
                  <Switch
                    id="number-chapters"
                    checked={pdfOptions.numberChapters}
                    onChange={(checked) =>
                      setPdfOptions((prev) => ({
                        ...prev,
                        numberChapters: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label htmlFor="include-page-numbers" className="text-sm text-foreground">
                    {t("export.includePageNumbers")}
                  </label>
                  <Switch
                    id="include-page-numbers"
                    checked={pdfOptions.includePageNumbers}
                    onChange={(checked) =>
                      setPdfOptions((prev) => ({
                        ...prev,
                        includePageNumbers: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label htmlFor="page-size" className="text-sm text-foreground">
                    {t("export.pageSize")}
                  </label>
                  <Select
                    id="page-size"
                    ariaLabel={t("export.pageSize")}
                    value={pdfOptions.pageSize}
                    onChange={(value) =>
                      setPdfOptions((prev) => ({
                        ...prev,
                        pageSize: value,
                      }))
                    }
                    options={pageSizeOptions}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label htmlFor="margin-presets" className="text-sm text-foreground">
                    {t("export.marginPreset")}
                  </label>
                  <Select
                    id="margin-presets"
                    ariaLabel={t("export.marginPreset")}
                    value={pdfOptions.margins}
                    onChange={(value) =>
                      setPdfOptions((prev) => ({
                        ...prev,
                        margins: value,
                      }))
                    }
                    options={marginOptions}
                  />
                </div>
              </>
            )}
          </div>

          {/* Progress / Status */}
          {progress.status !== "idle" && (
            <div
              className={`mb-4 p-3 rounded-md text-sm ${
                progress.status === "error"
                  ? "bg-feedback-error-bg text-feedback-error-text"
                  : progress.status === "complete"
                    ? "bg-feedback-success-bg text-feedback-success-text"
                    : "bg-feedback-progress-bg text-feedback-progress-text"
              }`}
            >
              <div className="flex items-center gap-2">
                {(progress.status === "preparing" ||
                  progress.status === "generating" ||
                  progress.status === "saving") && <SpinnerIcon className="h-4 w-4" />}
                {progress.status === "complete" && <CheckIcon className="h-4 w-4" />}
                {progress.status === "error" && <XIcon className="h-4 w-4" />}
                <span>{progress.message}</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={handleClose} disabled={isExporting}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleExport}
              disabled={isExporting || exportableChapters.length === 0}
            >
              {isExporting
                ? t("export.exporting")
                : format === "epub"
                  ? t("export.exportEpub")
                  : t("export.exportPdf")}
            </Button>
          </div>
    </Modal>
  );
}
