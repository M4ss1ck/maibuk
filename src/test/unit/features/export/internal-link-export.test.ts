import { describe, expect, it } from "vitest";
import { rewriteInternalLinksForExport } from "@/features/export/internal-link-export";

const hrefByChapter = new Map([
  ["c1", "text/chapter1.xhtml"],
  ["c2", "text/chapter2.xhtml"],
]);

describe("rewriteInternalLinksForExport", () => {
  it("rewrites chapter and heading links to relative href + fragment", () => {
    const html =
      '<a href="maibuk://chapter/c2">go</a>' + '<a href="maibuk://heading/c2/h-5">sec</a>';
    const result = rewriteInternalLinksForExport(html, {
      chapterHref: hrefByChapter,
      firstChapterHref: "text/chapter1.xhtml",
    });
    expect(result).toContain('href="text/chapter2.xhtml"');
    expect(result).toContain('href="text/chapter2.xhtml#h-5"');
  });

  it("rewrites book links to the first chapter href", () => {
    const html = '<a href="maibuk://book/b1">home</a>';
    const result = rewriteInternalLinksForExport(html, {
      chapterHref: hrefByChapter,
      firstChapterHref: "text/chapter1.xhtml",
    });
    expect(result).toContain('href="text/chapter1.xhtml"');
  });

  it("leaves unknown targets and external links untouched", () => {
    const html = '<a href="maibuk://chapter/missing">x</a><a href="https://e.com">e</a>';
    const result = rewriteInternalLinksForExport(html, {
      chapterHref: hrefByChapter,
      firstChapterHref: "text/chapter1.xhtml",
    });
    expect(result).toContain("https://e.com");
    // Unknown internal target is dropped to a non-navigating placeholder.
    expect(result).not.toContain("maibuk://chapter/missing");
  });
});
