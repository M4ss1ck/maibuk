/**
 * PDF Generator Service
 *
 * Generates print-ready HTML document using Paged.js for PDF export.
 */
import type { Book } from "../books/types";
import type { Chapter } from "../chapters/types";
import type { PdfExportOptions } from "./pdf-styles";
import { generatePdfStyles } from "./pdf-styles";
import { processChapterHtml } from "./html-sanitizer";

/**
 * Generates a complete HTML document ready for Paged.js rendering.
 */
export function generatePdfHtml(
  book: Book,
  chapters: Chapter[],
  options: PdfExportOptions
): string {
  // Filter and sort chapters for export
  const exportChapters = chapters
    .filter((ch) => ch.isIncludedInExport)
    .sort((a, b) => a.order - b.order);

  if (exportChapters.length === 0) {
    throw new Error("No chapters selected for export");
  }

  const styles = generatePdfStyles(options);

  // Generate cover page
  const coverHtml = book.coverImagePath
    ? `
      <section class="cover-page">
        <img src="${book.coverImagePath}" alt="Cover" />
      </section>
    `
    : `
      <section class="cover-page">
        <div class="title">${escapeHtml(book.title)}</div>
        ${book.subtitle ? `<div class="subtitle">${escapeHtml(book.subtitle)}</div>` : ""}
        <div class="author">by ${escapeHtml(book.authorName)}</div>
      </section>
    `;

  // Generate table of contents
  let tocHtml = "";
  if (options.includeTableOfContents) {
    const tocEntries = exportChapters
      .filter((ch) => ch.chapterType !== "frontmatter")
      .map((ch, idx) => {
        const displayTitle = getChapterDisplayTitle(ch);
        return `
          <div class="toc-entry">
            <a href="#chapter-${idx}">${escapeHtml(displayTitle)}</a>
            <span class="page-number" href="#chapter-${idx}"></span>
          </div>
        `;
      })
      .join("");

    tocHtml = `
      <section class="toc">
        <h2>Table of Contents</h2>
        ${tocEntries}
      </section>
    `;
  }

  // Generate chapters
  const chaptersHtml = exportChapters
    .map((chapter, index) => {
      const content = chapter.content
        ? processChapterHtml(chapter.content)
        : "<p></p>";
      const displayTitle = getChapterDisplayTitle(chapter);

      return `
        <section class="chapter" id="chapter-${index}">
          <div class="chapter-header">
            ${chapter.chapterType === "chapter" ? `<div class="chapter-number">Chapter ${getChapterNumber(chapter, exportChapters)}</div>` : ""}
            <h1 class="chapter-title">${escapeHtml(displayTitle)}</h1>
          </div>
          <div class="chapter-content">
            ${content}
          </div>
        </section>
      `;
    })
    .join("");

  // Complete HTML document - NO whitespace between body and content
  // to prevent Paged.js from creating empty pages
  return `<!DOCTYPE html>
<html lang="${book.language || "en"}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(book.title)}</title>
<style>${styles}</style>
</head>
<body>${coverHtml.trim()}${tocHtml.trim()}${chaptersHtml.trim()}</body>
</html>`;
}

/**
 * Get display title for a chapter.
 */
function getChapterDisplayTitle(chapter: Chapter): string {
  if (chapter.chapterType === "chapter") {
    return chapter.title;
  }
  // For prologue, epilogue, etc. use the title directly
  return chapter.title;
}

/**
 * Get the chapter number (counting only "chapter" type).
 */
function getChapterNumber(chapter: Chapter, allChapters: Chapter[]): number {
  const chapterTypeOnly = allChapters.filter((ch) => ch.chapterType === "chapter");
  return chapterTypeOnly.findIndex((ch) => ch.id === chapter.id) + 1;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
