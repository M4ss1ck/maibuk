import { describe, expect, it } from "vitest";
import { normalizeXhtmlToEditorHtml } from "@/features/import/xhtml-to-editor";

describe("normalizeXhtmlToEditorHtml()", () => {
  it("preserves editor-supported block structure", () => {
    const result = normalizeXhtmlToEditorHtml({
      html: `
        <html xmlns="http://www.w3.org/1999/xhtml">
          <body>
            <h1>One</h1><h2>Two</h2><h3>Three</h3>
            <p>Hello world.</p>
            <blockquote><p>Quoted</p></blockquote>
            <ul><li>First</li></ul>
            <ol><li>Second</li></ol>
          </body>
        </html>`,
      baseHref: "EPUB/chapter-1.xhtml",
      assetHrefMap: new Map(),
    });

    expect(result.html).toContain("<h1>One</h1>");
    expect(result.html).toContain("<h2>Two</h2>");
    expect(result.html).toContain("<h3>Three</h3>");
    expect(result.html).toContain("<p>Hello world.</p>");
    expect(result.html).toContain("<blockquote><p>Quoted</p></blockquote>");
    expect(result.html).toContain("<ul><li>First</li></ul>");
    expect(result.html).toContain("<ol><li>Second</li></ol>");
  });

  it("preserves supported inline formatting and links", () => {
    const result = normalizeXhtmlToEditorHtml({
      html: `
        <html><body>
          <p><strong>Bold</strong> <em>Italic</em> <u>Underline</u>
          <a href="../notes/end.xhtml#n1">note</a></p>
        </body></html>`,
      baseHref: "EPUB/text/chapter-1.xhtml",
      assetHrefMap: new Map(),
    });

    expect(result.html).toContain("<strong>Bold</strong>");
    expect(result.html).toContain("<em>Italic</em>");
    expect(result.html).toContain("<u>Underline</u>");
    expect(result.html).toContain('<a href="../notes/end.xhtml#n1">note</a>');
    expect(result.references).toEqual(
      expect.arrayContaining([
        {
          kind: "link",
          originalHref: "../notes/end.xhtml#n1",
          resolvedHref: "EPUB/notes/end.xhtml#n1",
        },
      ])
    );
  });

  it("converts resolvable images into editor image figures", () => {
    const result = normalizeXhtmlToEditorHtml({
      html: `
        <html><body>
          <p>Before</p>
          <img src="../images/cover.png" alt="Cover" title="Front cover" />
        </body></html>`,
      baseHref: "EPUB/text/chapter-1.xhtml",
      assetHrefMap: new Map([["EPUB/images/cover.png", "asset-cover"]]),
    });

    expect(result.html).toContain('<figure data-image="">');
    expect(result.html).toContain(
      '<img src="maibuk-asset:asset-cover" alt="Cover" title="Front cover">'
    );
    expect(result.referencedAssetIds).toEqual(["asset-cover"]);
    expect(result.references).toEqual(
      expect.arrayContaining([
        {
          kind: "asset",
          originalHref: "../images/cover.png",
          resolvedHref: "EPUB/images/cover.png",
          assetId: "asset-cover",
        },
      ])
    );
  });

  it("removes script and style tags and reports compatibility issues", () => {
    const result = normalizeXhtmlToEditorHtml({
      html: `
        <html><body>
          <style>p { color: red; }</style>
          <script>alert("no");</script>
          <p>Kept</p>
        </body></html>`,
      baseHref: "EPUB/chapter-1.xhtml",
      assetHrefMap: new Map(),
    });

    expect(result.html).toBe("<p>Kept</p>");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "lossy", code: "removed-style-tag" }),
        expect.objectContaining({ severity: "lossy", code: "removed-script-tag" }),
      ])
    );
  });

  it("keeps unresolved image resources traceable", () => {
    const result = normalizeXhtmlToEditorHtml({
      html: `<html><body><img src="../images/missing.png" alt="Missing" /></body></html>`,
      baseHref: "EPUB/text/chapter-1.xhtml",
      assetHrefMap: new Map(),
    });

    expect(result.html).toContain('<img src="../images/missing.png" alt="Missing">');
    expect(result.referencedAssetIds).toEqual([]);
    expect(result.references).toEqual([
      {
        kind: "asset",
        originalHref: "../images/missing.png",
        resolvedHref: "EPUB/images/missing.png",
      },
    ]);
  });
});
