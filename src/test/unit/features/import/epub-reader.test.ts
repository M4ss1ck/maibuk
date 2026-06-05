import { describe, expect, it } from "vitest";
import {
  buildEncryptedEpubFixture,
  buildEpubWithNavFixture,
  buildEpubWithNcxFixture,
  buildEpubWithoutContainerFixture,
  buildEpubWithoutOpfFixture,
  buildMinimalEpubFixture,
} from "../../../support/epub-fixtures";
import { readEpub } from "../../../../features/import/epub-reader";

describe("readEpub()", () => {
  it("parses the package path from META-INF/container.xml", () => {
    const parsed = readEpub(buildMinimalEpubFixture());

    expect(parsed.packagePath).toBe("EPUB/package.opf");
  });

  it("extracts OPF title, language, and creator metadata", () => {
    const parsed = readEpub(buildMinimalEpubFixture());

    expect(parsed.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "title", value: "Fixture Book" }),
        expect.objectContaining({ key: "language", value: "en" }),
        expect.objectContaining({ key: "creator", value: "Fixture Author" }),
      ])
    );
  });

  it("extracts manifest resources with resolved hrefs and data", () => {
    const parsed = readEpub(buildMinimalEpubFixture());

    expect(parsed.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "chapter-1",
          href: "chapter-1.xhtml",
          absoluteHref: "EPUB/chapter-1.xhtml",
          mediaType: "application/xhtml+xml",
          text: expect.stringContaining("Chapter One"),
        }),
        expect.objectContaining({
          id: "styles",
          absoluteHref: "EPUB/styles/book.css",
          mediaType: "text/css",
          text: "body { font-family: serif; }",
        }),
        expect.objectContaining({
          id: "cover",
          absoluteHref: "EPUB/images/cover.png",
          mediaType: "image/png",
          properties: ["cover-image"],
        }),
      ])
    );
  });

  it("extracts spine order from OPF itemrefs", () => {
    const parsed = readEpub(buildMinimalEpubFixture());

    expect(parsed.spine).toEqual([
      expect.objectContaining({
        idref: "chapter-1",
        href: "chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        index: 0,
        linear: true,
      }),
    ]);
  });

  it("parses EPUB3 nav.xhtml toc entries with resolved hrefs and labels", () => {
    const parsed = readEpub(buildEpubWithNavFixture());

    expect(parsed.nav).toEqual([
      { href: "EPUB/chapter-1.xhtml", label: "The Beginning", children: [] },
      {
        href: "EPUB/text/chapter-2.xhtml",
        label: "Rising Action",
        children: [{ href: "EPUB/text/chapter-2.xhtml", label: "A Scene", children: [] }],
      },
    ]);
  });

  it("parses EPUB2 NCX navMap entries with resolved hrefs and labels", () => {
    const parsed = readEpub(buildEpubWithNcxFixture());

    expect(parsed.nav).toEqual([
      { href: "EPUB/chapter-1.xhtml", label: "The Beginning", children: [] },
      { href: "EPUB/chapter-2.xhtml", label: "Rising Action", children: [] },
    ]);
  });

  it("returns a blocking compatibility issue when container.xml is missing", () => {
    const parsed = readEpub(buildEpubWithoutContainerFixture());

    expect(parsed.issues).toEqual([
      expect.objectContaining({
        severity: "blocking",
        code: "missing-container",
      }),
    ]);
  });

  it("returns a blocking compatibility issue when the OPF is missing", () => {
    const parsed = readEpub(buildEpubWithoutOpfFixture());

    expect(parsed.issues).toEqual([
      expect.objectContaining({
        severity: "blocking",
        code: "missing-opf",
      }),
    ]);
  });

  it("detects encrypted EPUBs", () => {
    const parsed = readEpub(buildEncryptedEpubFixture());

    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "blocking",
          code: "encrypted-epub",
        }),
      ])
    );
  });
});
