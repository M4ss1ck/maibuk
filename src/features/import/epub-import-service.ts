import { useBookStore } from "@/features/books/store";
import { useChapterStore } from "@/features/chapters/store";
import { fetchStoredBook, removeBookRow } from "@/features/books/write";
import { fetchStoredChapters } from "@/features/chapters/write";
import { refreshViewsForLocalRestore } from "@/features/sync/view-refresh";
import {
  insertBookMetadata,
  insertBookStyles,
  insertChapterEpubMeta,
  insertEpubStructure,
} from "@/features/import/epub-project-repo";
import { readEpub } from "@/features/import/epub-reader";
import { scanEpub, buildImportPreview } from "@/features/import/epub-scanner";
import { normalizeEpubProject } from "@/features/import/epub-normalizer";
import { insertProjectAssets } from "@/features/import/project-assets-repo";
import { rewriteImportedInternalLinks } from "@/features/import/internal-link-rewrite";
import type { CompatibilityReport, ImportPreview } from "@/features/import/types";
import { canImport, requiresAcknowledgement } from "@/features/import/types";
import type { Book } from "@/features/books/types";
import type { Chapter } from "@/features/chapters/types";

export async function scanEpubForImport(
  bytes: Uint8Array
): Promise<{ report: CompatibilityReport; preview: ImportPreview }> {
  const report = scanEpub(bytes);
  const parsed = readEpub(bytes);
  return {
    report,
    preview: buildImportPreview(parsed),
  };
}

export async function importEpubProject(input: {
  bytes: Uint8Array;
  acknowledged: boolean;
}): Promise<{ bookId: string; book: Book; chapters: Chapter[] }> {
  const report = scanEpub(input.bytes);

  if (!canImport(report)) {
    throw new Error("EPUB cannot be imported because it has blocking compatibility issues.");
  }

  if (requiresAcknowledgement(report) && !input.acknowledged) {
    throw new Error("EPUB import requires acknowledgement of compatibility warnings.");
  }

  const parsed = readEpub(input.bytes);
  const normalized = normalizeEpubProject(parsed);
  let createdBookId: string | null = null;

  try {
    const { language, ...createBookInput } = normalized.bookInput;
    const book = await useBookStore.getState().createBook(createBookInput);
    createdBookId = book.id;

    if (language) {
      await useBookStore.getState().updateBook(book.id, { language });
    }

    const chapterMappings = [];
    for (const chapterInput of normalized.chapters) {
      const chapter = await useChapterStore.getState().createChapter({
        bookId: book.id,
        title: chapterInput.title,
      });
      await useChapterStore.getState().updateChapter(chapter.id, {
        content: chapterInput.content,
      });
      chapterMappings.push({
        chapterId: chapter.id,
        bookId: book.id,
        href: chapterInput.href,
        mediaType: chapterInput.mediaType,
        navTitle: chapterInput.navTitle,
        spineIndex: chapterInput.spineIndex,
        linear: chapterInput.linear,
        capabilities: chapterInput.capabilities,
      });
    }

    const importedChapters = chapterMappings.map((m, idx) => ({
      chapterId: m.chapterId,
      href: m.href,
      content: normalized.chapters[idx].content,
    }));
    const rewritten = rewriteImportedInternalLinks(importedChapters);
    for (const c of rewritten) {
      const original = importedChapters.find((x) => x.chapterId === c.chapterId);
      if (original && original.content !== c.content) {
        await useChapterStore.getState().updateChapter(c.chapterId, { content: c.content });
      }
    }

    await insertProjectAssets(book.id, normalized.assets);
    await insertBookMetadata(book.id, normalized.metadata);
    await insertBookStyles(book.id, normalized.styles);
    await insertEpubStructure(book.id, {
      ...normalized.structure,
      compatibility: report,
    });
    await insertChapterEpubMeta(chapterMappings);

    // Return the rows as stored, after normalization and the link rewrite.
    const storedBook = await fetchStoredBook(book.id);
    if (!storedBook) throw new Error(`Book not found after import: ${book.id}`);
    const storedChapters = await fetchStoredChapters(book.id);
    return { bookId: book.id, book: storedBook, chapters: storedChapters };
  } catch (error) {
    if (createdBookId) {
      await cleanupPartialImport(createdBookId);
    }
    throw error;
  }
}

/**
 * Remove a half-imported book through the shared book removal path (no
 * tombstone: a failed import was never synced) and refresh the views so no
 * phantom book lingers. Best-effort: the original import error takes
 * precedence.
 */
async function cleanupPartialImport(bookId: string): Promise<void> {
  try {
    await removeBookRow(bookId, "remote");
  } catch {
    // The import already failed; a cleanup failure must not mask it.
  }
  try {
    await refreshViewsForLocalRestore(bookId);
  } catch {
    // View refresh is best-effort during cleanup.
  }
}
