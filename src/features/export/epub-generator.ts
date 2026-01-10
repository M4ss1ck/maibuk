/**
 * EPUB Generator Service
 *
 * Generates EPUB files from book and chapter data using epub-gen-memory.
 */
import epub from "epub-gen-memory/bundle";
import type { Options, Chapter as EpubChapter } from "epub-gen-memory";
import type { Book } from "../books/types";
import type { Chapter } from "../chapters/types";
import type { EpubExportOptions } from "./types";
import { processChapterHtml } from "./html-sanitizer";
import { EPUB_STYLES } from "./epub-styles";

/**
 * Generates an EPUB file from book data.
 * Returns a Blob that can be saved to file.
 */
export async function generateEpub(
  book: Book,
  chapters: Chapter[],
  options: EpubExportOptions,
  onProgress?: (message: string) => void
): Promise<Blob> {
  onProgress?.("Preparing chapters...");

  // Filter and sort chapters for export
  const exportChapters = chapters
    .filter((ch) => ch.isIncludedInExport)
    .sort((a, b) => a.order - b.order);

  if (exportChapters.length === 0) {
    throw new Error("No chapters selected for export");
  }

  onProgress?.("Processing chapter content...");

  // Convert chapters to epub-gen-memory format
  const epubChapters: EpubChapter[] = exportChapters.map((chapter, index) => {
    const content = chapter.content ? processChapterHtml(chapter.content) : "";

    // Determine if chapter should be before TOC (frontmatter)
    const beforeToc = chapter.chapterType === "frontmatter";

    // Generate chapter title based on type and options
    let title = chapter.title;
    if (options.numberChapters && chapter.chapterType === "chapter") {
      // Find the chapter number (counting only "chapter" type)
      const chapterNumber =
        exportChapters
          .filter((ch) => ch.chapterType === "chapter")
          .findIndex((ch) => ch.id === chapter.id) + 1;
      if (chapterNumber > 0) {
        title = `Chapter ${chapterNumber}: ${chapter.title}`;
      }
    }

    return {
      title,
      content: content || "<p></p>",
      beforeToc,
      filename: `chapter-${index + 1}.xhtml`,
    };
  });

  onProgress?.("Building EPUB metadata...");

  // Build cover image data if available
  // epub-gen-memory accepts string (URL) or File object
  let cover: string | File | undefined;
  if (book.coverImagePath) {
    // If it's a data URL (base64), convert to File object
    if (book.coverImagePath.startsWith("data:")) {
      try {
        const response = await fetch(book.coverImagePath);
        const blob = await response.blob();
        cover = new File([blob], "cover.png", { type: blob.type });
      } catch (error) {
        console.warn("Failed to process cover image:", error);
        cover = undefined;
      }
    } else {
      // For external URLs, pass directly (epub-gen-memory will fetch)
      cover = book.coverImagePath;
    }
  }

  // Add cover page as first chapter if cover exists
  if (book.coverImagePath) {
    const coverHtml = `<div class="cover"><img src="${book.coverImagePath}" alt="Cover" class="cover-image" /></div>`;
    epubChapters.unshift({
      title: "", // Empty title to prevent title page
      content: coverHtml,
      filename: "cover.xhtml",
      excludeFromToc: true,
    });
  }

  // Build EPUB options
  const epubOptions: Options = {
    title: book.title,
    author: book.authorName || "Unknown Author",
    description: book.description,
    lang: book.language || "en",
    cover,
    tocTitle: "Table of Contents",
    tocInTOC: options.includeTableOfContents,
    numberChaptersInTOC: false, // We handle numbering ourselves
    prependChapterTitles: options.prependChapterTitles,
    css: EPUB_STYLES,
    version: 3,
    verbose: false,
  };

  onProgress?.("Generating EPUB file...");

  // Generate the EPUB
  const epubBlob = await epub(epubOptions, epubChapters);

  onProgress?.("EPUB generated successfully!");

  return epubBlob;
}

/**
 * Gets the suggested filename for the EPUB export.
 */
export function getEpubFilename(book: Book): string {
  // Sanitize title for filename
  const sanitizedTitle = book.title
    .replace(/[<>:"/\\|?*]/g, "") // Remove invalid characters
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .substring(0, 100); // Limit length

  return `${sanitizedTitle}.epub`;
}
