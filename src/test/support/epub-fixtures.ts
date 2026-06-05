import { strToU8, zipSync } from "fflate";

interface EpubFixtureOptions {
  packagePath?: string;
  opf?: string;
  extraFiles?: Record<string, string | Uint8Array>;
}

function text(value: string): Uint8Array {
  return strToU8(value);
}

export function buildEpubFixture(options: EpubFixtureOptions = {}): Uint8Array {
  const packagePath = options.packagePath ?? "EPUB/package.opf";
  const opf = options.opf ?? buildMinimalOpf();
  const files: Record<string, Uint8Array> = {
    mimetype: text("application/epub+zip"),
    "META-INF/container.xml": text(buildContainerXml(packagePath)),
    [packagePath]: text(opf),
  };

  for (const [path, content] of Object.entries(options.extraFiles ?? {})) {
    files[path] = typeof content === "string" ? text(content) : content;
  }

  return zipSync(files);
}

export function buildMinimalEpubFixture(): Uint8Array {
  return buildEpubFixture({
    extraFiles: {
      "EPUB/chapter-1.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml">
          <head><title>Chapter One</title></head>
          <body><h1>Chapter One</h1><p>Hello.</p></body>
        </html>`,
      "EPUB/styles/book.css": "body { font-family: serif; }",
      "EPUB/images/cover.png": new Uint8Array([137, 80, 78, 71]),
      "EPUB/toc.ncx": "<ncx></ncx>",
    },
  });
}

function buildBookTitleChapter(n: number): string {
  // Real-world EPUBs commonly set every chapter's <title> to the book title.
  return `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head><title>Fixture Book</title></head>
      <body><h1>Heading ${n}</h1><p>Body of chapter ${n}.</p></body>
    </html>`;
}

export function buildEpubWithNavFixture(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">urn:uuid:test-book</dc:identifier>
        <dc:title>Fixture Book</dc:title>
        <dc:creator>Fixture Author</dc:creator>
        <dc:language>en</dc:language>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
        <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
        <item id="chapter-2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml" />
      </manifest>
      <spine>
        <itemref idref="chapter-1" />
        <itemref idref="chapter-2" />
      </spine>
    </package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <body>
        <nav epub:type="landmarks"><ol><li><a href="chapter-1.xhtml">Start</a></li></ol></nav>
        <nav epub:type="toc">
          <ol>
            <li><a href="chapter-1.xhtml">The Beginning</a></li>
            <li>
              <a href="text/chapter-2.xhtml#start">Rising Action</a>
              <ol><li><a href="text/chapter-2.xhtml#scene">A Scene</a></li></ol>
            </li>
          </ol>
        </nav>
      </body>
    </html>`;

  return buildEpubFixture({
    opf,
    extraFiles: {
      "EPUB/nav.xhtml": nav,
      "EPUB/chapter-1.xhtml": buildBookTitleChapter(1),
      "EPUB/text/chapter-2.xhtml": buildBookTitleChapter(2),
    },
  });
}

export function buildEpubWithNcxFixture(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">urn:uuid:test-book</dc:identifier>
        <dc:title>Fixture Book</dc:title>
        <dc:creator>Fixture Author</dc:creator>
        <dc:language>en</dc:language>
      </metadata>
      <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
        <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
        <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml" />
      </manifest>
      <spine toc="ncx">
        <itemref idref="chapter-1" />
        <itemref idref="chapter-2" />
      </spine>
    </package>`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
    <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
      <navMap>
        <navPoint id="np-1" playOrder="1">
          <navLabel><text>The Beginning</text></navLabel>
          <content src="chapter-1.xhtml" />
        </navPoint>
        <navPoint id="np-2" playOrder="2">
          <navLabel><text>Rising Action</text></navLabel>
          <content src="chapter-2.xhtml#start" />
        </navPoint>
      </navMap>
    </ncx>`;

  return buildEpubFixture({
    opf,
    extraFiles: {
      "EPUB/toc.ncx": ncx,
      "EPUB/chapter-1.xhtml": buildBookTitleChapter(1),
      "EPUB/chapter-2.xhtml": buildBookTitleChapter(2),
    },
  });
}

export function buildEpubWithoutContainerFixture(): Uint8Array {
  return zipSync({
    mimetype: text("application/epub+zip"),
    "EPUB/package.opf": text(buildMinimalOpf()),
  });
}

export function buildEpubWithoutOpfFixture(): Uint8Array {
  return zipSync({
    mimetype: text("application/epub+zip"),
    "META-INF/container.xml": text(buildContainerXml("EPUB/missing.opf")),
  });
}

export function buildEncryptedEpubFixture(): Uint8Array {
  return buildEpubFixture({
    extraFiles: {
      "META-INF/encryption.xml": `<?xml version="1.0" encoding="UTF-8"?>
        <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"></EncryptedData>
        </encryption>`,
      "EPUB/chapter-1.xhtml": "<html><body><p>Encrypted marker.</p></body></html>",
    },
  });
}

function buildContainerXml(packagePath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="${packagePath}" media-type="application/oebps-package+xml" />
      </rootfiles>
    </container>`;
}

function buildMinimalOpf(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">urn:uuid:test-book</dc:identifier>
        <dc:title>Fixture Book</dc:title>
        <dc:creator>Fixture Author</dc:creator>
        <dc:language>en</dc:language>
      </metadata>
      <manifest>
        <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
        <item id="styles" href="styles/book.css" media-type="text/css" />
        <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image" />
        <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml" />
      </manifest>
      <spine toc="toc">
        <itemref idref="chapter-1" />
      </spine>
    </package>`;
}
