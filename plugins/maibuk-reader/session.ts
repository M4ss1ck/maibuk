/**
 * One Reader session (#653): the Worker half of the Frame wire protocol. The
 * runtime creates one when the host hands it the reading Frame's port, and it
 * lives until the author leaves or the Frame hangs up. It seeds the Frame with
 * the Document, answers the Frame's byte-range reads from the File Grant,
 * saves the Reading Position the Frame reports, folds the Document's own
 * metadata into the Shelf, and forwards the manifest's reading Commands.
 *
 * Opening a PDF also starts pdf.js's core in a nested Worker and transfers one
 * end of a MessageChannel to it; the other end travels to the Frame inside
 * `open`, so the long parse never blocks the Plugin Worker and the Frame talks
 * to the core directly.
 *
 * Opening a zip-packed Document (EPUB and CBZ) makes the session read the
 * archive's directory and answer `zip-entry` requests with each entry's bytes
 * as stored, so the Frame never holds the whole file and inflates each entry
 * natively. The same `open` carries foliate's parsers and DOMPurify as source
 * the Frame imports from `blob:` URLs.
 *
 * Imports only `@/plugin-sdk` (types and the read cap) and this Plugin's files.
 */

import { FILE_READ_MAX_BYTES, type PluginClient } from "@/plugin-sdk";
import type { PluginApiErrorCode } from "@/plugin-sdk";
import type { ShelfService } from "./library";
import { hasCollisions, pickAndImport, type Importer, type ImportState } from "./import";
import {
  foliateSource,
  purifySource,
  startPdfCore,
  pdfDisplaySource,
  pdfViewerCss,
  type PdfCore,
} from "./loaders";
import {
  type Appearance,
  type FrameCommandId,
  type FrameEntry,
  type FrameLabels,
  type FrameLoadErrorMessage,
  type FrameMetaMessage,
  type FrameOpenMessage,
  type FramePdf,
  type FramePositionMessage,
  type FrameCoverJobMessage,
  type FrameReadMessage,
  type FrameSettingsMessage,
  type FrameShelfCollectionMessage,
  type FrameShelfImportMessage,
  type FrameShelfCommandMessage,
  type FrameShelfRemoveMessage,
  type FrameShelfState,
  type FrameToWorkerMessage,
  type FrameZipEntryRequest,
  type FrameZipListRequest,
  type ReadingPosition,
} from "./frame-protocol";
import {
  frameImportState,
  frameShelfLabels,
  frameShelfState,
  shelfRemovalCopy,
} from "./frame-shelf";
import { ZipError, openZip, type ZipArchive } from "./zip";
import {
  DEFAULT_READER_SETTINGS,
  clampSettings,
  IMPORT_COLLECT_KEY,
  positionKey,
  SUPPORTED_EXTENSIONS,
  withProgress,
  type Collection,
  type ReaderSettings,
  type ShelfEntry,
  type ShelfProgress,
  type ShelfViewSettings,
} from "./shelf";
import { translate } from "./i18n";

/** The SDK surface a session needs: the File Grant, Plugin storage, and the host's appearance. */
export type SessionClient = Pick<PluginClient, "files" | "storage" | "appearance">;

/** The appearance the Frame draws with when the host serves none. */
const DEFAULT_APPEARANCE: Appearance = { colorScheme: "light", eink: false };

/** How often a running Import redraws the Shelf's card and rows, at most (#948). */
export const IMPORT_THROTTLE_MS = 400;

/** How long the Shelf Frame may take over one Document's cover before it is skipped (#948). */
export const COVER_JOB_TIMEOUT_MS = 30_000;

/**
 * The largest cover data URL the Shelf keeps. It mirrors `COVER_MAX_BYTES` in
 * `frame/meta.ts`, which encodes it: the Frame may not import Worker code.
 */
const COVER_MAX_BYTES = 50 * 1024;

/** Whether the Frame's answer is a small JPEG data URL, the only cover the Shelf stores. */
function isCoverDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("data:image/jpeg;base64,") &&
    value.length <= COVER_MAX_BYTES
  );
}

/** One Document's archive, opened once on its first request. */
interface ArchiveSlot {
  archive: ZipArchive | null;
  opening: Promise<ZipArchive> | null;
}

/** What one Document's reads come from: its File Grant, its size, and its archive. */
interface DocumentSource {
  grant: string;
  size: number;
  archive: ArchiveSlot;
}

/** The Document whose cover the Shelf Frame is drawing, and what its read holds. */
interface CoverJob extends DocumentSource {
  documentId: string;
  core: PdfCore | null;
  port: MessagePort | null;
  timer: ReturnType<typeof setTimeout>;
}

/** What the runtime gives one mounted Frame. */
export interface ReaderSessionDeps {
  client: SessionClient;
  library: ShelfService;
  /** The Document to open, or null when the Frame mounted with nothing open. */
  entry: ShelfEntry | null;
  language: string;
  port: MessagePort;
  /**
   * The place the host's Back returns to, or null when this page has none
   * (#786): the Frame's own Back reads back to it instead of back to the Shelf.
   */
  returnLabel: () => string | null;
  /** Leaves the reading surface; the runtime opens the Shelf page. */
  navigateToShelf(): Promise<void> | void;
  /** The view the Frame mounts on; the Document view when absent. */
  view?: "shelf" | "document";
  /**
   * Whether the Frame owns the Shelf, so Back returns to it inside the Frame
   * instead of leaving the page (#944).
   */
  shelfInFrame?: boolean;
  /** Opens a Document the author picked or chose on the Frame's Shelf. */
  openEntry?(entry: ShelfEntry): Promise<void> | void;
  /** Told which view the session switched to, so the runtime can remember it. */
  onViewChange?(view: "shelf" | "document"): void;
  /** Called once when the session stops, so the runtime forgets the Frame. */
  onDispose?(): void;
  /** The Worker's one background Import, which outlives this Frame (#948). */
  importer?: Importer;
  /** How often a running Import redraws, at most; IMPORT_THROTTLE_MS when absent. */
  importThrottleMs?: number;
  /** How long one cover job may run; COVER_JOB_TIMEOUT_MS when absent. */
  coverJobTimeoutMs?: number;
}

/** A session the runtime can address for the life of one mounted Frame. */
export interface ReaderSession {
  readonly port: MessagePort;
  /** Starts listening to the Frame; call once after construction. */
  start(): void;
  /** Opens `entry` in this Frame, replacing whatever it showed. */
  setEntry(entry: ShelfEntry | null): void;
  /**
   * Switches the Frame to its Shelf without leaving the page (#944): flushes
   * the pending Reading Position, releases the open Document, and publishes a
   * fresh `open`.
   */
  showShelf(): Promise<void>;
  /** Tells the Frame the app language changed. */
  setLanguage(language: string): void;
  /** Tells the Frame Maibuk's appearance changed, so it redraws in it. */
  setAppearance(appearance: Appearance): void;
  /** Forwards one manifest reading Command. */
  command(id: FrameCommandId): void;
  /** Stops pdf.js, releases the port, and ignores anything later. */
  dispose(): void;
  /** The view the Frame shows now. */
  readonly view: "shelf" | "document";
  /** True once the session stopped. */
  readonly disposed: boolean;
}

/** The error code a refused File Grant call carries. */
function errorCode(error: unknown): PluginApiErrorCode {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code as PluginApiErrorCode;
  }
  return "internal-error";
}

/** The size the Fingerprint's `${size}:` prefix carries, or 0 when unparseable. */
export function sizeFromFingerprint(fingerprint: string): number {
  const prefix = fingerprint.split(":", 1)[0];
  const size = Number.parseInt(prefix, 10);
  return Number.isFinite(size) && size >= 0 ? size : 0;
}

/** The Document fields the Frame may draw; the grant and fingerprint stay here. */
function frameEntry(entry: ShelfEntry): FrameEntry {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    format: entry.format,
  };
}

/** The Reading Position the Frame should resume at, from whatever storage held. */
export function readPosition(value: unknown, settings: ReaderSettings): ReadingPosition | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "cfi" && typeof record.cfi === "string" && record.cfi !== "") {
    return { kind: "cfi", cfi: record.cfi };
  }
  if (record.kind === "section" && typeof record.index === "number") {
    const fraction =
      typeof record.fraction === "number" && Number.isFinite(record.fraction)
        ? Math.min(1, Math.max(0, record.fraction))
        : 0;
    return { kind: "section", index: Math.max(0, Math.floor(record.index)), fraction };
  }
  const zoom =
    typeof record.zoom === "number"
      ? record.zoom
      : record.zoom === "width" || record.zoom === "page"
        ? record.zoom
        : settings.pdfFit;
  if (record.kind === "page" && typeof record.page === "number") {
    return { kind: "page", page: Math.max(0, Math.floor(record.page)), zoom };
  }
  // A Shelf row written before Reading Position had a kind: `page` was the
  // one-based number the Shelf still shows.
  if (typeof record.page === "number") {
    return { kind: "page", page: Math.max(0, Math.floor(record.page) - 1), zoom };
  }
  return null;
}

/** Every string the Frame's own chrome needs, in the host's language. */
export function frameLabels(language: string, returnLabel: string | null = null): FrameLabels {
  return {
    back:
      returnLabel === null
        ? translate(language, "viewer.back")
        : translate(language, "viewer.backTo").replace("{label}", returnLabel),
    contents: translate(language, "viewer.contents"),
    contentsEmpty: translate(language, "viewer.contentsEmpty"),
    find: translate(language, "viewer.find"),
    searchPlaceholder: translate(language, "viewer.searchPlaceholder"),
    searchNext: translate(language, "viewer.searchNext"),
    searchPrevious: translate(language, "viewer.searchPrevious"),
    searchClose: translate(language, "viewer.searchClose"),
    searchNoMatches: translate(language, "viewer.searchNoMatches"),
    searchMatches: translate(language, "viewer.searchMatches"),
    pageOf: translate(language, "viewer.pageOf"),
    pageLabeled: translate(language, "viewer.pageLabeled"),
    zoomIn: translate(language, "viewer.zoomIn"),
    zoomOut: translate(language, "viewer.zoomOut"),
    fitWidth: translate(language, "viewer.fitWidth"),
    fitPage: translate(language, "viewer.fitPage"),
    zoomLevel: translate(language, "viewer.zoomLevel"),
    loading: translate(language, "viewer.loading"),
    empty: translate(language, "viewer.empty"),
    previousPage: translate(language, "viewer.previousPage"),
    nextPage: translate(language, "viewer.nextPage"),
    passwordTitle: translate(language, "viewer.passwordTitle"),
    passwordLabel: translate(language, "viewer.passwordLabel"),
    passwordSubmit: translate(language, "viewer.passwordSubmit"),
    passwordWrong: translate(language, "viewer.passwordWrong"),
    errorCorrupt: translate(language, "viewer.errorCorrupt"),
    errorEncrypted: translate(language, "viewer.errorEncrypted"),
    errorUnsupported: translate(language, "viewer.errorUnsupported"),
    errorGeneric: translate(language, "viewer.errorGeneric"),
    errorDrm: translate(language, "viewer.errorDrm"),
    errorDamaged: translate(language, "viewer.errorDamaged"),
    errorTooLarge: translate(language, "viewer.errorTooLarge"),
    errorTimeout: translate(language, "viewer.errorTimeout"),
    sectionPage: translate(language, "viewer.sectionPage"),
    increaseFontSize: translate(language, "viewer.increaseFontSize"),
    decreaseFontSize: translate(language, "viewer.decreaseFontSize"),
    continuousScroll: translate(language, "viewer.continuousScroll"),
    fullScreen: translate(language, "viewer.fullScreen"),
    exitFullScreen: translate(language, "viewer.exitFullScreen"),
  };
}

/** Joins the byte chunks one `read` assembled. */
function joinChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * Writes the Shelf's view with at most one write in flight. While one runs, only
 * the newest settings wait, and they are written once the running write settles,
 * so a burst of view changes costs at most two writes. A failed write is dropped
 * (the author keeps the Shelf as they see it), and the next settings still write.
 */
function coalescedShelfViewWriter(
  save: (settings: ShelfViewSettings) => Promise<void>
): (settings: ShelfViewSettings) => void {
  let pending: ShelfViewSettings | null = null;
  let writing = false;
  async function drain(): Promise<void> {
    writing = true;
    while (pending !== null) {
      const next = pending;
      pending = null;
      try {
        await save(next);
      } catch {
        // A refused write leaves the stored view as it was; the author keeps the Shelf as shown.
      }
    }
    writing = false;
  }
  return (settings) => {
    pending = settings;
    if (!writing) void drain();
  };
}

/** Creates one session for one Frame port. Nothing starts until {@link ReaderSession.start}. */
export function createReaderSession(deps: ReaderSessionDeps): ReaderSession {
  const { client, library, port } = deps;
  let view: "shelf" | "document" = deps.view ?? "document";
  let entry = view === "shelf" ? null : deps.entry;
  let selectedDocumentId: string | null = null;
  let language = deps.language;
  let disposed = false;
  let opened = false;
  /** Bumped whenever the open Document is released, so a stale `open` never posts. */
  let openGeneration = 0;
  let metaApplied = false;
  let core: PdfCore | null = null;
  let pdfPort: MessagePort | null = null;
  /** The open Document's archive, once a request opened it. */
  let documentArchive: ArchiveSlot = { archive: null, opening: null };
  /** The Document whose cover the Shelf Frame is drawing now (#948), one at a time. */
  let coverJob: CoverJob | null = null;
  /** Documents asked for a cover this session, so a failed one is not asked for again. */
  const coverAsked = new Set<string>();
  /**
   * Reading Position saves run one after another, latest last, so two saves
   * never read and write the Shelf row at the same time and lose one update.
   * `back` awaits the tail so the Shelf draws the Position it just left.
   */
  let pendingPosition: Promise<void> = Promise.resolve();
  /** Stores the Shelf's view as the Frame reports it; at most one write runs at a time. */
  const writeShelfView = coalescedShelfViewWriter((settings) => library.saveShelfView(settings));
  const importer = deps.importer ?? null;
  const importThrottleMs = deps.importThrottleMs ?? IMPORT_THROTTLE_MS;
  const coverJobTimeoutMs = deps.coverJobTimeoutMs ?? COVER_JOB_TIMEOUT_MS;
  /** The trailing redraw a running Import waits for; null when none is due. */
  let importTimer: ReturnType<typeof setTimeout> | null = null;
  /** The Import status this Frame last drew, so a status change always draws at once. */
  let drawnImportStatus: ImportState["status"] | null = null;
  let unsubscribeImport: (() => void) | null = null;

  function post(message: unknown, transfer?: Transferable[]): void {
    if (disposed) return;
    if (transfer === undefined) port.postMessage(message);
    else port.postMessage(message, transfer);
  }

  async function loadSettings(): Promise<ReaderSettings> {
    try {
      return clampSettings(await library.loadSettings());
    } catch {
      return DEFAULT_READER_SETTINGS;
    }
  }

  async function storedPosition(settings: ReaderSettings): Promise<ReadingPosition | null> {
    if (entry === null) return null;
    try {
      return readPosition(await client.storage.get({ key: positionKey(entry.id) }), settings);
    } catch {
      return null;
    }
  }

  /** The appearance Maibuk draws with now; the light scheme when the host refuses. */
  async function currentAppearance(): Promise<Appearance> {
    try {
      const value = await client.appearance.get({});
      return {
        colorScheme: value.colorScheme === "dark" ? "dark" : "light",
        eink: value.eink === true,
      };
    } catch {
      return DEFAULT_APPEARANCE;
    }
  }

  /**
   * Starts the pdf.js core and hands the Frame one end of its channel.
   */
  function startPdfBridge(): { pdf: FramePdf; port: MessagePort } {
    core = startPdfCore();
    const channel = new MessageChannel();
    pdfPort = channel.port2;
    core.worker.postMessage({ kind: "maibuk:pdf-port", port: channel.port1 }, [channel.port1]);
    return {
      pdf: { displaySource: pdfDisplaySource(), css: pdfViewerCss() },
      port: channel.port2,
    };
  }

  /** Stops what the open Document holds, ready for another Document or the Shelf. */
  function releaseDocument(): void {
    openGeneration += 1;
    metaApplied = false;
    opened = false;
    documentArchive = { archive: null, opening: null };
    cancelCoverJob();
    if (core !== null) {
      core.dispose();
      core = null;
    }
    if (pdfPort !== null) {
      try {
        pdfPort.close();
      } catch {
        // Already closed.
      }
      pdfPort = null;
    }
  }

  /** The author's Collections, or none when they can't be read: the Shelf still draws. */
  async function collectionsOrNone(): Promise<Collection[]> {
    try {
      return await library.loadCollections();
    } catch {
      return [];
    }
  }

  /** The folder Collection option (#949), read once per session; on unless turned off. */
  let importCollect: boolean | null = null;
  async function loadImportCollect(): Promise<boolean> {
    if (importCollect !== null) return importCollect;
    try {
      importCollect = (await client.storage.get({ key: IMPORT_COLLECT_KEY })) !== false;
    } catch {
      importCollect = true;
    }
    return importCollect;
  }

  /** Applies the author's collision choices, or remembers the folder Collection option (#949). */
  async function handleShelfImport(message: FrameShelfImportMessage): Promise<void> {
    if (message.action === "collect") {
      importCollect = message.collect === true;
      try {
        await client.storage.set({ key: IMPORT_COLLECT_KEY, value: importCollect });
      } catch {
        // The option still holds for this session.
      }
      return;
    }
    if (importer === null) return;
    try {
      const applied = await importer.resolve(message.choices);
      if (!applied) {
        post({ kind: "shelf-result", message: translate(language, "shelf.import.applyFailed") });
        return;
      }
      await publishShelf(await library.loadShelf());
    } catch {
      post({ kind: "shelf-result", message: translate(language, "shelf.import.applyFailed") });
    }
  }

  /** Draws `shelf` in the Frame; the File Grant and Fingerprint stay here. */
  async function publishShelf(
    shelf: readonly ShelfEntry[],
    collections?: readonly Collection[]
  ): Promise<void> {
    const filed = collections ?? (await collectionsOrNone());
    const collect = await loadImportCollect();
    if (disposed) return;
    post({
      kind: "shelf",
      state: { ...frameShelfState(language, shelf, filed), importCollect: collect },
    });
    startCoverJob(shelf);
  }

  /**
   * Asks the Shelf Frame for the next imported Document's own cover (#948). The
   * Frame owns parsing, so it draws the cover with the engine it opens
   * Documents with; this end answers its reads from that Document's File Grant.
   */
  function startCoverJob(shelf: readonly ShelfEntry[]): void {
    if (disposed || !opened || view !== "shelf" || coverJob !== null) return;
    const next = shelf.find(
      (candidate) =>
        candidate.coverPending === true &&
        candidate.state === "ok" &&
        candidate.coverDataUrl === undefined &&
        !coverAsked.has(candidate.id)
    );
    if (next === undefined) return;
    coverAsked.add(next.id);
    const size = sizeFromFingerprint(next.fingerprint);
    const job: CoverJob = {
      documentId: next.id,
      grant: next.grant,
      size,
      archive: { archive: null, opening: null },
      core: null,
      port: null,
      timer: setTimeout(() => {
        // A Frame that never answers must not hold the queue: the row keeps
        // its generated cover, and opening the Document still finds the real one.
        if (coverJob === job) void finishCover(job.documentId, undefined);
      }, coverJobTimeoutMs),
    };
    coverJob = job;
    const message: FrameCoverJobMessage = {
      kind: "cover-job",
      documentId: next.id,
      format: next.format,
      size,
    };
    if (next.format === "pdf") {
      job.core = startPdfCore();
      const channel = new MessageChannel();
      job.port = channel.port2;
      job.core.worker.postMessage({ kind: "maibuk:pdf-port", port: channel.port1 }, [
        channel.port1,
      ]);
      message.pdf = { displaySource: pdfDisplaySource(), css: "" };
      message.pdfPort = channel.port2;
      post(message, [channel.port2]);
      return;
    }
    message.foliate = foliateSource();
    post(message);
  }

  /** Stops the cover job's pdf.js core and its deadline. */
  function endCoverJob(): CoverJob | null {
    const job = coverJob;
    if (job === null) return null;
    coverJob = null;
    clearTimeout(job.timer);
    job.core?.dispose();
    try {
      job.port?.close();
    } catch {
      // Already closed.
    }
    return job;
  }

  /** Drops the cover job unfinished, so the Shelf asks for it again next time it draws. */
  function cancelCoverJob(): void {
    const job = endCoverJob();
    if (job !== null) coverAsked.delete(job.documentId);
  }

  /**
   * Files the Frame's answer to a cover job: the cover when it found one, and
   * no longer pending either way, then redraws the Shelf, which asks for the next.
   */
  async function finishCover(documentId: string, coverDataUrl: unknown): Promise<void> {
    if (coverJob?.documentId !== documentId) return;
    endCoverJob();
    let shelf: readonly ShelfEntry[] | null = null;
    try {
      shelf = await library.updateShelf((current) => {
        let changed = false;
        const mapped = current.map((candidate) => {
          if (candidate.id !== documentId || candidate.coverPending !== true) return candidate;
          changed = true;
          const updated: ShelfEntry = { ...candidate };
          delete updated.coverPending;
          if (isCoverDataUrl(coverDataUrl) && updated.coverDataUrl === undefined) {
            updated.coverDataUrl = coverDataUrl;
          }
          return updated;
        });
        return changed ? mapped : null;
      });
    } catch {
      // The row keeps its generated cover; `coverAsked` stops a retry this session.
    }
    if (disposed || view !== "shelf") return;
    try {
      await publishShelf(shelf ?? (await library.loadShelf()));
    } catch {
      // The rows stay as drawn; the next redraw asks for the next cover.
    }
  }

  /**
   * Draws the Importer's state in the Frame: the Shelf's card and report. On
   * the Shelf it also redraws the rows, so imported Documents appear as they
   * are added rather than all at the end.
   */
  function drawImport(): void {
    if (importTimer !== null) {
      clearTimeout(importTimer);
      importTimer = null;
    }
    if (disposed || importer === null) return;
    const state = importer.state;
    drawnImportStatus = state?.status ?? null;
    post({ kind: "import", state: state === null ? null : frameImportState(language, state) });
    if (state !== null && view === "shelf") {
      void library
        .loadShelf()
        .then((shelf) => publishShelf(shelf))
        .catch(() => {
          // The rows stay as drawn; the next file or the finish redraws them.
        });
    }
  }

  /** The first file and every status change draw at once; files between them at most every throttle. */
  function onImportChange(state: ImportState | null): void {
    if (disposed || !opened) return;
    if (state?.status === "running" && drawnImportStatus === "running") {
      importTimer ??= setTimeout(drawImport, importThrottleMs);
      return;
    }
    drawImport();
  }

  /** Refreshes every File Grant and replaces the Shelf the Frame draws. */
  async function refreshShelf(): Promise<void> {
    try {
      const shelf = await library.refreshStates();
      if (disposed || view !== "shelf") return;
      await publishShelf(shelf);
    } catch {
      if (disposed || view !== "shelf") return;
      const state: FrameShelfState = { status: "error", entries: [] };
      post({ kind: "shelf", state });
    }
  }

  async function sendOpen(): Promise<void> {
    if (disposed || opened) return;
    opened = true;
    const generation = openGeneration;
    const settings = await loadSettings();
    if (disposed || generation !== openGeneration) return;
    const appearance = await currentAppearance();
    if (disposed || generation !== openGeneration) return;
    const position = await storedPosition(settings);
    if (disposed || generation !== openGeneration) return;
    const shelfView = view === "shelf";
    const currentEntry = shelfView ? null : entry;
    let shelf: FrameShelfState;
    let savedView: ShelfViewSettings | null = null;
    if (shelfView) {
      shelf = { status: "loading", entries: [] };
      savedView = await library.loadShelfView();
    } else {
      try {
        shelf = frameShelfState(language, await library.loadShelf());
      } catch {
        shelf = { status: "error", entries: [] };
      }
    }
    if (disposed || generation !== openGeneration) return;
    const message: FrameOpenMessage = {
      kind: "open",
      view: shelfView ? "shelf" : "document",
      entry: currentEntry === null ? null : frameEntry(currentEntry),
      position: currentEntry === null ? null : position,
      settings,
      size: currentEntry === null ? 0 : sizeFromFingerprint(currentEntry.fingerprint),
      labels: frameLabels(language, deps.returnLabel()),
      shelf,
      shelfLabels: frameShelfLabels(language),
      ...(savedView === null ? {} : { shelfView: savedView }),
      language,
      appearance,
    };
    if (shelfView) {
      post(message);
      if (importer?.state != null) drawImport();
      void refreshShelf();
      return;
    }
    if (currentEntry !== null && currentEntry.format === "pdf") {
      const bridge = startPdfBridge();
      message.pdf = bridge.pdf;
      message.pdfPort = bridge.port;
      post(message, [bridge.port]);
      return;
    }
    if (currentEntry !== null) {
      message.foliate = { source: foliateSource(), purify: purifySource() };
    }
    post(message);
    if (importer?.state != null) drawImport();
  }

  /**
   * What a Frame read or archive request reads: the cover job's Document when it
   * names one, else the open Document. A request for a Document no job holds
   * reads nothing.
   */
  function sourceFor(documentId: string | undefined): DocumentSource | null {
    if (typeof documentId === "string") {
      return coverJob?.documentId === documentId ? coverJob : null;
    }
    if (entry === null) return null;
    return {
      grant: entry.grant,
      size: sizeFromFingerprint(entry.fingerprint),
      archive: documentArchive,
    };
  }

  /** Reads `length` bytes at `offset`, in the chunks the File Grant API allows. */
  async function readRange(
    source: DocumentSource,
    offset: number,
    length: number
  ): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < length) {
      const take = Math.min(length - total, FILE_READ_MAX_BYTES);
      const buffer = await client.files.read({
        grant: source.grant,
        offset: offset + total,
        length: take,
      });
      const bytes = new Uint8Array(buffer);
      if (bytes.byteLength === 0) break;
      chunks.push(bytes);
      total += bytes.byteLength;
      if (bytes.byteLength < take) break;
    }
    return joinChunks(chunks, total);
  }

  /** Opens the source's archive once, reusing it for every later entry request. */
  function ensureArchive(source: DocumentSource | null): Promise<ZipArchive> {
    if (source === null) {
      return Promise.reject(new ZipError("corrupt", "No Document is open"));
    }
    const slot = source.archive;
    if (slot.archive !== null) return Promise.resolve(slot.archive);
    if (slot.opening !== null) return slot.opening;
    const opening = openZip((offset, length) => readRange(source, offset, length), source.size)
      .then((opened) => {
        slot.archive = opened;
        return opened;
      })
      .finally(() => {
        slot.opening = null;
      });
    slot.opening = opening;
    return opening;
  }

  function zipCode(error: unknown): "corrupt" | "drm" | "missing" {
    return error instanceof ZipError ? error.code : "corrupt";
  }

  async function answerZipList(message: FrameZipListRequest): Promise<void> {
    try {
      const opened = await ensureArchive(sourceFor(message.documentId));
      post({
        kind: "zip-list",
        id: message.id,
        entries: opened.entries.map(({ name, size }) => ({ name, size })),
      });
    } catch (error) {
      post({ kind: "zip-error", id: message.id, code: zipCode(error) });
    }
  }

  /**
   * Hands over one entry as the archive stores it. The Frame inflates and
   * decodes it natively, so a large image or a long chapter never holds this
   * Worker past the host's heartbeat.
   */
  async function answerZipEntry(message: FrameZipEntryRequest): Promise<void> {
    try {
      const opened = await ensureArchive(sourceFor(message.documentId));
      const { bytes, deflated } = await opened.stored(message.name);
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      post({ kind: "zip-data", id: message.id, buffer, deflated }, [buffer]);
    } catch (error) {
      post({ kind: "zip-error", id: message.id, code: zipCode(error) });
    }
  }

  async function applySettings(message: FrameSettingsMessage): Promise<void> {
    try {
      await library.saveSettings(clampSettings(message.settings));
    } catch {
      // A settings refusal must not stop the author reading.
    }
  }

  async function answerRead(message: FrameReadMessage): Promise<void> {
    const id = message.id;
    const offset = Math.max(0, Math.floor(message.offset));
    const length = Math.max(0, Math.floor(message.length));
    const source = sourceFor(message.documentId);
    if (source === null || length === 0) {
      const empty = new ArrayBuffer(0);
      post({ kind: "bytes", id, buffer: empty }, [empty]);
      return;
    }
    try {
      const joined = await readRange(source, offset, length);
      post({ kind: "bytes", id, buffer: joined.buffer }, [joined.buffer]);
    } catch (error) {
      post({ kind: "read-error", id, code: errorCode(error) });
    }
  }

  // `current` is the Document the Frame was reading when it sent the position,
  // captured as the message is queued: a switch while an earlier save is still
  // running must not file the position under the next Document.
  async function savePosition(
    message: FramePositionMessage,
    current: ShelfEntry | null
  ): Promise<void> {
    if (current === null) return;
    try {
      await client.storage.set({
        key: positionKey(current.id),
        value: message.position,
      });
    } catch {
      // A storage refusal must not stop the author reading.
    }
    const progress: ShelfProgress = message.progress;
    try {
      const next = await library.updateShelf((shelf) =>
        shelf.map((candidate) =>
          candidate.id === current.id ? withProgress(candidate, progress, Date.now()) : candidate
        )
      );
      const updated = next.find((candidate) => candidate.id === current.id);
      if (updated !== undefined && entry?.id === current.id) entry = updated;
    } catch {
      // The Shelf keeps its previous row; the Position is already stored.
    }
  }

  async function applyMeta(message: FrameMetaMessage): Promise<void> {
    if (entry === null || metaApplied) return;
    metaApplied = true;
    const current = entry;
    try {
      const next = await library.updateShelf((shelf) => {
        let changed = false;
        const mapped = shelf.map((candidate) => {
          if (candidate.id !== current.id) return candidate;
          const updated: ShelfEntry = { ...candidate };
          // The Frame looked for the file's own cover on open, found or not (#948).
          delete updated.coverPending;
          if (typeof message.title === "string" && message.title.trim() !== "") {
            updated.title = message.title.trim();
          }
          if (typeof message.author === "string" && message.author.trim() !== "") {
            updated.author = message.author.trim();
          }
          if (typeof message.coverDataUrl === "string" && updated.coverDataUrl === undefined) {
            updated.coverDataUrl = message.coverDataUrl;
          }
          if (typeof message.pageCount === "number" && updated.progress !== null) {
            updated.progress = { ...updated.progress, pageCount: message.pageCount };
          }
          if (JSON.stringify(updated) !== JSON.stringify(candidate)) changed = true;
          return updated;
        });
        return changed ? mapped : null;
      });
      entry = next.find((candidate) => candidate.id === current.id) ?? current;
    } catch {
      // The Document's own metadata is a nicety; the Shelf keeps its row.
    }
  }

  async function markUnreadable(message: FrameLoadErrorMessage): Promise<void> {
    // A timeout is transient (a provider that stopped answering), not a
    // damaged Document: the row stays openable so the author can try again.
    if (message.code === "timeout") return;
    if (entry === null) return;
    const current = entry;
    try {
      const next = await library.updateShelf((shelf) =>
        shelf.map((candidate) =>
          candidate.id === current.id
            ? { ...candidate, state: "unreadable" as const, reason: message.reason }
            : candidate
        )
      );
      const updated = next.find((candidate) => candidate.id === current.id);
      if (updated !== undefined && entry?.id === current.id) entry = updated;
    } catch {
      // The Shelf's state is advisory; the Frame already told the author.
    }
  }

  /** The localized notice a failed Locate leaves on the Shelf, or null when it should stay quiet. */
  function locateNotice(reason: "cancelled" | "not-found" | "fingerprint-mismatch"): string | null {
    switch (reason) {
      case "fingerprint-mismatch":
        return translate(language, "shelf.locate.mismatch");
      case "not-found":
        return translate(language, "shelf.locate.notFound");
      default:
        // A cancelled pick is not a failure the author needs told about.
        return null;
    }
  }

  async function handleShelfCommand(message: FrameShelfCommandMessage): Promise<void> {
    const documentId = message.documentId ?? selectedDocumentId;
    try {
      switch (message.id) {
        case "openDocument": {
          if (documentId === null) return;
          const shelf = await library.loadShelf();
          const target = shelf.find((candidate) => candidate.id === documentId);
          if (target === undefined || (target.state ?? "ok") !== "ok") return;
          await deps.openEntry?.(target);
          return;
        }
        case "removeFromShelf": {
          if (documentId === null) return;
          try {
            const shelf = await library.loadShelf();
            const target = shelf.find((candidate) => candidate.id === documentId);
            if (target === undefined) return;
            const counts = await library.removalCounts(documentId);
            const copy = shelfRemovalCopy(language, target.title, counts);
            post({
              kind: "remove-counts",
              documentId,
              title: copy.title,
              body: copy.body,
              stats: copy.stats,
            });
          } catch {
            post({ kind: "shelf-result", message: translate(language, "shelf.remove.failed") });
          }
          return;
        }
        case "locateDocument": {
          if (documentId === null) return;
          try {
            const result = await library.locateAgain(documentId);
            await publishShelf(await library.loadShelf());
            if (result.ok) return;
            const notice = locateNotice(result.reason);
            if (notice !== null) post({ kind: "shelf-result", message: notice });
          } catch {
            post({ kind: "shelf-result", message: translate(language, "shelf.locate.failed") });
          }
          return;
        }
        case "openFile": {
          const picked = await library.openFileFlow();
          if (picked !== null) await deps.openEntry?.(picked);
          return;
        }
        case "importFiles":
        case "importFolder": {
          if (importer === null) return;
          if (hasCollisions(importer.state)) {
            post({
              kind: "shelf-result",
              message: translate(language, "shelf.import.resolveFirst"),
            });
            return;
          }
          try {
            await pickAndImport(
              client,
              importer,
              message.id === "importFiles" ? "files" : "folder",
              SUPPORTED_EXTENSIONS,
              { collect: await loadImportCollect() }
            );
          } catch {
            post({ kind: "shelf-result", message: translate(language, "shelf.import.failed") });
          }
          return;
        }
        case "cancelImport":
          importer?.cancel();
          return;
        case "dismissImport":
          importer?.dismiss();
          return;
      }
    } catch {
      post({ kind: "shelf-result", message: translate(language, "shelf.openFailed") });
    }
  }

  async function handleShelfRemove(message: FrameShelfRemoveMessage): Promise<void> {
    try {
      const shelf = await library.removeFromShelf(message.documentId);
      if (selectedDocumentId === message.documentId) selectedDocumentId = null;
      await publishShelf(shelf);
    } catch {
      post({ kind: "shelf-result", message: translate(language, "shelf.remove.failed") });
    }
  }

  /** Applies one Collection change, then redraws the Shelf with the stored result. */
  async function handleShelfCollection(message: FrameShelfCollectionMessage): Promise<void> {
    try {
      let collections: Collection[];
      switch (message.action) {
        case "create":
          collections = await library.createCollection(message.name, message.documentId);
          break;
        case "rename":
          collections = await library.renameCollection(message.collectionId, message.name);
          break;
        case "delete":
          collections = await library.deleteCollection(message.collectionId);
          break;
        case "file":
          collections = await library.setInCollection(
            message.collectionId,
            message.documentId,
            message.member
          );
          break;
        default:
          return;
      }
      if (disposed || view !== "shelf") return;
      await publishShelf(await library.loadShelf(), collections);
    } catch {
      if (disposed) return;
      post({ kind: "shelf-result", message: translate(language, "shelf.collection.failed") });
    }
  }

  async function showShelf(): Promise<void> {
    await pendingPosition;
    if (disposed) return;
    view = "shelf";
    entry = null;
    releaseDocument();
    if (!disposed) await sendOpen();
    if (!disposed) deps.onViewChange?.("shelf");
  }

  async function handleBack(): Promise<void> {
    if (deps.shelfInFrame === true) {
      await showShelf();
      return;
    }
    try {
      await pendingPosition;
      await deps.navigateToShelf();
    } finally {
      dispose();
    }
  }

  function handleMessage(value: unknown): void {
    if (disposed) return;
    if (typeof value !== "object" || value === null) return;
    const message = value as FrameToWorkerMessage;
    switch (message.kind) {
      case "ready":
        if (!opened) void sendOpen();
        return;
      case "read":
        void answerRead(message);
        return;
      case "zip-list":
        void answerZipList(message);
        return;
      case "zip-entry":
        void answerZipEntry(message);
        return;
      case "settings":
        void applySettings(message);
        return;
      case "position": {
        const current = entry;
        pendingPosition = pendingPosition.then(() => savePosition(message, current));
        return;
      }
      case "meta":
        void applyMeta(message);
        return;
      case "cover":
        void finishCover(message.documentId, message.coverDataUrl);
        return;
      case "load-error":
        void markUnreadable(message);
        return;
      case "shelf-select":
        selectedDocumentId = message.documentId;
        return;
      case "shelf-view":
        writeShelfView(message.settings);
        return;
      case "shelf-command":
        void handleShelfCommand(message);
        return;
      case "shelf-remove":
        void handleShelfRemove(message);
        return;
      case "shelf-collection":
        void handleShelfCollection(message);
        return;
      case "shelf-import":
        void handleShelfImport(message);
        return;
      case "back":
        void handleBack();
        return;
      case "closed":
        dispose();
        return;
      default:
        return;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    deps.onDispose?.();
    unsubscribeImport?.();
    unsubscribeImport = null;
    if (importTimer !== null) {
      clearTimeout(importTimer);
      importTimer = null;
    }
    documentArchive = { archive: null, opening: null };
    endCoverJob();
    if (pdfPort !== null) {
      try {
        pdfPort.close();
      } catch {
        // The Frame may already have closed its end.
      }
      pdfPort = null;
    }
    if (core !== null) {
      core.dispose();
      core = null;
    }
    port.onmessage = null;
    try {
      port.close();
    } catch {
      // A port that never started has nothing to close.
    }
  }

  const session: ReaderSession = {
    port,
    get disposed() {
      return disposed;
    },
    get view() {
      return view;
    },
    start(): void {
      port.onmessage = (event: MessageEvent) => handleMessage(event.data);
      port.start();
      unsubscribeImport = importer?.subscribe(onImportChange) ?? null;
    },
    setEntry(next: ShelfEntry | null): void {
      entry = next;
      if (next !== null) {
        view = "document";
        deps.onViewChange?.("document");
      }
      releaseDocument();
      if (!disposed) void sendOpen();
    },
    showShelf,
    setLanguage(next: string): void {
      language = next;
      post({
        kind: "language",
        language: next,
        labels: frameLabels(next, deps.returnLabel()),
        shelfLabels: frameShelfLabels(next),
      });
      if (importer?.state != null) drawImport();
    },
    setAppearance(next: Appearance): void {
      post({ kind: "appearance", appearance: next });
    },
    command(id: FrameCommandId): void {
      post({ kind: "command", id });
    },
    dispose,
  };
  return session;
}
