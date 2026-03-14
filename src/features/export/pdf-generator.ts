/**
 * PDF Generator Service
 *
 * Generates PDF files from book and chapter data using @react-pdf/renderer.
 * Returns a Blob that can be saved directly to disk — no browser print dialog.
 *
 * Workarounds for react-pdf 4.3.x bugs:
 * - lineHeight uses unitless ratios (react-pdf multiplies by fontSize internally)
 * - Page numbers stamped post-render via pdf-lib instead of render callback
 * - Text sanitized to remove control chars / unpaired surrogates
 * - Hyphenation callback registered to chunk long words
 */
import { createElement } from "react";
import { pdf, Font } from "@react-pdf/renderer";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Book } from "../books/types";
import type { Chapter } from "../chapters/types";
import type { PdfExportOptions } from "./types";
import { PdfDocument } from "./pdf-document";
import { getMargins } from "./pdf-styles";

// ---------------------------------------------------------------------------
// Text sanitisation — prevents pdfkit coordinate overflow on malformed text
// ---------------------------------------------------------------------------

/**
 * Strips control characters (except \n \r \t) and unpaired UTF-16 surrogates
 * that can produce NaN / Infinity in pdfkit glyph metrics.
 */
export function sanitizePdfText(text: string): string {
  // Remove control chars (C0/C1) except \t \n \r
  // eslint-disable-next-line no-control-regex
  let clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
  // Remove unpaired surrogates
  clean = clean.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "");
  clean = clean.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  return clean;
}

// ---------------------------------------------------------------------------
// Hyphenation callback — chunks very long words to prevent coordinate overflow
// ---------------------------------------------------------------------------

const MAX_WORD_LEN = 28;
const CHUNK_SIZE = 16;

function hyphenateWord(word: string): string[] {
  if (word.length <= MAX_WORD_LEN) return [word];
  const parts: string[] = [];
  for (let i = 0; i < word.length; i += CHUNK_SIZE) {
    parts.push(word.slice(i, i + CHUNK_SIZE));
  }
  return parts;
}

let hyphenationRegistered = false;

function ensureHyphenation() {
  if (hyphenationRegistered) return;
  Font.registerHyphenationCallback(hyphenateWord);
  hyphenationRegistered = true;
}

// ---------------------------------------------------------------------------
// pdf-lib page number stamping (avoids react-pdf render callback bug)
// ---------------------------------------------------------------------------

async function stampPageNumbers(
  rawBlob: Blob,
  options: PdfExportOptions,
  skipFirstPage: boolean
): Promise<Blob> {
  const bytes = new Uint8Array(await rawBlob.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const margins = getMargins(options.margins);
  const fontSize = 10;
  const pages = pdfDoc.getPages();

  const startIndex = skipFirstPage ? 1 : 0;

  for (let i = startIndex; i < pages.length; i++) {
    const page = pages[i];
    const { width } = page.getSize();
    // Display page number relative to content pages (skip cover)
    const displayNumber = skipFirstPage ? i : i + 1;
    const text = String(displayNumber);
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: margins.bottom * 0.45,
      size: fontSize,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  const stampedBytes = await pdfDoc.save();
  return new Blob([stampedBytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

/**
 * Generates a PDF file from book data.
 * Returns a Blob that can be saved to file.
 */
export async function generatePdf(
  book: Book,
  chapters: Chapter[],
  options: PdfExportOptions,
  onProgress?: (message: string) => void
): Promise<Blob> {
  ensureHyphenation();

  onProgress?.("Preparing chapters...");

  // Filter and sort chapters for export
  const exportChapters = chapters
    .filter((ch) => ch.isIncludedInExport)
    .sort((a, b) => a.order - b.order);

  if (exportChapters.length === 0) {
    throw new Error("No chapters selected for export");
  }

  // Sanitise text fields to prevent pdfkit coordinate overflow
  const sanitizedBook: Book = {
    ...book,
    title: sanitizePdfText(book.title),
    authorName: sanitizePdfText(book.authorName),
    subtitle: book.subtitle ? sanitizePdfText(book.subtitle) : book.subtitle,
  };

  onProgress?.("Generating PDF document...");

  const element = createElement(PdfDocument, {
    book: sanitizedBook,
    chapters: exportChapters,
    options,
  });

  // PdfDocument returns a <Document> element — safe cast for pdf() type constraint
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let blob = await pdf(element as any).toBlob();

  // Stamp page numbers post-render to avoid the react-pdf render callback bug
  if (options.includePageNumbers) {
    onProgress?.("Adding page numbers...");
    blob = await stampPageNumbers(blob, options, /* skipFirstPage (cover) */ true);
  }

  onProgress?.("PDF generated successfully!");

  return blob;
}

/**
 * Gets the suggested filename for the PDF export.
 */
export function getPdfFilename(book: Book): string {
  const sanitizedTitle = book.title
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 100);

  return `${sanitizedTitle}.pdf`;
}
