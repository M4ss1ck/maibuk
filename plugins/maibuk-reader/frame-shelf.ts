/**
 * The Shelf's Frame view model (#944): the rows, labels, and removal copy the
 * Worker hands its Frame over the wire. Everything here is a plain value in and
 * a plain value out, built from the Shelf row, Reader's runtime catalogs, and
 * the same progress rules the host-rendered page used.
 *
 * The File Grant and Fingerprint stay in the Worker: `FrameShelfEntry` carries
 * only what the Frame draws, so the author's file never leaks across the port.
 */

import type { FrameShelfEntry, FrameShelfLabels, FrameShelfState } from "./frame-protocol";
import { format, translate, type ReaderKey } from "./i18n";
import { baseLanguage } from "./language";
import { progressFraction, progressSummary, shelfStatus, type ShelfEntry } from "./shelf";

/** The generated cover's eight tone pairs. */
const TONE_COUNT = 8;

/**
 * One of the generated cover's eight tones, stable for a Document id: the same
 * Document keeps its cover color across launches and reorders.
 */
export function shelfTone(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % TONE_COUNT;
}

/**
 * The progress line for one row, localized: New until the Document is opened,
 * then its page or percentage (0% before a position is saved).
 */
function progressText(language: string, entry: ShelfEntry): string {
  if (shelfStatus(entry) === "finished") {
    return translate(language, "shelf.frame.finishedLabel");
  }
  const summary = progressSummary(entry.progress);
  if (summary === null) {
    return shelfStatus(entry) === "new"
      ? translate(language, "shelf.frame.newLabel")
      : format(translate(language, "shelf.progress.percent"), { percent: 0 });
  }
  if (summary.kind === "page") {
    return format(translate(language, "shelf.progress.page"), {
      page: summary.page,
      count: summary.pageCount,
    });
  }
  return format(translate(language, "shelf.progress.percent"), { percent: summary.percent });
}

/**
 * The whole percentage the drawn progress bar shows, or null when the Shelf
 * knows nothing yet. A page out of its count becomes the same whole percentage
 * the text does not spell out; a finished Document is always full.
 */
function progressPercent(entry: ShelfEntry): number | null {
  const progress = entry.progress;
  if (shelfStatus(entry) === "new") return null;
  if (shelfStatus(entry) === "finished") return 100;
  const summary = progressSummary(progress);
  if (summary === null) return 0;
  if (summary.kind === "page") {
    return Math.min(100, Math.max(0, Math.round((summary.page / summary.pageCount) * 100)));
  }
  return Math.min(100, Math.max(0, summary.percent));
}

/**
 * The state line for a file Reader cannot read, or null when it is readable.
 * The glossary calls a browser permission re-request a Missing Document too, so
 * `needs-permission` wears the same chip; an unreadable file says what it is.
 */
function statusText(language: string, entry: ShelfEntry): string | null {
  switch (entry.state) {
    case "missing":
    case "needs-permission":
      return translate(language, "shelf.frame.missing");
    case "unreadable":
      return translate(language, "shelf.status.unreadable");
    default:
      return null;
  }
}

/** One Shelf row as the Frame draws it. */
export function frameShelfEntry(language: string, entry: ShelfEntry): FrameShelfEntry {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    format: entry.format,
    state: entry.state ?? "ok",
    ...(entry.coverDataUrl === undefined ? {} : { coverDataUrl: entry.coverDataUrl }),
    progressText: progressText(language, entry),
    progressPercent: progressPercent(entry),
    statusText: statusText(language, entry),
    tone: shelfTone(entry.id),
    status: shelfStatus(entry),
    lastReadAt: entry.lastReadAt,
    addedAt: entry.addedAt,
    progress: progressFraction(entry.progress),
  };
}

/** A ready Shelf and every row it draws, localized in one language. */
export function frameShelfState(language: string, entries: readonly ShelfEntry[]): FrameShelfState {
  return { status: "ready", entries: entries.map((entry) => frameShelfEntry(language, entry)) };
}

/** The localized Shelf strings the Frame shows. */
export function frameShelfLabels(language: string): FrameShelfLabels {
  return {
    shelf: translate(language, "page.shelf"),
    import: translate(language, "shelf.frame.import"),
    importFiles: translate(language, "shelf.frame.importFiles"),
    emptyTitle: translate(language, "shelf.emptyTitle"),
    emptyDescription: translate(language, "shelf.frame.emptyDescription"),
    loading: translate(language, "shelf.loading"),
    error: translate(language, "shelf.frame.error"),
    documentsCountOne: translate(language, "shelf.frame.documentsCount.one"),
    documentsCountOther: translate(language, "shelf.frame.documentsCount.other"),
    open: translate(language, "shelf.open"),
    remove: translate(language, "shelf.frame.remove"),
    locate: translate(language, "shelf.frame.locate"),
    missing: translate(language, "shelf.frame.missing"),
    moreFor: translate(language, "shelf.frame.moreFor"),
    removeConfirm: translate(language, "shelf.frame.removeConfirm"),
    cancel: translate(language, "shelf.frame.cancel"),
    newLabel: translate(language, "shelf.frame.newLabel"),
    finishedLabel: translate(language, "shelf.frame.finishedLabel"),
    documentActions: translate(language, "shelf.frame.documentActions"),
    dismiss: translate(language, "shelf.frame.dismiss"),
    allDocuments: translate(language, "shelf.frame.allDocuments"),
    shownOf: translate(language, "shelf.frame.shownOf"),
    searchLabel: translate(language, "shelf.frame.searchLabel"),
    searchPlaceholder: translate(language, "shelf.frame.searchPlaceholder"),
    closeSearch: translate(language, "shelf.frame.closeSearch"),
    clearSearch: translate(language, "shelf.frame.clearSearch"),
    searchMatchesOne: translate(language, "shelf.frame.searchMatches.one"),
    searchMatchesOther: translate(language, "shelf.frame.searchMatches.other"),
    gridView: translate(language, "shelf.frame.gridView"),
    listView: translate(language, "shelf.frame.listView"),
    compactView: translate(language, "shelf.frame.compactView"),
    viewOptions: translate(language, "shelf.frame.viewOptions"),
    viewOptionsTitle: translate(language, "shelf.frame.viewOptionsTitle"),
    reset: translate(language, "shelf.frame.reset"),
    done: translate(language, "shelf.frame.done"),
    layout: translate(language, "shelf.frame.layout"),
    layoutLabel: translate(language, "shelf.frame.layoutLabel"),
    layoutGrid: translate(language, "shelf.frame.layoutGrid"),
    layoutList: translate(language, "shelf.frame.layoutList"),
    layoutCompact: translate(language, "shelf.frame.layoutCompact"),
    coverSize: translate(language, "shelf.frame.coverSize"),
    coverSmall: translate(language, "shelf.frame.coverSmall"),
    coverMedium: translate(language, "shelf.frame.coverMedium"),
    coverLarge: translate(language, "shelf.frame.coverLarge"),
    coverSmallShort: translate(language, "shelf.frame.coverSmallShort"),
    coverMediumShort: translate(language, "shelf.frame.coverMediumShort"),
    coverLargeShort: translate(language, "shelf.frame.coverLargeShort"),
    sortBy: translate(language, "shelf.frame.sortBy"),
    sortRecent: translate(language, "shelf.frame.sort.recent"),
    sortTitle: translate(language, "shelf.frame.sort.title"),
    sortAuthor: translate(language, "shelf.frame.sort.author"),
    sortProgress: translate(language, "shelf.frame.sort.progress"),
    sortAdded: translate(language, "shelf.frame.sort.added"),
    reverseOrder: translate(language, "shelf.frame.reverseOrder"),
    reverseOrderValue: translate(language, "shelf.frame.reverseOrderValue"),
    sortSummary: translate(language, "shelf.frame.sortSummary"),
    sortByValue: translate(language, "shelf.frame.sortByValue"),
    newestFirst: translate(language, "shelf.frame.newestFirst"),
    oldestFirst: translate(language, "shelf.frame.oldestFirst"),
    aToZ: translate(language, "shelf.frame.aToZ"),
    zToA: translate(language, "shelf.frame.zToA"),
    mostReadFirst: translate(language, "shelf.frame.mostReadFirst"),
    leastReadFirst: translate(language, "shelf.frame.leastReadFirst"),
    recentFirst: translate(language, "shelf.frame.recentFirst"),
    filters: translate(language, "shelf.frame.filters"),
    status: translate(language, "shelf.frame.status"),
    format: translate(language, "shelf.frame.format"),
    all: translate(language, "shelf.frame.all"),
    statusNew: translate(language, "shelf.frame.status.new"),
    statusReading: translate(language, "shelf.frame.status.reading"),
    statusFinished: translate(language, "shelf.frame.status.finished"),
    statusChip: translate(language, "shelf.frame.statusChip"),
    formatChip: translate(language, "shelf.frame.formatChip"),
    removeFilter: translate(language, "shelf.frame.removeFilter"),
    clearFilters: translate(language, "shelf.frame.clearFilters"),
    noMatch: translate(language, "shelf.frame.noMatch"),
    remembered: translate(language, "shelf.frame.remembered"),
  };
}

/** The real counts that disappear with a Document. */
export interface ShelfRemovalCounts {
  bookmarks: number;
  highlights: number;
  notes: number;
}

/** The localized Remove from Shelf confirmation: its title, body, and stats line. */
export interface ShelfRemovalCopy {
  title: string;
  body: string;
  stats: string;
}

/** A count with its singular or plural noun, such as "1 Bookmark" or "3 Bookmarks". */
function countNoun(language: string, count: number, one: ReaderKey, other: ReaderKey): string {
  const noun = translate(language, count === 1 ? one : other);
  return `${count} ${noun}`;
}

/**
 * The Remove from Shelf copy for one Document, built from the Bookmarks,
 * Highlights, and notes the Worker really found. Reading Stats stay, so the
 * line says so until #963 can name a duration.
 */
export function shelfRemovalCopy(
  language: string,
  title: string,
  counts: ShelfRemovalCounts
): ShelfRemovalCopy {
  const notes =
    counts.notes <= 0
      ? ""
      : format(
          translate(
            language,
            counts.notes === 1 ? "shelf.frame.removeNote" : "shelf.frame.removeNotes"
          ),
          { count: counts.notes }
        );
  const singular = counts.bookmarks === 1 || counts.highlights === 1;
  // Spanish names the nouns in the placeholder, so every count gets them; the
  // English plural template already spells "Bookmarks" and "Highlights".
  const nounPhrases = singular || baseLanguage(language) === "es";
  return {
    title: format(translate(language, "shelf.frame.removeTitle"), { title }),
    body: format(
      translate(language, singular ? "shelf.frame.removeBodySingular" : "shelf.frame.removeBody"),
      {
        bookmarks: nounPhrases
          ? countNoun(
              language,
              counts.bookmarks,
              "shelf.frame.removeBookmarkOne",
              "shelf.frame.removeBookmarkOther"
            )
          : counts.bookmarks,
        highlights: nounPhrases
          ? countNoun(
              language,
              counts.highlights,
              "shelf.frame.removeHighlightOne",
              "shelf.frame.removeHighlightOther"
            )
          : counts.highlights,
        notes,
      }
    ),
    stats: translate(language, "shelf.frame.stats"),
  };
}
