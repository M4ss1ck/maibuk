// EPUB fixtures, built from this source at global setup into
// e2e/.output/fixtures/ (binaries stay out of git). Names and texts here are
// what the Import specs assert.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";

export const FIXTURE_DIR = resolve(import.meta.dirname, "../../.output/fixtures");

export const HARBOR_LOG = {
  file: "harbor-log.epub",
  title: "The Harbor Log",
  author: "Mira Dune",
  chapters: [
    { title: "High Tide", text: "The boats came home before the bell." },
    { title: "Low Tide", text: "At low tide the harbor showed its bones." },
  ],
} as const;

export const LOCKED_EPUB = { file: "locked.epub", title: "Locked Volume" } as const;

function chapterXhtml(title: string, text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1><p>${text}</p></body></html>`;
}

function container(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
}

/** EPUB 3 with a nav, two Chapters, and an audio file the editor cannot hold (a lossy warning). */
function harborLog(): Uint8Array {
  const items = HARBOR_LOG.chapters
    .map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("\n    ");
  const spine = HARBOR_LOG.chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("");
  const navLinks = HARBOR_LOG.chapters
    .map((c, i) => `<li><a href="c${i + 1}.xhtml">${c.title}</a></li>`)
    .join("");
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:e2e-harbor-log</dc:identifier>
    <dc:title>${HARBOR_LOG.title}</dc:title>
    <dc:creator>${HARBOR_LOG.author}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${items}
    <item id="bells" href="bells.mp3" media-type="audio/mpeg"/>
  </manifest>
  <spine>${spine}</spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>${navLinks}</ol></nav></body></html>`;
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(container()),
    "EPUB/package.opf": strToU8(opf),
    "EPUB/nav.xhtml": strToU8(nav),
    "EPUB/bells.mp3": new Uint8Array([0x49, 0x44, 0x33]),
  };
  HARBOR_LOG.chapters.forEach((c, i) => {
    files[`EPUB/c${i + 1}.xhtml`] = strToU8(chapterXhtml(c.title, c.text));
  });
  return zipSync(files);
}

/** DRM-style encryption.xml makes the Compatibility Report block the import. */
function locked(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:e2e-locked</dc:identifier>
    <dc:title>${LOCKED_EPUB.title}</dc:title><dc:language>en</dc:language>
  </metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(container()),
    "META-INF/encryption.xml": strToU8(
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"/></encryption>`
    ),
    "EPUB/package.opf": strToU8(opf),
    "EPUB/c1.xhtml": strToU8(chapterXhtml("Sealed", "Nobody reads this.")),
  });
}

export async function writeEpubFixtures(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(resolve(FIXTURE_DIR, HARBOR_LOG.file), harborLog());
  await writeFile(resolve(FIXTURE_DIR, LOCKED_EPUB.file), locked());
}

/** Committed text fixtures (e2e/fixtures/). */
export const TEXT_FIXTURE_DIR = resolve(import.meta.dirname, "../../fixtures");
