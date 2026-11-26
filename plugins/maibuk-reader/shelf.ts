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

import { createSha256 } from "./sha256";

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

/** How the Shelf lays its Documents out (#945). */
export type ShelfLayout = "grid" | "list" | "compact";

/** The grid's cover width: 88, 128, or 176 px. */
export type ShelfCoverSize = "small" | "medium" | "large";

/** The orders the Shelf sorts by. */
export type ShelfSort = "recent" | "title" | "author" | "progress" | "added";

/**
 * Where the author is in a Document: never opened, started, or at its last
 * page (progress at 99% or more).
 */
export type ShelfStatus = "new" | "reading" | "finished";

/**
 * The Shelf's view, sort, filters, and search, as Reader remembers them on
 * this device (#945). An empty filter list means no filter.
 */
export interface ShelfViewSettings {
  layout: ShelfLayout;
  coverSize: ShelfCoverSize;
  sort: ShelfSort;
  /** True when the sort runs from the largest value (newest, most read, Z) down. */
  descending: boolean;
  formats: string[];
  statuses: ShelfStatus[];
  search: string;
  /** The Collection the Shelf is narrowed to, by id, or null for every Document. */
  collection: string | null;
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
  /** Milliseconds since the Unix epoch when the Document was imported. */
  addedAt: number;
  /** Milliseconds since the Unix epoch when the author first reached the last page. */
  finishedAt?: number;
  /** Milliseconds since the Unix epoch when the author first opened it; absent while new. */
  openedAt?: number;
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
  const hash = createSha256();
  for (const bytes of [head, tail]) {
    for (let offset = 0; offset < bytes.length; offset += FINGERPRINT_SLICE) {
      hash.update(bytes.subarray(offset, offset + FINGERPRINT_SLICE));
      await yieldToEventLoop();
    }
  }
  return `${size}:${hash.digestHex()}`;
}

/**
 * How much the Fingerprint hashes before it yields: small enough that a slow
 * device stays well inside the host's one-second heartbeat.
 */
const FINGERPRINT_SLICE = 8 * 1024;

/** A macrotask turn, so the Worker answers a host message waiting behind the hash. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

/** The key one Document's Bookmarks live under. */
export function bookmarksKey(id: string): string {
  return `bookmarks:${id}`;
}

/** The key one Document's Highlights live under. */
export function highlightsKey(id: string): string {
  return `highlights:${id}`;
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
    const lastReadAt =
      typeof item.lastReadAt === "number" && Number.isFinite(item.lastReadAt) ? item.lastReadAt : 0;
    shelf.push({
      id,
      grant,
      fingerprint: print,
      title,
      author: typeof item.author === "string" ? item.author : "",
      format: formatFromName(`x.${format}`) as DocumentFormat,
      ...(typeof item.coverDataUrl === "string" ? { coverDataUrl: item.coverDataUrl } : {}),
      lastReadAt,
      addedAt:
        typeof item.addedAt === "number" && Number.isFinite(item.addedAt)
          ? item.addedAt
          : lastReadAt,
      ...(typeof item.openedAt === "number" && Number.isFinite(item.openedAt)
        ? { openedAt: item.openedAt }
        : {}),
      ...(typeof item.finishedAt === "number" && Number.isFinite(item.finishedAt)
        ? { finishedAt: item.finishedAt }
        : {}),
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

/** A Document counts as finished from this fraction of its progress on. */
export const FINISHED_THRESHOLD = 0.99;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * How far through the Document the author is, from 0 to 1. A page out of its
 * count wins; a fraction is the fallback; anything else counts as unread.
 */
export function progressFraction(progress: ShelfProgress | null): number {
  if (progress === null) return 0;
  const { page, pageCount, fraction } = progress;
  if (typeof page === "number" && typeof pageCount === "number" && pageCount > 0) {
    return clampUnit(page / pageCount);
  }
  if (typeof fraction === "number" && Number.isFinite(fraction)) return clampUnit(fraction);
  return 0;
}

/** Where the author is in a Document: never opened, reading, or finished. */
export function shelfStatus(entry: Pick<ShelfEntry, "progress" | "openedAt">): ShelfStatus {
  if (entry.progress === null) return entry.openedAt === undefined ? "new" : "reading";
  return progressFraction(entry.progress) >= FINISHED_THRESHOLD ? "finished" : "reading";
}

/**
 * The Document with new progress read at `now`. The first time it reaches
 * finished it stamps `finishedAt`; that stamp then stays, even if the author
 * later reads back below the threshold.
 */
export function withProgress(entry: ShelfEntry, progress: ShelfProgress, now: number): ShelfEntry {
  const next: ShelfEntry = { ...entry, progress, lastReadAt: now };
  if (entry.finishedAt === undefined && shelfStatus(next) === "finished") {
    next.finishedAt = now;
  }
  return next;
}

/** The key the Shelf's remembered view, sort, filters, and search live under. */
export const SHELF_VIEW_KEY = "shelfView";

/** One Collection: a group of Documents the author makes and names (#946). */
export interface Collection {
  /** Plugin-local id. */
  id: string;
  /** The author's name for it, trimmed, at most COLLECTION_NAME_LIMIT characters. */
  name: string;
  /** The Shelf Documents filed in it, once each, in the order they were added. */
  documentIds: string[];
}

/** The key the author's Collections live under. */
export const COLLECTIONS_KEY = "collections";

/** The longest Collection name, in characters (code points). */
export const COLLECTION_NAME_LIMIT = 100;

/** A Collection name as the author meant it: trimmed, and cut to COLLECTION_NAME_LIMIT characters. */
export function collectionName(value: string): string {
  return Array.from(value.trim()).slice(0, COLLECTION_NAME_LIMIT).join("").trim();
}

/** Whether two names are the same Collection name, ignoring case and the ends' spaces. */
export function sameCollectionName(a: string, b: string): boolean {
  return collectionName(a).toLocaleLowerCase() === collectionName(b).toLocaleLowerCase();
}

/**
 * The Collections from anything stored, record by record: a record needs a
 * non-empty id and a name that is not blank, and a repeated id keeps the first
 * record that passed. Names are stored normalized, and documentIds keep only
 * strings, once each, in order. A value that is not an array reads as none.
 */
export function parseCollections(value: unknown): Collection[] {
  if (!Array.isArray(value)) return [];
  const collections: Collection[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { id, name, documentIds } = item;
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    if (typeof name !== "string") continue;
    const cleaned = collectionName(name);
    if (cleaned === "") continue;
    seen.add(id);
    const ids = Array.isArray(documentIds) ? documentIds : [];
    collections.push({
      id,
      name: cleaned,
      documentIds: [
        ...new Set(
          ids.filter((documentId): documentId is string => typeof documentId === "string")
        ),
      ],
    });
  }
  return collections;
}

/** Titles and authors read A to Z; everything else reads from the largest value down. */
export function defaultDescending(sort: ShelfSort): boolean {
  return sort !== "title" && sort !== "author";
}

/** The view, sort, filters, and search a fresh Plugin opens the Shelf with. */
export const DEFAULT_SHELF_VIEW: ShelfViewSettings = {
  layout: "grid",
  coverSize: "medium",
  sort: "recent",
  descending: true,
  formats: [],
  statuses: [],
  search: "",
  collection: null,
};

/** The longest search the Shelf remembers, in characters. */
const SHELF_SEARCH_LIMIT = 200;

/** The longest Collection id the Shelf remembers, in characters. */
const SHELF_COLLECTION_LIMIT = 200;

/** The formats in the order the Shelf's filter lists them. */
const SHELF_FORMAT_ORDER: readonly DocumentFormat[] = ["pdf", "epub", "mobi", "azw3", "fb2", "cbz"];

/** The statuses in the order the Shelf's filter lists them. */
const SHELF_STATUS_ORDER: readonly ShelfStatus[] = ["new", "reading", "finished"];

/**
 * The Shelf's view from anything stored, field by field: an unknown layout,
 * cover size, or sort falls back to the default; a missing direction follows
 * the sort; formats and statuses keep only the known values, once each, in
 * their canonical order; the search is cut to 200 characters; and a Collection
 * id is kept when it is a string of 1 to 200 characters, otherwise the Shelf
 * shows every Document. The arrays are always fresh, never the default's.
 */
export function clampShelfView(value: unknown): ShelfViewSettings {
  if (!isRecord(value)) return { ...DEFAULT_SHELF_VIEW, formats: [], statuses: [] };
  const sort = oneOf<ShelfSort>(
    value.sort,
    ["recent", "title", "author", "progress", "added"],
    DEFAULT_SHELF_VIEW.sort
  );
  const storedFormats: unknown[] = Array.isArray(value.formats) ? value.formats : [];
  const storedStatuses: unknown[] = Array.isArray(value.statuses) ? value.statuses : [];
  return {
    layout: oneOf(value.layout, ["grid", "list", "compact"], DEFAULT_SHELF_VIEW.layout),
    coverSize: oneOf(value.coverSize, ["small", "medium", "large"], DEFAULT_SHELF_VIEW.coverSize),
    sort,
    descending: typeof value.descending === "boolean" ? value.descending : defaultDescending(sort),
    formats: SHELF_FORMAT_ORDER.filter((format) => storedFormats.includes(format)),
    statuses: SHELF_STATUS_ORDER.filter((status) => storedStatuses.includes(status)),
    search:
      typeof value.search === "string"
        ? Array.from(value.search).slice(0, SHELF_SEARCH_LIMIT).join("")
        : "",
    collection:
      typeof value.collection === "string" &&
      Array.from(value.collection).length >= 1 &&
      Array.from(value.collection).length <= SHELF_COLLECTION_LIMIT
        ? value.collection
        : null,
  };
}
