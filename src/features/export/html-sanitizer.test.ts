import { describe, expect, it } from "vitest";
import {
  generateEndnotesHtml,
  processChapterHtml,
  sanitizeHtmlForEpub,
} from "./html-sanitizer";

describe("sanitizeHtmlForEpub()", () => {
  it("returns empty output for empty input", () => {
    const result = sanitizeHtmlForEpub("");

    expect(result).toEqual({ html: "", footnotes: [] });
  });

  it("extracts and renumbers footnotes", () => {
    const html =
      '<p>Hello<sup data-footnote="" data-footnote-content="A &amp; B" data-footnote-id="fn-custom"></sup></p>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.footnotes).toHaveLength(1);
    expect(result.footnotes[0]).toMatchObject({
      id: "fn-custom",
      number: 1,
      content: "A & B",
    });
    expect(result.html).toContain('class="footnote-ref"');
    expect(result.html).toContain('href="#fn-1"');
    expect(result.html).toContain('id="fnref-1"');
  });

  it("converts scene break blocks to hr tags", () => {
    const html =
      '<div data-scene-break class="scene-break"><span class="scene-break-symbols">* * *</span></div>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.html).toContain('<hr class="scene-break" />');
  });
});

describe("generateEndnotesHtml()", () => {
  it("returns a notes section with backlinks", () => {
    const html = generateEndnotesHtml([
      { id: "fn-a", number: 1, content: "First note" },
      { id: "fn-b", number: 2, content: "Second note" },
    ]);

    expect(html).toContain('<section class="endnotes">');
    expect(html).toContain('<h2>Notes</h2>');
    expect(html).toContain('id="fn-1"');
    expect(html).toContain('href="#fnref-2"');
  });
});

describe("processChapterHtml()", () => {
  it("fixes orphan list items and appends endnotes", () => {
    const html =
      '<p>Intro</p><li>Orphan item</li><p>Outro<sup data-footnote="" data-footnote-content="Tail note" data-footnote-id="fn-tail"></sup></p>';

    const result = processChapterHtml(html);

    expect(result).toContain("<ul><li>Orphan item</li></ul>");
    expect(result).toContain('<section class="endnotes">');
    expect(result).toContain("Tail note");
  });
});
