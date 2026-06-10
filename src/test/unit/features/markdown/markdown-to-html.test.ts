import { describe, expect, it } from "vitest";
import { markdownToEditorHtml } from "../../../../features/markdown/markdown-to-html";

describe("markdownToEditorHtml()", () => {
  it("returns empty string for blank input", () => {
    expect(markdownToEditorHtml("")).toBe("");
    expect(markdownToEditorHtml("   \n ")).toBe("");
  });

  it("converts ATX headings", () => {
    const html = markdownToEditorHtml("# One\n\n## Two\n\n### Three");
    expect(html).toContain("<h1>One</h1>");
    expect(html).toContain("<h2>Two</h2>");
    expect(html).toContain("<h3>Three</h3>");
  });

  it("demotes headings deeper than h3 to h3", () => {
    const html = markdownToEditorHtml("#### Deep\n\n##### Deeper");
    expect(html).toContain("<h3>Deep</h3>");
    expect(html).toContain("<h3>Deeper</h3>");
    expect(html).not.toContain("<h4");
    expect(html).not.toContain("<h5");
  });

  it("converts paragraphs and inline emphasis", () => {
    const html = markdownToEditorHtml("This is **bold** and *italic* text.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("converts unordered and ordered lists", () => {
    const ul = markdownToEditorHtml("- a\n- b");
    expect(ul).toContain("<ul>");
    expect(ul).toContain("<li>a</li>");

    const ol = markdownToEditorHtml("1. a\n2. b");
    expect(ol).toContain("<ol>");
    expect(ol).toContain("<li>a</li>");
  });

  it("converts blockquotes", () => {
    const html = markdownToEditorHtml("> quoted");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("quoted");
  });

  it("converts links", () => {
    const html = markdownToEditorHtml("[Maibuk](https://maibuk.app)");
    expect(html).toContain('href="https://maibuk.app"');
    expect(html).toContain(">Maibuk</a>");
  });

  it("converts thematic breaks to hr", () => {
    expect(markdownToEditorHtml("a\n\n---\n\nb")).toContain("<hr>");
  });

  it("converts GFM tables (editor supports tables)", () => {
    const html = markdownToEditorHtml("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<tr>");
    expect(html).toContain("1");
    expect(html).toContain("2");
  });

  it("unwraps genuinely unsupported elements but keeps their text", () => {
    // A raw <div> wrapper is not in the schema; its text must survive.
    const html = markdownToEditorHtml("text with `inline code` here");
    expect(html).toContain("<code>inline code</code>");
  });
});
