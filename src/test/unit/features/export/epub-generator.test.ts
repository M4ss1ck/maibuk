import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildBook, buildChapter } from "../../../support/fixtures";

// Mock epub-gen-memory before importing the generator
const mockEpub = vi.hoisted(() => vi.fn());
vi.mock("epub-gen-memory/bundle", () => ({
  default: mockEpub,
}));

// Mock processChapterHtml so we can verify it's called without pulling in
// the full sanitizer dependency
const mockProcessChapterHtml = vi.hoisted(() => vi.fn((html: string) => html));
vi.mock("../../../../features/export/html-sanitizer", () => ({
  processChapterHtml: mockProcessChapterHtml,
}));

import { generateEpub, getEpubFilename } from "../../../../features/export/epub-generator";
import type { EpubExportOptions } from "../../../../features/export/types";

const defaultOptions: EpubExportOptions = {
  includeTableOfContents: true,
  numberChapters: false,
  prependChapterTitles: false,
};

describe("getEpubFilename()", () => {
  it("returns title with .epub extension", () => {
    const book = buildBook({ title: "My Book" });
    expect(getEpubFilename(book)).toBe("My_Book.epub");
  });

  it("replaces spaces with underscores", () => {
    const book = buildBook({ title: "A Long Book Title" });
    expect(getEpubFilename(book)).toBe("A_Long_Book_Title.epub");
  });

  it("removes invalid filename characters", () => {
    const book = buildBook({ title: 'Book: A "Story" <Part 1>' });
    const filename = getEpubFilename(book);
    expect(filename).not.toMatch(/[<>:"/\\|?*]/);
    expect(filename).toBe("Book_A_Story_Part_1.epub");
  });

  it("truncates very long titles to 100 characters", () => {
    const longTitle = "A".repeat(150);
    const book = buildBook({ title: longTitle });
    const filename = getEpubFilename(book);
    // 100 chars + ".epub" = 105
    expect(filename.length).toBeLessThanOrEqual(105);
  });

  it("collapses consecutive spaces from removed characters into single underscore", () => {
    const book = buildBook({ title: "Book:  Two  Spaces" });
    const filename = getEpubFilename(book);
    // Colon removed, then \s+ collapses into a single underscore
    expect(filename).toBe("Book_Two_Spaces.epub");
  });
});

describe("generateEpub()", () => {
  beforeEach(() => {
    mockEpub.mockReset();
    mockProcessChapterHtml.mockReset();
    mockProcessChapterHtml.mockImplementation((html: string) => html);
    mockEpub.mockResolvedValue(new Blob(["epub-content"]));
  });

  describe("chapter filtering & sorting", () => {
    it("throws when no chapters are selected for export", async () => {
      const book = buildBook();
      const chapters = [buildChapter({ isIncludedInExport: false })];

      await expect(generateEpub(book, chapters, defaultOptions)).rejects.toThrow(
        "No chapters selected for export"
      );
    });

    it("throws when chapters array is empty", async () => {
      const book = buildBook();

      await expect(generateEpub(book, [], defaultOptions)).rejects.toThrow(
        "No chapters selected for export"
      );
    });

    it("filters out chapters not included in export", async () => {
      const book = buildBook();
      const chapters = [
        buildChapter({ title: "Included", isIncludedInExport: true, order: 1 }),
        buildChapter({ title: "Excluded", isIncludedInExport: false, order: 2 }),
      ];

      await generateEpub(book, chapters, defaultOptions);

      const epubChapters = mockEpub.mock.calls[0][1];
      const titles = epubChapters.map((ch: { title: string }) => ch.title);
      expect(titles).toContain("Included");
      expect(titles).not.toContain("Excluded");
    });

    it("sorts chapters by order", async () => {
      const book = buildBook();
      const chapters = [
        buildChapter({ title: "Second", order: 2 }),
        buildChapter({ title: "First", order: 1 }),
      ];

      await generateEpub(book, chapters, defaultOptions);

      const epubChapters = mockEpub.mock.calls[0][1];
      // Skip cover page if present, check order of content chapters
      const contentChapters = epubChapters.filter((ch: { title: string }) => ch.title !== "");
      expect(contentChapters[0].title).toBe("First");
      expect(contentChapters[1].title).toBe("Second");
    });
  });

  describe("chapter content processing", () => {
    it("processes chapter HTML through processChapterHtml", async () => {
      const book = buildBook();
      const chapters = [buildChapter({ content: "<p>Raw content</p>" })];

      await generateEpub(book, chapters, defaultOptions);

      expect(mockProcessChapterHtml).toHaveBeenCalledWith("<p>Raw content</p>");
    });

    it("uses empty paragraph for null content", async () => {
      const book = buildBook();
      const chapters = [buildChapter({ content: null })];

      await generateEpub(book, chapters, defaultOptions);

      const epubChapters = mockEpub.mock.calls[0][1];
      const contentChapter = epubChapters.find((ch: { title: string }) => ch.title !== "");
      expect(contentChapter.content).toBe("<p></p>");
    });

    it("assigns sequential filenames to chapters", async () => {
      const book = buildBook();
      const chapters = [
        buildChapter({ title: "A", order: 1 }),
        buildChapter({ title: "B", order: 2 }),
      ];

      await generateEpub(book, chapters, defaultOptions);

      const epubChapters = mockEpub.mock.calls[0][1];
      const contentChapters = epubChapters.filter((ch: { title: string }) => ch.title !== "");
      expect(contentChapters[0].filename).toBe("chapter-1.xhtml");
      expect(contentChapters[1].filename).toBe("chapter-2.xhtml");
    });
  });

  describe("chapter types", () => {
    it("marks frontmatter chapters with beforeToc=true", async () => {
      const book = buildBook();
      const chapters = [
        buildChapter({ title: "Preface", chapterType: "frontmatter", order: 1 }),
        buildChapter({ title: "Chapter One", chapterType: "chapter", order: 2 }),
      ];

      await generateEpub(book, chapters, defaultOptions);

      const epubChapters = mockEpub.mock.calls[0][1];
      const contentChapters = epubChapters.filter((ch: { title: string }) => ch.title !== "");
      expect(contentChapters[0].beforeToc).toBe(true);
      expect(contentChapters[1].beforeToc).toBe(false);
    });

    it("does not mark non-frontmatter types with beforeToc", async () => {
      const book = buildBook();
      const chapters = [
        buildChapter({ chapterType: "prologue" }),
        buildChapter({ chapterType: "epilogue", order: 2 }),
        buildChapter({ chapterType: "backmatter", order: 3 }),
      ];

      await generateEpub(book, chapters, defaultOptions);

      const epubChapters = mockEpub.mock.calls[0][1];
      const contentChapters = epubChapters.filter((ch: { title: string }) => ch.title !== "");
      contentChapters.forEach((ch: { beforeToc: boolean }) => {
        expect(ch.beforeToc).toBe(false);
      });
    });
  });

  describe("chapter numbering", () => {
    it("prepends chapter number when numberChapters is enabled", async () => {
      const book = buildBook();
      const chapters = [
        buildChapter({ title: "Opening", chapterType: "chapter", order: 1 }),
        buildChapter({ title: "Rising", chapterType: "chapter", order: 2 }),
      ];
      const options = { ...defaultOptions, numberChapters: true };

      await generateEpub(book, chapters, options);

      const epubChapters = mockEpub.mock.calls[0][1];
      const contentChapters = epubChapters.filter((ch: { title: string }) => ch.title !== "");
      expect(contentChapters[0].title).toBe("Chapter 1: Opening");
      expect(contentChapters[1].title).toBe("Chapter 2: Rising");
    });

    it("numbers only chapter-type, skipping other types", async () => {
      const book = buildBook();
      const chapters = [
        buildChapter({ title: "Prologue", chapterType: "prologue", order: 1 }),
        buildChapter({ title: "Opening", chapterType: "chapter", order: 2 }),
        buildChapter({ title: "Rising", chapterType: "chapter", order: 3 }),
      ];
      const options = { ...defaultOptions, numberChapters: true };

      await generateEpub(book, chapters, options);

      const epubChapters = mockEpub.mock.calls[0][1];
      const contentChapters = epubChapters.filter((ch: { title: string }) => ch.title !== "");
      expect(contentChapters[0].title).toBe("Prologue"); // no number
      expect(contentChapters[1].title).toBe("Chapter 1: Opening");
      expect(contentChapters[2].title).toBe("Chapter 2: Rising");
    });

    it("does not number chapters when option is disabled", async () => {
      const book = buildBook();
      const chapters = [buildChapter({ title: "Opening", chapterType: "chapter" })];

      await generateEpub(book, chapters, defaultOptions);

      const epubChapters = mockEpub.mock.calls[0][1];
      const contentChapter = epubChapters.find((ch: { title: string }) => ch.title !== "");
      expect(contentChapter.title).toBe("Opening");
    });
  });

  describe("cover handling", () => {
    it("prepends a cover chapter when coverImagePath is set", async () => {
      const book = buildBook({ coverImagePath: "https://example.com/cover.jpg" });
      const chapters = [buildChapter()];

      await generateEpub(book, chapters, defaultOptions);

      const epubChapters = mockEpub.mock.calls[0][1];
      expect(epubChapters[0].title).toBe("");
      expect(epubChapters[0].filename).toBe("cover.xhtml");
      expect(epubChapters[0].excludeFromToc).toBe(true);
      expect(epubChapters[0].content).toContain("<img");
    });

    it("does not add cover chapter when coverImagePath is absent", async () => {
      const book = buildBook({ coverImagePath: undefined });
      const chapters = [buildChapter({ title: "First" })];

      await generateEpub(book, chapters, defaultOptions);

      const epubChapters = mockEpub.mock.calls[0][1];
      expect(epubChapters[0].title).toBe("First");
      expect(epubChapters[0].filename).not.toBe("cover.xhtml");
    });

    it("passes external URL as cover to epub options", async () => {
      const book = buildBook({ coverImagePath: "https://example.com/cover.jpg" });
      const chapters = [buildChapter()];

      await generateEpub(book, chapters, defaultOptions);

      const epubOptions = mockEpub.mock.calls[0][0];
      expect(epubOptions.cover).toBe("https://example.com/cover.jpg");
    });
  });

  describe("EPUB metadata", () => {
    it("passes book title and author to epub options", async () => {
      const book = buildBook({ title: "Great Novel", authorName: "Jane Doe" });
      const chapters = [buildChapter()];

      await generateEpub(book, chapters, defaultOptions);

      const epubOptions = mockEpub.mock.calls[0][0];
      expect(epubOptions.title).toBe("Great Novel");
      expect(epubOptions.author).toBe("Jane Doe");
    });

    it("defaults author to 'Unknown Author' when empty", async () => {
      const book = buildBook({ authorName: "" });
      const chapters = [buildChapter()];

      await generateEpub(book, chapters, defaultOptions);

      const epubOptions = mockEpub.mock.calls[0][0];
      expect(epubOptions.author).toBe("Unknown Author");
    });

    it("passes book language and description", async () => {
      const book = buildBook({ language: "es", description: "A great story" });
      const chapters = [buildChapter()];

      await generateEpub(book, chapters, defaultOptions);

      const epubOptions = mockEpub.mock.calls[0][0];
      expect(epubOptions.lang).toBe("es");
      expect(epubOptions.description).toBe("A great story");
    });

    it("maps includeTableOfContents to tocInTOC", async () => {
      const book = buildBook();
      const chapters = [buildChapter()];

      await generateEpub(book, chapters, {
        ...defaultOptions,
        includeTableOfContents: false,
      });

      const epubOptions = mockEpub.mock.calls[0][0];
      expect(epubOptions.tocInTOC).toBe(false);
    });

    it("maps prependChapterTitles to epub option", async () => {
      const book = buildBook();
      const chapters = [buildChapter()];

      await generateEpub(book, chapters, {
        ...defaultOptions,
        prependChapterTitles: true,
      });

      const epubOptions = mockEpub.mock.calls[0][0];
      expect(epubOptions.prependChapterTitles).toBe(true);
    });

    it("uses EPUB version 3", async () => {
      const book = buildBook();
      const chapters = [buildChapter()];

      await generateEpub(book, chapters, defaultOptions);

      const epubOptions = mockEpub.mock.calls[0][0];
      expect(epubOptions.version).toBe(3);
    });
  });

  describe("progress callback", () => {
    it("calls onProgress at each generation stage", async () => {
      const book = buildBook();
      const chapters = [buildChapter()];
      const progress = vi.fn();

      await generateEpub(book, chapters, defaultOptions, progress);

      const messages = progress.mock.calls.map((c: unknown[]) => c[0]);
      expect(messages).toContain("Preparing chapters...");
      expect(messages).toContain("Processing chapter content...");
      expect(messages).toContain("Building EPUB metadata...");
      expect(messages).toContain("Generating EPUB file...");
      expect(messages).toContain("EPUB generated successfully!");
    });

    it("works without onProgress callback", async () => {
      const book = buildBook();
      const chapters = [buildChapter()];

      // Should not throw
      await expect(generateEpub(book, chapters, defaultOptions)).resolves.toBeInstanceOf(Blob);
    });
  });

  it("returns a Blob from epub-gen-memory", async () => {
    const expectedBlob = new Blob(["test-epub"]);
    mockEpub.mockResolvedValue(expectedBlob);

    const book = buildBook();
    const chapters = [buildChapter()];

    const result = await generateEpub(book, chapters, defaultOptions);

    expect(result).toBe(expectedBlob);
  });
});
