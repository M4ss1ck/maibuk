import { describe, expect, it } from "vitest";
import { rewriteImportedInternalLinks } from "@/features/import/internal-link-rewrite";

describe("rewriteImportedInternalLinks", () => {
  const chapters = [
    { chapterId: "c1", href: "text/chap1.xhtml", content: "" },
    { chapterId: "c2", href: "text/chap2.xhtml", content: "" },
  ];

  it("rewrites cross-chapter links with fragments to maibuk heading URIs", () => {
    const input = chapters.map((c) =>
      c.chapterId === "c1" ? { ...c, content: '<a href="chap2.xhtml#sec3">go</a>' } : c
    );
    const result = rewriteImportedInternalLinks(input);
    expect(result.find((c) => c.chapterId === "c1")?.content).toContain(
      'href="maibuk://heading/c2/sec3"'
    );
  });

  it("rewrites whole-document links to chapter URIs", () => {
    const input = chapters.map((c) =>
      c.chapterId === "c1" ? { ...c, content: '<a href="chap2.xhtml">go</a>' } : c
    );
    const result = rewriteImportedInternalLinks(input);
    expect(result.find((c) => c.chapterId === "c1")?.content).toContain(
      'href="maibuk://chapter/c2"'
    );
  });

  it("rewrites same-document fragment links to the current chapter", () => {
    const input = chapters.map((c) =>
      c.chapterId === "c1" ? { ...c, content: '<a href="#local">x</a>' } : c
    );
    const result = rewriteImportedInternalLinks(input);
    expect(result.find((c) => c.chapterId === "c1")?.content).toContain(
      'href="maibuk://heading/c1/local"'
    );
  });

  it("encodes arbitrary heading ids", () => {
    const input = chapters.map((c) =>
      c.chapterId === "c1" ? { ...c, content: '<a href="chap2.xhtml#a/b c">go</a>' } : c
    );
    const result = rewriteImportedInternalLinks(input);
    expect(result.find((c) => c.chapterId === "c1")?.content).toContain(
      `href="maibuk://heading/c2/${encodeURIComponent("a/b c")}"`
    );
  });

  it("leaves external links and unknown targets untouched", () => {
    const input = chapters.map((c) =>
      c.chapterId === "c1"
        ? {
            ...c,
            content: '<a href="https://x.com">e</a><a href="ghost.xhtml">g</a>',
          }
        : c
    );
    const result = rewriteImportedInternalLinks(input);
    const html = result.find((c) => c.chapterId === "c1")?.content ?? "";
    expect(html).toContain("https://x.com");
    expect(html).toContain('href="ghost.xhtml"');
  });
});
