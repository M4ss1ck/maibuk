/**
 * Reads the title and author a file names in its own metadata, so an Import can
 * spot a collision with a Book already on the Shelf (#949). It runs in the
 * Reader Worker beside zip.ts, which is why it uses regular expressions and
 * TextDecoder rather than DOMParser. A file it cannot read comes back empty;
 * it never throws.
 */
import type { DocumentFormat } from "./shelf";
import { openZip, type RangedRead } from "./zip";

/** A found file's own title and author, as an Import reads them; "" when the file names none. */
export interface FileMeta {
  title: string;
  author: string;
}

/** FB2 files up to this size are read whole; larger ones are judged by their head. */
const FB2_WHOLE_LIMIT = 8 * 1024 * 1024;
/** How much of a PDF's end is scanned, where the info dictionary often sits. */
const PDF_TAIL = 64 * 1024;
/** A MOBI record0 keeps its MOBI header 16 bytes in, and the EXTH flags at this offset. */
const MOBI_HEADER_START = 16;
const MOBI_LENGTH_OFFSET = 20;
const MOBI_ENCODING_OFFSET = 28;
const MOBI_EXTH_FLAGS_OFFSET = 0x80;
const MOBI_NAME_OFFSET = 84;
const MOBI_NAME_LENGTH_OFFSET = 88;
const EXTH_FLAG = 0x40;
const MOBI_ENCODING_CP1252 = 1252;
const EXTH_TYPE_AUTHOR = 100;
const EXTH_TYPE_UPDATED_TITLE = 503;
const PALM_RECORD0_OFFSET = 78;

const NO_META: FileMeta = { title: "", author: "" };

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export async function readFileMeta(
  read: RangedRead,
  size: number,
  format: DocumentFormat,
  head: Uint8Array
): Promise<FileMeta> {
  try {
    const found = await metaByFormat(read, size, format, head);
    return { title: tidy(found.title), author: tidy(found.author) };
  } catch {
    return { ...NO_META };
  }
}

async function metaByFormat(
  read: RangedRead,
  size: number,
  format: DocumentFormat,
  head: Uint8Array
): Promise<FileMeta> {
  switch (format) {
    case "epub":
      return epubMeta(read, size);
    case "cbz":
      return cbzMeta(read, size);
    case "fb2":
      return fb2Meta(read, size, head);
    case "mobi":
    case "azw3":
      return mobiMeta(read, size, head);
    case "pdf":
      return pdfMeta(read, size, head);
    default:
      return { ...NO_META };
  }
}

async function epubMeta(read: RangedRead, size: number): Promise<FileMeta> {
  const zip = await openZip(read, size);
  const container = await zip.readText("META-INF/container.xml");
  const rootfile = container?.match(/<rootfile\b[^>]*?\bfull-path\s*=\s*(["'])(.*?)\1/i);
  if (!rootfile) return { ...NO_META };
  const opfPath = decodeXml(rootfile[2] ?? "");
  const opf = await zip.readText(opfPath);
  if (!opf) return { ...NO_META };
  const metadata = opf.match(/<(?:[\w-]+:)?metadata\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?metadata>/i);
  if (!metadata) return { ...NO_META };
  const body = metadata[1] ?? "";
  return {
    title: elementText(body, "title"),
    author: elementText(body, "creator"),
  };
}

/** The text of the first element with this local name, any prefix, with its inner tags removed. */
function elementText(xml: string, localName: string): string {
  const open = `<(?:[\\w-]+:)?${localName}\\b[^>]*(?<!\\/)>`;
  const close = `<\\/(?:[\\w-]+:)?${localName}>`;
  const found = xml.match(new RegExp(`${open}([\\s\\S]*?)${close}`, "i"));
  return found ? decodeXml(stripTags(found[1] ?? "")) : "";
}

async function cbzMeta(read: RangedRead, size: number): Promise<FileMeta> {
  const zip = await openZip(read, size);
  const names = zip.entries.map((entry) => entry.name);
  const root = names.find((name) => name.toLowerCase() === "comicinfo.xml");
  const nested = names.find((name) => name.toLowerCase().endsWith("/comicinfo.xml"));
  const path = root ?? nested;
  if (!path) return { ...NO_META };
  const xml = await zip.readText(path);
  if (!xml) return { ...NO_META };
  return {
    title: elementText(xml, "Title"),
    author: elementText(xml, "Writer"),
  };
}

async function fb2Meta(read: RangedRead, size: number, head: Uint8Array): Promise<FileMeta> {
  const bytes = size <= FB2_WHOLE_LIMIT ? await read(0, size) : head;
  const xml = new TextDecoder("utf-8").decode(bytes);
  const titleInfo = xml.match(/<title-info\b[^>]*>([\s\S]*?)<\/title-info>/i);
  if (!titleInfo) return { ...NO_META };
  const info = titleInfo[1] ?? "";
  const bookTitle = info.match(/<book-title\b[^>]*>([\s\S]*?)<\/book-title>/i);
  const author = info.match(/<author\b[^>]*>([\s\S]*?)<\/author>/i);
  return {
    title: bookTitle ? decodeXml(stripTags(bookTitle[1] ?? "")) : "",
    author: author ? fb2AuthorName(author[1] ?? "") : "",
  };
}

/** First, middle, and last name joined by single spaces; the nickname when no name part is set. */
function fb2AuthorName(inner: string): string {
  const part = (tag: string): string => {
    const found = inner.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return found ? decodeXml(stripTags(found[1] ?? "")) : "";
  };
  const name = [part("first-name"), part("middle-name"), part("last-name")]
    .filter((text) => text !== "")
    .join(" ");
  return name !== "" ? name : part("nickname");
}

async function mobiMeta(read: RangedRead, size: number, head: Uint8Array): Promise<FileMeta> {
  if (head.byteLength < PALM_RECORD0_OFFSET + 4) return { ...NO_META };
  const at = async (offset: number, length: number): Promise<Uint8Array> => {
    if (offset < 0 || length < 0 || offset + length > size)
      throw new RangeError("outside the file");
    if (offset + length <= head.byteLength) return head.subarray(offset, offset + length);
    const bytes = await read(offset, length);
    if (bytes.byteLength < length) throw new RangeError("short read");
    return bytes;
  };
  const record0 = u32(head, PALM_RECORD0_OFFSET);
  // Covers the MOBI magic, the header length, the encoding, the EXTH flags, and the full-name pointer.
  const header = await at(record0, MOBI_EXTH_FLAGS_OFFSET + 4);
  const magic = ascii(header, MOBI_HEADER_START, 4);
  if (magic !== "MOBI") return { ...NO_META };

  const decoder = mobiDecoder(u32(header, MOBI_ENCODING_OFFSET));
  const headerLength = u32(header, MOBI_LENGTH_OFFSET);
  const hasExth = (u32(header, MOBI_EXTH_FLAGS_OFFSET) & EXTH_FLAG) !== 0;

  let title = "";
  let author = "";
  if (hasExth) {
    const exthStart = record0 + MOBI_HEADER_START + headerLength;
    const exth = await at(exthStart, 12);
    if (ascii(exth, 0, 4) === "EXTH") {
      const block = await at(exthStart, u32(exth, 4));
      const count = u32(exth, 8);
      let p = 12;
      for (let i = 0; i < count && p + 8 <= block.byteLength; i++) {
        const type = u32(block, p);
        const recordLength = u32(block, p + 4);
        if (recordLength < 8 || p + recordLength > block.byteLength) break;
        const data = block.subarray(p + 8, p + recordLength);
        if (type === EXTH_TYPE_UPDATED_TITLE && title === "") title = decoder(data);
        if (type === EXTH_TYPE_AUTHOR && author === "") author = decoder(data);
        p += recordLength;
      }
    }
  }
  if (title === "") {
    // The full name is the fallback title; losing it must not lose an EXTH author.
    try {
      const nameOffset = record0 + u32(header, MOBI_NAME_OFFSET);
      title = decoder(await at(nameOffset, u32(header, MOBI_NAME_LENGTH_OFFSET)));
    } catch {
      title = "";
    }
  }
  return { title, author };
}

/** windows-1252 when the header says so; UTF-8 otherwise (65001, and any encoding this does not name). */
function mobiDecoder(encoding: number): (bytes: Uint8Array) => string {
  const decoder = new TextDecoder(encoding === MOBI_ENCODING_CP1252 ? "windows-1252" : "utf-8");
  return (bytes) => decoder.decode(bytes);
}

async function pdfMeta(read: RangedRead, size: number, head: Uint8Array): Promise<FileMeta> {
  const tail =
    size > head.byteLength
      ? await read(Math.max(0, size - PDF_TAIL), Math.min(size, PDF_TAIL))
      : new Uint8Array(0);
  const text = `${latin1(head)}\n${latin1(tail)}`;
  const info = pdfInfoDictionary(text);
  return {
    title: pdfValue(info, "Title"),
    author: pdfValue(info, "Author"),
  };
}

/**
 * The text of the document information dictionary the trailer (or a
 * cross-reference stream) names with `/Info N G R`, or "" when the scanned text
 * holds none. Only that object counts: an outline item's `/Title` names a
 * chapter, never the Document.
 */
function pdfInfoDictionary(text: string): string {
  const refs = [...text.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R/g)];
  for (const ref of refs.reverse()) {
    const object = new RegExp(`(?:^|[^\\d])${ref[1]}\\s+${ref[2]}\\s+obj\\b`).exec(text);
    if (object === null) continue;
    const start = object.index + object[0].length;
    const end = text.indexOf("endobj", start);
    return text.slice(start, end === -1 ? undefined : end);
  }
  return "";
}

/** The first string value of `/key` in the scanned text; non-string values are skipped. */
function pdfValue(text: string, key: string): string {
  const pattern = new RegExp(`/${key}(?![A-Za-z])\\s*(?=[(<])`, "g");
  for (const match of text.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const bytes = text[start] === "(" ? pdfLiteral(text, start) : pdfHex(text, start);
    if (bytes) return decodePdfString(bytes);
  }
  return "";
}

const PDF_ESCAPES: Record<string, number> = {
  n: 10,
  r: 13,
  t: 9,
  b: 8,
  f: 12,
  "(": 40,
  ")": 41,
  "\\": 92,
};

/** Bytes of a literal string starting at `start` (its opening parenthesis), or null when unclosed. */
function pdfLiteral(text: string, start: number): number[] | null {
  const out: number[] = [];
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i] ?? "";
    if (char === "\\") {
      const next = text[i + 1];
      if (next === undefined) break;
      if (isOctal(text, i + 1)) {
        let value = 0;
        let j = i + 1;
        while (j < i + 4 && isOctal(text, j)) {
          value = value * 8 + (text.charCodeAt(j) - 48);
          j++;
        }
        out.push(value & 0xff);
        i = j - 1;
      } else if (next === "\r") {
        i += text[i + 2] === "\n" ? 2 : 1;
      } else if (next === "\n") {
        i += 1;
      } else {
        out.push(PDF_ESCAPES[next] ?? next.charCodeAt(0));
        i += 1;
      }
      continue;
    }
    if (char === "(") {
      depth++;
      if (depth > 1) out.push(char.charCodeAt(0));
      continue;
    }
    if (char === ")") {
      depth--;
      if (depth === 0) return out;
      out.push(char.charCodeAt(0));
      continue;
    }
    out.push(text.charCodeAt(i));
  }
  return null;
}

/** True when the character at `index` is an octal digit (a `\ddd` escape starts with one). */
function isOctal(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 48 && code <= 55;
}

/** Bytes of a hex string starting at `start` (its `<`), or null when it is not one. */
function pdfHex(text: string, start: number): number[] | null {
  const end = text.indexOf(">", start);
  if (end < 0) return null;
  let hex = text.slice(start + 1, end).replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
  if (hex.length % 2 === 1) hex += "0";
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** UTF-16BE when the bytes open with a BOM (FE FF), latin1 otherwise. */
function decodePdfString(bytes: number[]): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(Uint8Array.from(bytes.slice(2)));
  }
  return bytes.map((byte) => String.fromCharCode(byte)).join("");
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.byteLength; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError("outside the buffer");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

/** Decodes the XML entities an OPF, ComicInfo, or FB2 file uses, named and numeric. */
function decodeXml(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const codePoint = hex
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
    }
    return XML_ENTITIES[body] ?? whole;
  });
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
