import { useState, useCallback } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { Button, Switch, Select } from "../ui";
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
} from "../../features/export";
import type { Book } from "../../features/books/types";
import type { Chapter } from "../../features/chapters/types";
import { IS_WEB, getDialog, getFileSystem } from "../../lib/platform";
import { useTranslation } from "react-i18next";
import { SpinnerIcon, CheckIcon, XIcon } from "../icons";

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

  const [progress, setProgress] = useState<ExportProgress>({
    status: "idle",
    message: "",
  });

  const handleExport = useCallback(async () => {
    try {
      setProgress({ status: "preparing", message: t("export.preparingStatus") });

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
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50" transition>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity duration-200 ease-out data-closed:opacity-0"
        aria-hidden="true"
      />

      {/* Dialog container */}
      <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4">
        <DialogPanel
          transition
          className="bg-background rounded-t-xl sm:rounded-lg shadow-xl max-w-md w-full p-4 sm:p-6 border border-border max-h-[90vh] overflow-auto transition duration-200 ease-out data-closed:translate-y-4 data-closed:opacity-0 data-closed:sm:scale-95 data-closed:sm:translate-y-0"
        >
          <DialogTitle className="text-lg sm:text-xl font-semibold text-foreground mb-4">
            {t("export.title")}
          </DialogTitle>

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
            <label className="block text-sm font-medium text-foreground mb-2">
              {t("export.format")}
            </label>
            <div className="flex gap-2">
              <button
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
                  <label className="text-sm text-foreground">{t("export.includeTOC")}</label>
                  <Switch
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
                  <label className="text-sm text-foreground">{t("export.numberedTOC")}</label>
                  <Switch
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
                  <label className="text-sm text-foreground">
                    {t("export.prependChapterTitles")}
                  </label>
                  <Switch
                    checked={epubOptions.prependChapterTitles}
                    onChange={(checked) =>
                      setEpubOptions((prev) => ({
                        ...prev,
                        prependChapterTitles: checked,
                      }))
                    }
                  />
                </div>
              </>
            ) : (
              // PDF Options
              <>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-foreground">{t("export.includeTOC")}</label>
                  <Switch
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
                  <label className="text-sm text-foreground">{t("export.numberChapters")}</label>
                  <Switch
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
                  <label className="text-sm text-foreground">
                    {t("export.includePageNumbers")}
                  </label>
                  <Switch
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
                  <label className="text-sm text-foreground">{t("export.pageSize")}</label>
                  <Select
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
                  <label className="text-sm text-foreground">{t("export.marginPreset")}</label>
                  <Select
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
        </DialogPanel>
      </div>
    </Dialog>
  );
}
