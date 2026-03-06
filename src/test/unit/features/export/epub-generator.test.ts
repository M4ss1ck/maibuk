import { describe, expect, it, vi } from "vitest";
import { getEpubFilename } from "../../../../features/export/epub-generator";
import { buildBook } from "../../../support/fixtures";

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
});

describe("generateEpub()", () => {
  it("throws when no chapters are selected for export", async () => {
    // We mock epub-gen-memory to avoid heavy dependency in tests
    const { generateEpub } = await import(
      "../../../../features/export/epub-generator"
    );
    const book = buildBook();
    const chapters = [
      buildBook().id, // invalid — but we just need isIncludedInExport: false
    ];

    // Use chapters that are excluded
    const excludedChapters = [
      {
        ...buildBook(),
        bookId: book.id,
        content: "<p>test</p>",
        order: 1,
        chapterType: "chapter" as const,
        wordCount: 1,
        status: "draft" as const,
        isIncludedInExport: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    await expect(
      generateEpub(book, excludedChapters as never[], {} as never),
    ).rejects.toThrow("No chapters selected for export");
  });

  it("calls onProgress callback during generation", async () => {
    // Mock epub-gen-memory
    vi.mock("epub-gen-memory/bundle", () => ({
      default: vi.fn().mockResolvedValue(new Blob(["epub-content"])),
    }));

    const { generateEpub } = await import(
      "../../../../features/export/epub-generator"
    );
    const book = buildBook();
    const chapters = [
      {
        id: "ch-1",
        bookId: book.id,
        title: "Chapter 1",
        content: "<p>Content</p>",
        order: 1,
        chapterType: "chapter" as const,
        wordCount: 1,
        status: "draft" as const,
        isIncludedInExport: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const progress = vi.fn();

    await generateEpub(
      book,
      chapters as never[],
      { includeTableOfContents: true, numberChapters: false, prependChapterTitles: false },
      progress,
    );

    expect(progress).toHaveBeenCalled();
    const messages = progress.mock.calls.map((c: unknown[]) => c[0]);
    expect(messages).toContain("Preparing chapters...");
    expect(messages).toContain("EPUB generated successfully!");
  });
});
