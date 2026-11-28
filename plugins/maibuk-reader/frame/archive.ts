/**
 * The Reader Frame's archive access (#941): reading the zip a Document is
 * packed in, inflating its entries, and the `blob:` URLs its assets need.
 *
 * The archive requests travel over the protocol client (`protocol.ts`):
 * `entry.ts` makes one archive over that client, and calls it where the old
 * module-level functions were. The factory closes over the entry table and the
 * object URLs it owns, so `reset()` and `revoke()` reach the same state the
 * Frame used to keep at module level.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules (`types.ts`, `protocol.ts`).
 */

import { errorCode, type FrameZipEntryData } from "./protocol";
import type { FrameZipEntry } from "./types";

/** The image extensions a CBZ's pages carry. */
export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".jxl",
  ".avif",
];

/** The largest FB2 the Frame reads whole; a larger one is refused as too large. */
export const FB2_MAX_BYTES = 20 * 1024 * 1024;

/** Why a document could not be opened. */
export class DocumentError extends Error {
  declare code: "drm" | "corrupt" | "too-large";
  constructor(code: "drm" | "corrupt" | "too-large", message: string) {
    super(message);
    this.name = "DocumentError";
    this.code = code;
  }
}

/** Decodes archive text, as the Worker's zip reader once did. */
const UTF8 = new TextDecoder("utf-8");

/** The sanitizer module's media-type lookup, as the Frame exposes it. */
interface ArchiveSanitizer {
  mediaTypeFor(name: string): string;
}

/** The sanitizer `sanitizer.js` defines before the Frame's script runs. */
const sanitizer = (globalThis as { ReaderSanitizer?: ArchiveSanitizer }).ReaderSanitizer;

/** The loader foliate's EPUB parser expects, backed by the Worker's archive. */
export interface ArchiveLoader {
  loadText: (name: string) => Promise<string | null>;
  loadBlob: (name: string) => Promise<Blob>;
  getSize: (name: string) => number;
}

/** The archive requests the archive sends through the protocol client. */
export interface FrameArchiveDeps {
  requestZipList(): Promise<{ entries: FrameZipEntry[] }>;
  requestZipEntry(name: string): Promise<FrameZipEntryData>;
}

/** The archive access `entry.ts` composes over the protocol client. */
export interface FrameArchive {
  /** Lists the archive once and keeps the entry table. */
  open(): Promise<void>;
  /** The entry table `open()` read. */
  entries(): FrameZipEntry[];
  /** One entry's inflated bytes. */
  bytes(name: string): Promise<Uint8Array>;
  /** One entry's text, or null when the archive has no such entry. */
  text(name: string): Promise<string | null>;
  /** One entry's stored size, or zero when the archive has no such entry. */
  size(name: string): number;
  /** The loader foliate's EPUB parser expects. */
  loader(): ArchiveLoader;
  /** Creates a `blob:` URL the Frame owns and revokes when the section changes. */
  newObjectUrl(blob: Blob): string;
  /** One asset's `blob:` URL, or null when it cannot be read. */
  assetUrl(path: string, type: string): Promise<string | null>;
  /** Revokes every `blob:` URL the archive made. */
  revoke(): void;
  /** Drops the entry table, as closing the Document does. */
  reset(): void;
}

/**
 * Inflates raw deflate bytes with the platform's own decompressor. The
 * Worker hands entries over as stored so a large image never holds it past
 * the host's heartbeat; the Frame inflates them here.
 */
async function inflateEntry(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  try {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const inflated = source.pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(inflated).arrayBuffer());
  } catch {
    throw new DocumentError("corrupt", `The archive's entry ${name} will not inflate`);
  }
}

/**
 * The archive over the protocol client: the entry table, the object URLs it
 * owns, and the reads that fill them.
 */
export function createArchive(deps: FrameArchiveDeps): FrameArchive {
  let zipEntries: FrameZipEntry[] = [];
  const zipByName: Map<string, FrameZipEntry> = new Map();
  const objectUrls: Set<string> = new Set();

  async function open(): Promise<void> {
    if (zipEntries.length > 0) return;
    const response = await deps.requestZipList();
    const list = response && Array.isArray(response.entries) ? response.entries : [];
    zipEntries = list;
    zipByName.clear();
    for (const item of zipEntries) zipByName.set(item.name, item);
  }

  function entries(): FrameZipEntry[] {
    return zipEntries;
  }

  async function bytes(name: string): Promise<Uint8Array> {
    const data = await deps.requestZipEntry(name);
    if (!(data && data.buffer)) throw new DocumentError("corrupt", `The archive has no ${name}`);
    const raw = new Uint8Array(data.buffer);
    return data.deflated ? inflateEntry(raw, name) : raw;
  }

  async function text(name: string): Promise<string | null> {
    try {
      return UTF8.decode(await bytes(name));
    } catch (error) {
      if (errorCode(error) === "missing") return null;
      throw error;
    }
  }

  function size(name: string): number {
    const item = zipByName.get(name);
    return item ? item.size : 0;
  }

  function loader(): ArchiveLoader {
    return {
      loadText: text,

      loadBlob: async (name: string) =>
        new Blob([(await bytes(name)) as BlobPart], {
          type: sanitizer!.mediaTypeFor(name),
        }),
      getSize: size,
    };
  }

  function newObjectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return url;
  }

  async function assetUrl(path: string, type: string): Promise<string | null> {
    if (!path) return null;
    try {
      const data = await bytes(path);
      return newObjectUrl(new Blob([data as BlobPart], { type }));
    } catch {
      return null;
    }
  }

  function revoke(): void {
    for (const url of objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* The platform may already have dropped it. */
      }
    }
    objectUrls.clear();
  }

  function reset(): void {
    zipEntries = [];
    zipByName.clear();
  }

  return {
    open,
    entries,
    bytes,
    text,
    size,
    loader,
    newObjectUrl,
    assetUrl,
    revoke,
    reset,
  };
}
