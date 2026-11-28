/**
 * The Shelf's Frame view model (#944): the rows, labels, and removal copy the
 * Worker hands its Frame over the wire. Everything here is a plain value in and
 * a plain value out, built from the Shelf row, Reader's runtime catalogs, and
 * the same progress rules the host-rendered page used.
 *
 * The File Grant and Fingerprint stay in the Worker: `FrameShelfEntry` carries
 * only what the Frame draws, so the author's file never leaks across the port.
 */

import type {
  FrameImportState,
  FrameShelfEntry,
  FrameShelfLabels,
  FrameShelfState,
} from "./frame-protocol";
import { format, translate, type ReaderKey } from "./i18n";
import type { ImportReport, ImportState, UnreadableReason } from "./import";
import { baseLanguage } from "./language";
import {
  progressFraction,
  progressSummary,
  type Collection,
  type ShelfEntry,
  type ShelfStatus,
  shelfStatus,
} from "./shelf";

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
function progressText(language: string, entry: ShelfEntry, status: ShelfStatus): string {
  if (status === "finished") {
    return translate(language, "shelf.frame.finishedLabel");
  }
  const summary = progressSummary(entry.progress);
  if (summary === null) {
    return status === "new"
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
function progressPercent(entry: ShelfEntry, status: ShelfStatus): number | null {
  const progress = entry.progress;
  if (status === "new") return null;
  if (status === "finished") return 100;
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
  const status = shelfStatus(entry);
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    format: entry.format,
    state: entry.state ?? "ok",
    ...(entry.coverDataUrl === undefined ? {} : { coverDataUrl: entry.coverDataUrl }),
    ...(entry.coverPending === true ? { coverPending: true } : {}),
    progressText: progressText(language, entry, status),
    progressPercent: progressPercent(entry, status),
    statusText: statusText(language, entry),
    tone: shelfTone(entry.id),
    status,
    lastReadAt: entry.lastReadAt,
    addedAt: entry.addedAt,
    progress: progressFraction(entry.progress),
  };
}

/**
 * A ready Shelf and every row it draws, localized in one language, with the
 * author's Collections (#946). Each row names the Collections it is filed in;
 * an id a Collection keeps for a Document no longer on the Shelf draws nothing.
 */
export function frameShelfState(
  language: string,
  entries: readonly ShelfEntry[],
  collections: readonly Collection[] = []
): FrameShelfState {
  const filed = new Map<string, string[]>();
  for (const collection of collections) {
    for (const documentId of collection.documentIds) {
      const ids = filed.get(documentId);
      if (ids === undefined) filed.set(documentId, [collection.id]);
      else ids.push(collection.id);
    }
  }
  return {
    status: "ready",
    entries: entries.map((entry) => {
      const row = frameShelfEntry(language, entry);
      const ids = filed.get(entry.id);
      return ids === undefined ? row : { ...row, collections: ids };
    }),
    collections: collections.map(({ id, name }) => ({ id, name })),
  };
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
    collections: translate(language, "shelf.frame.collections"),
    newCollection: translate(language, "shelf.frame.newCollection"),
    newCollectionName: translate(language, "shelf.frame.newCollectionName"),
    add: translate(language, "shelf.frame.add"),
    railHint: translate(language, "shelf.frame.railHint"),
    collection: translate(language, "shelf.frame.collection"),
    anyCollection: translate(language, "shelf.frame.anyCollection"),
    collectionChip: translate(language, "shelf.frame.collectionChip"),
    moreForCollection: translate(language, "shelf.frame.moreForCollection"),
    collectionName: translate(language, "shelf.frame.collectionName"),
    create: translate(language, "shelf.frame.create"),
    renameCollection: translate(language, "shelf.frame.renameCollection"),
    renameAction: translate(language, "shelf.frame.renameAction"),
    rename: translate(language, "shelf.frame.rename"),
    deleteAction: translate(language, "shelf.frame.deleteAction"),
    deleteCollectionTitle: translate(language, "shelf.frame.deleteCollectionTitle"),
    deleteCollectionBody: translate(language, "shelf.frame.deleteCollectionBody"),
    delete: translate(language, "shelf.frame.delete"),
    duplicateCollection: translate(language, "shelf.frame.duplicateCollection"),
    noCollections: translate(language, "shelf.frame.noCollections"),
    importDescription: translate(language, "shelf.frame.importDescription"),
    importFilesOption: translate(language, "shelf.frame.importFilesOption"),
    importFilesHint: translate(language, "shelf.frame.importFilesHint"),
    importFolderOption: translate(language, "shelf.frame.importFolderOption"),
    importFolderHint: translate(language, "shelf.frame.importFolderHint"),
    importFolder: translate(language, "shelf.frame.importFolder"),
    importClose: translate(language, "shelf.frame.importClose"),
    importProgressLabel: translate(language, "shelf.frame.importProgressLabel"),
    importCancel: translate(language, "shelf.frame.importCancel"),
    importViewReport: translate(language, "shelf.frame.importViewReport"),
    importDismiss: translate(language, "shelf.frame.importDismiss"),
    importKeepReading: translate(language, "shelf.frame.importKeepReading"),
    reportTitle: translate(language, "shelf.frame.reportTitle"),
    reportClose: translate(language, "shelf.frame.reportClose"),
    reportAdded: translate(language, "shelf.frame.reportAdded"),
    reportAlreadyOnShelf: translate(language, "shelf.frame.reportAlreadyOnShelf"),
    reportRelinked: translate(language, "shelf.frame.reportRelinked"),
    reportRelinkedShort: translate(language, "shelf.frame.reportRelinkedShort"),
    reportUnreadable: translate(language, "shelf.frame.reportUnreadable"),
    reportUnreadableHint: translate(language, "shelf.frame.reportUnreadableHint"),
    reportDetails: translate(language, "shelf.frame.reportDetails"),
    reportNone: translate(language, "shelf.frame.reportNone"),
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

const UNREADABLE_REASON: Readonly<Record<UnreadableReason, ReaderKey>> = {
  drm: "shelf.import.reason.drm",
  corrupt: "shelf.import.reason.corrupt",
  unsupported: "shelf.import.reason.unsupported",
  unreadable: "shelf.import.reason.unreadable",
};

/** A count in its singular or plural template, such as "1 file found". */
function countText(language: string, count: number, one: ReaderKey, other: ReaderKey): string {
  return format(translate(language, count === 1 ? one : other), { count });
}

/** The card's title: what is being imported, or that it finished or was cancelled. */
function importTitle(
  language: string,
  status: ImportState["status"],
  report: ImportReport
): string {
  const { source } = report;
  if (status === "done" && report.cancelled)
    return translate(language, "shelf.import.titleCancelled");
  if (source.kind === "files") {
    return translate(
      language,
      status === "running" ? "shelf.import.titleFiles" : "shelf.import.titleFilesDone"
    );
  }
  const key = status === "running" ? "shelf.import.titleFolder" : "shelf.import.titleFolderDone";
  return format(translate(language, key), { name: source.name });
}

/** "96 added · 22 already on Shelf · 3 relinked · 1 unreadable"; a zero past "added" stays out. */
function importCounts(language: string, report: ImportReport): string {
  const parts = [
    countText(
      language,
      report.added.length,
      "shelf.import.countAdded.one",
      "shelf.import.countAdded.other"
    ),
  ];
  const rest: [number, ReaderKey, ReaderKey][] = [
    [
      report.alreadyOnShelf.length,
      "shelf.import.countAlreadyOnShelf.one",
      "shelf.import.countAlreadyOnShelf.other",
    ],
    [report.relinked.length, "shelf.import.countRelinked.one", "shelf.import.countRelinked.other"],
    [
      report.unreadable.length,
      "shelf.import.countUnreadable.one",
      "shelf.import.countUnreadable.other",
    ],
  ];
  for (const [count, one, other] of rest) {
    if (count > 0) parts.push(countText(language, count, one, other));
  }
  return parts.join(" · ");
}

/** Where the files came from, how many, and when the Import finished or was cancelled. */
function importSubtitle(language: string, report: ImportReport): string {
  const { source } = report;
  const parts = [
    source.kind === "folder"
      ? format(translate(language, "shelf.import.sourceFolder"), { name: source.name })
      : translate(language, "shelf.import.sourceFiles"),
    countText(language, report.found, "shelf.import.found.one", "shelf.import.found.other"),
  ];
  if (report.finishedAt !== undefined) {
    const time = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(
      report.finishedAt
    );
    const key = report.cancelled ? "shelf.import.cancelledAt" : "shelf.import.finishedAt";
    parts.push(format(translate(language, key), { time }));
  }
  return parts.join(" · ");
}

/** The line about files the Import found twice and added once, or "". */
function duplicatesText(language: string, report: ImportReport): string {
  if (report.duplicates <= 0) return "";
  return report.source.kind === "folder"
    ? countText(
        language,
        report.duplicates,
        "shelf.import.duplicatesFolder.one",
        "shelf.import.duplicatesFolder.other"
      )
    : countText(
        language,
        report.duplicates,
        "shelf.import.duplicates.one",
        "shelf.import.duplicates.other"
      );
}

/**
 * The background Import as the Shelf's card and report draw it (#948), every
 * string localized here so the Frame only lays it out. File names stay as the
 * host gave them; the host never hands Reader a path.
 */
export function frameImportState(language: string, state: ImportState): FrameImportState {
  const { report, status } = state;
  return {
    status,
    source: report.source.kind,
    title: importTitle(language, status, report),
    processed: report.processed,
    found: report.found,
    progressText: format(translate(language, "shelf.import.progress"), {
      processed: report.processed,
      found: report.found,
    }),
    countsText: importCounts(language, report),
    report: {
      subtitle: importSubtitle(language, report),
      added: [...report.added],
      alreadyOnShelf: [...report.alreadyOnShelf],
      relinked: [...report.relinked],
      unreadable: report.unreadable.map(({ name, reason }) => ({
        name,
        reason: translate(language, UNREADABLE_REASON[reason]),
      })),
      duplicatesText: duplicatesText(language, report),
    },
  };
}
