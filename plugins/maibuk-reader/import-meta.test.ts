// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readFileMeta } from "./import-meta";
import type { DocumentFormat } from "./shelf";

const reader = (bytes: Uint8Array) => async (o: number, l: number) => bytes.subarray(o, o + l);

const FIXTURES = join(__dirname, "fixtures");
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

async function meta(bytes: Uint8Array, format: DocumentFormat) {
  return readFileMeta(reader(bytes), bytes.byteLength, format, bytes.subarray(0, 64 * 1024));
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function opf(titleXml: string, creatorXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${titleXml}
    ${creatorXml}
  </metadata>
  <manifest></manifest>
</package>`;
}

function epub(level: 0 | 6, opfXml: string): Uint8Array {
  return zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": [strToU8(CONTAINER), { level }],
    "OEBPS/content.opf": [strToU8(opfXml), { level }],
  });
}

function cbz(files: Record<string, string>): Uint8Array {
  const out: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [name, text] of Object.entries(files)) out[name] = [strToU8(text), { level: 6 }];
  return zipSync(out);
}

/** A PalmDB file with one MOBI record0, a 232-byte MOBI header, and an optional EXTH block. */
function mobi(opts: {
  encoding: number;
  fullName: string;
  exth: Array<[number, Uint8Array]> | null;
}): Uint8Array {
  const r0 = 86; // 78-byte PalmDB header, then one 8-byte record-info entry
  const mobiLen = 232;
  const exthBytes = opts.exth
    ? opts.exth.reduce((sum, [, data]) => sum + 8 + data.byteLength, 12)
    : 0;
  const exthStart = 16 + mobiLen; // relative to record0
  const nameOff = exthStart + exthBytes;
  const name = Uint8Array.from(opts.fullName, (c) => c.charCodeAt(0));
  const total = r0 + nameOff + name.byteLength;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint16(76, 1); // record count
  dv.setUint32(78, r0); // record 0 offset
  dv.setUint16(r0, 1); // PalmDOC compression
  buf.set(strToU8("MOBI"), r0 + 16);
  dv.setUint32(r0 + 20, mobiLen);
  dv.setUint32(r0 + 28, opts.encoding);
  dv.setUint32(r0 + 84, nameOff);
  dv.setUint32(r0 + 88, name.byteLength);
  dv.setUint32(r0 + 128, opts.exth ? 0x40 : 0);
  buf.set(name, r0 + nameOff);
  if (opts.exth) {
    const at = r0 + exthStart;
    buf.set(strToU8("EXTH"), at);
    dv.setUint32(at + 4, exthBytes);
    dv.setUint32(at + 8, opts.exth.length);
    let p = at + 12;
    for (const [type, data] of opts.exth) {
      dv.setUint32(p, type);
      dv.setUint32(p + 4, 8 + data.byteLength);
      buf.set(data, p + 8);
      p += 8 + data.byteLength;
    }
  }
  return buf;
}

/** Latin-1 bytes: each character is one byte, which is how a PDF literal stores Western text. */
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe("readFileMeta: epub", () => {
  const opf1 = opf("<dc:title>Middlemarch</dc:title>", "<dc:creator>George Eliot</dc:creator>");

  it("reads title and author from a deflated EPUB", async () => {
    expect(await meta(epub(6, opf1), "epub")).toEqual({
      title: "Middlemarch",
      author: "George Eliot",
    });
  });

  it("reads title and author from a stored EPUB", async () => {
    expect(await meta(epub(0, opf1), "epub")).toEqual({
      title: "Middlemarch",
      author: "George Eliot",
    });
  });

  it("decodes XML entities", async () => {
    const xml = opf(
      "<dc:title>Pride &amp; Prejudice &#x2014; &#8220;Vol. 1&#8221;</dc:title>",
      "<dc:creator>Jane &apos;Austen&apos;</dc:creator>"
    );
    expect(await meta(epub(6, xml), "epub")).toEqual({
      title: "Pride & Prejudice — “Vol. 1”",
      author: "Jane 'Austen'",
    });
  });

  it("accepts a title with an id attribute and a varying prefix", async () => {
    const xml = opf('<dc:title id="t">Emma</dc:title>', "<dc:creator>Jane Austen</dc:creator>");
    expect((await meta(epub(6, xml), "epub")).title).toBe("Emma");
    const plain = `<?xml version="1.0"?><package><metadata><title>Persuasion</title><creator>J. A.</creator></metadata></package>`;
    expect(await meta(epub(6, plain), "epub")).toEqual({ title: "Persuasion", author: "J. A." });
  });

  it("strips inner tags and collapses whitespace", async () => {
    const xml = opf("<dc:title>  The   <span>Long</span>\n  Road </dc:title>", "");
    expect((await meta(epub(6, xml), "epub")).title).toBe("The Long Road");
  });

  it("returns empty fields when the OPF names neither", async () => {
    expect(await meta(epub(6, opf("", "")), "epub")).toEqual({ title: "", author: "" });
  });
});

describe("readFileMeta: cbz", () => {
  it("reads Title and Writer from ComicInfo.xml at the root", async () => {
    const info = "<ComicInfo><Title>Akira</Title><Writer>Katsuhiro Otomo</Writer></ComicInfo>";
    expect(await meta(cbz({ "ComicInfo.xml": info, "001.jpg": "x" }), "cbz")).toEqual({
      title: "Akira",
      author: "Katsuhiro Otomo",
    });
  });

  it("finds ComicInfo.xml in a folder, case-insensitively", async () => {
    const info = "<ComicInfo><Title>Monster</Title><Writer>Naoki Urasawa</Writer></ComicInfo>";
    expect(await meta(cbz({ "vol1/comicinfo.XML": info, "vol1/001.jpg": "x" }), "cbz")).toEqual({
      title: "Monster",
      author: "Naoki Urasawa",
    });
  });

  it("prefers the root ComicInfo.xml over a nested one", async () => {
    const nested = "<ComicInfo><Title>Nested</Title></ComicInfo>";
    const root = "<ComicInfo><Title>Root</Title></ComicInfo>";
    const bytes = cbz({ "sub/ComicInfo.xml": nested, "ComicInfo.xml": root });
    expect((await meta(bytes, "cbz")).title).toBe("Root");
  });

  it("returns empty fields when there is no ComicInfo.xml", async () => {
    expect(await meta(cbz({ "001.jpg": "x" }), "cbz")).toEqual({ title: "", author: "" });
  });
});

describe("readFileMeta: fb2", () => {
  const fb2 = (titleInfo: string) =>
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    ${titleInfo}
  </description>
  <body><section><p>Hello</p></section></body>
</FictionBook>`;

  it("joins first, middle, and last name for the first author", async () => {
    const xml = fb2(`<title-info>
      <author><first-name>Leo</first-name><middle-name>Nikolayevich</middle-name><last-name>Tolstoy</last-name></author>
      <author><first-name>Second</first-name></author>
      <book-title>War and Peace</book-title>
    </title-info>`);
    expect(await meta(new TextEncoder().encode(xml), "fb2")).toEqual({
      title: "War and Peace",
      author: "Leo Nikolayevich Tolstoy",
    });
  });

  it("skips empty name parts", async () => {
    const xml = fb2(
      `<title-info><author><first-name>Ada</first-name><middle-name></middle-name><last-name>Lovelace</last-name></author><book-title>Notes</book-title></title-info>`
    );
    expect((await meta(new TextEncoder().encode(xml), "fb2")).author).toBe("Ada Lovelace");
  });

  it("falls back to the nickname when there are no name parts", async () => {
    const xml = fb2(
      `<title-info><author><nickname>Quill</nickname></author><book-title>Zines</book-title></title-info>`
    );
    expect(await meta(new TextEncoder().encode(xml), "fb2")).toEqual({
      title: "Zines",
      author: "Quill",
    });
  });

  it("ignores book-title outside title-info", async () => {
    const xml = `<FictionBook><description><src-title-info><book-title>Source</book-title></src-title-info></description></FictionBook>`;
    expect(await meta(new TextEncoder().encode(xml), "fb2")).toEqual({ title: "", author: "" });
  });
});

describe("readFileMeta: mobi and azw3", () => {
  const utf8 = new TextEncoder();

  it("reads the EXTH updated title (503) and the author (100)", async () => {
    const bytes = mobi({
      encoding: 65001,
      fullName: "ignored full name",
      exth: [
        [100, utf8.encode("Mary Shelley")],
        [503, utf8.encode("Frankenstein édition")],
        [100, utf8.encode("Second Author")],
      ],
    });
    expect(await meta(bytes, "mobi")).toEqual({
      title: "Frankenstein édition",
      author: "Mary Shelley",
    });
    expect(await meta(bytes, "azw3")).toEqual({
      title: "Frankenstein édition",
      author: "Mary Shelley",
    });
  });

  it("decodes windows-1252 when the header says so", async () => {
    const bytes = mobi({
      encoding: 1252,
      fullName: "x",
      exth: [
        [503, latin1("Señor")],
        [100, latin1("José Martí")],
      ],
    });
    expect(await meta(bytes, "mobi")).toEqual({ title: "Señor", author: "José Martí" });
  });

  it("falls back to the full name when there is no 503", async () => {
    const bytes = mobi({
      encoding: 65001,
      fullName: "Full Name Title",
      exth: [[100, utf8.encode("Author A")]],
    });
    expect(await meta(bytes, "mobi")).toEqual({ title: "Full Name Title", author: "Author A" });
  });

  it("uses the full name when EXTH is absent", async () => {
    const bytes = mobi({ encoding: 65001, fullName: "Bare Title", exth: null });
    expect(await meta(bytes, "mobi")).toEqual({ title: "Bare Title", author: "" });
  });

  it("returns empty fields when the MOBI magic is missing", async () => {
    const bytes = mobi({ encoding: 65001, fullName: "T", exth: null });
    bytes.set(strToU8("XXXX"), 86 + 16);
    expect(await meta(bytes, "mobi")).toEqual({ title: "", author: "" });
  });

  it("reads the committed fixture", async () => {
    // No EXTH block: the title is the full name in record0 ("Notes").
    expect(await meta(fixture("story.mobi"), "mobi")).toEqual({ title: "Notes", author: "" });
  });
});

describe("readFileMeta: pdf", () => {
  const pdf = (body: string) =>
    latin1(`%PDF-1.4\n${body}\ntrailer << /Root 9 0 R /Info 1 0 R >>\n%%EOF\n`);

  it("reads only the information dictionary, never an outline item's /Title", async () => {
    const bytes = pdf(
      "5 0 obj << /Title (Chapter One) /Parent 4 0 R >> endobj\n1 0 obj << /Producer (x) >> endobj"
    );
    expect(await meta(bytes, "pdf")).toEqual({ title: "", author: "" });
  });
  it("reads a literal title with backslash escapes", async () => {
    const bytes = pdf("1 0 obj << /Title (Moby\\-Dick) /Author (Herman Melville) >> endobj");
    expect(await meta(bytes, "pdf")).toEqual({ title: "Moby-Dick", author: "Herman Melville" });
  });

  it("decodes octal escapes and nested balanced parentheses", async () => {
    const bytes = pdf("1 0 obj << /Title (Moby\\050Dick\\051 (Vol. 1)) >>");
    expect((await meta(bytes, "pdf")).title).toBe("Moby(Dick) (Vol. 1)");
  });

  it("decodes a UTF-16BE hex title with a BOM", async () => {
    const bytes = pdf("1 0 obj << /Title <FEFF00DC00620065 0072> >>");
    expect((await meta(bytes, "pdf")).title).toBe("Über");
  });

  it("skips a non-string value and takes the next string", async () => {
    const bytes = pdf("1 0 obj << /Title 12 0 R /Title (Second) >> endobj");
    expect((await meta(bytes, "pdf")).title).toBe("Second");
  });

  it("finds the info dictionary in the last 64 KB of a large file", async () => {
    const padding = "%".repeat(200_000);
    const bytes = pdf(`${padding}\n1 0 obj << /Title (At The End) >> endobj`);
    expect((await meta(bytes, "pdf")).title).toBe("At The End");
  });

  it("reads the committed fixture without throwing", async () => {
    const result = await meta(fixture("twelve-pages.pdf"), "pdf");
    // Its outline names chapters with /Title; it has no information dictionary title.
    expect(result).toEqual({ title: "", author: "" });
  });
});

describe("readFileMeta: resilience", () => {
  const garbage = new TextEncoder().encode("this is not a book at all \u0000ÿ\u0001 random");
  const formats: DocumentFormat[] = ["epub", "cbz", "fb2", "mobi", "azw3", "pdf"];

  for (const format of formats) {
    it(`returns empty fields for garbage bytes as ${format}`, async () => {
      await expect(meta(garbage, format)).resolves.toEqual({ title: "", author: "" });
    });
  }

  it("returns empty fields for an empty file", async () => {
    for (const format of formats) {
      await expect(meta(new Uint8Array(0), format)).resolves.toEqual({ title: "", author: "" });
    }
  });

  it("never throws when the reader rejects", async () => {
    const failing = async () => {
      throw new Error("disk gone");
    };
    // Size exceeds the head, so the PDF path must read the tail and the read rejects.
    await expect(readFileMeta(failing, 200, "pdf", new Uint8Array(100))).resolves.toEqual({
      title: "",
      author: "",
    });
  });

  it("reads the committed EPUB fixture", async () => {
    expect(await meta(fixture("flowing.epub"), "epub")).toEqual({
      title: "Dune",
      author: "Frank Herbert",
    });
  });

  it("reads the committed FB2 fixture", async () => {
    expect(await meta(fixture("story.fb2"), "fb2")).toEqual({
      title: "Notes from the Archive",
      author: "Ada Lovelace",
    });
  });
});
