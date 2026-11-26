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
  type FrameReadMessage,
  type FrameSettingsMessage,
  type FrameShelfCommandMessage,
  type FrameShelfRemoveMessage,
  type FrameShelfState,
  type FrameToWorkerMessage,
  type FrameZipEntryRequest,
  type FrameZipListRequest,
  type ReadingPosition,
} from "./frame-protocol";
import { frameShelfLabels, frameShelfState, shelfRemovalCopy } from "./frame-shelf";
import { ZipError, openZip, type ZipArchive } from "./zip";
import {
  DEFAULT_READER_SETTINGS,
  clampSettings,
  positionKey,
  sortShelf,
  type ReaderSettings,
  type ShelfEntry,
  type ShelfProgress,
} from "./shelf";
import { translate } from "./i18n";

/** The SDK surface a session needs: the File Grant, Plugin storage, and the host's appearance. */
export type SessionClient = Pick<PluginClient, "files" | "storage" | "appearance">;

/** The appearance the Frame draws with when the host serves none. */
const DEFAULT_APPEARANCE: Appearance = { colorScheme: "light", eink: false };

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
  let archive: ZipArchive | null = null;
  let openingArchive: Promise<ZipArchive> | null = null;
  /**
   * Reading Position saves run one after another, latest last, so two saves
   * never read and write the Shelf row at the same time and lose one update.
   * `back` awaits the tail so the Shelf draws the Position it just left.
   */
  let pendingPosition: Promise<void> = Promise.resolve();

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
    archive = null;
    openingArchive = null;
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

  /** Draws `shelf` in the Frame; the File Grant and Fingerprint stay here. */
  function publishShelf(shelf: readonly ShelfEntry[]): void {
    post({ kind: "shelf", state: frameShelfState(language, shelf) });
  }

  /** Refreshes every File Grant and replaces the Shelf the Frame draws. */
  async function refreshShelf(): Promise<void> {
    try {
      const shelf = await library.refreshStates();
      if (disposed || view !== "shelf") return;
      publishShelf(shelf);
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
    if (shelfView) {
      shelf = { status: "loading", entries: [] };
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
      language,
      appearance,
    };
    if (shelfView) {
      post(message);
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
  }

  /** Reads `length` bytes at `offset`, in the chunks the File Grant API allows. */
  async function readRange(offset: number, length: number): Promise<Uint8Array> {
    if (entry === null || length <= 0) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < length) {
      const take = Math.min(length - total, FILE_READ_MAX_BYTES);
      const buffer = await client.files.read({
        grant: entry.grant,
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

  /** Opens the archive once, reusing it for every later entry request. */
  function ensureArchive(): Promise<ZipArchive> {
    if (archive !== null) return Promise.resolve(archive);
    if (openingArchive !== null) return openingArchive;
    if (entry === null) {
      return Promise.reject(new ZipError("corrupt", "No Document is open"));
    }
    const size = sizeFromFingerprint(entry.fingerprint);
    const opening = openZip(readRange, size)
      .then((opened) => {
        archive = opened;
        return opened;
      })
      .finally(() => {
        openingArchive = null;
      });
    openingArchive = opening;
    return opening;
  }

  function zipCode(error: unknown): "corrupt" | "drm" | "missing" {
    return error instanceof ZipError ? error.code : "corrupt";
  }

  async function answerZipList(message: FrameZipListRequest): Promise<void> {
    try {
      const opened = await ensureArchive();
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
      const opened = await ensureArchive();
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
    if (entry === null || length === 0) {
      const empty = new ArrayBuffer(0);
      post({ kind: "bytes", id, buffer: empty }, [empty]);
      return;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < length) {
        const take = Math.min(length - total, FILE_READ_MAX_BYTES);
        const buffer = await client.files.read({
          grant: entry.grant,
          offset: offset + total,
          length: take,
        });
        const bytes = new Uint8Array(buffer);
        if (bytes.byteLength === 0) break;
        chunks.push(bytes);
        total += bytes.byteLength;
        if (bytes.byteLength < take) break;
      }
      const joined = joinChunks(chunks, total);
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
      const shelf = await library.loadShelf();
      const next = sortShelf(
        shelf.map((candidate) =>
          candidate.id === current.id
            ? { ...candidate, progress, lastReadAt: Date.now() }
            : candidate
        )
      );
      await library.saveShelf(next);
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
      const shelf = await library.loadShelf();
      let changed = false;
      const next = shelf.map((candidate) => {
        if (candidate.id !== current.id) return candidate;
        const updated: ShelfEntry = { ...candidate };
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
      if (changed) {
        await library.saveShelf(sortShelf(next));
        entry = next.find((candidate) => candidate.id === current.id) ?? current;
      }
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
      const shelf = await library.loadShelf();
      const next = shelf.map((candidate) =>
        candidate.id === current.id
          ? { ...candidate, state: "unreadable" as const, reason: message.reason }
          : candidate
      );
      await library.saveShelf(next);
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
            publishShelf(await library.loadShelf());
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
      }
    } catch {
      post({ kind: "shelf-result", message: translate(language, "shelf.openFailed") });
    }
  }

  async function handleShelfRemove(message: FrameShelfRemoveMessage): Promise<void> {
    try {
      const shelf = await library.removeFromShelf(message.documentId);
      if (selectedDocumentId === message.documentId) selectedDocumentId = null;
      publishShelf(shelf);
    } catch {
      post({ kind: "shelf-result", message: translate(language, "shelf.remove.failed") });
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
      case "load-error":
        void markUnreadable(message);
        return;
      case "shelf-select":
        selectedDocumentId = message.documentId;
        return;
      case "shelf-command":
        void handleShelfCommand(message);
        return;
      case "shelf-remove":
        void handleShelfRemove(message);
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
    archive = null;
    openingArchive = null;
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
    start(): void {
      port.onmessage = (event: MessageEvent) => handleMessage(event.data);
      port.start();
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
