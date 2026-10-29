/**
 * The Shelf's pure rules (#653): what a Document is, how a file's format is
 * read from its name and first bytes, the Fingerprint that keeps one Document
 * from becoming two, and the ordering, upsert, removal, state, and reattach
 * transitions the Shelf page draws. Nothing here imports the SDK or touches the
 * host, so every rule is a plain value in and a plain value out.
 *
 * The storage keys and the Reader settings shape live here too, so the service
 * (`library.ts`) and the page read the same names.
 */

import { sha256Hex } from "./sha256";

/** The formats Reader opens. `azw` is Kindle's older extension for AZW3. */
export type DocumentFormat = "pdf" | "epub" | "mobi" | "azw3" | "fb2" | "cbz";

/** The file extensions the picker offers and `formatFromName` accepts. */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  "pdf",
  "epub",
  "mobi",
  "azw3",
  "azw",
  "fb2",
  "cbz",
];

/** How many bytes each end of a file the Fingerprint hashes. */
export const FINGERPRINT_WINDOW = 64 * 1024;

/** Whether a Document can be read right now. */
export type DocumentState = "ok" | "missing" | "needs-permission" | "unreadable";

/** Where the author was in a Document, as the Shelf remembers it. */
export interface ShelfProgress {
  page?: number;
  pageCount?: number;
  fraction?: number;
}

/** One Document on the Shelf. */
export interface ShelfEntry {
  /** Plugin-local id; it names this Document's Reading Position key. */
  id: string;
  /** The File Grant the host holds for the author's file. */
  grant: string;
  /** `${size}:` plus the SHA-256 of the first and last 64 KB. */
  fingerprint: string;
  title: string;
  author: string;
  format: DocumentFormat;
  /** A JPEG or WebP data URL made at first open; absent until covers exist. */
  coverDataUrl?: string;
  /** Milliseconds since the Unix epoch. */
  lastReadAt: number;
  progress: ShelfProgress | null;
  /** Defaults to `ok`; a Missing Document carries `missing` and a reason. */
  state?: DocumentState;
  reason?: string;
}

/** The format a file name's extension stands for, or null when Reader can't open it. */
export function formatFromName(name: string): DocumentFormat | null {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  switch (extension) {
    case "pdf":
      return "pdf";
    case "epub":
      return "epub";
    case "mobi":
      return "mobi";
    case "azw3":
    case "azw":
      return "azw3";
    case "fb2":
      return "fb2";
    case "cbz":
      return "cbz";
    default:
      return null;
  }
}

/** The file name without its extension, used as a new Document's title. */
export function titleFromName(name: string): string {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const base = slash === -1 ? name : name.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const title = dot > 0 ? base.slice(0, dot) : base;
  return title === "" ? name : title;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  let text = "";
  for (let index = offset; index < offset + length; index++) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
/** A zip local-file, central-directory, or end-of-central-directory header. */
const ZIP_MAGICS = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

/**
 * The format the file's first bytes prove, falling back to the extension. A zip
 * is an EPUB or a CBZ by name; a Palm database carrying `BOOKMOBI` at offset 60
 * is a MOBI or an AZW3 by name; an XML prologue or `<FictionBook` root is FB2.
 */
export function sniffFormat(firstBytes: Uint8Array, name: string): DocumentFormat | null {
  if (startsWith(firstBytes, PDF_MAGIC)) return "pdf";
  if (ZIP_MAGICS.some((magic) => startsWith(firstBytes, magic))) {
    const named = formatFromName(name);
    return named === "epub" || named === "cbz" ? named : null;
  }
  if (ascii(firstBytes, 60, 8) === "BOOKMOBI") {
    const named = formatFromName(name);
    return named === "mobi" || named === "azw3" ? named : "mobi";
  }
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(firstBytes)
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (text.startsWith("<?xml") || text.startsWith("<FictionBook")) return "fb2";
  return formatFromName(name);
}

/**
 * The Fingerprint that identifies a file across picks: `${size}:` plus the hex
 * SHA-256 over the first and last 64 KB, read by two `files.read` calls. Two
 * picks of the same untouched file agree; an edit that changes either end does
 * not.
 *
 * It hashes through `sha256.ts` rather than `crypto.subtle`: the Plugin Worker
 * runs from a `blob:` URL, which is not a secure context, so `crypto.subtle` is
 * undefined there and every Open file used to fail.
 */
export async function fingerprint(
  size: number,
  head: Uint8Array,
  tail: Uint8Array
): Promise<string> {
  const joined = new Uint8Array(head.length + tail.length);
  joined.set(head, 0);
  joined.set(tail, head.length);
  return `${size}:${sha256Hex(joined)}`;
}

/** The Shelf, most recently read first. */
export function sortShelf(shelf: readonly ShelfEntry[]): ShelfEntry[] {
  return [...shelf].sort((left, right) => right.lastReadAt - left.lastReadAt);
}

/**
 * Adds `entry` to the Shelf, or, when its Fingerprint is already there, refreshes
 * that Document's grant and state and keeps its id, Reading Position, and
 * progress. Opening the same file again never adds a second Document.
 */
export function upsertByFingerprint(shelf: readonly ShelfEntry[], entry: ShelfEntry): ShelfEntry[] {
  const index = shelf.findIndex((candidate) => candidate.fingerprint === entry.fingerprint);
  if (index === -1) return sortShelf([...shelf, entry]);
  const next = [...shelf];
  const existing = next[index];
  next[index] = {
    ...existing,
    grant: entry.grant,
    state: entry.state ?? "ok",
    ...(entry.state === undefined || entry.state === "ok" ? { reason: undefined } : {}),
  };
  return sortShelf(next);
}

/** The Shelf without the Document `id`. */
export function removeEntry(shelf: readonly ShelfEntry[], id: string): ShelfEntry[] {
  return shelf.filter((entry) => entry.id !== id);
}

/** One Document marked with its state; a reason is kept only when the state is not ok. */
export function markState(
  shelf: readonly ShelfEntry[],
  id: string,
  state: DocumentState,
  reason?: string
): ShelfEntry[] {
  return shelf.map((entry) => {
    if (entry.id !== id) return entry;
    if (state === "ok") {
      const cleared = { ...entry, state };
      delete cleared.reason;
      return cleared;
    }
    return reason === undefined ? { ...entry, state } : { ...entry, state, reason };
  });
}

/** What reattaching a located file found. */
export type ReattachResult =
  | { ok: true; shelf: ShelfEntry[]; entry: ShelfEntry }
  | { ok: false; reason: "not-found" | "fingerprint-mismatch" };

/**
 * Reattaches the picked file to the Missing Document `missingId`, only when its
 * Fingerprint matches. The Document keeps its id and Reading Position; a
 * different file leaves the Shelf untouched.
 */
export function reattach(
  shelf: readonly ShelfEntry[],
  missingId: string,
  pickedFingerprint: string,
  grant: string
): ReattachResult {
  const index = shelf.findIndex((entry) => entry.id === missingId);
  if (index === -1) return { ok: false, reason: "not-found" };
  if (shelf[index].fingerprint !== pickedFingerprint) {
    return { ok: false, reason: "fingerprint-mismatch" };
  }
  const located: ShelfEntry = {
    ...shelf[index],
    grant,
    state: "ok",
    reason: undefined,
  };
  const next = [...shelf];
  next[index] = located;
  return { ok: true, shelf: next, entry: located };
}

/** The key the Shelf array lives under in Plugin storage. */
export const SHELF_KEY = "shelf";

/** The key one Document's Reading Position lives under. */
export function positionKey(id: string): string {
  return `position:${id}`;
}

/**
 * The key the open Document's id lives under, so a relaunch that lands on the
 * Reading page reopens it instead of showing no Document.
 */
export const CURRENT_DOCUMENT_KEY = "currentDocument";

/** The key Reader's settings live under. */
export const SETTINGS_KEY = "settings";

/** How Reader draws a Flowing view and fits a PDF page. */
export interface ReaderSettings {
  /** Percent of the base size, 60 to 200 in steps of 10. */
  fontSize: number;
  lineWidth: "narrow" | "medium" | "wide";
  pdfFit: "width" | "page";
  /** One PDF page at a time, or every page stacked in Continuous scroll. */
  pdfLayout: "single" | "continuous";
}

/** The settings a fresh Plugin uses. */
export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 100,
  lineWidth: "medium",
  pdfFit: "width",
  pdfLayout: "single",
};

/** The bounds and step of the font size. */
export const FONT_SIZE_MIN = 60;
export const FONT_SIZE_MAX = 200;
export const FONT_SIZE_STEP = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One of `allowed`, or `fallback` when the value is anything else. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Reader's settings, field by field, from anything stored: the font size snaps
 * to the 10% step and clamps to 60..200, and an unknown line width, PDF fit,
 * or PDF layout falls back to the default.
 */
export function clampSettings(value: unknown): ReaderSettings {
  const record = isRecord(value) ? value : {};
  const raw = typeof record.fontSize === "number" ? record.fontSize : Number(record.fontSize);
  const numeric = Number.isFinite(raw) ? raw : DEFAULT_READER_SETTINGS.fontSize;
  const stepped = Math.round(numeric / FONT_SIZE_STEP) * FONT_SIZE_STEP;
  const fontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, stepped));
  return {
    fontSize,
    lineWidth: oneOf(record.lineWidth, ["narrow", "medium", "wide"], "medium"),
    pdfFit: oneOf(record.pdfFit, ["width", "page"], "width"),
    pdfLayout: oneOf(record.pdfLayout, ["single", "continuous"], "single"),
  };
}

/** A Shelf read back from storage, with every malformed row dropped. */
export function parseShelf(value: unknown): ShelfEntry[] {
  if (!Array.isArray(value)) return [];
  const shelf: ShelfEntry[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { id, grant, fingerprint: print, title, format } = item;
    if (
      typeof id !== "string" ||
      typeof grant !== "string" ||
      typeof print !== "string" ||
      typeof title !== "string" ||
      typeof format !== "string" ||
      formatFromName(`x.${format}`) === null
    ) {
      continue;
    }
    const progress = isRecord(item.progress) ? parseProgress(item.progress) : null;
    shelf.push({
      id,
      grant,
      fingerprint: print,
      title,
      author: typeof item.author === "string" ? item.author : "",
      format: formatFromName(`x.${format}`) as DocumentFormat,
      ...(typeof item.coverDataUrl === "string" ? { coverDataUrl: item.coverDataUrl } : {}),
      lastReadAt:
        typeof item.lastReadAt === "number" && Number.isFinite(item.lastReadAt)
          ? item.lastReadAt
          : 0,
      progress,
      state: oneOf(
        item.state,
        ["ok", "missing", "needs-permission", "unreadable"],
        "ok" as DocumentState
      ) as DocumentState,
      ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
    });
  }
  return shelf;
}

function parseProgress(value: Record<string, unknown>): ShelfProgress | null {
  const progress: ShelfProgress = {};
  if (typeof value.page === "number" && Number.isFinite(value.page)) progress.page = value.page;
  if (typeof value.pageCount === "number" && Number.isFinite(value.pageCount)) {
    progress.pageCount = value.pageCount;
  }
  if (typeof value.fraction === "number" && Number.isFinite(value.fraction)) {
    progress.fraction = value.fraction;
  }
  return Object.keys(progress).length === 0 ? null : progress;
}

/** The progress line's parts: a page out of its count, or a whole percentage. */
export type ProgressSummary =
  | { kind: "page"; page: number; pageCount: number }
  | { kind: "percent"; percent: number };

/** What the progress line should say, or null when the Shelf knows nothing yet. */
export function progressSummary(progress: ShelfProgress | null): ProgressSummary | null {
  if (progress === null) return null;
  if (
    typeof progress.page === "number" &&
    typeof progress.pageCount === "number" &&
    progress.pageCount > 0
  ) {
    return { kind: "page", page: progress.page, pageCount: progress.pageCount };
  }
  if (typeof progress.fraction === "number" && Number.isFinite(progress.fraction)) {
    return { kind: "percent", percent: Math.round(progress.fraction * 100) };
  }
  return null;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * The last-read time as a localized relative phrase ("yesterday", "hace 3
 * días"). Uses `Intl.RelativeTimeFormat`; the app ships no Android reader, so
 * the engine always has `Intl`.
 */
export function relativeTimestamp(
  language: string,
  timestamp: number,
  now: number = Date.now()
): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const magnitude = Math.abs(seconds);
  const [value, unit] =
    magnitude < MINUTE
      ? [0, "second"]
      : magnitude < HOUR
        ? [Math.round(seconds / MINUTE), "minute"]
        : magnitude < DAY
          ? [Math.round(seconds / HOUR), "hour"]
          : magnitude < 26 * DAY
            ? [Math.round(seconds / DAY), "day"]
            : magnitude < 11 * MONTH
              ? [Math.round(seconds / MONTH), "month"]
              : [Math.round(seconds / YEAR), "year"];
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  return formatter.format(value, unit as Intl.RelativeTimeFormatUnit);
}
