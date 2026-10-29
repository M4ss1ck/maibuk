/**
 * Writes Reader's small fixtures (#653): PDFs, EPUBs, a CBZ, an FB2, and
 * MOBI/AZW3 files. Every object is written by hand here, with no third-party
 * code and no fonts or images, so the files stay tiny, readable, and
 * deterministic: running this script again leaves the tree unchanged.
 *
 * The password file uses PDF's Standard security handler, revision 2 (RC4,
 * 40-bit), which the format documents in full; MD5 and RC4 are implemented
 * below because no PDF library is a Reader dependency. `qpdf` is not needed.
 *
 * The archives are stored-entry zips written by {@link buildZip}, and the
 * images are the smallest valid PNGs {@link buildPng} can produce. The MOBI and
 * AZW3 files carry a PalmDB header, a PalmDOC header, and one text record; the
 * AZW3 marks itself KF8 without the INDX tables a real KF8 needs, so it exercises
 * the unreadable path rather than a full parse.
 *
 * Run: node plugins/maibuk-reader/scripts/generate-fixtures.mjs
 *
 * It sits in `scripts/`, not beside the fixtures: the Plugin tooling's import
 * boundary refuses Node builtins outside test files, and `scripts/` is the one
 * folder it never walks. The files it writes still land in `../fixtures`.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

/** The `fixtures/` folder beside this script's own `scripts/` folder. */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** The user and owner passwords the password fixture opens with. */
export const PASSWORD = "reader";
const OWNER_PASSWORD = "maibuk";

/** The 32-byte password padding from the PDF specification (Algorithm 2). */
const PASSWORD_PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/** MD5's per-round left-rotation schedule. */
const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

/** MD5's sine-derived constants. */
const MD5_K = Array.from(
  { length: 64 },
  (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0
);

/** MD5 of `input`, as 16 bytes. Enough for PDF's R2 password hashing. */
export function md5(input) {
  const bytes = Uint8Array.from(input);
  const bitLength = bytes.length * 8;
  const total = (((bytes.length + 8) >> 6) << 6) + 64;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(total - 8, bitLength >>> 0, true);
  view.setUint32(total - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let offset = 0; offset < total; offset += 64) {
    const words = [];
    for (let index = 0; index < 16; index += 1) {
      words.push(view.getUint32(offset + index * 4, true));
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let mixed;
      let word;
      if (index < 16) {
        mixed = (b & c) | (~b & d);
        word = index;
      } else if (index < 32) {
        mixed = (d & b) | (~d & c);
        word = (5 * index + 1) % 16;
      } else if (index < 48) {
        mixed = b ^ c ^ d;
        word = (3 * index + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        word = (7 * index) % 16;
      }
      const sum = (mixed + a + MD5_K[index] + words[word]) >>> 0;
      const shift = MD5_SHIFTS[(index >> 4) * 4 + (index % 4)];
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  const out = new DataView(digest.buffer);
  out.setUint32(0, a0, true);
  out.setUint32(4, b0, true);
  out.setUint32(8, c0, true);
  out.setUint32(12, d0, true);
  return digest;
}

/** RC4 of `data` under `key`. */
export function rc4(key, data) {
  const state = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) state[index] = index;
  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (j + state[index] + key[index % key.length]) & 255;
    const swap = state[index];
    state[index] = state[j];
    state[j] = swap;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let index = 0; index < data.length; index += 1) {
    i = (i + 1) & 255;
    j = (j + state[i]) & 255;
    const swap = state[i];
    state[i] = state[j];
    state[j] = swap;
    out[index] = data[index] ^ state[(state[i] + state[j]) & 255];
  }
  return out;
}

/** `password`, padded to the 32 bytes the Standard security handler hashes. */
function paddedPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const padded = new Uint8Array(32);
  padded.set(PASSWORD_PADDING);
  padded.set(bytes.slice(0, 32));
  return padded;
}

/** The `/O` entry: the user password encrypted under the owner key. */
function ownerEntry(userPassword, ownerPassword) {
  const key = md5(paddedPassword(ownerPassword)).slice(0, 5);
  return rc4(key, paddedPassword(userPassword));
}

/** The `/U` entry: the padding encrypted under the user key. */
function userEntry(userPassword) {
  const key = md5(paddedPassword(userPassword)).slice(0, 5);
  return rc4(key, PASSWORD_PADDING);
}

function hex(bytes) {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0").toUpperCase();
  return text;
}

/**
 * Assembles a classic xref-table PDF from object bodies, in order, with a fixed
 * trailer so the file is byte-for-byte reproducible.
 */
function buildPdf(bodies, trailerEntries) {
  let text = "%PDF-1.4\n";
  const offsets = [];
  bodies.forEach((body, index) => {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${bodies.length + 1} ${trailerEntries} >>\n`;
  text += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text, "latin1");
}

/** A fixed file identifier, so the trailer carries one without a timestamp. */
const FILE_ID = "00112233445566778899AABBCCDDEEFF";

/** Twelve pages: roman prelims, then 1..10, an outline, and one nested section. */
export function buildTwelvePagePdf() {
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R /Outlines 15 0 R " +
      "/PageLabels << /Nums [0 << /S /r >> 2 << /S /D >>] >> >>",
  ];
  const kids = Array.from({ length: 12 }, (_, index) => `${index + 3} 0 R`).join(" ");
  bodies.push(`<< /Type /Pages /Kids [${kids}] /Count 12 >>`);
  for (let index = 0; index < 12; index += 1) {
    bodies.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>");
  }
  bodies.push("<< /Type /Outlines /First 16 0 R /Last 18 0 R /Count 4 >>");
  bodies.push("<< /Title (Chapter One) /Parent 15 0 R /Dest [3 0 R /Fit] /Next 17 0 R >>");
  bodies.push(
    "<< /Title (Chapter Two) /Parent 15 0 R /Dest [7 0 R /Fit] /Next 18 0 R " +
      "/First 19 0 R /Last 19 0 R /Count 1 >>"
  );
  bodies.push("<< /Title (Chapter Three) /Parent 15 0 R /Dest [11 0 R /Fit] /Prev 17 0 R >>");
  bodies.push("<< /Title (A Section) /Parent 17 0 R /Dest [9 0 R /Fit] >>");
  return buildPdf(bodies, `/Root 1 0 R /ID [<${FILE_ID}><${FILE_ID}>]`);
}

/** Two blank pages behind a Standard security handler, revision 2. */
export function buildPasswordPdf() {
  const R = 2;
  const keyLength = 5;
  const permissions = -4;
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    `<< /Filter /Standard /V 1 /R ${R} /Length ${keyLength * 8} ` +
      `/O <${hex(ownerEntry(PASSWORD, OWNER_PASSWORD))}> ` +
      `/U <${hex(userEntry(PASSWORD))}> /P ${permissions} >>`,
  ];
  return buildPdf(bodies, `/Root 1 0 R /Encrypt 5 0 R /ID [<${FILE_ID}><${FILE_ID}>]`);
}

/* Archives ---------------------------------------------------------------- */

/** CRC-32's lookup table, as the zip format defines it. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 of `bytes`, which every zip entry records. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const UTF8 = new TextEncoder();

/**
 * A zip whose entries are all stored (method 0), written by hand so the bytes
 * never depend on a library's timestamp or compression level. `files` is an
 * array of `{ name, data }`, with `data` a string or bytes, in archive order;
 * EPUB requires `mimetype` first and stored, and every entry here is stored.
 */
export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = UTF8.encode(file.name);
    const data = typeof file.data === "string" ? UTF8.encode(file.data) : file.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // fixed DOS time
    local.writeUInt16LE(0x0021, 12); // fixed DOS date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    local.set(name, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    central.set(name, 46);

    locals.push(local, Buffer.from(data));
    centrals.push(central);
    offset += local.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

/** One PNG chunk: length, type, data, and the CRC over type and data. */
function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A solid-colour RGB PNG, small enough to stay a few hundred bytes. */
export function buildPng(width, height, colour) {
  const [red, green, blue] = colour;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const at = y * stride + 1 + x * 3;
      raw[at] = red;
      raw[at + 1] = green;
      raw[at + 2] = blue;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* EPUB -------------------------------------------------------------------- */

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

/** One EPUB XHTML section. `body` is trusted fixture markup, not user input. */
function xhtml(title, body, head = "") {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
  <head>
    <title>${title}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
    ${head}
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

/** A nav document whose table of contents points at `entries`. */
function navDocument(entries) {
  const items = entries
    .map(([label, href]) => `        <li><a href="${href}">${label}</a></li>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>`;
}

const FLOW_STYLE = `body { font-family: serif; }
p { margin: 0 0 1em; }
.figure { background: url("images/figure.png"); }
.tracker { background: url(https://example.com/tracker.png); }
@import url("https://example.com/evil.css");
`;

const FLOW_CHAPTER_ONE = xhtml(
  "One",
  `<section epub:type="chapter" id="ch1">
      <h1>One</h1>
      <p>The spice must flow across Arrakis.</p>
      <p>Spice is life on Arrakis. The spice is the desert.</p>
      <p class="figure">A desert planet, drawn once and stored in the archive.</p>
      <img src="images/figure.png" alt="A figure"/>
      <img src="https://example.com/tracker.png" alt="A tracker"/>
      <img src="missing.png" alt="A missing figure"/>
      <p class="tracker">An external background belongs to nobody.</p>
    </section>`
);

const FLOW_CHAPTER_TWO = xhtml(
  "Two",
  `<section epub:type="chapter" id="ch2">
      <h1>Two</h1>
      <p>The journey continues past the desert.</p>
      <script>globalThis.__readerScriptRan = true;</script>
      <p onclick="globalThis.__readerHandlerRan = true">A paragraph with a handler.</p>
      <form action="https://example.com/collect"><input name="q"/></form>
      <iframe src="https://example.com/embed"></iframe>
      <p><a href="javascript:globalThis.__readerLinkRan = true">A script link</a></p>
      <p><a href="https://example.com/away">An external link</a></p>
    </section>`
);

const FLOW_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:00000000-0000-4000-8000-000000000653</dc:identifier>
    <dc:title>Dune</dc:title>
    <dc:creator>Frank Herbert</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="figure" href="images/figure.png" media-type="image/png"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

/** A reflowable EPUB: two chapters, a style sheet, a cover, and hostile markup. */
export function buildFlowingEpub() {
  return buildZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: CONTAINER_XML },
    { name: "OEBPS/content.opf", data: FLOW_OPF },
    {
      name: "OEBPS/nav.xhtml",
      data: navDocument([
        ["One", "chapter1.xhtml"],
        ["Two", "chapter2.xhtml"],
      ]),
    },
    { name: "OEBPS/chapter1.xhtml", data: FLOW_CHAPTER_ONE },
    { name: "OEBPS/chapter2.xhtml", data: FLOW_CHAPTER_TWO },
    { name: "OEBPS/style.css", data: FLOW_STYLE },
    { name: "OEBPS/images/cover.png", data: buildPng(16, 24, [180, 120, 60]) },
    { name: "OEBPS/images/figure.png", data: buildPng(8, 8, [40, 80, 160]) },
  ]);
}

const FIXED_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:00000000-0000-4000-8000-000000000654</dc:identifier>
    <dc:title>Plates</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    <item id="p1" href="page1.xhtml" media-type="application/xhtml+xml"/>
    <item id="p2" href="page2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img1" href="images/page1.png" media-type="image/png"/>
    <item id="img2" href="images/page2.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="p1"/>
    <itemref idref="p2"/>
  </spine>
</package>`;

/** One pre-paginated plate: a fixed viewport and a single image. */
function fixedPage(title, source) {
  return xhtml(
    title,
    `<img src="${source}" alt="${title}"/>`,
    '<meta name="viewport" content="width=600, height=800"/>'
  );
}

/** A fixed-layout EPUB: two pre-paginated pages sized 600×800. */
export function buildFixedLayoutEpub() {
  return buildZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: CONTAINER_XML },
    { name: "OEBPS/content.opf", data: FIXED_OPF },
    { name: "OEBPS/page1.xhtml", data: fixedPage("Plate one", "images/page1.png") },
    { name: "OEBPS/page2.xhtml", data: fixedPage("Plate two", "images/page2.png") },
    { name: "OEBPS/images/page1.png", data: buildPng(12, 16, [20, 40, 90]) },
    { name: "OEBPS/images/page2.png", data: buildPng(12, 16, [90, 40, 20]) },
  ]);
}

const ENCRYPTION_XML = `<?xml version="1.0" encoding="utf-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
            xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <enc:CipherData>
      <enc:CipherReference URI="OEBPS/chapter1.xhtml"/>
    </enc:CipherData>
  </enc:EncryptedData>
</encryption>`;

/** An EPUB whose content is DRM-encrypted: Reader must refuse it. */
export function buildEncryptedEpub() {
  return buildZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: CONTAINER_XML },
    { name: "META-INF/encryption.xml", data: ENCRYPTION_XML },
    { name: "OEBPS/content.opf", data: FLOW_OPF },
    { name: "OEBPS/chapter1.xhtml", data: FLOW_CHAPTER_ONE },
    { name: "OEBPS/chapter2.xhtml", data: FLOW_CHAPTER_TWO },
    { name: "OEBPS/style.css", data: FLOW_STYLE },
  ]);
}

/** Bytes that are not a zip at all: no end-of-central-directory record. */
export function buildCorruptEpub() {
  return Buffer.from("PK\u0003\u0004this is not a readable archive", "latin1");
}

/* CBZ --------------------------------------------------------------------- */

/** A comic book: eight PNG pages, named so natural order matters. */
export function buildComicBook() {
  const files = [{ name: "mimetype", data: "application/vnd.comicbook+zip" }];
  for (let index = 1; index <= 8; index += 1) {
    files.push({
      name: `page-${index}.png`,
      data: buildPng(10, 14, [index * 20, 60, 200 - index * 20]),
    });
  }
  return buildZip(files);
}

/* FB2 --------------------------------------------------------------------- */

const FB2_COVER = buildPng(16, 24, [60, 140, 90]).toString("base64");

/** A FictionBook with two sections and an embedded cover. */
export function buildFb2() {
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>fiction</genre>
      <author><first-name>Ada</first-name><last-name>Lovelace</last-name></author>
      <book-title>Notes from the Archive</book-title>
      <lang>en</lang>
      <coverpage><image l:href="#cover.png"/></coverpage>
    </title-info>
    <document-info>
      <author><nickname>Maibuk</nickname></author>
      <id>fixture-fb2</id>
      <version>1</version>
    </document-info>
  </description>
  <body>
    <title><p>Notes from the Archive</p></title>
    <section>
      <title><p>One</p></title>
      <p>The archive keeps every draft.</p>
    </section>
    <section>
      <title><p>Two</p></title>
      <p>A second section follows the first.</p>
    </section>
  </body>
  <binary id="cover.png" content-type="image/png">${FB2_COVER}</binary>
</FictionBook>
`,
    "utf8"
  );
}

/* MOBI and AZW3 ----------------------------------------------------------- */

/** The PalmDB header is 78 bytes, then one 8-byte offset per record, then a gap. */
const PDB_HEADER_SIZE = 78;
const PDB_GAP = 2;
const MOBI_TEXT_RECORD_SIZE = 4096;

/**
 * A PalmDB container with one text record. The PalmDOC header carries the
 * compression (1, none), the text length, the record count, and the encryption
 * flag; the MOBI header carries the identifier, version, and title.
 */
function buildPalmDoc({ title, text, version, encryption = 0 }) {
  const textBytes = UTF8.encode(text);
  const titleBytes = UTF8.encode(title);
  const headerLength = version >= 8 ? 264 : 232;
  const titleOffset = 16 + headerLength;

  // PalmDB, PalmDOC, and MOBI headers store every number big-endian.
  const record0 = Buffer.alloc(titleOffset + titleBytes.length);
  record0.writeUInt16BE(1, 0); // PalmDOC compression: none
  record0.writeUInt32BE(textBytes.length, 4);
  record0.writeUInt16BE(1, 8); // one text record
  record0.writeUInt16BE(MOBI_TEXT_RECORD_SIZE, 10);
  record0.writeUInt16BE(encryption, 12);

  record0.write("MOBI", 16, "latin1");
  record0.writeUInt32BE(headerLength, 20);
  record0.writeUInt32BE(2, 24); // Mobipocket book
  record0.writeUInt32BE(65001, 28); // UTF-8
  record0.writeUInt32BE(1, 32); // unique id
  record0.writeUInt32BE(version, 36);
  record0.writeUInt32BE(titleOffset, 84);
  record0.writeUInt32BE(titleBytes.length, 88);
  record0.writeUInt32BE(0xffffffff, 108); // no resources
  record0.writeUInt32BE(0, 128); // no EXTH
  record0.writeUInt32BE(0, 240); // no trailing entries
  record0.writeUInt32BE(0xffffffff, 244); // no INDX
  if (version >= 8) {
    record0.writeUInt32BE(0xffffffff, 192); // FDST
    record0.writeUInt32BE(0xffffffff, 248); // fragment index
    record0.writeUInt32BE(0xffffffff, 252); // skeleton index
    record0.writeUInt32BE(0xffffffff, 260); // guide index
  }
  Buffer.from(titleBytes).copy(record0, titleOffset);

  const records = [record0, Buffer.from(textBytes)];
  const firstRecord = PDB_HEADER_SIZE + records.length * 8 + PDB_GAP;
  const offsets = [];
  let cursor = firstRecord;
  for (const record of records) {
    offsets.push(cursor);
    cursor += record.length;
  }

  const pdb = Buffer.alloc(firstRecord);
  pdb.write("Maibuk fixture", 0, "latin1");
  pdb.write("BOOK", 60, "latin1");
  pdb.write("MOBI", 64, "latin1");
  pdb.writeUInt32BE(1, 68); // unique id seed
  pdb.writeUInt16BE(records.length, 76);
  for (const [index, offset] of offsets.entries()) {
    pdb.writeUInt32BE(offset, 78 + index * 8);
  }
  return Buffer.concat([pdb, ...records]);
}

/** The HTML one MOBI text record carries. */
const MOBI_TEXT = `<html><head><guide></guide></head><body>
  <h1>Notes</h1>
  <p>The desert keeps its own record of the journey.</p>
  <p>A second paragraph follows the first.</p>
</body></html>`;

/** A readable MOBI 6 book: uncompressed text, no DRM, no images. */
export function buildMobi() {
  return buildPalmDoc({ title: "Notes", text: MOBI_TEXT, version: 6 });
}

/** A MOBI whose PalmDOC header says its text is encrypted. */
export function buildDrmMobi() {
  return buildPalmDoc({ title: "Locked", text: MOBI_TEXT, version: 6, encryption: 2 });
}

/**
 * An AZW3 that marks itself KF8 (version 8) without the INDX tables a real KF8
 * needs. Reader detects the format, finds no readable skeleton, and reports the
 * file as damaged; a valid KF8 fixture would need hand-built INDX/SKEL/FRAG
 * tables, which no test here depends on.
 */
export function buildAzw3() {
  return buildPalmDoc({ title: "Plates", text: MOBI_TEXT, version: 8 });
}

/* Large, bench-only fixtures ---------------------------------------------- */

/**
 * The bench PDF's page count and embedded image size. 96 pages of one raw RGB
 * image each is about 50 MB (96 × 420 × 420 × 3 bytes), the size issue #653's
 * performance gate names. The images are uncompressed on purpose: the file is
 * large because it carries large image streams, like a scanned book, without
 * spending generation time on a compressor.
 */
export const LARGE_PDF_PAGES = 96;
export const LARGE_PDF_IMAGE = 420;

/** The bench EPUB's section count: issue #653 asks for at least 300. */
export const LARGE_EPUB_SECTIONS = 320;

/** Escapes a PDF literal string's delimiters and backslash. */
function pdfString(text) {
  return text.replace(/([\\()])/g, "\\$1");
}

/** A deterministic RGB image body: a diagonal gradient, so no page is blank. */
function gradientRgb(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3;
      raw[at] = (x * 255) / (width - 1);
      raw[at + 1] = (y * 255) / (height - 1);
      raw[at + 2] = ((x + y) * 255) / (width + height - 2);
    }
  }
  return raw;
}

/**
 * Assembles a PDF from object bodies, each a string or a Buffer, with a classic
 * xref table and a fixed trailer. Unlike {@link buildPdf}, a body may carry
 * raw image bytes, so the large fixture never has to be base64 or latin1 text.
 */
function buildPdfFromBodies(bodies, trailerEntries) {
  const parts = [Buffer.from("%PDF-1.5\n", "latin1")];
  let offset = parts[0].length;
  const offsets = [];
  bodies.forEach((body, index) => {
    offsets.push(offset);
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1");
    const head = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    const tail = Buffer.from("\nendobj\n", "latin1");
    parts.push(head, bytes, tail);
    offset += head.length + bytes.length + tail.length;
  });
  const xref = offset;
  let table = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const entry of offsets) table += `${String(entry).padStart(10, "0")} 00000 n \n`;
  parts.push(Buffer.from(table, "latin1"));
  parts.push(
    Buffer.from(
      `trailer\n<< /Size ${bodies.length + 1} ${trailerEntries} >>\nstartxref\n${xref}\n%%EOF\n`,
      "latin1"
    )
  );
  return Buffer.concat(parts);
}

/** The page's text lines: dense enough that extraction is real work. */
function largePageText(pageNumber) {
  const lines = [];
  for (let line = 0; line < 40; line += 1) {
    const marker = pageNumber % 30 === 1 && line === 20 ? "wanderlust " : "";
    lines.push(
      `${marker}Page ${pageNumber}, line ${line + 1}: the keeper counted the lamps along the shore ` +
        `and wrote every one of them down before the tide came in.`
    );
  }
  return lines;
}

/**
 * A ~50 MB PDF: every page carries one uncompressed 420×420 RGB image plus a
 * dense text layer, so opening, paging, and searching it exercises the parser
 * and the renderer. `wanderlust` appears on pages 1, 31, 61, and 91, the word the
 * bench searches for.
 */
export function buildLargePdf({ pages = LARGE_PDF_PAGES, imageSize = LARGE_PDF_IMAGE } = {}) {
  const image = gradientRgb(imageSize, imageSize);
  // Object 1 is the catalog, 2 the page tree, 3 the font; each page then owns
  // three objects: the page, its content stream, and its image.
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const kids = [];
  for (let index = 0; index < pages; index += 1) {
    const pageNumber = index + 1;
    const pageObj = bodies.length + 1;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;
    kids.push(`${pageObj} 0 R`);

    const lines = largePageText(pageNumber);
    const text =
      `q\n${imageSize} 0 0 ${imageSize} 96 280 cm\n/Im0 Do\nQ\n` +
      `BT\n/F1 9 Tf\n11 TL\n40 760 Td\n` +
      lines.map((line) => `(${pdfString(line)}) Tj\nT*`).join("\n") +
      "\nET\n";
    const content = Buffer.from(
      `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
      "latin1"
    );
    const imageBody = Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${imageSize} /Height ${imageSize} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.length} >>\nstream\n`,
        "latin1"
      ),
      image,
      Buffer.from("\nendstream", "latin1"),
    ]);
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${imageObj} 0 R >> >> ` +
        `/Contents ${contentObj} 0 R >>`,
      content,
      imageBody
    );
  }
  bodies[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  return buildPdfFromBodies(bodies, `/Root 1 0 R /ID [<${FILE_ID}><${FILE_ID}>]`);
}

/** The large EPUB's one section, with `wanderlust` in a few of them. */
function largeSection(index, total) {
  const n = index + 1;
  const marker =
    n === 2 || n === 150 || n === 290
      ? "The wanderlust of the desert carried them on."
      : "The caravan moved at dawn.";
  return xhtml(
    `Section ${n}`,
    `<section epub:type="chapter" id="s${n}">
      <h1>Section ${n}</h1>
      <p>${marker}</p>
      <p>This is section ${n} of ${total}. The spice must flow across Arrakis, and the keeper wrote it down.</p>
      <p>A second paragraph gives the flowing view enough text to paginate, so a page turn moves within the section before the next one loads.</p>
    </section>`
  );
}

/**
 * A large reflowable EPUB: {@link LARGE_EPUB_SECTIONS} sections, a nav with one
 * entry per section, a stylesheet, and the word `wanderlust` in sections 2,
 * 150, and 290, the word the bench searches for.
 */
export function buildLargeEpub({ sections = LARGE_EPUB_SECTIONS } = {}) {
  const files = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: CONTAINER_XML },
  ];
  const items = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
  ];
  const spine = [];
  const nav = [];
  for (let index = 0; index < sections; index += 1) {
    const n = index + 1;
    items.push(`<item id="s${n}" href="s${n}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="s${n}"/>`);
    nav.push([`Section ${n}`, `s${n}.xhtml`]);
    files.push({ name: `OEBPS/s${n}.xhtml`, data: largeSection(index, sections) });
  }
  files.push({
    name: "OEBPS/content.opf",
    data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:00000000-0000-4000-8000-000000000653</dc:identifier>
    <dc:title>Long Book</dc:title>
    <dc:creator>Maibuk</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    ${items.join("\n    ")}
  </manifest>
  <spine>
    ${spine.join("\n    ")}
  </spine>
</package>`,
  });
  files.push({ name: "OEBPS/nav.xhtml", data: navDocument(nav) });
  files.push({
    name: "OEBPS/style.css",
    data: "body { font-family: serif; } p { margin: 0 0 1em; }",
  });
  return buildZip(files);
}

/** Every fixture this script writes, keyed by file name. */
export function buildAll() {
  return {
    "twelve-pages.pdf": buildTwelvePagePdf(),
    "password.pdf": buildPasswordPdf(),
    "flowing.epub": buildFlowingEpub(),
    "fixed-layout.epub": buildFixedLayoutEpub(),
    "encrypted.epub": buildEncryptedEpub(),
    "corrupt.epub": buildCorruptEpub(),
    "pages.cbz": buildComicBook(),
    "story.fb2": buildFb2(),
    "story.mobi": buildMobi(),
    "story.azw3": buildAzw3(),
    "drm.mobi": buildDrmMobi(),
  };
}

function main() {
  for (const [name, bytes] of Object.entries(buildAll())) {
    writeFileSync(join(FIXTURES, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
