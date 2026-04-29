/**
 * React-PDF Document component for PDF export.
 *
 * Renders a complete book as a multi-page PDF using @react-pdf/renderer.
 */
import { createElement, cloneElement, type ReactNode } from "react";
import { Document, Page, View, Text, Image, Link } from "@react-pdf/renderer";
import type { Book } from "../books/types";
import type { Chapter } from "../chapters/types";
import type { PdfExportOptions } from "./types";
import { createPdfStyles } from "./pdf-styles";
import { processChapterHtml } from "./html-sanitizer";
import { renderHtmlContent } from "./pdf-content-renderer";

export interface PdfDocumentProps {
  book: Book;
  chapters: Chapter[];
  options: PdfExportOptions;
}

export function PdfDocument({ book, chapters, options }: PdfDocumentProps) {
  const styles = createPdfStyles(options);

  // Chapters that have chapterType === "chapter" only (for numbering)
  const chapterTypeOnly = chapters.filter((ch) => ch.chapterType === "chapter");

  return createElement(
    Document,
    {
      title: book.title,
      author: book.authorName,
      language: book.language || "en",
    },

    // ---- Cover page (no margins, full bleed) ----
    createElement(
      Page,
      { size: options.pageSize, style: styles.coverPage },
      renderCover(book, styles)
    ),

    // ---- Content pages (margins, page numbers, flowing content) ----
    createElement(
      Page,
      {
        size: options.pageSize,
        style: styles.contentPage,
        wrap: true,
      },

      // Table of Contents
      ...(options.includeTableOfContents ? [renderToc(chapters, styles)] : []),

      // Chapters
      ...chapters.map((chapter, index) =>
        renderChapter(
          chapter,
          index,
          chapterTypeOnly,
          options,
          styles,
          // Add page break before each chapter (and after TOC)
          index > 0 || options.includeTableOfContents
        )
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

function renderCover(book: Book, styles: ReturnType<typeof createPdfStyles>) {
  if (book.coverImagePath) {
    return createElement(Image, {
      src: book.coverImagePath,
      style: styles.coverImage,
    });
  }

  // Text-only cover
  const children: ReactNode[] = [
    createElement(Text, { key: "title", style: styles.coverTitle }, book.title),
  ];

  if (book.subtitle) {
    children.push(
      createElement(Text, { key: "subtitle", style: styles.coverSubtitle }, book.subtitle)
    );
  }

  children.push(createElement(Text, { key: "author", style: styles.coverAuthor }, book.authorName));

  return createElement(View, null, ...children);
}

// ---------------------------------------------------------------------------
// Table of Contents
// ---------------------------------------------------------------------------

function renderToc(chapters: Chapter[], styles: ReturnType<typeof createPdfStyles>) {
  const tocChapters = chapters.filter((ch) => ch.chapterType !== "frontmatter");

  const entries = tocChapters.map((ch, i) =>
    createElement(
      View,
      { key: `toc-${i}`, style: styles.tocEntry },
      createElement(
        Link,
        { src: `#chapter-${chapters.indexOf(ch)}`, style: styles.tocLink },
        createElement(Text, null, ch.title)
      )
    )
  );

  return createElement(
    View,
    { key: "toc", style: styles.tocContainer },
    createElement(Text, { key: "toc-title", style: styles.tocTitle }, "Table of Contents"),
    ...entries
  );
}

// ---------------------------------------------------------------------------
// Chapter
// ---------------------------------------------------------------------------

function renderChapter(
  chapter: Chapter,
  index: number,
  chapterTypeOnly: Chapter[],
  options: PdfExportOptions,
  styles: ReturnType<typeof createPdfStyles>,
  addBreak: boolean
) {
  const content = chapter.content ? processChapterHtml(chapter.content) : "<p></p>";

  const contentNodes = renderHtmlContent(content, styles);

  // Chapter number (only for "chapter" type when numbering is enabled)
  const chapterNumber =
    options.numberChapters && chapter.chapterType === "chapter"
      ? chapterTypeOnly.findIndex((ch) => ch.id === chapter.id) + 1
      : null;

  // Re-key content nodes so they don't collide with the header sibling
  const keyedContent = contentNodes.map((node, i) => {
    if (node && typeof node === "object" && "type" in node) {
      return cloneElement(node as React.ReactElement, { key: `content-${i}` });
    }
    return node;
  });

  return createElement(
    View,
    {
      key: `chapter-${index}`,
      id: `chapter-${index}`,
      break: addBreak,
    },

    // Chapter header
    createElement(
      View,
      { key: "header", style: styles.chapterHeader, minPresenceAhead: 100 },

      // Chapter number label
      ...(chapterNumber !== null
        ? [
            createElement(
              Text,
              { key: "ch-num", style: styles.chapterNumber },
              `Chapter ${chapterNumber}`
            ),
          ]
        : []),

      // Chapter title
      createElement(Text, { key: "ch-title", style: styles.chapterTitle }, chapter.title)
    ),

    // Chapter content
    ...keyedContent
  );
}
