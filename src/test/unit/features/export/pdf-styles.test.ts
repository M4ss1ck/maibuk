import { describe, expect, it } from "vitest";
import {
  generatePdfStyles,
  DEFAULT_PDF_OPTIONS,
} from "../../../../features/export/pdf-styles";
import type { PdfExportOptions } from "../../../../features/export/pdf-styles";

describe("generatePdfStyles()", () => {
  it("returns a non-empty CSS string", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    expect(css.length).toBeGreaterThan(0);
  });

  it("scopes all rules under .pdf-preview-content", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    // Every CSS rule should be scoped
    expect(css).toContain(".pdf-preview-content");
    // Should not have unscoped body/html rules
    const lines = css.split("\n").map((l) => l.trim());
    const ruleLines = lines.filter(
      (l) =>
        l.endsWith("{") &&
        !l.startsWith("/*") &&
        !l.startsWith("@") &&
        !l.startsWith("*"),
    );
    for (const line of ruleLines) {
      expect(line).toMatch(/\.pdf-preview-content|@/);
    }
  });

  it("contains cover page styles", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    expect(css).toContain(".cover-page");
    expect(css).toContain(".cover-page img");
    expect(css).toContain(".cover-page .title");
  });

  it("contains chapter styles", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    expect(css).toContain(".chapter");
    expect(css).toContain(".chapter-header");
    expect(css).toContain(".chapter-title");
    expect(css).toContain(".chapter-number");
    expect(css).toContain(".chapter-content");
  });

  it("contains TOC styles", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    expect(css).toContain(".toc");
    expect(css).toContain(".toc-entry");
  });

  it("contains typography basics: paragraphs, headings, lists, blockquotes", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    expect(css).toContain(" p {");
    expect(css).toContain("text-indent:");
    expect(css).toContain(" h1,");
    expect(css).toContain(" ul,");
    expect(css).toContain(" blockquote {");
  });

  it("contains scene break (hr) styles", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    expect(css).toContain(" hr {");
    expect(css).toContain("hr::before");
    expect(css).toContain("* * *");
  });

  it("contains footnote/endnote styles", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    expect(css).toContain(".footnote-ref");
    expect(css).toContain(".endnotes");
    expect(css).toContain(".endnote");
  });

  it("includes @media print rules", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    expect(css).toContain("@media print");
    expect(css).toContain("@page");
  });

  it("includes table styles", () => {
    const css = generatePdfStyles(DEFAULT_PDF_OPTIONS);

    expect(css).toContain(" table {");
    expect(css).toContain(" th,");
    expect(css).toContain(" td {");
  });
});

describe("DEFAULT_PDF_OPTIONS", () => {
  it("has includeTableOfContents set to true", () => {
    expect(DEFAULT_PDF_OPTIONS).toEqual<PdfExportOptions>({
      includeTableOfContents: true,
    });
  });
});
