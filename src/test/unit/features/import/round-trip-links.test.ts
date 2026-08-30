import { describe, expect, it } from "vitest";
import { rewriteInternalLinksForExport } from "@/features/export/internal-link-export";
import { rewriteImportedInternalLinks } from "@/features/import/internal-link-rewrite";

describe("internal link round-trip", () => {
  it("export then import preserves a heading link target", () => {
    const chapterHref = new Map([
      ["c1", "text/chap1.xhtml"],
      ["c2", "text/chap2.xhtml"],
    ]);

    // 1. Author content with an internal heading link.
    const authored = '<p><a href="maibuk://heading/c2/h-5">see</a></p>';

    // 2. Export rewrite -> relative href#fragment.
    const exported = rewriteInternalLinksForExport(authored, {
      chapterHref,
      firstChapterHref: "text/chap1.xhtml",
    });
    expect(exported).toContain('href="text/chap2.xhtml#h-5"');

    // 3. Re-import: simulate the exported XHTML as chapter c1's content,
    //    with the same spine layout. The exported href is package-relative,
    //    so the importing chapter's base href is its own path.
    const reimported = rewriteImportedInternalLinks([
      { chapterId: "c1", href: "text/chap1.xhtml", content: exported },
      { chapterId: "c2", href: "text/chap2.xhtml", content: "" },
    ]);

    // 4. The link points back at the same heading id in the target chapter.
    expect(reimported[0].content).toContain('href="maibuk://heading/c2/h-5"');
  });

  it("round-trips an encoded heading id", () => {
    const chapterHref = new Map([
      ["c1", "text/chap1.xhtml"],
      ["c2", "text/chap2.xhtml"],
    ]);
    const tricky = "a/b c";
    const authored = `<p><a href="maibuk://heading/c2/${encodeURIComponent(tricky)}">see</a></p>`;
    const exported = rewriteInternalLinksForExport(authored, {
      chapterHref,
      firstChapterHref: "text/chap1.xhtml",
    });
    expect(exported).toContain(`href="text/chap2.xhtml#${tricky}"`);
    const reimported = rewriteImportedInternalLinks([
      { chapterId: "c1", href: "text/chap1.xhtml", content: exported },
      { chapterId: "c2", href: "text/chap2.xhtml", content: "" },
    ]);
    expect(reimported[0].content).toContain(
      `href="maibuk://heading/c2/${encodeURIComponent(tricky)}"`
    );
  });
});
