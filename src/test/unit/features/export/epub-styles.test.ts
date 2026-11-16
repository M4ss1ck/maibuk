import { describe, expect, it } from "vitest";
import { EPUB_STYLES } from "@/features/export/epub-styles";

/** Returns the declarations of the one rule whose selector matches exactly. */
function rule(selector: string): string {
  const css = EPUB_STYLES.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);

  if (!match) throw new Error(`No rule found for selector: ${selector}`);

  return match[1]!.trim();
}

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

  it("does not hardcode asterisks via ::before and centers scene breaks", () => {
    expect(EPUB_STYLES).not.toContain('content: "* * *"');
    expect(EPUB_STYLES).toContain("text-align: center");
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

  it("lays out image figures and their alignment", () => {
    expect(rule("figure.image-figure img")).toContain("margin: 0");
    expect(rule("figure.image-figure img")).toContain("max-width: 100%");

    const imageDeclarations = rule("figure.image-figure img")
      .split(";")
      .map((declaration) => declaration.trim());
    expect(imageDeclarations.filter((declaration) => declaration.startsWith("width:"))).toEqual([]);

    expect(rule("figure.image-figure.align-left")).toContain("text-align: left");
    expect(rule("figure.image-figure.align-left img")).toContain("margin-left: 0");
    expect(rule("figure.image-figure.align-left img")).toContain("margin-right: auto");

    expect(rule("figure.image-figure.align-center")).toContain("text-align: center");
    expect(rule("figure.image-figure.align-center img")).toContain("margin-left: auto");
    expect(rule("figure.image-figure.align-center img")).toContain("margin-right: auto");

    expect(rule("figure.image-figure.align-right")).toContain("text-align: right");
    expect(rule("figure.image-figure.align-right img")).toContain("margin-left: auto");
    expect(rule("figure.image-figure.align-right img")).toContain("margin-right: 0");
  });

  it("leaves the scene break figure rules unchanged", () => {
    expect(rule("figure.scene-break")).toBe("letter-spacing: normal;");
    expect(rule("figure.scene-break img")).toBe(
      "max-width: 40%; height: auto; margin: 0 auto; display: block;"
    );
  });
});
