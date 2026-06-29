import { vi, describe, expect, it } from "vitest";

// Mock StyleSheet.create to pass through styles (avoid react-pdf internals)
vi.mock("@react-pdf/renderer", () => ({
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
  },
}));

import { createPdfStyles, getMargins } from "@/features/export/pdf-styles";
import { DEFAULT_PDF_OPTIONS } from "@/features/export/types";
import type { PdfExportOptions } from "@/features/export/types";

describe("createPdfStyles()", () => {
  it("returns an object with expected style keys", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);

    // Page styles
    expect(styles).toHaveProperty("coverPage");
    expect(styles).toHaveProperty("contentPage");

    // Cover
    expect(styles).toHaveProperty("coverImage");
    expect(styles).toHaveProperty("coverTitle");
    expect(styles).toHaveProperty("coverSubtitle");
    expect(styles).toHaveProperty("coverAuthor");

    // TOC
    expect(styles).toHaveProperty("tocContainer");
    expect(styles).toHaveProperty("tocTitle");
    expect(styles).toHaveProperty("tocEntry");
    expect(styles).toHaveProperty("tocLink");

    // Chapter
    expect(styles).toHaveProperty("chapterHeader");
    expect(styles).toHaveProperty("chapterNumber");
    expect(styles).toHaveProperty("chapterTitle");

    // Typography
    expect(styles).toHaveProperty("paragraph");
    expect(styles).toHaveProperty("heading1");
    expect(styles).toHaveProperty("heading2");
    expect(styles).toHaveProperty("heading3");

    // Lists
    expect(styles).toHaveProperty("list");
    expect(styles).toHaveProperty("listItem");
    expect(styles).toHaveProperty("bullet");
    expect(styles).toHaveProperty("listItemContent");

    // Other blocks
    expect(styles).toHaveProperty("blockquote");
    expect(styles).toHaveProperty("sceneBreak");
    expect(styles).toHaveProperty("image");
    expect(styles).toHaveProperty("table");

    // Endnotes
    expect(styles).toHaveProperty("endnotes");
    expect(styles).toHaveProperty("endnotesTitle");
    expect(styles).toHaveProperty("endnote");

    // Inline
    expect(styles).toHaveProperty("bold");
    expect(styles).toHaveProperty("italic");
    expect(styles).toHaveProperty("underline");
    expect(styles).toHaveProperty("strikethrough");
    expect(styles).toHaveProperty("footnoteRef");
    expect(styles).toHaveProperty("link");

    // Page number
    expect(styles).toHaveProperty("pageNumber");
  });

  it("uses the default base font (Times-Roman) for all text styles", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);

    expect(styles.paragraph).toHaveProperty("fontFamily", "Times-Roman");
    expect(styles.coverTitle).toHaveProperty("fontFamily", "Times-Roman");
    expect(styles.chapterTitle).toHaveProperty("fontFamily", "Times-Roman");
  });

  it("applies standard margins by default", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);

    expect(styles.contentPage).toHaveProperty("paddingTop", 71);
    expect(styles.contentPage).toHaveProperty("paddingLeft", 57);
    expect(styles.contentPage).toHaveProperty("paddingRight", 57);
  });

  it("applies wide margins when configured", () => {
    const options: PdfExportOptions = {
      ...DEFAULT_PDF_OPTIONS,
      margins: "wide",
    };
    const styles = createPdfStyles(options);

    expect(styles.contentPage).toHaveProperty("paddingTop", 85);
    expect(styles.contentPage).toHaveProperty("paddingLeft", 85);
    expect(styles.contentPage).toHaveProperty("paddingRight", 85);
  });

  it("applies narrow margins when configured", () => {
    const options: PdfExportOptions = {
      ...DEFAULT_PDF_OPTIONS,
      margins: "narrow",
    };
    const styles = createPdfStyles(options);

    expect(styles.contentPage).toHaveProperty("paddingTop", 43);
    expect(styles.contentPage).toHaveProperty("paddingLeft", 43);
  });

  it("sets bold fontWeight in bold style", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);
    expect(styles.bold).toHaveProperty("fontWeight", "bold");
  });

  it("sets italic fontStyle in italic style", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);
    expect(styles.italic).toHaveProperty("fontStyle", "italic");
  });

  it("uses justified text alignment for paragraphs", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);
    expect(styles.paragraph).toHaveProperty("textAlign", "justify");
  });

  it("sets minPresenceAhead on headings for keep-with-next behavior", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);
    expect(styles.heading1).toHaveProperty("minPresenceAhead", 40);
    expect(styles.heading2).toHaveProperty("minPresenceAhead", 40);
  });

  it("uses ratio values for lineHeight (react-pdf multiplies by fontSize)", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);

    // react-pdf resolves `lineHeight: N` as `N * fontSize` in points.
    // A value of 19 with fontSize 12 would produce 228pt lines — hanging the layout.
    // Correct ratios: desiredPt / fontSize  (e.g. 19pt / 12pt ≈ 1.6)
    const paragraph = styles.paragraph as Record<string, unknown>;
    expect(paragraph.lineHeight).toBeCloseTo(1.6, 1);

    const blockquoteText = styles.blockquoteText as Record<string, unknown>;
    expect(blockquoteText.lineHeight).toBeCloseTo(1.6, 1);

    const endnote = styles.endnote as Record<string, unknown>;
    expect(endnote.lineHeight).toBeCloseTo(1.5, 1);

    const listItemContent = styles.listItemContent as Record<string, unknown>;
    expect(listItemContent.lineHeight).toBeCloseTo(1.6, 1);

    const chapterTitle = styles.chapterTitle as Record<string, unknown>;
    expect(chapterTitle.lineHeight).toBeCloseTo(1.2, 1);
  });

  it("all lineHeight values are safe ratios (< 3.0)", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);
    const allStyles = Object.values(styles) as Record<string, unknown>[];

    for (const style of allStyles) {
      if (style && typeof style === "object" && "lineHeight" in style) {
        const lh = style.lineHeight as number;
        expect(lh).toBeGreaterThan(0);
        expect(lh).toBeLessThan(3.0);
      }
    }
  });

  it("does not set lineHeight on contentPage (Page-level style)", () => {
    const styles = createPdfStyles(DEFAULT_PDF_OPTIONS);
    expect(styles.contentPage).not.toHaveProperty("lineHeight");
  });
});

describe("getMargins()", () => {
  it("returns standard margins", () => {
    const margins = getMargins("standard");
    expect(margins.top).toBe(71);
    expect(margins.bottom).toBe(71);
    expect(margins.left).toBe(57);
    expect(margins.right).toBe(57);
  });

  it("returns wide margins", () => {
    const margins = getMargins("wide");
    expect(margins.top).toBe(85);
    expect(margins.left).toBe(85);
  });

  it("returns narrow margins", () => {
    const margins = getMargins("narrow");
    expect(margins.top).toBe(43);
    expect(margins.left).toBe(43);
  });
});

describe("DEFAULT_PDF_OPTIONS", () => {
  it("has expected default values", () => {
    expect(DEFAULT_PDF_OPTIONS.includeTableOfContents).toBe(true);
    expect(DEFAULT_PDF_OPTIONS.numberChapters).toBe(true);
    expect(DEFAULT_PDF_OPTIONS.includePageNumbers).toBe(true);
    expect(DEFAULT_PDF_OPTIONS.pageSize).toBe("A4");
    expect(DEFAULT_PDF_OPTIONS.margins).toBe("standard");
  });
});
