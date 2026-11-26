/**
 * Reader's Frame wire protocol (#653): the messages the Plugin Worker and the
 * reading Frame exchange over the Frame's MessagePort. The host never parses
 * them (`docs/plugins/frame-ui.md`), so this file is the one place both sides
 * agree on. `frame/entry.ts` declares these shapes again and cannot import this
 * module: the build bundles it to `assets/ui/reader.js` as a classic script in
 * an opaque origin, so a relative import would fail closed.
 *
 * Every message starts with `kind`. The Worker opens the Document, answers byte
 * reads, forwards Commands, and saves the Reading Position the Frame reports.
 * The Frame owns pdf.js, the page canvas, the text layer, Contents, search, and
 * the password form. Imports only `@/plugin-sdk` and this Plugin's files.
 */

import type { ReaderSettings, ShelfProgress, ShelfStatus, ShelfViewSettings } from "./shelf";

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

/**
 * The appearance Maibuk draws with: the resolved color scheme and whether
 * E-ink Mode is applied, exactly what `appearance.get` serves.
 */
export interface Appearance {
  colorScheme: "light" | "dark";
  eink: boolean;
}

/** The Document fields the Frame draws; the File Grant never leaves the Worker. */
export interface FrameEntry {
  id: string;
  title: string;
  author: string;
  format: string;
}

export type {
  ShelfCoverSize,
  ShelfLayout,
  ShelfSort,
  ShelfStatus,
  ShelfViewSettings,
} from "./shelf";

/**
 * One Shelf row the Frame draws (#944). The File Grant and Fingerprint stay in
 * the Worker, so the Frame never sees where the author's file lives.
 */
export interface FrameShelfEntry {
  id: string;
  title: string;
  author: string;
  format: string;
  /** Whether the file can be read right now. */
  state: "ok" | "missing" | "needs-permission" | "unreadable";
  /** Generated-cover artwork, when the Document has one. */
  coverDataUrl?: string;
  /** The localized progress line, already formatted. */
  progressText: string;
  /** The whole percentage the drawn progress bar shows, or null when unknown. */
  progressPercent: number | null;
  /** The localized state line, or null when the Document is readable. */
  statusText: string | null;
  /** One of the generated cover's eight tones, stable for the Document id. */
  tone: number;
  /** New, reading, or finished, decided by the Worker from the stored progress. */
  status: ShelfStatus;
  /** Milliseconds since the Unix epoch: the last read, or the Import when never read. */
  lastReadAt: number;
  /** Milliseconds since the Unix epoch when the Document was imported. */
  addedAt: number;
  /** How far through the Document the author is, 0 to 1; 0 when new. */
  progress: number;
  /** The ids of the Collections the Document is filed in (#946); absent means none. */
  collections?: string[];
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
  errorTimeout: string;
  sectionPage: string;
  increaseFontSize: string;
  decreaseFontSize: string;
  continuousScroll: string;
  fullScreen: string;
  exitFullScreen: string;
}

/** The localized Shelf strings the Frame shows, built by the Worker from i18n. */
export interface FrameShelfLabels {
  shelf: string;
  import: string;
  importFiles: string;
  emptyTitle: string;
  emptyDescription: string;
  loading: string;
  error: string;
  /** "{{count}} Document", for exactly one. */
  documentsCountOne: string;
  documentsCountOther: string;
  open: string;
  remove: string;
  locate: string;
  missing: string;
  moreFor: string;
  removeConfirm: string;
  cancel: string;
  newLabel: string;
  finishedLabel: string;
  documentActions: string;
  dismiss: string;
  allDocuments: string;
  /** Placeholders: {{shown}}, {{total}}. */
  shownOf: string;
  searchLabel: string;
  searchPlaceholder: string;
  closeSearch: string;
  clearSearch: string;
  /** Placeholders: {{count}}, {{layout}}, {{search}}. */
  searchMatchesOne: string;
  /** Placeholders: {{count}}, {{layout}}, {{search}}. */
  searchMatchesOther: string;
  gridView: string;
  listView: string;
  compactView: string;
  viewOptions: string;
  viewOptionsTitle: string;
  reset: string;
  done: string;
  layout: string;
  layoutLabel: string;
  layoutGrid: string;
  layoutList: string;
  layoutCompact: string;
  coverSize: string;
  coverSmall: string;
  coverMedium: string;
  coverLarge: string;
  coverSmallShort: string;
  coverMediumShort: string;
  coverLargeShort: string;
  sortBy: string;
  sortRecent: string;
  sortTitle: string;
  sortAuthor: string;
  sortProgress: string;
  sortAdded: string;
  reverseOrder: string;
  sortSummary: string;
  reverseOrderValue: string;
  sortByValue: string;
  newestFirst: string;
  oldestFirst: string;
  aToZ: string;
  zToA: string;
  mostReadFirst: string;
  leastReadFirst: string;
  recentFirst: string;
  filters: string;
  status: string;
  format: string;
  all: string;
  statusNew: string;
  statusReading: string;
  statusFinished: string;
  /** Placeholders: {{status}}. */
  statusChip: string;
  /** Placeholders: {{format}}. */
  formatChip: string;
  /** Placeholders: {{filter}}. */
  removeFilter: string;
  clearFilters: string;
  noMatch: string;
  /** Placeholders: {{shown}}, {{total}}. */
  remembered: string;
  collections: string;
  newCollection: string;
  newCollectionName: string;
  add: string;
  railHint: string;
  collection: string;
  anyCollection: string;
  /** Placeholders: {{name}}. */
  collectionChip: string;
  /** Placeholders: {{name}}. */
  moreForCollection: string;
  collectionName: string;
  create: string;
  renameCollection: string;
  renameAction: string;
  rename: string;
  deleteAction: string;
  /** Placeholders: {{name}}. */
  deleteCollectionTitle: string;
  deleteCollectionBody: string;
  delete: string;
  duplicateCollection: string;
  noCollections: string;
}

/** What the Shelf draws: its loading, ready, or error state and its rows. */
export interface FrameShelfState {
  status: "loading" | "ready" | "error";
  entries: FrameShelfEntry[];
  /** The author's Collections in the order they were made (#946); absent means none. */
  collections?: FrameCollection[];
}

/** One Collection the Shelf draws: its id and the author's name for it. */
export interface FrameCollection {
  id: string;
  name: string;
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
  | "searchShelf"
  | "showShelfOptions"
  | "clearShelfFilters"
  | "newCollection"
  | "renameCollection"
  | "deleteCollection"
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
  | "toggleContinuousScroll"
  | "backToShelf"
  | "removeFromShelf"
  | "locateDocument";

/** The Shelf Commands the Frame sends to the Worker. */
export type FrameShelfCommandId =
  | "openDocument"
  | "removeFromShelf"
  | "locateDocument"
  | "openFile";

/* Worker -> Frame */

/** Opens the Frame on the Shelf or on one Document. `pdfPort` is transferred alongside the message. */
export interface FrameOpenMessage {
  kind: "open";
  /** Which view the Frame shows; absent means the Document view. */
  view?: "shelf" | "document";
  entry: FrameEntry | null;
  position: ReadingPosition | null;
  settings: ReaderSettings;
  /** The file's size in bytes; the Frame never reads the whole file. */
  size: number;
  labels: FrameLabels;
  /** The Shelf state the Frame draws when it opens on the Shelf. */
  shelf?: FrameShelfState;
  /** The Shelf's localized strings, rebuilt in the app language. */
  shelfLabels?: FrameShelfLabels;
  /** The Shelf's remembered view, sort, filters, and search (#945). */
  shelfView?: ShelfViewSettings;
  language: string;
  /** The appearance Maibuk draws with right now. */
  appearance: Appearance;
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
  /** The Shelf's labels and row copy, rebuilt in the new language. */
  shelfLabels?: FrameShelfLabels;
}

/** Tells the Frame Maibuk's appearance changed, so it redraws in it. */
export interface FrameAppearanceMessage {
  kind: "appearance";
  appearance: Appearance;
}

/** Lists every entry of the archive the Document is packed in. */
export interface FrameZipListMessage {
  kind: "zip-list";
  id: number;
  entries: FrameZipEntry[];
}

/**
 * Answers one `zip-entry` with the entry as the archive stores it. The Frame
 * inflates `deflated` bytes with `DecompressionStream("deflate-raw")` and
 * decodes text itself, so the Plugin Worker never does either.
 */
export interface FrameZipDataMessage {
  kind: "zip-data";
  id: number;
  /** Transferred. */
  buffer: ArrayBuffer;
  /** True when `buffer` is raw deflate, false when the entry is stored as is. */
  deflated: boolean;
}

/** Refuses one archive request; `code` is `corrupt`, `drm`, or `missing`. */
export interface FrameZipErrorMessage {
  kind: "zip-error";
  id: number;
  code: "corrupt" | "drm" | "missing";
}

/** Replaces the Shelf the Frame draws with its loading, ready, or error state. */
export interface FrameShelfMessage {
  kind: "shelf";
  state: FrameShelfState;
}

/** The localized Remove from Shelf copy for one Document, built from real counts. */
export interface FrameRemoveCountsMessage {
  kind: "remove-counts";
  documentId: string;
  /** The dialog's heading, already localized. */
  title: string;
  /** The line naming what is deleted too, already localized. */
  body: string;
  /** The line promising Reading Stats are kept, already localized. */
  stats: string;
}

/** Answers a Shelf Command; `message` is a localized notice, or omitted when it succeeded. */
export interface FrameShelfResultMessage {
  kind: "shelf-result";
  message?: string;
}

export type WorkerToFrameMessage =
  | FrameOpenMessage
  | FrameBytesMessage
  | FrameReadErrorMessage
  | FrameCommandMessage
  | FrameLanguageMessage
  | FrameAppearanceMessage
  | FrameZipListMessage
  | FrameZipDataMessage
  | FrameZipErrorMessage
  | FrameShelfMessage
  | FrameRemoveCountsMessage
  | FrameShelfResultMessage;

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

/**
 * The Frame could not open the Document. `timeout` is transient (the source
 * stopped answering); the Worker keeps the Document openable so the author can
 * retry, while the other codes mark it unreadable. `reason` is the localized
 * message the Frame already showed.
 */
export interface FrameLoadErrorMessage {
  kind: "load-error";
  code: "corrupt" | "encrypted" | "unsupported" | "timeout";
  reason: string;
}

/** Asks the Worker to list the archive's entries. */
export interface FrameZipListRequest {
  kind: "zip-list";
  id: number;
}

/** Asks for one archive entry, answered with `zip-data` or `zip-error`. */
export interface FrameZipEntryRequest {
  kind: "zip-entry";
  id: number;
  name: string;
}

/** Reports a settings change the Frame made, such as a font size step. */
export interface FrameSettingsMessage {
  kind: "settings";
  settings: ReaderSettings;
}

/** Runs one Shelf Command; `documentId` names the row it acts on. */
export interface FrameShelfCommandMessage {
  kind: "shelf-command";
  id: FrameShelfCommandId;
  documentId?: string;
}

/** Selects one row in the Shelf grid. */
export interface FrameShelfSelectMessage {
  kind: "shelf-select";
  documentId: string;
}

/** Confirms removal of one Document from the Shelf. */
export interface FrameShelfRemoveMessage {
  kind: "shelf-remove";
  documentId: string;
}

/** The author changed the Shelf's view, sort, filters, or search; the Worker stores it (#945). */
export interface FrameShelfViewMessage {
  kind: "shelf-view";
  settings: ShelfViewSettings;
}

/**
 * Creates, renames, or deletes a Collection, or files a Document in one or
 * takes it out (#946). The Worker stores the change and sends the Shelf again.
 */
export type FrameShelfCollectionMessage =
  | { kind: "shelf-collection"; action: "create"; name: string; documentId?: string }
  | { kind: "shelf-collection"; action: "rename"; collectionId: string; name: string }
  | { kind: "shelf-collection"; action: "delete"; collectionId: string }
  | {
      kind: "shelf-collection";
      action: "file";
      collectionId: string;
      documentId: string;
      member: boolean;
    };

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
  | FrameSettingsMessage
  | FrameShelfCommandMessage
  | FrameShelfSelectMessage
  | FrameShelfRemoveMessage
  | FrameShelfViewMessage
  | FrameShelfCollectionMessage;

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
