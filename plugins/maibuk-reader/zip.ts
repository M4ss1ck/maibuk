/**
 * The zip reader the Reader Worker runs for EPUB and CBZ files (#653). The
 * Frame cannot read a file, so it asks for one entry at a time and the Worker
 * inflates it here. Opening the archive reads only the end-of-central-directory
 * record and the central directory through ranged `files.read` calls; an entry
 * is inflated only when the Frame asks for it.
 *
 * It also decides whether the archive is DRM-protected: an EPUB's
 * `META-INF/encryption.xml` may list obfuscated fonts (which Reader still
 * renders) or content itself (which Reader cannot decrypt), and only the latter
 * makes the Document unreadable.
 *
 * Imports only `fflate`; nothing here touches the SDK or the DOM, so the tests
 * drive it with an in-memory `read` function.
 */

import { inflateSync } from "fflate";

/** Why an archive could not be read. */
export type ZipErrorCode = "corrupt" | "drm";

/** An archive the Worker refuses to open or read. */
export class ZipError extends Error {
  constructor(
    readonly code: ZipErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ZipError";
  }
}

/** One file inside the archive, from its central-directory record. */
export interface ZipEntry {
  /** Path inside the archive, with `/` separators. */
  name: string;
  /** Uncompressed size in bytes. */
  size: number;
  /** Compressed size in bytes. */
  compressedSize: number;
  /** 0 for stored, 8 for deflate. */
  method: number;
  /** Offset of the entry's local file header. */
  offset: number;
  /** The general-purpose bit flags; bit 0 marks zip-level encryption. */
  flags: number;
}

/** Reads `length` bytes at `offset`; the caller caps each call. */
export type RangedRead = (offset: number, length: number) => Promise<Uint8Array>;

/** An opened archive, ready to answer entry reads. */
export interface ZipArchive {
  entries: ZipEntry[];
  /** The uncompressed bytes of `name`. */
  read(name: string): Promise<Uint8Array>;
  /** The uncompressed text of `name`, decoded as UTF-8. */
  readText(name: string): Promise<string | null>;
}

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;
/** The EOCD record plus the largest comment a zip may carry. */
const EOCD_WINDOW = EOCD_SIZE + 0xffff;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** ZIP64's "look in the ZIP64 record" marker, which Reader does not read. */
const ZIP64_MARKER = 0xffffffff;

const UTF8 = new TextDecoder("utf-8");

/** Reads `length` bytes at `offset` with one call, clamped to the archive. */
function slice(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  return bytes.subarray(offset, offset + length);
}

/** The uint16 at `offset`, little-endian. */
function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8);
}

/** The uint32 at `offset`, little-endian. */
function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) |
      ((bytes[offset + 1] as number) << 8) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 3] as number) << 24)) >>>
    0
  );
}

/** The offset of the end-of-central-directory record, or -1 when there is none. */
function findEocd(tail: Uint8Array): number {
  for (let offset = tail.length - EOCD_SIZE; offset >= 0; offset -= 1) {
    if (u32(tail, offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/** Font formats an EPUB may obfuscate without becoming unreadable. */
const FONT_PATTERN = /\.(?:ttf|otf|woff2?|ttc)$/i;

/** Whether `encryption.xml` protects anything besides embedded fonts. */
export function protectsContent(encryptionXml: string): boolean {
  if (!/<(?:\w+:)?EncryptedData\b/i.test(encryptionXml)) return false;
  const uris: string[] = [];
  const pattern = /<(?:\w+:)?CipherReference\b[^>]*\bURI\s*=\s*["']([^"']+)["']/gi;
  let match = pattern.exec(encryptionXml);
  while (match !== null) {
    uris.push(match[1]);
    match = pattern.exec(encryptionXml);
  }
  if (uris.length === 0) return true;
  return uris.some((uri) => !FONT_PATTERN.test(decodeURI(uri)));
}

/**
 * Opens the archive behind `read`. Throws {@link ZipError} with `corrupt` for
 * a damaged or ZIP64 archive whose entries cannot be trusted, and with `drm`
 * when `META-INF/encryption.xml` protects content rather than only fonts.
 */
export async function openZip(read: RangedRead, size: number): Promise<ZipArchive> {
  if (size < EOCD_SIZE) throw new ZipError("corrupt", "This archive is too small to be a zip");
  const window = Math.min(size, EOCD_WINDOW);
  const tail = await read(size - window, window);
  const eocd = findEocd(tail);
  if (eocd === -1) throw new ZipError("corrupt", "This archive has no zip directory");

  const count = u16(tail, eocd + 10);
  const directorySize = u32(tail, eocd + 12);
  const directoryOffset = u32(tail, eocd + 16);
  if (
    count === 0xffff ||
    directorySize === ZIP64_MARKER ||
    directoryOffset === ZIP64_MARKER ||
    directoryOffset + directorySize > size
  ) {
    throw new ZipError("corrupt", "This archive uses a zip layout Reader cannot read");
  }

  const directory = await read(directoryOffset, directorySize);
  const entries: ZipEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > directory.length) {
      throw new ZipError("corrupt", "This archive's directory is truncated");
    }
    if (u32(directory, cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipError("corrupt", "This archive's directory is malformed");
    }
    const flags = u16(directory, cursor + 8);
    const method = u16(directory, cursor + 10);
    const compressedSize = u32(directory, cursor + 20);
    const uncompressedSize = u32(directory, cursor + 24);
    const nameLength = u16(directory, cursor + 28);
    const extraLength = u16(directory, cursor + 30);
    const commentLength = u16(directory, cursor + 32);
    const localOffset = u32(directory, cursor + 42);
    const nameStart = cursor + CENTRAL_HEADER_SIZE;
    if (nameStart + nameLength > directory.length) {
      throw new ZipError("corrupt", "This archive's directory names are truncated");
    }
    const name = UTF8.decode(slice(directory, nameStart, nameLength));
    cursor = nameStart + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (flags & 0x1) throw new ZipError("corrupt", "This archive is password-protected");
    if (method !== 0 && method !== 8) {
      throw new ZipError("corrupt", `This archive uses an unsupported compression method`);
    }
    entries.push({
      name,
      size: uncompressedSize,
      compressedSize,
      method,
      offset: localOffset,
      flags,
    });
  }

  const archive: ZipArchive = {
    entries,
    async read(name: string): Promise<Uint8Array> {
      const entry = entries.find((candidate) => candidate.name === name);
      if (entry === undefined) throw new ZipError("missing", `This archive has no ${name}`);
      const header = await read(entry.offset, LOCAL_HEADER_SIZE);
      if (header.length < LOCAL_HEADER_SIZE || u32(header, 0) !== LOCAL_SIGNATURE) {
        throw new ZipError("corrupt", `This archive's entry ${name} is malformed`);
      }
      const dataStart =
        entry.offset + LOCAL_HEADER_SIZE + u16(header, 26) + u16(header, 28);
      const compressed = await read(dataStart, entry.compressedSize);
      if (compressed.length < entry.compressedSize) {
        throw new ZipError("corrupt", `This archive's entry ${name} is truncated`);
      }
      if (entry.method === 0) return compressed;
      try {
        return inflateSync(compressed);
      } catch {
        throw new ZipError("corrupt", `This archive's entry ${name} will not inflate`);
      }
    },
    async readText(name: string): Promise<string | null> {
      const entry = entries.find((candidate) => candidate.name === name);
      if (entry === undefined) return null;
      return UTF8.decode(await archive.read(name));
    },
  };

  const encryption = entries.find((entry) => entry.name === "META-INF/encryption.xml");
  if (encryption !== undefined && protectsContent(UTF8.decode(await archive.read(encryption.name)))) {
    throw new ZipError("drm", "This Document is protected by DRM");
  }
  return archive;
}
