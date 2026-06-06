import { describe, expect, it } from "vitest";
import { buildBook, buildChapter } from "../../../support/fixtures";
import { buildProjectEpubPackage } from "../../../../features/export/project-epub-generator";
import type { BookMetadata, BookStyle } from "../../../../features/import/epub-project-repo";
import type { ProjectAsset } from "../../../../features/import/project-assets-repo";

const now = new Date("2026-06-01T12:00:00.000Z");

const importedCss: BookStyle = {
  id: "style-1",
  bookId: "book-1",
  name: "Imported",
  css: "body { font-family: serif; }",
  sourceHref: "EPUB/styles/book.css",
  isDefault: true,
  createdAt: now,
  updatedAt: now,
};

const coverAsset: ProjectAsset = {
  id: "asset-cover",
  bookId: "book-1",
  filename: "cover.png",
  href: "EPUB/images/cover.png",
  mediaType: "image/png",
  role: "cover",
  dataBase64: "iVBORw==",
  textContent: null,
  sizeBytes: 4,
  checksum: null,
  createdAt: now,
  updatedAt: now,
};

const metadata: BookMetadata[] = [
  {
    id: "meta-creator-2",
    bookId: "book-1",
    namespace: "http://purl.org/dc/elements/1.1/",
    key: "creator",
    value: "Second Author",
    attributes: { id: "creator-2" },
    order: 2,
    createdAt: now,
    updatedAt: now,
  },
];

describe("buildProjectEpubPackage()", () => {
  it("includes custom book CSS when selected", () => {
    const pkg = buildProjectEpubPackage({
      book: buildBook({ id: "book-1" }),
      chapters: [buildChapter({ bookId: "book-1", content: "<p>One</p>" })],
      metadata: [],
      styles: [importedCss],
      assets: [],
      options: { includeImportedStyles: true, useMaibukStyles: false, generateMaibukToc: true },
    });

    expect(pkg.css).toContain("body { font-family: serif; }");
  });

  it("includes project assets referenced by chapters and styles", () => {
    const pkg = buildProjectEpubPackage({
      book: buildBook({ id: "book-1" }),
      chapters: [
        buildChapter({
          bookId: "book-1",
          content: '<p>Cover</p><figure data-image=""><img src="maibuk-asset:asset-cover"></figure>',
        }),
      ],
      metadata: [],
      styles: [
        {
          ...importedCss,
          css: "body { background-image: url('maibuk-asset:asset-cover'); }",
        },
      ],
      assets: [coverAsset],
      options: { includeImportedStyles: true, useMaibukStyles: false, generateMaibukToc: true },
    });

    expect(pkg.assets).toEqual([
      expect.objectContaining({
        id: "asset-cover",
        filename: "cover.png",
        mediaType: "image/png",
      }),
    ]);
    expect(pkg.chapters[0].content).toContain("assets/cover.png");
    expect(pkg.css).toContain("assets/cover.png");
  });

  it("includes rich metadata rows in OPF metadata", () => {
    const pkg = buildProjectEpubPackage({
      book: buildBook({ id: "book-1", title: "Novel", authorName: "Primary Author" }),
      chapters: [buildChapter({ bookId: "book-1" })],
      metadata,
      styles: [],
      assets: [],
      options: { includeImportedStyles: false, useMaibukStyles: true, generateMaibukToc: true },
    });

    expect(pkg.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "creator", value: "Second Author", attributes: { id: "creator-2" } }),
      ])
    );
  });

  it("can generate TOC entries from Maibuk chapter order", () => {
    const pkg = buildProjectEpubPackage({
      book: buildBook({ id: "book-1" }),
      chapters: [
        buildChapter({ bookId: "book-1", title: "Second", order: 2 }),
        buildChapter({ bookId: "book-1", title: "First", order: 1 }),
      ],
      metadata: [],
      styles: [],
      assets: [],
      options: { includeImportedStyles: false, useMaibukStyles: true, generateMaibukToc: true },
    });

    expect(pkg.toc).toEqual([
      { title: "First", href: "chapters/chapter-1.xhtml" },
      { title: "Second", href: "chapters/chapter-2.xhtml" },
    ]);
  });

  it("can disable imported styling in favor of Maibuk defaults", () => {
    const pkg = buildProjectEpubPackage({
      book: buildBook({ id: "book-1" }),
      chapters: [buildChapter({ bookId: "book-1" })],
      metadata: [],
      styles: [importedCss],
      assets: [],
      options: { includeImportedStyles: false, useMaibukStyles: true, generateMaibukToc: true },
    });

    expect(pkg.css).not.toContain("body { font-family: serif; }");
    expect(pkg.css).toContain("font-family: Georgia");
  });
});
