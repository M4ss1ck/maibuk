/**
 * The Reader Frame's PDF engine (#941): the pdf.js display module and its
 * nested core Worker, the range transport that reads the file through the
 * Worker, page slots and Continuous scroll, the zoom and fit math, and the
 * render cache that keeps a handful of drawn pages alive. `entry.ts` supplies
 * the containers, the protocol reads, the live settings and view state, the
 * password form, and the callbacks each draw ends with, so the engine knows
 * nothing about the toolbar or the other views.
 *
 * A password is asked for through `requestPassword`: `entry.ts` owns the form
 * and hands back what the author typed, and this engine resumes pdf.js's own
 * `onPassword` update or starts a fresh load exactly as the Frame always did.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules.
 */

import type { OutlineItem } from "./contents";
import { hooks } from "./hooks";
import type { FramePdf, FrameZoom, ReaderSettings, ReadingPosition } from "./types";

const INITIAL_CHUNK_BYTES = 1 << 20;
/** The most one pdf.js range read asks the Worker for. */
export const RANGE_CHUNK_BYTES = 1 << 20;
/** How many drawn pages the cache keeps before trimming. */
export const MAX_CACHED_PAGES = 5;
/**
 * How long a PDF may take to answer before the Frame reports a load failure.
 * pdf.js's core answers through a `MessageHandler` that calls `Promise.try`
 * inside a deferred `LoopbackPort` callback. An engine below pdf.js's floor
 * (the polyfills cover only Chrome 138) has no `Promise.try`, so that call
 * throws after `getDocument` was called; the throw becomes an unhandled
 * rejection and no `GetDoc` or `DocException` ever arrives, so the loading
 * task's promise never settles and `handleLoadError` never runs. 30s leaves a
 * slow, large Document on a low-end device ample room while turning a
 * permanent hang into the visible error the author can act on.
 */
const PDF_LOAD_TIMEOUT_MS = 30000;

/** One page size at a scale, as pdf.js reports it. */
export interface PdfViewport {
  width: number;
  height: number;
}

/** One text item on a page, as far as the text layer reads it. */
export interface PdfTextItem {
  str?: string;
}

/** A page's text content, as far as the text layer reads it. */
export interface PdfTextContent {
  items: PdfTextItem[];
}

/** One pdf.js render task. */
export interface PdfRenderTask {
  promise?: Promise<unknown>;
}

/** One pdf.js page, as far as the Frame draws and reads it. */
export interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): PdfRenderTask | null | undefined;
  getTextContent(): Promise<PdfTextContent>;
}

/** The pdf.js Document, as far as the Frame draws, searches, and outlines it. */
export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  getPageLabels(): Promise<string[] | null>;
  getOutline(): Promise<OutlineItem[] | null>;
  getMetadata(): Promise<unknown>;
  getDestination(name: string): Promise<unknown>;
  getPageIndex?(ref: unknown): Promise<number>;
  destroy?(): Promise<void> | void;
}

/** pdf.js's range transport, which reads the file in chunks through the Worker. */
export interface PdfRangeTransport {
  onDataRange(begin: number, bytes: Uint8Array): void;
  requestDataRange?: (begin: number, end: number) => void;
  abort?: () => void;
}

/** One pdf.js loading task: its promise and the callbacks it reports through. */
export interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  onProgress?: (progress: { loaded: number; total: number }) => void;
  onPassword?: (updatePassword: (password: string) => void, reason: number) => void;
  destroy?(): Promise<void> | void;
}

/** The pdf.js core Worker the Frame drives over the transferred port. */
export interface PdfWorker {
  destroy?(): void;
}

/** pdf.js's text layer renderer. */
export interface PdfTextLayer {
  render(): Promise<void>;
}

/** The pdf.js display module the Worker hands the Frame as source. */
export interface PdfJsModule {
  PDFWorker: new (options: { port: MessagePort }) => PdfWorker;
  PDFDataRangeTransport: new (length: number, initial: Uint8Array) => PdfRangeTransport;
  TextLayer?: new (options: {
    textContentSource: PdfTextContent;
    container: HTMLElement;
    viewport: PdfViewport;
  }) => PdfTextLayer;
  PasswordException?: new (...args: never[]) => Error;
  getDocument(params: Record<string, unknown>): PdfLoadingTask;
}

/** One drawn PDF page, kept in a slot until the cache drops it. */
export interface RenderedPage {
  index: number;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  page: PdfPage;
  scale: number;
  bitmap: ImageBitmap | null;
}

/** The containers, live state, and callbacks `entry.ts` gives the engine. */
export interface FramePdfDeps {
  /** The container the page slots are drawn into. */
  stage(): HTMLElement;
  /** The scroll container the pages are sized and scrolled against. */
  viewer(): HTMLElement;
  /** The live Reader settings. */
  settings(): ReaderSettings;
  /** Persists and posts the settings a layout switch produced. */
  saveSettings(settings: ReaderSettings): void;
  /** Reads `length` bytes at `offset` through the Worker. */
  requestBytes(offset: number, length: number): Promise<Uint8Array>;
  /** Rejects every byte read still in flight, as pdf.js aborting its transport does. */
  abortReads(reason: string): void;
  /** The Document's size in bytes, as the Worker sent it. */
  fileSize(): number;
  /** Whether the Frame is being torn down. */
  destroyed(): boolean;
  /** The view generation, read to see whether a newer draw has started. */
  generation(): number;
  /** Starts a new view generation, invalidating draws already in flight. */
  beginGeneration(): number;
  /** The page on screen, zero-based. */
  pageIndex(): number;
  /** Records the page on screen after a turn or a scroll. */
  setPage(index: number): void;
  /** The current zoom setting. */
  zoom(): FrameZoom;
  /** Records the zoom setting a saved position or a fit produces. */
  setZoomSetting(zoom: FrameZoom): void;
  /** Records the scale the current page was drawn at. */
  setScale(scale: number): void;
  /** Brings the toolbar's page indicator up to date. */
  updateIndicator(): void;
  /** Brings the whole toolbar in line with the open Document. */
  updateControls(): void;
  /** Refreshes Find's status line after a page turn. */
  updateFindStatus(): void;
  /** Scrolls the shown page's current search mark into view. */
  revealPdfMatch(): void;
  /** Paints one drawn page's search marks. */
  paintPdfMatches(container: HTMLElement, index: number): void;
  /** Schedules a debounced Reading Position report. */
  schedulePosition(): void;
  /** Shows a zoom percentage in the toolbar. */
  showZoom(percent: number): void;
  /** Shows a PDF's outline in the Contents panel. */
  showOutline(outline: OutlineItem[] | null): void;
  /** Records the Document's page labels for the indicator. */
  setPageLabels(labels: string[] | null): void;
  /** Shows the stage and hides the message and password form once a PDF opens. */
  showStage(): void;
  /** Posts the PDF's metadata and cover once it has opened. */
  sendMeta(): void;
  /** Whether the password form is on screen, which pauses the load deadline. */
  passwordOpen(): boolean;
  /** Asks the author for the password, resolving with what they submitted. */
  requestPassword(wrong: boolean): Promise<string | undefined>;
  /** Maps a load failure to the message the author sees. */
  handleLoadError(error: unknown): void;
}

/** The engine: opening, drawing, scrolling, zooming, and closing a PDF. */
export interface FramePdfEngine {
  /** Opens a PDF from its resources, the core port, and the saved position. */
  open(pdf: FramePdf, pdfPort: MessagePort, saved: ReadingPosition | null): Promise<void>;
  /** Whether a pdf.js Document is open. */
  isOpen(): boolean;
  /** The open pdf.js Document, or null. */
  document(): PdfDocument | null;
  /** The open Document's page count, or 0. */
  pageCount(): number;
  /** Whether the PDF is laid out in Continuous scroll. */
  isContinuous(): boolean;
  /** Every drawn page, for Find's marks. */
  pages(): Iterable<[number, RenderedPage]>;
  /** Draws the PDF in the current layout and zoom. */
  rebuild(): Promise<void>;
  /** Turns to a page, in the layout on screen. */
  goToPage(index: number, options?: { atEnd?: boolean }): void;
  /** Flips the layout between single page and Continuous scroll. */
  toggleContinuous(): void;
  /** In Continuous scroll, syncs the current page to the scroll position. */
  handleScroll(): void;
  /** Retries a load with a password the form submitted outside a request. */
  retry(password: string): void;
  /** Revokes every drawn page and empties the render cache. */
  clearCache(): void;
  /** Destroys the loading task, Document, worker, transport, and port, in order. */
  destroy(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isErrorLike(value: unknown): value is { name?: unknown; message?: unknown } {
  return typeof value === "object" && value !== null;
}

/** The zoom a saved position resumes at, or the settings' fit when it names none. */
function savedZoom(saved: ReadingPosition | null, fallback: FrameZoom): FrameZoom {
  if (!saved || saved.kind !== "page") return fallback;
  const zoom = saved.zoom;
  if (typeof zoom === "number" || zoom === "width" || zoom === "page") return zoom;
  return fallback;
}

/** Imports pdf.js's display module from the source the Worker sent, or the test stub. */
export async function importPdfjs(displaySource: string): Promise<PdfJsModule> {
  if (hooks && typeof hooks.importPdfjs === "function") {
    return (await hooks.importPdfjs(displaySource)) as PdfJsModule;
  }
  const url = URL.createObjectURL(new Blob([displaySource], { type: "text/javascript" }));
  try {
    const module: unknown = await import(/* @vite-ignore */ url);
    return module as PdfJsModule;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The PDF engine over the containers and live state `deps` supplies: the
 * loading task, the slots, the Continuous scroll observer, and the cache.
 */
export function createPdf(deps: FramePdfDeps): FramePdfEngine {
  let pdfjs: PdfJsModule | null = null;
  let pdfDoc: PdfDocument | null = null;
  let loadingTask: PdfLoadingTask | null = null;
  let pdfWorker: PdfWorker | null = null;
  let transport: PdfRangeTransport | null = null;
  let activePdfPort: MessagePort | null = null;
  let savedPosition: ReadingPosition | null = null;

  const pageCache: Map<number, RenderedPage> = new Map();
  /** The renders in flight, so a page never draws twice at once. */
  const renderingPages: Map<number, Promise<RenderedPage>> = new Map();
  /** One slot per PDF page; a drawn page lives in its slot until the cache drops it. */
  let slots: HTMLElement[] = [];
  /** The first page's unscaled size, which every slot takes until its page renders. */
  let pdfBase: { width: number; height: number } | null = null;
  let slotObserver: IntersectionObserver | null = null;
  const visiblePages = new Set<number>();
  /** The scrollTop a programmatic scroll left, so the scroll sync ignores it. */
  let scrollTarget: number | null = null;

  /** The open timeout, which the test harness may shorten through `hooks`. */
  function pdfLoadTimeoutMs(): number {
    return hooks && typeof hooks.loadTimeoutMs === "number"
      ? hooks.loadTimeoutMs
      : PDF_LOAD_TIMEOUT_MS;
  }

  /**
   * Rejects when `promise` neither resolves nor rejects within the open
   * timeout, so a wedged pdf.js still reaches `handleLoadError`. The
   * underlying work is left to pdf.js and to `destroy`, which the failure path
   * calls.
   */
  function withPdfLoadTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("pdf.js did not answer in time");
        (error as { name?: string }).name = "LoadTimeoutError";
        reject(error);
      }, pdfLoadTimeoutMs());
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  function isPasswordError(error: unknown): boolean {
    if (!isErrorLike(error)) return false;
    if (error.name === "PasswordException") return true;
    return Boolean(pdfjs && pdfjs.PasswordException && error instanceof pdfjs.PasswordException);
  }

  function injectCss(css: string) {
    const previous = document.getElementById("reader-pdf-css");
    if (previous) previous.remove();
    const style = document.createElement("style");
    style.id = "reader-pdf-css";
    style.textContent = css;
    document.head.append(style);
  }

  /**
   * Opens a PDF. pdf.js's core answers from the Plugin Worker's nested Worker
   * through `pdfPort`.
   */
  async function open(
    pdf: FramePdf,
    pdfPort: MessagePort,
    saved: ReadingPosition | null
  ): Promise<void> {
    savedPosition = saved;
    try {
      pdfjs = await withPdfLoadTimeout(importPdfjs(pdf.displaySource));
      injectCss(pdf.css);
      activePdfPort = pdfPort;
      pdfPort.start();
      pdfWorker = new pdfjs.PDFWorker({ port: pdfPort });
      deps.setZoomSetting(savedZoom(saved, deps.settings().pdfFit));
      const size = deps.fileSize();
      const initialLength = Math.min(size > 0 ? size : 0, INITIAL_CHUNK_BYTES);
      // The first read is as likely to stall as any later one, so it runs under
      // the same deadline; a provider that never answers must not leave the
      // spinner up with no way out.
      const initial = await withPdfLoadTimeout(deps.requestBytes(0, initialLength));
      const rangeTransport = new pdfjs.PDFDataRangeTransport(size, initial);
      transport = rangeTransport;
      rangeTransport.requestDataRange = (begin: number, end: number) => {
        void deps
          .requestBytes(begin, Math.min(end - begin, RANGE_CHUNK_BYTES))
          .then((bytes) => rangeTransport.onDataRange(begin, bytes))
          .catch(() => {
            /* A refused range fails the page render; the Frame reports it once. */
          });
      };
      rangeTransport.abort = () => {
        deps.abortReads("Reader stopped reading");
      };
      await loadDocument(undefined);
    } catch (error) {
      if (!deps.destroyed()) deps.handleLoadError(error);
    }
  }

  async function loadDocument(password: string | undefined): Promise<void> {
    if (!pdfjs || !transport) return;
    const range = transport;
    const params: Record<string, unknown> = {
      range,
      worker: pdfWorker,
      isEvalSupported: false,
      disableAutoFetch: true,
      disableStream: true,
      rangeChunkSize: RANGE_CHUNK_BYTES,
    };
    if (typeof password === "string") params.password = password;
    const task = pdfjs.getDocument(params);
    loadingTask = task;
    // A password request keeps `task.promise` pending while the author types,
    // so that wait is exempt from the load deadline: the clock stops when the
    // form shows and starts again only when the author submits. Every progress
    // report restarts the clock, so a slow but moving load is left alone and
    // only an inactive one fails.
    let timer = 0;
    let done = false;
    let rejectTimeout = () => {};
    const timeout = new Promise<PdfDocument>((_resolve, reject) => {
      rejectTimeout = () => {
        const error = new Error("pdf.js did not answer in time");
        (error as { name?: string }).name = "LoadTimeoutError";
        reject(error);
      };
    });
    const armTimeout = () => {
      if (done) return;
      clearTimeout(timer);
      timer = window.setTimeout(rejectTimeout, pdfLoadTimeoutMs());
    };
    armTimeout();
    task.onProgress = () => {
      // While the password form is open the deadline stays paused, even if a
      // stray progress frame arrives.
      if (deps.passwordOpen()) return;
      armTimeout();
    };
    task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      clearTimeout(timer);
      void deps.requestPassword(reason === 2).then((value) => {
        if (value === undefined) return;
        armTimeout();
        updatePassword(value);
      });
    };
    let passwordError: unknown = null;
    try {
      pdfDoc = await Promise.race([task.promise, timeout]);
    } catch (error) {
      if (isPasswordError(error)) passwordError = error;
      else throw error;
    } finally {
      done = true;
      clearTimeout(timer);
    }
    if (passwordError) {
      const value = await deps.requestPassword(typeof password === "string");
      if (value !== undefined) await loadDocument(value);
      return;
    }
    await onOpened();
  }

  async function onOpened(): Promise<void> {
    const doc = pdfDoc;
    if (!doc) return;
    let labels: string[] | null = null;
    try {
      labels = await doc.getPageLabels();
    } catch {
      labels = null;
    }
    deps.setPageLabels(labels);
    let outline: OutlineItem[] | null = null;
    try {
      outline = await doc.getOutline();
    } catch {
      outline = null;
    }
    deps.showOutline(outline);
    const savedIndex = savedPosition && savedPosition.kind === "page" ? savedPosition.page : 0;
    deps.setPage(clamp(Math.floor(savedIndex), 0, Math.max(0, doc.numPages - 1)));
    deps.showStage();
    try {
      const first = await doc.getPage(1);
      pdfBase = first.getViewport({ scale: 1 });
    } catch {
      pdfBase = null;
    }
    if (deps.destroyed() || !pdfDoc) return;
    deps.updateIndicator();
    await rebuild();
    deps.sendMeta();
  }

  function scaleFor(base: { width: number; height: number }): number {
    const viewer = deps.viewer();
    const zoomSetting = deps.zoom();
    if (typeof zoomSetting === "number") return clamp(zoomSetting, 0.5, 4);
    const width = viewer.clientWidth > 0 ? viewer.clientWidth - 32 : base.width;
    const height = viewer.clientHeight > 0 ? viewer.clientHeight - 32 : base.height;
    const byWidth = width / Math.max(1, base.width);
    if (zoomSetting === "page") return Math.min(byWidth, height / Math.max(1, base.height));
    return byWidth;
  }

  function isContinuous(): boolean {
    return pdfDoc !== null && deps.settings().pdfLayout === "continuous";
  }

  /**
   * Lays out one slot per page, each sized from the first page until its own
   * page renders. A drawn canvas stays in its slot until the cache drops it:
   * the Frame never detaches a canvas and shows it again, which WebKit can hand
   * back blank.
   */
  function buildSlots() {
    if (!pdfDoc) return;
    deps.beginGeneration();
    stopObserving();
    clearCache();
    const stage = deps.stage();
    const base = pdfBase || { width: 612, height: 792 };
    const scale = scaleFor(base);
    const continuous = isContinuous();
    stage.textContent = "";
    stage.className = "pdf-pages";
    stage.style.width = "";
    stage.style.height = "";
    slots = [];
    for (let index = 0; index < pdfDoc.numPages; index += 1) {
      const slot = document.createElement("div");
      slot.className = "pdf-page";
      slot.dataset.page = String(index);
      slot.style.width = `${Math.round(base.width * scale)}px`;
      slot.style.height = `${Math.round(base.height * scale)}px`;
      slot.hidden = !continuous && index !== deps.pageIndex();
      slots.push(slot);
    }
    stage.append(...slots);
    stage.hidden = false;
    deps.setScale(scale);
    deps.showZoom(Math.round(scale * 100));
  }

  /**
   * Draws the PDF in the current layout and zoom: the shown page and its
   * neighbors, or, in Continuous scroll, the pages near the viewport.
   */
  function rebuild(): Promise<void> {
    if (!pdfDoc) return Promise.resolve();
    buildSlots();
    deps.updateControls();
    const index = deps.pageIndex();
    if (isContinuous()) {
      observeSlots();
      scrollToSlot(index);
      return renderPage(index)
        .then(() => deps.revealPdfMatch())
        .catch((error) => {
          if (!deps.destroyed()) deps.handleLoadError(error);
        });
    }
    deps.viewer().scrollTop = 0;
    const shown = renderCurrent();
    renderNeighbors();
    return shown;
  }

  /** Shows only the current page's slot. */
  function showSlot(index: number) {
    for (const slot of slots) {
      const shown = Number(slot.dataset.page) === index;
      if (slot.hidden === shown) slot.hidden = !shown;
    }
  }

  async function renderCurrent() {
    if (!pdfDoc) return;
    if (slots.length !== pdfDoc.numPages) buildSlots();
    const generation = deps.generation();
    const index = deps.pageIndex();
    if (!isContinuous()) showSlot(index);
    try {
      const rendered = await renderPage(index);
      if (deps.destroyed() || generation !== deps.generation() || index !== deps.pageIndex())
        return;
      showRendered(rendered);
    } catch (error) {
      if (!deps.destroyed() && generation === deps.generation()) deps.handleLoadError(error);
    }
  }

  /**
   * The page drawn into its slot: from the cache, from the render already in
   * flight, or freshly drawn.
   */
  function renderPage(index: number): Promise<RenderedPage> {
    const cached = pageCache.get(index);
    if (cached) {
      pageCache.delete(index);
      pageCache.set(index, cached);
      return Promise.resolve(cached);
    }
    const pending = renderingPages.get(index);
    if (pending) return pending;
    const promise = drawPage(index, deps.generation()).finally(() => {
      if (renderingPages.get(index) === promise) renderingPages.delete(index);
    });
    renderingPages.set(index, promise);
    return promise;
  }

  async function drawPage(index: number, generation: number): Promise<RenderedPage> {
    const doc = pdfDoc;
    if (!doc) throw new Error("No Document open");
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = scaleFor(base);
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * ratio });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${base.width * scale}px`;
    canvas.style.height = `${base.height * scale}px`;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This device cannot draw the page");
    const task = page.render({ canvasContext: context, viewport });
    if (task && task.promise) await task.promise;
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    textLayer.style.width = `${base.width * scale}px`;
    textLayer.style.height = `${base.height * scale}px`;
    try {
      const textContent = await page.getTextContent();
      if (pdfjs && pdfjs.TextLayer) {
        const layer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport: page.getViewport({ scale }),
        });
        await layer.render();
      }
    } catch {
      /* A page without a text layer is still readable. */
    }
    // WebKit drops a canvas's pixels once it has been shown and then hidden,
    // so a page keeps a bitmap copy to paint back when it shows again.
    let bitmap: ImageBitmap | null = null;
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(canvas);
      } catch {
        bitmap = null;
      }
    }
    const rendered: RenderedPage = { index, canvas, textLayer, page, scale, bitmap };
    // A zoom, a resize, or a layout switch rebuilt the slots meanwhile: this
    // drawing belongs to a view that is gone.
    if (deps.destroyed() || generation !== deps.generation()) return rendered;
    deps.paintPdfMatches(textLayer, index);
    placeRendered(rendered);
    pageCache.set(index, rendered);
    trimCache();
    return rendered;
  }

  /** Puts a drawn page in its slot, keeping the reading spot when a slot above it grows. */
  function placeRendered(rendered: RenderedPage) {
    const slot = slots[rendered.index];
    if (!slot) return;
    const viewer = deps.viewer();
    const before = slot.offsetHeight;
    const above = isContinuous() && deps.stage().offsetTop + slot.offsetTop < viewer.scrollTop;
    slot.textContent = "";
    slot.style.width = rendered.canvas.style.width;
    slot.style.height = rendered.canvas.style.height;
    slot.append(rendered.canvas, rendered.textLayer);
    const delta = slot.offsetHeight - before;
    if (above && delta !== 0) {
      viewer.scrollTop += delta;
      scrollTarget = viewer.scrollTop;
    }
  }

  /** Paints a page's saved bitmap back onto its canvas, for a page shown again. */
  function repaint(rendered: RenderedPage) {
    if (!rendered.bitmap) return;
    const context = rendered.canvas.getContext("2d");
    if (!context || typeof context.drawImage !== "function") return;
    context.clearRect(0, 0, rendered.canvas.width, rendered.canvas.height);
    context.drawImage(rendered.bitmap, 0, 0);
  }

  function showRendered(rendered: RenderedPage) {
    repaint(rendered);
    deps.setScale(rendered.scale);
    deps.showZoom(Math.round(rendered.scale * 100));
    deps.updateIndicator();
    deps.revealPdfMatch();
  }

  function renderNeighbors() {
    if (!pdfDoc) return;
    const count = pdfDoc.numPages;
    const pageIndex = deps.pageIndex();
    for (const offset of [1, -1]) {
      const index = pageIndex + offset;
      if (index < 0 || index >= count) continue;
      if (pageCache.has(index) || renderingPages.has(index)) continue;
      void renderPage(index).catch(() => {
        /* Prefetching is best effort; the current page already renders. */
      });
    }
  }

  /** Takes a drawn page out of its slot and frees its pixels. */
  function evict(rendered: RenderedPage) {
    if (rendered.bitmap && typeof rendered.bitmap.close === "function") rendered.bitmap.close();
    rendered.bitmap = null;
    rendered.canvas.remove();
    rendered.textLayer.remove();
    rendered.canvas.width = 0;
    rendered.canvas.height = 0;
  }

  function trimCache() {
    const pageIndex = deps.pageIndex();
    for (const [index, rendered] of pageCache) {
      if (pageCache.size <= MAX_CACHED_PAGES) break;
      if (index === pageIndex || visiblePages.has(index)) continue;
      pageCache.delete(index);
      evict(rendered);
    }
  }

  function clearCache() {
    for (const rendered of pageCache.values()) evict(rendered);
    pageCache.clear();
    renderingPages.clear();
  }

  /** Draws the pages that come near the viewport as the author scrolls. */
  function observeSlots() {
    stopObserving();
    if (typeof IntersectionObserver !== "function") {
      renderNeighbors();
      return;
    }
    slotObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) visiblePages.add(index);
          else visiblePages.delete(index);
        }
        for (const index of visiblePages) {
          void renderPage(index).catch(() => {
            /* A page that fails to draw stays a blank slot; the rest still read. */
          });
        }
      },
      { root: deps.viewer(), rootMargin: "50% 0px" }
    );
    for (const slot of slots) slotObserver.observe(slot);
  }

  function stopObserving() {
    if (slotObserver) slotObserver.disconnect();
    slotObserver = null;
    visiblePages.clear();
  }

  /** Scrolls a page's top into view, and marks the scroll as the Frame's own. */
  function scrollToSlot(index: number) {
    const slot = slots[index];
    if (!slot) return;
    const viewer = deps.viewer();
    viewer.scrollTop = Math.max(0, deps.stage().offsetTop + slot.offsetTop - 16);
    scrollTarget = viewer.scrollTop;
  }

  /** The page under the upper third of the viewport. */
  function pageAtScroll() {
    const viewer = deps.viewer();
    const line = viewer.scrollTop + viewer.clientHeight / 3 - deps.stage().offsetTop;
    let low = 0;
    let high = slots.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (slots[middle].offsetTop <= line) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  /** In Continuous scroll, the page the author scrolls to becomes the current page. */
  function handleScroll() {
    if (!isContinuous() || slots.length === 0) return;
    const viewer = deps.viewer();
    if (scrollTarget !== null) {
      if (Math.abs(viewer.scrollTop - scrollTarget) < 2) return;
      scrollTarget = null;
    }
    const next = pageAtScroll();
    if (next === deps.pageIndex()) return;
    deps.setPage(next);
    deps.updateIndicator();
    deps.schedulePosition();
    deps.updateFindStatus();
  }

  function setPdfLayout(layout: "single" | "continuous") {
    if (!pdfDoc || deps.settings().pdfLayout === layout) return;
    deps.saveSettings({ ...deps.settings(), pdfLayout: layout });
    void rebuild();
  }

  function toggleContinuous() {
    setPdfLayout(isContinuous() ? "single" : "continuous");
  }

  /**
   * `atEnd` opens a tall page at its bottom, the way paging back by wheel expects.
   */
  function goToPage(index: number, options: { atEnd?: boolean } = {}) {
    if (!pdfDoc) return;
    const next = clamp(Math.floor(index), 0, Math.max(0, pdfDoc.numPages - 1));
    if (isContinuous()) {
      deps.setPage(next);
      deps.updateIndicator();
      deps.schedulePosition();
      scrollToSlot(next);
      void renderPage(next)
        .then(() => {
          if (next === deps.pageIndex()) deps.revealPdfMatch();
        })
        .catch(() => {
          /* The slot stays blank; scrolling on draws the rest. */
        });
      deps.updateFindStatus();
      return;
    }
    if (next === deps.pageIndex()) return;
    deps.setPage(next);
    deps.updateIndicator();
    deps.schedulePosition();
    showSlot(next);
    const viewer = deps.viewer();
    viewer.scrollTop = options.atEnd ? viewer.scrollHeight : 0;
    void renderCurrent();
    renderNeighbors();
    deps.updateFindStatus();
  }

  function retry(password: string): void {
    void loadDocument(password).catch((error) => {
      if (!deps.destroyed()) deps.handleLoadError(error);
    });
  }

  function destroy() {
    if (loadingTask && typeof loadingTask.destroy === "function") {
      try {
        void loadingTask.destroy();
      } catch {
        /* Already gone. */
      }
    }
    loadingTask = null;
    if (pdfDoc && typeof pdfDoc.destroy === "function") {
      try {
        void pdfDoc.destroy();
      } catch {
        /* Already gone. */
      }
    }
    pdfDoc = null;
    if (pdfWorker && typeof pdfWorker.destroy === "function") {
      try {
        pdfWorker.destroy();
      } catch {
        /* Already gone. */
      }
    }
    pdfWorker = null;
    if (transport && typeof transport.abort === "function") {
      try {
        transport.abort();
      } catch {
        /* Already gone. */
      }
    }
    transport = null;
    if (activePdfPort) {
      try {
        activePdfPort.close();
      } catch {
        /* The Worker may have closed its end first. */
      }
      activePdfPort = null;
    }
    deps.setScale(1);
    stopObserving();
    slots = [];
    pdfBase = null;
  }

  return {
    open,
    isOpen: () => pdfDoc !== null,
    document: () => pdfDoc,
    pageCount: () => (pdfDoc ? pdfDoc.numPages : 0),
    isContinuous,
    pages: () => pageCache,
    rebuild,
    goToPage,
    toggleContinuous,
    handleScroll,
    retry,
    clearCache,
    destroy,
  };
}
