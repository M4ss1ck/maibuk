/**
 * Reader's Frame wire protocol (#653): the messages the Plugin Worker and the
 * reading Frame exchange over the Frame's MessagePort. The host never parses
 * them (`docs/plugins/frame-ui.md`), so this file is the one place both sides
 * agree on. `assets/ui/reader.js` mirrors these shapes as JSDoc typedefs and
 * cannot import this module: a Frame script is a classic script in an opaque
 * origin, so a relative import would fail closed.
 *
 * Every message starts with `kind`. The Worker opens the Document, answers byte
 * reads, forwards Commands, and saves the Reading Position the Frame reports.
 * The Frame owns pdf.js, the page canvas, the text layer, Contents, search, and
 * the password form. Imports only `@/plugin-sdk` and this Plugin's files.
 */

import type { ReaderSettings, ShelfProgress } from "./shelf";

/** The page fit a fresh Document opens with, or a numeric zoom scale. */
export type FrameZoom = number | "width" | "page";

/** Where the author was in a fixed-page Document: a PDF, a CBZ, or a fixed-layout EPUB. */
export interface PagePosition {
  kind: "page";
  /** Zero-based page index. */
  page: number;
  /** The zoom the author left the page at. */
  zoom: FrameZoom;
}

/** Where the author was in a reflowable EPUB, by its canonical fragment identifier. */
export interface CfiPosition {
  kind: "cfi";
  /** An `epubcfi(…)` string from foliate's `epubcfi.js`. */
  cfi: string;
}

/** Where the author was in a format with no fragment identifier, by spine index. */
export interface SectionPosition {
  kind: "section";
  /** Zero-based spine (or section) index. */
  index: number;
  /** How far into the section the author was, from 0 to 1. */
  fraction: number;
}

/** Where the author was in a Document. */
export type ReadingPosition = PagePosition | CfiPosition | SectionPosition;

/** The Document fields the Frame draws; the File Grant never leaves the Worker. */
export interface FrameEntry {
  id: string;
  title: string;
  author: string;
  format: string;
}

/** The localized UI strings the Frame shows, built by the Worker from i18n. */
export interface FrameLabels {
  back: string;
  contents: string;
  contentsEmpty: string;
  find: string;
  searchPlaceholder: string;
  searchNext: string;
  searchPrevious: string;
  searchClose: string;
  searchNoMatches: string;
  searchMatches: string;
  pageOf: string;
  pageLabeled: string;
  zoomIn: string;
  zoomOut: string;
  fitWidth: string;
  fitPage: string;
  zoomLevel: string;
  loading: string;
  empty: string;
  previousPage: string;
  nextPage: string;
  passwordTitle: string;
  passwordLabel: string;
  passwordSubmit: string;
  passwordWrong: string;
  errorCorrupt: string;
  errorEncrypted: string;
  errorUnsupported: string;
  errorGeneric: string;
  errorDrm: string;
  errorDamaged: string;
  errorTooLarge: string;
  sectionPage: string;
  increaseFontSize: string;
  decreaseFontSize: string;
}

/** One entry in the archive a reflowable Document is packed in. */
export interface FrameZipEntry {
  /** The entry's path inside the archive, with `/` separators. */
  name: string;
  /** The entry's uncompressed size in bytes. */
  size: number;
}

/** The pdf.js resources the Worker hands the Frame when a PDF opens. */
export interface FramePdf {
  /** pdf.js's display module source, imported from a `blob:` URL. */
  displaySource: string;
  /** pdf.js's viewer CSS, which carries the text-layer rules. */
  css: string;
}

/**
 * The modules the Frame evaluates for a reflowable or fixed-layout Document:
 * foliate's parsers and DOMPurify, each imported from a `blob:` URL.
 */
export interface FrameFoliate {
  /** foliate-js's parser modules, bundled into one self-contained ESM module. */
  source: string;
  /** DOMPurify's browser ESM build. */
  purify: string;
}

/** The reading Commands the Frame handles while it is mounted. */
export type FrameCommandId =
  | "nextPage"
  | "previousPage"
  | "firstPage"
  | "lastPage"
  | "findInDocument"
  | "toggleContents"
  | "zoomIn"
  | "zoomOut"
  | "fitWidth"
  | "fitPage"
  | "increaseFontSize"
  | "decreaseFontSize"
  | "backToShelf";

/* Worker -> Frame */

/** Opens one Document. `pdfPort` is transferred alongside the message. */
export interface FrameOpenMessage {
  kind: "open";
  entry: FrameEntry | null;
  position: ReadingPosition | null;
  settings: ReaderSettings;
  /** The file's size in bytes; the Frame never reads the whole file. */
  size: number;
  labels: FrameLabels;
  language: string;
  pdf?: FramePdf;
  pdfPort?: MessagePort;
  /** The parsers and sanitizer a non-PDF Document needs. */
  foliate?: FrameFoliate;
}

/** Answers one `read`. The `buffer` is transferred. */
export interface FrameBytesMessage {
  kind: "bytes";
  id: number;
  buffer: ArrayBuffer;
}

/** Refuses one `read`; `code` is a Plugin API error code such as `file-missing`. */
export interface FrameReadErrorMessage {
  kind: "read-error";
  id: number;
  code: string;
}

/** Forwards one reading Command to the mounted Frame. */
export interface FrameCommandMessage {
  kind: "command";
  id: FrameCommandId;
}

/** Tells the Frame the app language changed, so it re-labels its own chrome. */
export interface FrameLanguageMessage {
  kind: "language";
  language: string;
  /** The same labels, rebuilt in the new language. */
  labels?: FrameLabels;
}

/** Lists every entry of the archive the Document is packed in. */
export interface FrameZipListMessage {
  kind: "zip-list";
  id: number;
  entries: FrameZipEntry[];
}

/** Answers one `zip-entry`; exactly one of `text` and `buffer` is set. */
export interface FrameZipDataMessage {
  kind: "zip-data";
  id: number;
  text?: string;
  /** Transferred. */
  buffer?: ArrayBuffer;
}

/** Refuses one archive request; `code` is `corrupt`, `drm`, or `missing`. */
export interface FrameZipErrorMessage {
  kind: "zip-error";
  id: number;
  code: "corrupt" | "drm" | "missing";
}

export type WorkerToFrameMessage =
  | FrameOpenMessage
  | FrameBytesMessage
  | FrameReadErrorMessage
  | FrameCommandMessage
  | FrameLanguageMessage
  | FrameZipListMessage
  | FrameZipDataMessage
  | FrameZipErrorMessage;

/* Frame -> Worker */

/** The Frame finished loading and is ready for `open`. */
export interface FrameReadyMessage {
  kind: "ready";
}

/** Asks for `length` bytes at `offset`; the Worker answers `bytes` or `read-error`. */
export interface FrameReadMessage {
  kind: "read";
  id: number;
  offset: number;
  length: number;
}

/** Reports where the author is; the Frame debounces it before sending. */
export interface FramePositionMessage {
  kind: "position";
  position: ReadingPosition;
  progress: ShelfProgress;
}

/** The Document's own title, author, page count, and optional cover. */
export interface FrameMetaMessage {
  kind: "meta";
  title?: string;
  author?: string;
  pageCount?: number;
  coverDataUrl?: string;
}

/** Leaves the reading surface for the Shelf. */
export interface FrameBackMessage {
  kind: "back";
}

/**
 * The Frame is going away without a Back (the page was hidden: the author left
 * Reader by the sidebar). The Worker releases what the Document holds, since
 * nothing else tells it the Frame is gone.
 */
export interface FrameClosedMessage {
  kind: "closed";
}

/** The Frame could not open the Document; the Worker marks it unreadable. */
export interface FrameLoadErrorMessage {
  kind: "load-error";
  code: "corrupt" | "encrypted" | "unsupported";
  reason: string;
}

/** Asks the Worker to list the archive's entries. */
export interface FrameZipListRequest {
  kind: "zip-list";
  id: number;
}

/**
 * Asks for one archive entry. `as: "text"` decodes it as UTF-8, and
 * `as: "bytes"` transfers the bytes for a `blob:` URL.
 */
export interface FrameZipEntryRequest {
  kind: "zip-entry";
  id: number;
  name: string;
  as: "text" | "bytes";
}

/** Reports a settings change the Frame made, such as a font size step. */
export interface FrameSettingsMessage {
  kind: "settings";
  settings: ReaderSettings;
}

export type FrameToWorkerMessage =
  | FrameReadyMessage
  | FrameReadMessage
  | FramePositionMessage
  | FrameMetaMessage
  | FrameBackMessage
  | FrameClosedMessage
  | FrameLoadErrorMessage
  | FrameZipListRequest
  | FrameZipEntryRequest
  | FrameSettingsMessage;

/**
 * The Worker's handoff of one MessagePort to the nested pdf.js core Worker.
 * The bootstrap module in `loaders.ts` receives it and calls
 * `WorkerMessageHandler.initializeFromPort(port)`.
 */
export interface PdfCorePortMessage {
  kind: "maibuk:pdf-port";
  port: MessagePort;
}

/** The largest initial read the Frame asks for when it opens a PDF. */
export const PDF_INITIAL_CHUNK_BYTES = 1 << 20;
