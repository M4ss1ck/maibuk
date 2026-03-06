import { describe, expect, it } from "vitest";
import { EPUB_STYLES } from "../../../../features/export/epub-styles";

describe("EPUB_STYLES", () => {
  it("is a non-empty string", () => {
    expect(typeof EPUB_STYLES).toBe("string");
    expect(EPUB_STYLES.length).toBeGreaterThan(0);
  });

  it("contains base body typography", () => {
    expect(EPUB_STYLES).toContain("body {");
    expect(EPUB_STYLES).toContain("font-family:");
    expect(EPUB_STYLES).toContain("line-height:");
  });

  it("contains heading styles", () => {
    expect(EPUB_STYLES).toContain("h1,");
    expect(EPUB_STYLES).toContain("h2 {");
    expect(EPUB_STYLES).toContain("h3 {");
  });

  it("contains paragraph styles with text-indent", () => {
    expect(EPUB_STYLES).toContain("p {");
    expect(EPUB_STYLES).toContain("text-indent:");
  });

  it("contains scene break styles", () => {
    expect(EPUB_STYLES).toContain(".scene-break");
  });

  it("contains footnote/endnote styles", () => {
    expect(EPUB_STYLES).toContain(".footnote-ref");
    expect(EPUB_STYLES).toContain(".endnotes");
    expect(EPUB_STYLES).toContain(".endnote");
  });

  it("contains blockquote styles", () => {
    expect(EPUB_STYLES).toContain("blockquote {");
  });

  it("contains image styles", () => {
    expect(EPUB_STYLES).toContain("img {");
    expect(EPUB_STYLES).toContain("max-width:");
  });

  it("contains table styles", () => {
    expect(EPUB_STYLES).toContain("table {");
    expect(EPUB_STYLES).toContain("th,");
  });

  it("contains cover styles", () => {
    expect(EPUB_STYLES).toContain(".cover");
    expect(EPUB_STYLES).toContain(".cover-image");
  });
});
