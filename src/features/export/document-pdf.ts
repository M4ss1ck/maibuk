/**
 * Generates a standalone PDF from a single chapter or note.
 *
 * Reuses the book-export PDF pipeline (react-pdf styles + HTML content
 * renderer) so a single document exports with the same typography as a full
 * book, but without cover, table of contents, or chapter numbering.
 */
import { createElement } from "react";
import { pdf, Font, Document, Page, Text, View } from "@react-pdf/renderer";
import { createPdfStyles } from "./pdf-styles";
import { processChapterHtml } from "./html-sanitizer";
import { renderHtmlContent } from "./pdf-content-renderer";
import { sanitizePdfText } from "./pdf-generator";
import { DEFAULT_PDF_OPTIONS } from "./types";

const MAX_WORD_LEN = 28;
const CHUNK_SIZE = 16;
let hyphenationRegistered = false;

function ensureHyphenation() {
  if (hyphenationRegistered) return;
  Font.registerHyphenationCallback((word) => {
    if (word.length <= MAX_WORD_LEN) return [word];
    const parts: string[] = [];
    for (let i = 0; i < word.length; i += CHUNK_SIZE) {
      parts.push(word.slice(i, i + CHUNK_SIZE));
    }
    return parts;
  });
  hyphenationRegistered = true;
}

/**
 * Builds a PDF Blob from a single document's HTML. A centered title is
 * rendered as a header when provided.
 */
export async function generateDocumentPdf(html: string, title: string): Promise<Blob> {
  ensureHyphenation();

  const options = DEFAULT_PDF_OPTIONS;
  const styles = createPdfStyles(options);
  const content = renderHtmlContent(processChapterHtml(html), styles);
  const safeTitle = sanitizePdfText(title).trim();

  const element = createElement(
    Document,
    { title: safeTitle || undefined },
    createElement(
      Page,
      { size: options.pageSize, style: styles.contentPage, wrap: true },
      safeTitle
        ? createElement(
            View,
            { style: styles.chapterHeader },
            createElement(Text, { style: styles.chapterTitle }, safeTitle)
          )
        : null,
      ...content
    )
  );

  return pdf(element).toBlob();
}
