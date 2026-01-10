import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui";
import { generatePdfHtml, type PdfExportOptions } from "../../features/export";
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
  const printStyleRef = useRef<HTMLStyleElement | null>(null);
  const [options] = useState<PdfExportOptions>(initialOptions);

  // Generate preview content
  useEffect(() => {
    if (!isOpen || !previewRef.current) return;

    try {
      const html = generatePdfHtml(book, chapters, options);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Extract body content and styles
      const styleContent = doc.querySelector("style")?.textContent || "";
      const bodyContent = doc.body.innerHTML;

      // Add preview-specific styles for visual section separation (scoped to content)
      const previewStyles = `
        /* Preview-only: visual separation between sections */
        .pdf-preview-content .cover-page {
          margin-bottom: 1em;
          min-height: 400px;
        }
        .pdf-preview-content .toc {
          margin-bottom: 1em;
          padding: 2em 0;
        }
        .pdf-preview-content .chapter {
          margin-bottom: 1em;
          padding: 2em 0;
        }
        .pdf-preview-content .chapter-header {
          padding-top: 1em;
        }
        
        /* Preview: page break separators AFTER sections */
        .pdf-preview-content .cover-page::after,
        .pdf-preview-content .toc::after,
        .pdf-preview-content .chapter::after {
          content: "— page break —";
          display: block;
          font-size: 11px;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          text-align: center;
          font-family: system-ui, sans-serif;
          margin-top: 2em;
          padding: 1em 0;
          border-top: 1px dashed #ccc;
          border-bottom: 1px dashed #ccc;
          background: #f9f9f9;
          width: 100%;
        }
        
        /* Last chapter doesn't need separator after */
        .pdf-preview-content .chapter:last-child::after {
          display: none;
        }
      `;

      // Set preview content
      previewRef.current.innerHTML = `
        <style>${styleContent}</style>
        <style>${previewStyles}</style>
        ${bodyContent}
      `;
    } catch (err) {
      console.error("Preview error:", err);
      if (previewRef.current) {
        previewRef.current.innerHTML = `<p class="text-red-500">Error generating preview</p>`;
      }
    }
  }, [isOpen, book, chapters, options]);

  // Setup print styles
  useEffect(() => {
    if (!isOpen) return;

    // Create print styles
    const styleEl = document.createElement("style");
    styleEl.id = "pdf-print-styles";
    styleEl.textContent = `
      @media print {
        /* Hide everything except the print content */
        body > *:not(.pdf-preview-overlay) {
          display: none !important;
        }
        
        /* Hide the preview UI */
        .pdf-preview-toolbar {
          display: none !important;
        }
        
        /* Reset the overlay for printing - make it flow naturally */
        .pdf-preview-overlay {
          position: static !important;
          display: block !important;
          background: transparent !important;
          overflow: visible !important;
          height: auto !important;
        }
        
        .pdf-preview-scroll-area {
          display: block !important;
          overflow: visible !important;
          background: #fff !important;
          padding: 0 !important;
          height: auto !important;
        }
        
        .pdf-preview-content {
          display: block !important;
          max-width: none !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          box-shadow: none !important;
          border-radius: 0 !important;
          background: #fff !important;
          min-height: auto !important;
          height: auto !important;
        }
        
        /* Hide preview-only visual elements (separators) */
        .pdf-preview-content .cover-page::after,
        .pdf-preview-content .toc::after,
        .pdf-preview-content .chapter::after {
          display: none !important;
        }
        
        /* Remove preview decorations */
        .pdf-preview-content .cover-page,
        .pdf-preview-content .toc,
        .pdf-preview-content .chapter {
          margin-bottom: 0 !important;
          min-height: auto !important;
        }
        
        /* Ensure colors and backgrounds print */
        html, body {
          background: #fff !important;
          margin: 0 !important;
          padding: 0 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      }
    `;
    document.head.appendChild(styleEl);
    printStyleRef.current = styleEl;

    return () => {
      if (printStyleRef.current) {
        printStyleRef.current.remove();
        printStyleRef.current = null;
      }
    };
  }, [isOpen]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (!isOpen) return null;

  return createPortal(
    <div className="pdf-preview-overlay fixed inset-0 z-50 bg-background flex flex-col">
      {/* Toolbar */}
      <div className="pdf-preview-toolbar h-14 border-b border-border flex items-center px-4 gap-4 bg-surface">
        <Button variant="ghost" onClick={onClose}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Button>
        <h1 className="font-medium flex-1">PDF Preview: {book.title}</h1>
        <p className="text-sm text-muted-foreground">
          Page layout is determined by your browser's print settings
        </p>
        <Button variant="primary" onClick={handlePrint}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print / Save as PDF
        </Button>
      </div>

      {/* Content preview (scrollable) */}
      <div className="pdf-preview-scroll-area flex-1 overflow-auto bg-neutral-200 dark:bg-neutral-800 p-8">
        <div
          ref={previewRef}
          className="pdf-preview-content max-w-4xl mx-auto bg-white text-black p-12 shadow-lg rounded-lg"
          style={{ minHeight: "100%" }}
        />
      </div>
    </div>,
    document.body
  );
}
