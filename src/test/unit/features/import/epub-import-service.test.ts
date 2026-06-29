import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBuildImportPreview,
  mockCreateBook,
  mockCreateChapter,
  mockDeleteExecute,
  mockGetDatabase,
  mockInsertBookMetadata,
  mockInsertBookStyles,
  mockInsertChapterEpubMeta,
  mockInsertEpubStructure,
  mockInsertProjectAssets,
  mockNormalizeEpubProject,
  mockReadEpub,
  mockScanEpub,
  mockUpdateBook,
  mockUpdateChapter,
} = vi.hoisted(() => ({
  mockBuildImportPreview: vi.fn(),
  mockCreateBook: vi.fn(),
  mockCreateChapter: vi.fn(),
  mockDeleteExecute: vi.fn(),
  mockGetDatabase: vi.fn(),
  mockInsertBookMetadata: vi.fn(),
  mockInsertBookStyles: vi.fn(),
  mockInsertChapterEpubMeta: vi.fn(),
  mockInsertEpubStructure: vi.fn(),
  mockInsertProjectAssets: vi.fn(),
  mockNormalizeEpubProject: vi.fn(),
  mockReadEpub: vi.fn(),
  mockScanEpub: vi.fn(),
  mockUpdateBook: vi.fn(),
  mockUpdateChapter: vi.fn(),
}));

vi.mock("../../../../features/import/epub-scanner", () => ({
  buildImportPreview: mockBuildImportPreview,
  scanEpub: mockScanEpub,
}));
vi.mock("../../../../features/import/epub-reader", () => ({ readEpub: mockReadEpub }));
vi.mock("../../../../features/import/epub-normalizer", () => ({
  normalizeEpubProject: mockNormalizeEpubProject,
}));
vi.mock("../../../../features/import/project-assets-repo", () => ({
  insertProjectAssets: mockInsertProjectAssets,
}));
vi.mock("../../../../features/import/epub-project-repo", () => ({
  insertBookMetadata: mockInsertBookMetadata,
  insertBookStyles: mockInsertBookStyles,
  insertChapterEpubMeta: mockInsertChapterEpubMeta,
  insertEpubStructure: mockInsertEpubStructure,
}));
vi.mock("../../../../features/books/store", () => ({
  useBookStore: {
    getState: () => ({ createBook: mockCreateBook, updateBook: mockUpdateBook }),
  },
}));
vi.mock("../../../../features/chapters/store", () => ({
  useChapterStore: {
    getState: () => ({ createChapter: mockCreateChapter, updateChapter: mockUpdateChapter }),
  },
}));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const { importEpubProject, scanEpubForImport } = await import(
  "@/features/import/epub-import-service"
);

const cleanReport = {
  issues: [],
  summary: { blocking: 0, lossy: 0, converted: 0, info: 0 },
};

const lossyReport = {
  issues: [{ severity: "lossy" as const, code: "unsupported-media", message: "Lossy" }],
  summary: { blocking: 0, lossy: 1, converted: 0, info: 0 },
};

const blockingReport = {
  issues: [{ severity: "blocking" as const, code: "encrypted-epub", message: "Encrypted" }],
  summary: { blocking: 1, lossy: 0, converted: 0, info: 0 },
};

const parsed = {
  packagePath: "EPUB/package.opf",
  epubVersion: "3.0",
  metadata: [],
  resources: [],
  spine: [],
  nav: [],
  issues: [],
};

const normalized = {
  bookInput: {
    title: "Imported Book",
    authorName: "Author",
    description: "Description",
    language: "es",
  },
  chapters: [
    {
      title: "Chapter One",
      content: "<p>One</p>",
      href: "EPUB/chapter-1.xhtml",
      mediaType: "application/xhtml+xml",
      navTitle: "Chapter One",
      spineIndex: 0,
      linear: true,
      capabilities: { images: false },
    },
  ],
  assets: [{ filename: "cover.png", href: "EPUB/cover.png", mediaType: "image/png" }],
  metadata: [{ key: "title", value: "Imported Book", attributes: {}, order: 0 }],
  styles: [{ name: "book.css", css: "body {}", sourceHref: "EPUB/book.css", isDefault: true }],
  structure: {
    epubVersion: "3.0",
    packagePath: "EPUB/package.opf",
    manifest: [],
    spine: [],
    nav: [],
  },
};

describe("EPUB import service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanEpub.mockReturnValue(cleanReport);
    mockReadEpub.mockReturnValue(parsed);
    mockBuildImportPreview.mockReturnValue({
      title: "Imported Book",
      chapterCount: 1,
      assetCount: 1,
      styleCount: 1,
      metadataCount: 1,
    });
    mockNormalizeEpubProject.mockReturnValue(normalized);
    mockCreateBook.mockResolvedValue({ id: "book-1", title: "Imported Book" });
    mockUpdateBook.mockResolvedValue(undefined);
    mockCreateChapter.mockResolvedValue({
      id: "chapter-1",
      bookId: "book-1",
      title: "Chapter One",
    });
    mockUpdateChapter.mockResolvedValue(undefined);
    mockInsertProjectAssets.mockResolvedValue([]);
    mockInsertBookMetadata.mockResolvedValue(undefined);
    mockInsertBookStyles.mockResolvedValue(undefined);
    mockInsertEpubStructure.mockResolvedValue(undefined);
    mockInsertChapterEpubMeta.mockResolvedValue(undefined);
    mockDeleteExecute.mockResolvedValue({ rowsAffected: 0 });
    mockGetDatabase.mockResolvedValue({ execute: mockDeleteExecute });
  });

  it("scans without writing to the database", async () => {
    const result = await scanEpubForImport(new Uint8Array([1, 2, 3]));

    expect(result).toEqual({
      report: cleanReport,
      preview: {
        title: "Imported Book",
        chapterCount: 1,
        assetCount: 1,
        styleCount: 1,
        metadataCount: 1,
      },
    });
    expect(mockCreateBook).not.toHaveBeenCalled();
    expect(mockInsertProjectAssets).not.toHaveBeenCalled();
  });

  it("prevents import when the compatibility report has blocking issues", async () => {
    mockScanEpub.mockReturnValue(blockingReport);

    await expect(
      importEpubProject({ bytes: new Uint8Array([1]), acknowledged: true })
    ).rejects.toThrow("EPUB cannot be imported because it has blocking compatibility issues.");

    expect(mockCreateBook).not.toHaveBeenCalled();
  });

  it("requires acknowledgement for lossy compatibility reports", async () => {
    mockScanEpub.mockReturnValue(lossyReport);

    await expect(
      importEpubProject({ bytes: new Uint8Array([1]), acknowledged: false })
    ).rejects.toThrow("EPUB import requires acknowledgement of compatibility warnings.");

    expect(mockCreateBook).not.toHaveBeenCalled();
  });

  it("creates book, chapters, assets, metadata, styles, structure, and chapter mappings", async () => {
    mockScanEpub.mockReturnValue(lossyReport);

    const result = await importEpubProject({ bytes: new Uint8Array([1]), acknowledged: true });

    expect(result).toEqual({ bookId: "book-1" });
    expect(mockCreateBook).toHaveBeenCalledWith({
      title: "Imported Book",
      authorName: "Author",
      description: "Description",
    });
    expect(mockUpdateBook).toHaveBeenCalledWith("book-1", { language: "es" });
    expect(mockCreateChapter).toHaveBeenCalledWith({ bookId: "book-1", title: "Chapter One" });
    expect(mockUpdateChapter).toHaveBeenCalledWith("chapter-1", { content: "<p>One</p>" });
    expect(mockInsertProjectAssets).toHaveBeenCalledWith("book-1", normalized.assets);
    expect(mockInsertBookMetadata).toHaveBeenCalledWith("book-1", normalized.metadata);
    expect(mockInsertBookStyles).toHaveBeenCalledWith("book-1", normalized.styles);
    expect(mockInsertEpubStructure).toHaveBeenCalledWith("book-1", {
      ...normalized.structure,
      compatibility: lossyReport,
    });
    expect(mockInsertChapterEpubMeta).toHaveBeenCalledWith([
      {
        chapterId: "chapter-1",
        bookId: "book-1",
        href: "EPUB/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        navTitle: "Chapter One",
        spineIndex: 0,
        linear: true,
        capabilities: { images: false },
      },
    ]);
  });

  it("cleans up partially created rows when persistence fails after book creation", async () => {
    mockInsertBookStyles.mockRejectedValue(new Error("style write failed"));

    await expect(
      importEpubProject({ bytes: new Uint8Array([1]), acknowledged: true })
    ).rejects.toThrow("style write failed");

    expect(mockDeleteExecute).toHaveBeenCalledWith(
      "DELETE FROM chapter_epub_meta WHERE book_id = ?",
      ["book-1"]
    );
    expect(mockDeleteExecute).toHaveBeenCalledWith("DELETE FROM chapters WHERE book_id = ?", [
      "book-1",
    ]);
    expect(mockDeleteExecute).toHaveBeenCalledWith("DELETE FROM books WHERE id = ?", ["book-1"]);
  });
});
