import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Previewer } from "pagedjs";
import { Button, Select } from "../ui";
import {
  generatePdfHtml,
  PAGE_SIZES,
  type PdfExportOptions,
  type PageSize,
} from "../../features/export";
import type { Book } from "../../features/books/types";
import type { Chapter } from "../../features/chapters/types";

interface PdfPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  chapters: Chapter[];
  initialOptions: PdfExportOptions;
}

export function PdfPreview({
  isOpen,
  onClose,
  book,
  chapters,
  initialOptions,
}: PdfPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<PdfExportOptions>(initialOptions);

  const cleanup = useCallback(() => {
    if (styleRef.current && document.head.contains(styleRef.current)) {
      document.head.removeChild(styleRef.current);
      styleRef.current = null;
    }
    document.querySelectorAll("style[data-pagedjs-inserted-styles]").forEach((s) => s.remove());
    // Remove print mode class from body
    document.body.classList.remove("pdf-print-mode");
  }, []);

  const renderPreview = useCallback(async () => {
    if (!previewRef.current || !isOpen) return;

    setIsLoading(true);
    setError(null);
    cleanup();

    try {
      previewRef.current.innerHTML = "";

      // Generate the HTML
      const html = generatePdfHtml(book, chapters, options);

      // Parse the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Extract styles and body content
      const styleContent = doc.querySelector("style")?.textContent || "";
      const bodyContent = doc.body.innerHTML;

      // Create a detached container for Paged.js (not in DOM)
      const sourceContainer = document.createElement("div");
      sourceContainer.innerHTML = bodyContent;

      // Add preview-specific styles
      const styleEl = document.createElement("style");
      styleEl.setAttribute("data-pagedjs-inserted-styles", "true");
      styleEl.textContent = `
        .pdf-preview-container,
        .pdf-preview-container *,
        .pagedjs_pages,
        .pagedjs_pages * {
          color-scheme: light !important;
        }
        .pagedjs_pages {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          padding: 20px !important;
          background: transparent !important;
        }
        .pagedjs_page {
          background: #fff !important;
          color: #000 !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2) !important;
          margin-bottom: 24px !important;
        }
        .pagedjs_pagebox,
        .pagedjs_area,
        .pagedjs_page_content,
        .pagedjs_margin,
        .pagedjs_margin-content,
        .pagedjs_sheet {
          background: #fff !important;
          color: #000 !important;
        }
        .pagedjs_page section,
        .pagedjs_page div,
        .pagedjs_page p,
        .pagedjs_page span,
        .pagedjs_page h1,
        .pagedjs_page h2,
        .pagedjs_page h3 {
          background: transparent !important;
          color: #000 !important;
        }
        @media print {
          html, body {
            background: #fff !important;
            color: #000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .pagedjs_pages {
            padding: 0 !important;
            background: #fff !important;
          }
          .pagedjs_page {
            box-shadow: none !important;
            margin: 0 !important;
            background: #fff !important;
            color: #000 !important;
          }
          .pagedjs_pagebox,
          .pagedjs_area,
          .pagedjs_page_content,
          .pagedjs_sheet {
            background: #fff !important;
            color: #000 !important;
          }
        }
      `;
      document.head.appendChild(styleEl);
      styleRef.current = styleEl;

      // Run Paged.js
      const previewer = new Previewer();
      await previewer.preview(
        sourceContainer,
        [{ textContent: styleContent }],
        previewRef.current
      );

      setIsLoading(false);
    } catch (err) {
      console.error("PDF preview error:", err);
      setError(err instanceof Error ? err.message : "Failed to generate preview");
      setIsLoading(false);
    }
  }, [book, chapters, options, isOpen, cleanup]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(renderPreview, 200);
      return () => {
        clearTimeout(timer);
        cleanup();
      };
    }
    return cleanup;
  }, [isOpen, renderPreview, cleanup]);

  const handlePrint = useCallback(() => {
    // Add class to body to hide everything except the PDF preview when printing
    document.body.classList.add("pdf-print-mode");

    // Remove the class after printing (whether completed or cancelled)
    const handleAfterPrint = () => {
      document.body.classList.remove("pdf-print-mode");
      window.removeEventListener("afterprint", handleAfterPrint);
    };
    window.addEventListener("afterprint", handleAfterPrint);

    window.print();
  }, []);

  const handlePageSizeChange = useCallback((size: PageSize) => {
    setOptions((prev) => ({ ...prev, pageSize: size }));
  }, []);

  if (!isOpen) return null;

  return createPortal(
    <div className="pdf-preview-overlay fixed inset-0 z-50 bg-background flex flex-col">
      <div className="h-14 border-b border-border flex items-center px-4 gap-4 bg-surface print:hidden">
        <Button variant="ghost" onClick={onClose}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Button>
        <h1 className="font-medium flex-1">PDF Preview: {book.title}</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground w-max whitespace-nowrap">Page Size:</label>
          <div className="w-40">
            <Select
              value={options.pageSize}
              onChange={(value) => handlePageSizeChange(value as PageSize)}
              options={Object.entries(PAGE_SIZES).map(([value, { label }]) => ({
                value: value as PageSize,
                label,
              }))}
            />
          </div>
        </div>
        <Button variant="primary" onClick={handlePrint} disabled={isLoading}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print / Save as PDF
        </Button>
      </div>

      {/* Print instructions tooltip */}
      <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/30 border-t border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200 print:hidden">
        <strong>Tip:</strong> In the print dialog, select "Save as PDF" as the destination.
        Make sure to set paper size to <strong>{PAGE_SIZES[options.pageSize].label}</strong> and
        enable "Background graphics" for best results. Set margins to "None" or "Minimum".
      </div>

      <div className="flex-1 overflow-auto bg-neutral-200 dark:bg-neutral-800 print:bg-white print:overflow-visible">
        {isLoading && (
          <div className="flex items-center justify-center h-full print:hidden">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-muted-foreground">Generating preview...</p>
            </div>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full print:hidden">
            <div className="text-center text-red-500">
              <p className="font-medium">Error</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}
        <div
          ref={previewRef}
          className={`pdf-preview-container mx-auto print:m-0 ${isLoading ? "opacity-0" : ""}`}
          style={{ position: "relative", minHeight: "100%" }}
        />
      </div>

      <style>{`
        @media print {
          /* Hide everything in the body except the PDF preview */
          body.pdf-print-mode > *:not(.pdf-preview-overlay) {
            display: none !important;
          }
          body.pdf-print-mode #root {
            display: none !important;
          }
          /* Make the PDF preview the only visible element */
          body.pdf-print-mode .pdf-preview-overlay {
            position: static !important;
            display: block !important;
          }
          html, body {
            background: #fff !important;
            color: #000 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print\\:hidden { display: none !important; }
          .pdf-preview-container {
            position: static !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .pagedjs_pages {
            display: block !important;
            background: #fff !important;
            padding: 0 !important;
          }
          .pagedjs_page {
            display: block !important;
            background: #fff !important;
            color: #000 !important;
            box-shadow: none !important;
            margin: 0 !important;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
