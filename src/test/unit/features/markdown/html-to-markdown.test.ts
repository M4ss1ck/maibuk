import { describe, expect, it } from "vitest";
import { editorHtmlToMarkdown } from "@/features/markdown/html-to-markdown";
import { markdownToEditorHtml } from "@/features/markdown/markdown-to-html";

describe("editorHtmlToMarkdown()", () => {
  it("returns empty string for blank input", () => {
    expect(editorHtmlToMarkdown("")).toBe("");
  });

  it("converts headings", () => {
    expect(editorHtmlToMarkdown("<h1>One</h1>")).toBe("# One");
    expect(editorHtmlToMarkdown("<h2>Two</h2>")).toBe("## Two");
  });

  it("converts emphasis", () => {
    const md = editorHtmlToMarkdown("<p>This is <strong>bold</strong> and <em>italic</em>.</p>");
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
  });

  it("converts lists", () => {
    expect(editorHtmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("-   a\n-   b");
    expect(editorHtmlToMarkdown("<ol><li>a</li><li>b</li></ol>")).toContain("1.");
  });

  it("converts blockquotes", () => {
    expect(editorHtmlToMarkdown("<blockquote><p>q</p></blockquote>")).toBe("> q");
  });

  it("converts links", () => {
    expect(editorHtmlToMarkdown('<p><a href="https://x.com">x</a></p>')).toBe("[x](https://x.com)");
  });

  it("converts a scene-break div to a thematic break", () => {
    const md = editorHtmlToMarkdown(
      '<p>a</p><div data-scene-break="" data-kind="text"><span class="scene-break-symbols">* * *</span></div><p>b</p>'
    );
    expect(md).toContain("* * *");
    expect(md).not.toContain("data-scene-break");
  });

  it("converts footnotes to inline refs with definitions", () => {
    const md = editorHtmlToMarkdown(
      '<p>Text<sup data-footnote="" data-footnote-content="A note" data-footnote-id="fn-1"></sup> more.</p>'
    );
    expect(md).toContain("[^1]");
    expect(md).toContain("[^1]: A note");
  });

  it("unwraps figures to plain images", () => {
    const md = editorHtmlToMarkdown(
      '<figure data-image=""><img src="x.png" alt="cat"><figcaption></figcaption></figure>'
    );
    expect(md).toContain("![cat](x.png)");
  });

  it("round-trips a representative document", () => {
    const md = [
      "# Title",
      "",
      "Intro with **bold** and a [link](https://example.com).",
      "",
      "## Section",
      "",
      "-   one",
      "-   two",
    ].join("\n");
    const roundTripped = editorHtmlToMarkdown(markdownToEditorHtml(md));
    expect(roundTripped).toContain("# Title");
    expect(roundTripped).toContain("## Section");
    expect(roundTripped).toContain("**bold**");
    expect(roundTripped).toContain("[link](https://example.com)");
    expect(roundTripped).toContain("-   one");
  });
});
