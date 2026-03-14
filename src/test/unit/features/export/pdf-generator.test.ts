import { vi, describe, expect, it, beforeEach } from "vitest";
import { buildBook, buildChapter } from "../../../support/fixtures";

// vi.hoisted ensures mocks are available when vi.mock factories run
const { mockToBlob, mockPdf, mockPdfLibLoad, mockEmbedFont } = vi.hoisted(() => {
  const mockToBlob = vi.fn().mockResolvedValue(new Blob(["fake-pdf"], { type: "application/pdf" }));
  const mockPdf = vi.fn().mockReturnValue({ toBlob: mockToBlob });
  const mockWidthOfTextAtSize = vi.fn().mockReturnValue(20);
  const mockEmbedFont = vi.fn().mockResolvedValue({ widthOfTextAtSize: mockWidthOfTextAtSize });
  const mockDrawText = vi.fn();
  const mockGetPages = vi.fn().mockReturnValue([
    { getSize: () => ({ width: 595, height: 842 }), drawText: mockDrawText },
    { getSize: () => ({ width: 595, height: 842 }), drawText: mockDrawText },
  ]);
  const mockSave = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  const mockPdfLibLoad = vi.fn().mockResolvedValue({
    embedFont: mockEmbedFont,
    getPages: mockGetPages,
    save: mockSave,
  });
  return { mockToBlob, mockPdf, mockPdfLibLoad, mockEmbedFont };
});

vi.mock("@react-pdf/renderer", () => ({
  pdf: mockPdf,
  Font: { registerHyphenationCallback: mockPdf }, // Stub — actual hyphenation tested implicitly
  Document: "Document",
  Page: "Page",
  View: "View",
  Text: "Text",
  Image: "Image",
  Link: "Link",
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
}));

vi.mock("pdf-lib", () => ({
  PDFDocument: { load: mockPdfLibLoad },
  StandardFonts: { TimesRoman: "TimesRoman", Helvetica: "Helvetica", Courier: "Courier" },
  rgb: (r: number, g: number, b: number) => ({ r, g, b }),
}));

// Mock the PdfDocument component
vi.mock("../../../../features/export/pdf-document", () => ({
  PdfDocument: () => null,
}));

import { generatePdf, getPdfFilename, sanitizePdfText } from "../../../../features/export/pdf-generator";
import { DEFAULT_PDF_OPTIONS } from "../../../../features/export/types";

describe("sanitizePdfText()", () => {
  it("returns normal text unchanged", () => {
    expect(sanitizePdfText("Hello, world!")).toBe("Hello, world!");
  });

  it("preserves tabs, newlines, and carriage returns", () => {
    expect(sanitizePdfText("line1\nline2\ttab\r")).toBe("line1\nline2\ttab\r");
  });

  it("strips C0 control characters (except \\t \\n \\r)", () => {
    expect(sanitizePdfText("abc\x00\x01\x08\x0Bdef")).toBe("abcdef");
  });

  it("strips C1 control characters", () => {
    expect(sanitizePdfText("abc\x80\x9Fdef")).toBe("abcdef");
  });

  it("strips unpaired high surrogates", () => {
    const input = "abc\uD800def";
    expect(sanitizePdfText(input)).toBe("abcdef");
  });

  it("strips unpaired low surrogates", () => {
    const input = "abc\uDC00def";
    expect(sanitizePdfText(input)).toBe("abcdef");
  });

  it("preserves valid surrogate pairs (emoji)", () => {
    const emoji = "Hello 😊 World";
    expect(sanitizePdfText(emoji)).toBe(emoji);
  });
});

describe("generatePdf()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the toBlob mock to return a valid Blob each time
    mockToBlob.mockResolvedValue(new Blob(["fake-pdf"], { type: "application/pdf" }));
  });

  it("throws when no chapters are selected for export", async () => {
    const book = buildBook();
    const chapters = [buildChapter({ isIncludedInExport: false })];

    await expect(
      generatePdf(book, chapters, DEFAULT_PDF_OPTIONS)
    ).rejects.toThrow("No chapters selected for export");
  });

  it("returns a Blob when chapters exist", async () => {
    const book = buildBook();
    const chapters = [buildChapter({ isIncludedInExport: true })];

    const blob = await generatePdf(book, chapters, DEFAULT_PDF_OPTIONS);

    expect(blob).toBeInstanceOf(Blob);
  });

  it("calls pdf() to generate the document", async () => {
    const book = buildBook();
    const chapters = [buildChapter()];

    await generatePdf(book, chapters, DEFAULT_PDF_OPTIONS);

    expect(mockPdf).toHaveBeenCalledTimes(1);
    expect(mockToBlob).toHaveBeenCalledTimes(1);
  });

  it("filters out chapters not included in export", async () => {
    const book = buildBook();
    const included = buildChapter({
      title: "Included",
      isIncludedInExport: true,
      order: 1,
    });
    const excluded = buildChapter({
      title: "Excluded",
      isIncludedInExport: false,
      order: 2,
    });

    await generatePdf(book, [included, excluded], DEFAULT_PDF_OPTIONS);

    expect(mockPdf).toHaveBeenCalledTimes(1);
    const element = mockPdf.mock.calls[0][0];
    expect(element.props.chapters).toHaveLength(1);
    expect(element.props.chapters[0].title).toBe("Included");
  });

  it("sorts chapters by order", async () => {
    const book = buildBook();
    const second = buildChapter({ title: "Second", order: 2 });
    const first = buildChapter({ title: "First", order: 1 });

    await generatePdf(book, [second, first], DEFAULT_PDF_OPTIONS);

    const element = mockPdf.mock.calls[0][0];
    expect(element.props.chapters[0].title).toBe("First");
    expect(element.props.chapters[1].title).toBe("Second");
  });

  it("passes options to the PdfDocument element", async () => {
    const book = buildBook();
    const chapters = [buildChapter()];
    const options = { ...DEFAULT_PDF_OPTIONS, pageSize: "A5" as const };

    await generatePdf(book, chapters, options);

    const element = mockPdf.mock.calls[0][0];
    expect(element.props.options.pageSize).toBe("A5");
  });

  it("sanitizes book title before passing to PdfDocument", async () => {
    const book = buildBook({ title: "My\x00Book" });
    const chapters = [buildChapter()];

    await generatePdf(book, chapters, DEFAULT_PDF_OPTIONS);

    const element = mockPdf.mock.calls[0][0];
    expect(element.props.book.title).toBe("MyBook");
  });

  it("stamps page numbers via pdf-lib when includePageNumbers is true", async () => {
    const book = buildBook();
    const chapters = [buildChapter()];

    await generatePdf(book, chapters, { ...DEFAULT_PDF_OPTIONS, includePageNumbers: true });

    expect(mockPdfLibLoad).toHaveBeenCalledTimes(1);
    expect(mockEmbedFont).toHaveBeenCalledTimes(1);
    expect(mockEmbedFont).toHaveBeenCalledWith("TimesRoman");
  });

  it("skips page stamping when includePageNumbers is false", async () => {
    const book = buildBook();
    const chapters = [buildChapter()];

    await generatePdf(book, chapters, { ...DEFAULT_PDF_OPTIONS, includePageNumbers: false });

    expect(mockPdfLibLoad).not.toHaveBeenCalled();
  });

  it("calls onProgress callback with status messages", async () => {
    const book = buildBook();
    const chapters = [buildChapter()];
    const onProgress = vi.fn();

    await generatePdf(book, chapters, DEFAULT_PDF_OPTIONS, onProgress);

    expect(onProgress).toHaveBeenCalledWith("Preparing chapters...");
    expect(onProgress).toHaveBeenCalledWith("Generating PDF document...");
    expect(onProgress).toHaveBeenCalledWith("Adding page numbers...");
    expect(onProgress).toHaveBeenCalledWith("PDF generated successfully!");
  });
});

describe("getPdfFilename()", () => {
  it("returns a .pdf filename from book title", () => {
    const book = buildBook({ title: "My Book" });
    expect(getPdfFilename(book)).toBe("My_Book.pdf");
  });

  it("sanitizes special characters", () => {
    const book = buildBook({ title: 'A <Book> "Quoted"' });
    expect(getPdfFilename(book)).toBe("A_Book_Quoted.pdf");
  });

  it("replaces spaces with underscores", () => {
    const book = buildBook({ title: "Hello World Again" });
    expect(getPdfFilename(book)).toBe("Hello_World_Again.pdf");
  });

  it("truncates long titles to 100 characters", () => {
    const longTitle = "A".repeat(200);
    const book = buildBook({ title: longTitle });
    const filename = getPdfFilename(book);
    // 100 chars + ".pdf" = 104
    expect(filename.length).toBe(104);
  });
});
