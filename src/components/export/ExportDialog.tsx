import { useState, useCallback } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { Button, Switch } from "../ui";
import {
  generateEpub,
  getEpubFilename,
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_PDF_OPTIONS,
  type EpubExportOptions,
  type PdfExportOptions,
  type ExportProgress,
} from "../../features/export";
import type { Book } from "../../features/books/types";
import type { Chapter } from "../../features/chapters/types";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { PdfPreview } from "./PdfPreview";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  chapters: Chapter[];
}

export function ExportDialog({
  isOpen,
  onClose,
  book,
  chapters,
}: ExportDialogProps) {
  const [format, setFormat] = useState<"epub" | "pdf">("epub");
  const [epubOptions, setEpubOptions] = useState<EpubExportOptions>(
    DEFAULT_EXPORT_OPTIONS
  );
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions>(
    DEFAULT_PDF_OPTIONS
  );
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  const [progress, setProgress] = useState<ExportProgress>({
    status: "idle",
    message: "",
  });

  const handleExport = useCallback(async () => {
    if (format === "pdf") {
      setShowPdfPreview(true);
      return;
    }

    try {
      setProgress({ status: "preparing", message: "Preparing export..." });

      // Generate the EPUB
      const blob = await generateEpub(book, chapters, epubOptions, (message) => {
        setProgress((prev) => ({ ...prev, message }));
      });

      setProgress({ status: "saving", message: "Saving file..." });

      // Get save location from user
      const suggestedFilename = getEpubFilename(book);
      const filePath = await save({
        defaultPath: suggestedFilename,
        filters: [
          {
            name: "EPUB",
            extensions: ["epub"],
          },
        ],
      });

      if (!filePath) {
        // User cancelled
        setProgress({ status: "idle", message: "" });
        return;
      }

      // Convert blob to Uint8Array and save
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      await writeFile(filePath, uint8Array);

      setProgress({
        status: "complete",
        message: "EPUB exported successfully!",
      });

      // Close dialog after a short delay
      setTimeout(() => {
        onClose();
        setProgress({ status: "idle", message: "" });
      }, 1500);
    } catch (error) {
      console.error("Export failed:", error);
      setProgress({
        status: "error",
        message: error instanceof Error ? error.message : "Export failed",
      });
    }
  }, [book, chapters, epubOptions, format, onClose]);

  const handleClose = useCallback(() => {
    if (progress.status !== "generating" && progress.status !== "saving") {
      onClose();
      setProgress({ status: "idle", message: "" });
      setShowPdfPreview(false);
    }
  }, [onClose, progress.status]);

  const isExporting =
    progress.status === "preparing" ||
    progress.status === "generating" ||
    progress.status === "saving";

  const exportableChapters = chapters.filter((ch) => ch.isIncludedInExport);

  if (showPdfPreview) {
    return (
      <PdfPreview
        isOpen={showPdfPreview}
        onClose={() => setShowPdfPreview(false)}
        book={book}
        chapters={chapters}
        initialOptions={pdfOptions}
      />
    );
  }

  return (
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Dialog container */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-background rounded-lg shadow-xl max-w-md w-full p-6 border border-border">
          <DialogTitle className="text-xl font-semibold text-foreground mb-4">
            Export Book
          </DialogTitle>

          {/* Book info */}
          <div className="mb-6 p-3 bg-primary rounded-md">
            <p className="font-medium text-foreground">{book.title}</p>
            <p className="text-sm text-success">
              by {book.authorName}
            </p>
            <p className="text-sm text-success mt-1">
              {exportableChapters.length} chapter
              {exportableChapters.length !== 1 ? "s" : ""} to export
            </p>
          </div>

          {/* Format selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-foreground mb-2">
              Format
            </label>
            <div className="flex gap-2">
              <button
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors border-2 ${format === "epub"
                  ? "bg-accent text-accent-foreground border-accent"
                  : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                  }`}
                onClick={() => setFormat("epub")}
              >
                EPUB
              </button>
              <button
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors border-2 ${format === "pdf"
                  ? "bg-accent text-accent-foreground border-accent"
                  : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                  }`}
                onClick={() => setFormat("pdf")}
              >
                PDF
              </button>
            </div>
          </div>

          {/* Export options */}
          <div className="space-y-4 mb-6">
            {format === "epub" ? (
              <>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-foreground">
                    Include Table of Contents
                  </label>
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
                  <label className="text-sm text-foreground">
                    Number chapters in TOC
                  </label>
                  <Switch
                    checked={epubOptions.numberChapters}
                    onChange={(checked) =>
                      setEpubOptions((prev) => ({ ...prev, numberChapters: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm text-foreground">
                    Prepend chapter titles
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
              // PDF Options - most settings controlled by browser print dialog
              <>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-foreground">
                    Table of Contents
                  </label>
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

                <p className="text-xs text-muted-foreground">
                  Page size, margins, and page numbers are configured in your browser's print dialog.
                </p>
              </>
            )}
          </div>

          {/* Progress / Status */}
          {progress.status !== "idle" && (
            <div
              className={`mb-4 p-3 rounded-md text-sm ${progress.status === "error"
                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200"
                : progress.status === "complete"
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                  : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
                }`}
            >
              <div className="flex items-center gap-2">
                {isExporting && (
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                )}
                {progress.status === "complete" && (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
                {progress.status === "error" && (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                )}
                <span>{progress.message}</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={isExporting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleExport}
              disabled={isExporting || exportableChapters.length === 0}
            >
              {isExporting
                ? "Exporting..."
                : format === "epub"
                  ? "Export EPUB"
                  : "Preview PDF"}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
