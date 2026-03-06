import { describe, expect, it } from "vitest";
import { generatePdfHtml } from "../../../../features/export/pdf-generator";
import { buildBook, buildChapter } from "../../../support/fixtures";

describe("generatePdfHtml()", () => {
  const defaultOptions = { includeTableOfContents: false };

  it("throws when no chapters are selected for export", () => {
    const book = buildBook();
    const chapters = [buildChapter({ isIncludedInExport: false })];

    expect(() => generatePdfHtml(book, chapters, defaultOptions)).toThrow(
      "No chapters selected for export",
    );
  });

  it("renders a valid HTML document with doctype, head, and body", () => {
    const book = buildBook({ title: "My Novel" });
    const chapters = [buildChapter({ title: "Opening", content: "<p>Hello</p>" })];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
  });

  it("includes book title in the <title> tag", () => {
    const book = buildBook({ title: "My Novel" });
    const chapters = [buildChapter()];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toContain("<title>My Novel</title>");
  });

  it("sets the lang attribute from book.language", () => {
    const book = buildBook({ language: "es" });
    const chapters = [buildChapter()];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toContain('lang="es"');
  });

  it("renders a text-only cover when no cover image is provided", () => {
    const book = buildBook({ title: "No Cover", authorName: "Jane Doe" });
    const chapters = [buildChapter()];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toContain('class="cover-page"');
    expect(html).toContain('class="title"');
    expect(html).toContain("No Cover");
    expect(html).toContain("Jane Doe");
    expect(html).not.toContain("<img");
  });

  it("renders a cover image when coverImagePath is set", () => {
    const book = buildBook({ coverImagePath: "data:image/png;base64,abc" });
    const chapters = [buildChapter()];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toContain("<img");
    expect(html).toContain("data:image/png;base64,abc");
  });

  it("renders subtitle when present", () => {
    const book = buildBook({ subtitle: "A Subtitle" });
    const chapters = [buildChapter()];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toContain("A Subtitle");
    expect(html).toContain('class="subtitle"');
  });

  it("omits subtitle div when not present", () => {
    const book = buildBook({ subtitle: undefined });
    const chapters = [buildChapter()];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).not.toContain('class="subtitle"');
  });

  it("includes table of contents when option is enabled", () => {
    const book = buildBook();
    const chapters = [
      buildChapter({ title: "Chapter One", chapterType: "chapter", order: 1 }),
      buildChapter({ title: "Chapter Two", chapterType: "chapter", order: 2 }),
    ];

    const html = generatePdfHtml(book, chapters, {
      includeTableOfContents: true,
    });

    expect(html).toContain('class="toc"');
    expect(html).toContain("Table of Contents");
    expect(html).toContain("Chapter One");
    expect(html).toContain("Chapter Two");
  });

  it("excludes frontmatter chapters from TOC", () => {
    const book = buildBook();
    const chapters = [
      buildChapter({ title: "Preface", chapterType: "frontmatter", order: 1 }),
      buildChapter({ title: "Chapter One", chapterType: "chapter", order: 2 }),
    ];

    const html = generatePdfHtml(book, chapters, {
      includeTableOfContents: true,
    });

    expect(html).toContain('class="toc"');
    // Preface should not be in the TOC, but should still render as a section
    const tocSection = html.match(/<section class="toc">[\s\S]*?<\/section>/);
    expect(tocSection).toBeTruthy();
    expect(tocSection![0]).not.toContain("Preface");
    expect(tocSection![0]).toContain("Chapter One");
  });

  it("does not include TOC when option is disabled", () => {
    const book = buildBook();
    const chapters = [buildChapter()];

    const html = generatePdfHtml(book, chapters, {
      includeTableOfContents: false,
    });

    expect(html).not.toContain('class="toc"');
  });

  it("filters out chapters not included in export", () => {
    const book = buildBook();
    const chapters = [
      buildChapter({ title: "Included", isIncludedInExport: true, order: 1 }),
      buildChapter({ title: "Excluded", isIncludedInExport: false, order: 2 }),
    ];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toContain("Included");
    expect(html).not.toContain("Excluded");
  });

  it("sorts chapters by order", () => {
    const book = buildBook();
    const chapters = [
      buildChapter({ title: "Second", order: 2 }),
      buildChapter({ title: "First", order: 1 }),
    ];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    const firstIdx = html.indexOf("First");
    const secondIdx = html.indexOf("Second");
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it("renders chapter numbers only for 'chapter' type", () => {
    const book = buildBook();
    const chapters = [
      buildChapter({ title: "Prologue", chapterType: "prologue", order: 1 }),
      buildChapter({ title: "Opening", chapterType: "chapter", order: 2 }),
    ];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    // The chapter section should have "Chapter 1"
    expect(html).toContain("Chapter 1");
    // Prologue should not get a chapter number
    const prologueSection = html.match(
      /<section class="chapter" id="chapter-0">[\s\S]*?<\/section>/,
    );
    expect(prologueSection).toBeTruthy();
    expect(prologueSection![0]).not.toContain("chapter-number");
  });

  it("escapes HTML special characters in title and author", () => {
    const book = buildBook({
      title: 'A <Book> & "More"',
      authorName: "O'Brien",
    });
    const chapters = [buildChapter()];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toContain("A &lt;Book&gt; &amp; &quot;More&quot;");
    expect(html).toContain("O&#039;Brien");
  });

  it("embeds generated styles inside a <style> tag", () => {
    const book = buildBook();
    const chapters = [buildChapter()];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toContain("<style>");
    expect(html).toContain("</style>");
    // Verify it contains actual CSS content from generatePdfStyles
    expect(html).toContain(".pdf-preview-content");
  });

  it("handles chapters with null content gracefully", () => {
    const book = buildBook();
    const chapters = [buildChapter({ content: null })];

    const html = generatePdfHtml(book, chapters, defaultOptions);

    expect(html).toContain("<p></p>");
  });
});
