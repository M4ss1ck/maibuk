import { describe, expect, it } from "vitest";
import {
  buildEncryptedEpubFixture,
  buildEpubFixture,
  buildEpubWithoutOpfFixture,
  buildMinimalEpubFixture,
} from "../../../support/epub-fixtures";
import { buildImportPreview, scanEpub } from "../../../../features/import/epub-scanner";
import { readEpub } from "../../../../features/import/epub-reader";

describe("scanEpub()", () => {
  it("reports encrypted EPUBs as blocking", () => {
    const report = scanEpub(buildEncryptedEpubFixture());

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "blocking", code: "encrypted-epub" }),
      ])
    );
  });

  it("reports missing OPF files as blocking", () => {
    const report = scanEpub(buildEpubWithoutOpfFixture());

    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "blocking", code: "missing-opf" })])
    );
  });

  it("reports CSS resources as supported importable resources", () => {
    const report = scanEpub(buildMinimalEpubFixture());

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "info", code: "css-resource", href: "EPUB/styles/book.css" }),
      ])
    );
  });

  it("reports image and font resources as supported importable resources", () => {
    const report = scanEpub(
      buildEpubFixture({
        extraFiles: {
          "EPUB/chapter-1.xhtml": "<html><body><p>One</p></body></html>",
          "EPUB/images/cover.png": new Uint8Array([137, 80, 78, 71]),
          "EPUB/fonts/book.woff2": new Uint8Array([1, 2, 3]),
        },
        opf: `<?xml version="1.0" encoding="UTF-8"?>
          <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Assets</dc:title></metadata>
            <manifest>
              <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
              <item id="cover" href="images/cover.png" media-type="image/png" />
              <item id="font" href="fonts/book.woff2" media-type="font/woff2" />
            </manifest>
            <spine><itemref idref="chapter-1" /></spine>
          </package>`,
      })
    );

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "info", code: "asset-resource", href: "EPUB/images/cover.png" }),
        expect.objectContaining({ severity: "info", code: "asset-resource", href: "EPUB/fonts/book.woff2" }),
      ])
    );
  });

  it("reports unsupported media types as lossy", () => {
    const report = scanEpub(
      buildEpubFixture({
        extraFiles: {
          "EPUB/chapter-1.xhtml": "<html><body><p>One</p></body></html>",
          "EPUB/audio/theme.mp3": new Uint8Array([1, 2, 3]),
        },
        opf: `<?xml version="1.0" encoding="UTF-8"?>
          <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Audio</dc:title></metadata>
            <manifest>
              <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
              <item id="audio" href="audio/theme.mp3" media-type="audio/mpeg" />
            </manifest>
            <spine><itemref idref="chapter-1" /></spine>
          </package>`,
      })
    );

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "lossy", code: "unsupported-media-type", href: "EPUB/audio/theme.mp3" }),
      ])
    );
  });

  it("reports EPUB 2 NCX as informational instead of blocking", () => {
    const report = scanEpub(
      buildEpubFixture({
        extraFiles: {
          "EPUB/chapter-1.xhtml": "<html><body><p>One</p></body></html>",
          "EPUB/toc.ncx": "<ncx></ncx>",
        },
        opf: `<?xml version="1.0" encoding="UTF-8"?>
          <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB 2</dc:title></metadata>
            <manifest>
              <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
              <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml" />
            </manifest>
            <spine toc="toc"><itemref idref="chapter-1" /></spine>
          </package>`,
      })
    );

    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "epub2-ncx" })])
    );
    expect(report.issues.find((issue) => issue.code === "epub2-ncx")?.severity).not.toBe("blocking");
  });
});

describe("buildImportPreview()", () => {
  it("returns preview counts for chapters, assets, CSS files, and metadata entries", () => {
    const preview = buildImportPreview(readEpub(buildMinimalEpubFixture()));

    expect(preview).toMatchObject({
      title: "Fixture Book",
      author: "Fixture Author",
      language: "en",
      chapterCount: 1,
      assetCount: 1,
      styleCount: 1,
      metadataCount: 4,
    });
  });
});
