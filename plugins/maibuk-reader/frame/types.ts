/**
 * The Reader Frame's shared Document shapes (#941): what the Worker hands the
 * Frame to draw, and where the author was in it. Every Frame module that draws
 * or reports a Document takes these instead of declaring its own copy.
 *
 * These mirror `../frame-protocol.ts`, the Plugin Worker's copy. The Frame may
 * not import it (see `entry.ts`), so the shapes stay duplicated; a change lands
 * on both sides at once.
 */

/** The page fit a fresh Document opens with, or a numeric zoom scale. */
export type FrameZoom = number | "width" | "page";

/** Where the author was in a fixed-page Document. */
export interface PagePosition {
  kind: "page";
  page: number;
  zoom: FrameZoom;
}

/** Where the author was in a reflowable Document, by its canonical fragment identifier. */
export interface CfiPosition {
  kind: "cfi";
  cfi: string;
}

/** Where the author was in a format with no fragment identifier, by spine index. */
export interface SectionPosition {
  kind: "section";
  index: number;
  fraction: number;
}

/** Where the author was in a Document. */
export type ReadingPosition = PagePosition | CfiPosition | SectionPosition;

/**
 * The appearance Maibuk draws with: the resolved color scheme and whether
 * E-ink Mode is applied, exactly as the host serves them.
 */
export interface Appearance {
  colorScheme: "light" | "dark";
  eink: boolean;
}

/** The Document fields the Frame draws. */
export interface FrameEntry {
  id: string;
  title: string;
  author: string;
  format: string;
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
}

/** One Shelf row the Frame draws; the File Grant and Fingerprint stay in the Worker. */
export interface FrameShelfEntry {
  id: string;
  title: string;
  author: string;
  format: string;
  state: "ok" | "missing" | "needs-permission" | "unreadable";
  coverDataUrl?: string;
  progressText: string;
  progressPercent: number | null;
  statusText: string | null;
  tone: number;
  /** New, reading, or finished, decided by the Worker from the stored progress. */
  status: ShelfStatus;
  /** Milliseconds since the Unix epoch: the last read, or the Import when never read. */
  lastReadAt: number;
  /** Milliseconds since the Unix epoch when the Document was imported. */
  addedAt: number;
  /** How far through the Document the author is, 0 to 1; 0 when new. */
  progress: number;
}

/** The Reader settings the Worker hands the Frame. */
export interface ReaderSettings {
  fontSize: number;
  lineWidth: string;
  pdfFit: "width" | "page";
  pdfLayout: "single" | "continuous";
}

/** The pdf.js resources the Worker hands the Frame when a PDF opens. */
export interface FramePdf {
  displaySource: string;
  css: string;
}

/** The modules the Frame evaluates for a reflowable or fixed-layout Document. */
export interface FrameFoliate {
  source: string;
  purify: string;
}

/** One entry in the archive a reflowable Document is packed in. */
export interface FrameZipEntry {
  name: string;
  size: number;
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

/** The localized Shelf strings the Frame shows. */
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
}

/** What the Shelf draws: its loading, ready, or error state and its rows. */
export interface FrameShelfState {
  status: "loading" | "ready" | "error";
  entries: FrameShelfEntry[];
}

/** The Shelf Commands the Frame sends to the Worker. */
export type FrameShelfCommandId =
  | "openDocument"
  | "removeFromShelf"
  | "locateDocument"
  | "openFile";
