import { getDatabase } from "@/lib/db";
import { useBookStore } from "@/features/books/store";
import { useChapterStore } from "@/features/chapters/store";
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
}): Promise<{ bookId: string }> {
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

    return { bookId: book.id };
  } catch (error) {
    if (createdBookId) {
      await cleanupPartialImport(createdBookId);
    }
    throw error;
  }
}

async function cleanupPartialImport(bookId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM chapter_epub_meta WHERE book_id = ?", [bookId]).catch(() => {});
  await db.execute("DELETE FROM epub_structures WHERE book_id = ?", [bookId]).catch(() => {});
  await db.execute("DELETE FROM book_styles WHERE book_id = ?", [bookId]).catch(() => {});
  await db.execute("DELETE FROM book_metadata WHERE book_id = ?", [bookId]).catch(() => {});
  await db.execute("DELETE FROM project_assets WHERE book_id = ?", [bookId]).catch(() => {});
  await db.execute("DELETE FROM chapters WHERE book_id = ?", [bookId]).catch(() => {});
  await db.execute("DELETE FROM books WHERE id = ?", [bookId]).catch(() => {});
}
