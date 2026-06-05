import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { normalizeEpubProject } from "../../../../features/import/epub-normalizer";
import type { ParsedEpub } from "../../../../features/import/types";

function buildParsedEpub(overrides: Partial<ParsedEpub> = {}): ParsedEpub {
  return {
    packagePath: "EPUB/package.opf",
    epubVersion: "3.0",
    metadata: [
      {
        namespace: "http://purl.org/dc/elements/1.1/",
        key: "title",
        value: "Imported Novel",
        attributes: {},
        order: 0,
      },
      {
        namespace: "http://purl.org/dc/elements/1.1/",
        key: "creator",
        value: "Primary Author",
        attributes: { id: "creator-1" },
        order: 1,
      },
      {
        namespace: "http://purl.org/dc/elements/1.1/",
        key: "creator",
        value: "Second Author",
        attributes: { id: "creator-2" },
        order: 2,
      },
      {
        namespace: "http://purl.org/dc/elements/1.1/",
        key: "language",
        value: "es",
        attributes: {},
        order: 3,
      },
      {
        namespace: "http://purl.org/dc/elements/1.1/",
        key: "description",
        value: "A fixture EPUB.",
        attributes: {},
        order: 4,
      },
    ],
    resources: [
      {
        id: "chapter-1",
        href: "chapter-1.xhtml",
        absoluteHref: "EPUB/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        properties: [],
        data: strToU8("<html><head><title>Document Title</title></head><body><p>One</p></body></html>"),
        text: "<html><head><title>Document Title</title></head><body><p>One</p></body></html>",
      },
      {
        id: "style",
        href: "styles/book.css",
        absoluteHref: "EPUB/styles/book.css",
        mediaType: "text/css",
        properties: [],
        data: strToU8("body { font-family: serif; }"),
        text: "body { font-family: serif; }",
      },
      {
        id: "cover",
        href: "images/cover.png",
        absoluteHref: "EPUB/images/cover.png",
        mediaType: "image/png",
        properties: ["cover-image"],
        data: new Uint8Array([137, 80, 78, 71]),
      },
      {
        id: "font",
        href: "fonts/book.woff2",
        absoluteHref: "EPUB/fonts/book.woff2",
        mediaType: "font/woff2",
        properties: [],
        data: new Uint8Array([1, 2, 3]),
      },
    ],
    spine: [
      {
        idref: "chapter-1",
        href: "chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        linear: true,
        index: 0,
        properties: [],
      },
    ],
    nav: [{ href: "chapter-1.xhtml", label: "Navigation Title", children: [] }],
    issues: [],
    ...overrides,
  };
}

describe("normalizeEpubProject()", () => {
  it("maps title, language, description, and primary author into the book input", () => {
    const normalized = normalizeEpubProject(buildParsedEpub());

    expect(normalized.bookInput).toMatchObject({
      title: "Imported Novel",
      authorName: "Primary Author",
      description: "A fixture EPUB.",
      language: "es",
    });
  });

  it("maps multiple creators into rich metadata rows", () => {
    const normalized = normalizeEpubProject(buildParsedEpub());

    expect(normalized.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "creator", value: "Primary Author", order: 1 }),
        expect.objectContaining({ key: "creator", value: "Second Author", order: 2 }),
      ])
    );
  });

  it("maps CSS resources into book styles", () => {
    const normalized = normalizeEpubProject(buildParsedEpub());

    expect(normalized.styles).toEqual([
      expect.objectContaining({
        name: "book.css",
        css: "body { font-family: serif; }",
        sourceHref: "EPUB/styles/book.css",
        isDefault: true,
      }),
    ]);
  });

  it("maps image and font resources into project assets", () => {
    const normalized = normalizeEpubProject(buildParsedEpub());

    expect(normalized.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: "cover.png",
          href: "EPUB/images/cover.png",
          mediaType: "image/png",
          role: "cover",
          dataBase64: "iVBORw==",
        }),
        expect.objectContaining({
          filename: "book.woff2",
          href: "EPUB/fonts/book.woff2",
          mediaType: "font/woff2",
          dataBase64: "AQID",
        }),
      ])
    );
  });

  it("maps spine XHTML documents into ordered chapter inputs", () => {
    const normalized = normalizeEpubProject(buildParsedEpub());

    expect(normalized.chapters).toEqual([
      expect.objectContaining({
        title: "Navigation Title",
        content: "<p>One</p>",
        href: "EPUB/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        spineIndex: 0,
        linear: true,
      }),
    ]);
  });

  it("uses document title before generated chapter title fallback", () => {
    const parsed = buildParsedEpub({ nav: [] });

    expect(normalizeEpubProject(parsed).chapters[0].title).toBe("Document Title");

    const withoutTitle = buildParsedEpub({
      nav: [],
      resources: [
        {
          id: "chapter-1",
          href: "chapter-1.xhtml",
          absoluteHref: "EPUB/chapter-1.xhtml",
          mediaType: "application/xhtml+xml",
          properties: [],
          data: strToU8("<html><body><p>One</p></body></html>"),
          text: "<html><body><p>One</p></body></html>",
        },
      ],
    });

    expect(normalizeEpubProject(withoutTitle).chapters[0].title).toBe("Chapter 1");
  });
});
