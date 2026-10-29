/**
 * Writes Reader's small PDF fixtures (#653): a twelve-page Document with an
 * outline, a nested section, and page labels (i, ii, 1..10), and a
 * password-protected Document. Every object is written by hand here, with no
 * third-party code and no fonts or images, so the files stay tiny, readable,
 * and deterministic: running this script again leaves the tree unchanged.
 *
 * The password file uses PDF's Standard security handler, revision 2 (RC4,
 * 40-bit), which the format documents in full; MD5 and RC4 are implemented
 * below because no PDF library is a Reader dependency. `qpdf` is not needed.
 *
 * Run: node plugins/maibuk-reader/scripts/generate-fixtures.mjs
 *
 * It sits in `scripts/`, not beside the PDFs: the Plugin tooling's import
 * boundary refuses Node builtins outside test files, and `scripts/` is the one
 * folder it never walks. The files it writes still land in `../fixtures`.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

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

/** Every fixture this script writes, keyed by file name. */
export function buildAll() {
  return {
    "twelve-pages.pdf": buildTwelvePagePdf(),
    "password.pdf": buildPasswordPdf(),
  };
}

function main() {
  for (const [name, bytes] of Object.entries(buildAll())) {
    writeFileSync(join(FIXTURES, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
