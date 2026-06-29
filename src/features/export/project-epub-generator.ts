import type { Book } from "@/features/books/types";
import type { Chapter } from "@/features/chapters/types";
import type { BookMetadata, BookStyle } from "@/features/import/epub-project-repo";
import type { ProjectAsset } from "@/features/import/project-assets-repo";
import { processChapterHtml } from "@/features/export/html-sanitizer";
import { EPUB_STYLES } from "@/features/export/epub-styles";
import { rewriteInternalLinksForExport } from "@/features/export/internal-link-export";

export interface ProjectEpubExportOptions {
  includeImportedStyles: boolean;
  useMaibukStyles: boolean;
  generateMaibukToc: boolean;
}

export interface ProjectEpubPackageAsset {
  id: string;
  filename: string;
  path: string;
  mediaType: string;
  dataBase64: string | null;
  textContent: string | null;
}

export interface ProjectEpubPackage {
  title: string;
  author: string;
  language: string;
  metadata: BookMetadata[];
  css: string;
  chapters: { title: string; href: string; content: string }[];
  assets: ProjectEpubPackageAsset[];
  toc: { title: string; href: string }[];
}

interface BuildProjectEpubPackageInput {
  book: Book;
  chapters: Chapter[];
  metadata: BookMetadata[];
  styles: BookStyle[];
  assets: ProjectAsset[];
  options: ProjectEpubExportOptions;
}

export function buildProjectEpubPackage(input: BuildProjectEpubPackageInput): ProjectEpubPackage {
  const exportChapters = input.chapters
    .filter((chapter) => chapter.isIncludedInExport)
    .sort((a, b) => a.order - b.order);
  const assetPathById = new Map(
    input.assets.map((asset) => [asset.id, `assets/${sanitizeAssetFilename(asset.filename)}`])
  );
  // Build href map for internal link rewrite.
  const chapterHref = new Map<string, string>();
  exportChapters.forEach((chapter, index) => {
    chapterHref.set(chapter.id, `chapters/chapter-${index + 1}.xhtml`);
  });
  const firstChapterHref = chapterHref.get(exportChapters[0]?.id) ?? "chapters/chapter-1.xhtml";

  const chapters = exportChapters.map((chapter, index) => {
    const href = `chapters/chapter-${index + 1}.xhtml`;
    const rawContent = chapter.content
      ? rewriteInternalLinksForExport(chapter.content, { chapterHref, firstChapterHref })
      : "<p></p>";
    return {
      title: chapter.title,
      href,
      content: rewriteAssetReferences(processChapterHtml(rawContent), assetPathById),
    };
  });
  const cssParts = [];
  if (input.options.useMaibukStyles) {
    cssParts.push(EPUB_STYLES);
  }
  if (input.options.includeImportedStyles) {
    cssParts.push(...input.styles.map((style) => rewriteAssetReferences(style.css, assetPathById)));
  }

  return {
    title: input.book.title,
    author: input.book.authorName || "Unknown Author",
    language: input.book.language || "en",
    metadata: input.metadata,
    css: cssParts.join("\n\n"),
    chapters,
    assets: referencedAssets(input.assets, assetPathById, [
      ...chapters.map((chapter) => chapter.content),
      ...cssParts,
    ]),
    toc: input.options.generateMaibukToc
      ? chapters.map((chapter) => ({ title: chapter.title, href: chapter.href }))
      : [],
  };
}

function rewriteAssetReferences(value: string, assetPathById: Map<string, string>): string {
  return value.replace(/maibuk-asset:([A-Za-z0-9_-]+)/g, (match, assetId: string) => {
    return assetPathById.get(assetId) ?? match;
  });
}

function referencedAssets(
  assets: ProjectAsset[],
  assetPathById: Map<string, string>,
  contentSources: string[]
): ProjectEpubPackageAsset[] {
  return assets
    .filter((asset) => {
      const path = assetPathById.get(asset.id);
      return path ? contentSources.some((source) => source.includes(path)) : false;
    })
    .map((asset) => ({
      id: asset.id,
      filename: asset.filename,
      path: assetPathById.get(asset.id) ?? `assets/${sanitizeAssetFilename(asset.filename)}`,
      mediaType: asset.mediaType,
      dataBase64: asset.dataBase64,
      textContent: asset.textContent,
    }));
}

function sanitizeAssetFilename(filename: string): string {
  return filename.replace(/[<>:"/\\|?*]/g, "_");
}
