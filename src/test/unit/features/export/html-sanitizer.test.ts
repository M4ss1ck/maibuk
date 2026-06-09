import { describe, expect, it } from "vitest";

import {
  generateEndnotesHtml,
  processChapterHtml,
  sanitizeHtmlForEpub,
} from "../../../../features/export/html-sanitizer";

describe("sanitizeHtmlForEpub()", () => {
  it("returns empty output for empty input", () => {
    const result = sanitizeHtmlForEpub("");

    expect(result).toEqual({ html: "", footnotes: [] });
  });

  it("extracts sup footnotes in standard attribute order", () => {
    const html =
      '<p>Hello<sup data-footnote="" data-footnote-content="A &amp; B" data-footnote-id="fn-custom"></sup></p>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.footnotes).toEqual([
      {
        id: "fn-custom",
        number: 1,
        content: "A & B",
      },
    ]);
    expect(result.html).toContain('class="footnote-ref"');
    expect(result.html).toContain('href="#fn-1"');
    expect(result.html).toContain('id="fnref-1"');
  });

  it("extracts sup footnotes when attributes come in different order", () => {
    const html =
      '<p>Hello<sup data-footnote-id="fn-2" data-footnote-content="Other note" data-footnote=""></sup></p>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.footnotes).toEqual([
      {
        id: "fn-2",
        number: 1,
        content: "Other note",
      },
    ]);
    expect(result.html).toContain('href="#fn-1"');
  });

  it("handles legacy span footnote format", () => {
    const html =
      '<p>Word<span data-footnote="" data-footnote-content="Legacy note" data-footnote-id="legacy-id">*</span></p>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.footnotes).toHaveLength(1);
    expect(result.footnotes[0].id).toBe("legacy-id");
    expect(result.html).toContain("Word*");
    expect(result.html).toContain('class="footnote-ref"');
  });

  it("converts a text scene-break block to a p.scene-break preserving symbols", () => {
    const html =
      '<div data-scene-break data-kind="text" class="scene-break"><span class="scene-break-symbols">❧</span></div>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.html).toContain('<p class="scene-break">❧</p>');
  });

  it("converts an image scene-break block to a figure.scene-break", () => {
    const html =
      '<div data-scene-break data-kind="image" class="scene-break"><img src="data:image/png;base64,AA" alt="o"></div>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.html).toContain('<figure class="scene-break">');
    expect(result.html).toContain('src="data:image/png;base64,AA"');
  });

  it("converts a legacy attribute-less scene break to '* * *'", () => {
    const html = "<div data-scene-break></div>";

    const result = sanitizeHtmlForEpub(html);

    expect(result.html).toContain('<p class="scene-break">* * *</p>');
  });

  it("strips editor and ProseMirror classes", () => {
    const html = '<p class="editor-selected">A</p><p class="ProseMirror-focused">B</p>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.html).toContain("<p >A</p>");
    expect(result.html).toContain("<p >B</p>");
    expect(result.html).not.toContain("editor-selected");
    expect(result.html).not.toContain("ProseMirror-focused");
  });

  it("strips unsupported mark data attributes", () => {
    const html = '<p><mark data-color="#FFFF00">hi</mark></p>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.html).toContain("<p><mark>hi</mark></p>");
    expect(result.html).not.toContain("data-color");
  });

  it("removes generic data-* attributes and empty class attributes", () => {
    const html = '<p data-test="x" class="">A</p><p data-scene-break="1" class="   ">B</p>';

    const result = sanitizeHtmlForEpub(html);

    expect(result.html).toContain("<p >A</p>");
    expect(result.html).toContain("<p >B</p>");
    expect(result.html).not.toContain("data-test");
    expect(result.html).not.toContain("data-scene-break");
  });
});

describe("generateEndnotesHtml()", () => {
  it("returns empty string when no footnotes exist", () => {
    expect(generateEndnotesHtml([])).toBe("");
  });

  it("returns a notes section with backlinks", () => {
    const html = generateEndnotesHtml([
      { id: "fn-a", number: 1, content: "First note" },
      { id: "fn-b", number: 2, content: "Second note" },
    ]);

    expect(html).toContain('<section class="endnotes">');
    expect(html).toContain("<h2>Notes</h2>");
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

  it("leaves valid list structures untouched", () => {
    const html = "<ul><li>Item</li></ul>";

    const result = processChapterHtml(html);

    expect(result).toContain("<ul><li>Item</li></ul>");
  });
});
