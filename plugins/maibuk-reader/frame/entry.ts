/* The Reader Frame's entry (#653, #941): the UI wiring that composes the
 `frame/` modules and draws the reading surface. The Frame's only host channel
 is `window.maibuk.port`: the Worker sends `open` with the Document, its
 Reading Position, the Reader settings, the file's size, and localized labels.
 For a PDF it also transfers the pdf.js display source, the viewer CSS, and one
 end of a MessageChannel wired to the pdf.js core Worker. For every other
 format it carries foliate's parsers and DOMPurify as source the Frame imports
 from `blob:` URLs.

 The Frame then draws one of three views: pdf.js pages, a Flowing view for a
 reflowable EPUB, MOBI, AZW3, or FB2 (one sanitized section at a time, paged
 with CSS multi-columns), or a Page view for a CBZ or a fixed-layout EPUB
 (one image or pre-paginated section at a time). It answers nothing itself; the
 protocol client in `protocol.ts` asks the Worker for byte ranges with `read`,
 and for archive entries with `zip-list` / `zip-entry`.

 The `frame/` folder is bundled into one classic script, not a module: a
 relative `import` cannot resolve in the Frame's opaque origin, so
 `scripts/build-plugin.ts` inlines the folder into `assets/ui/reader.js`.
 Nothing under `frame/` may import a Worker-side file such as
 `../frame-protocol.ts` or `../shelf.ts`: those run in the Plugin Worker, so
 the Frame declares the shapes it needs itself (`types.ts`, `protocol.ts`).
 pdf.js's display module, foliate's parsers, and DOMPurify are imported from
 `blob:` URLs the `open` message carries, and the core Worker is the Worker's
 business, not the Frame's (the Frame CSP forbids `worker-src`).

 The wire shapes mirror `frame-protocol.ts`. Tests inject stubs and layout
 seams through `globalThis.__readerTestHooks`; production never defines it.

 This is the TypeScript source; `scripts/build-plugin.ts` bundles it to the
 classic script `assets/ui/reader.js`, which the Frame's HTML loads. */

import { createArchive, DocumentError, IMAGE_EXTENSIONS } from "./archive";
import { createContents, documentOutline, type OutlineItem } from "./contents";
import { createFind } from "./find";
import { hooks, positionDebounceMs } from "./hooks";
import { createMeta } from "./meta";
import { createFrameProtocol, errorCode, type FrameOpenMessage } from "./protocol";
import type {
  FrameEntry,
  FrameFoliate,
  FrameLabels,
  FramePdf,
  FrameZoom,
  PagePosition,
  ReaderSettings,
  ReadingPosition,
} from "./types";

/** One drawn PDF page, kept in a slot until the cache drops it. */
interface RenderedPage {
  index: number;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  page: any;
  scale: number;
  bitmap: ImageBitmap | null;
}

const STRINGS: Record<string, Record<string, string>> = {
  en: {
    back: "Back to Shelf",
    contents: "Contents",
    contentsEmpty: "This Document has no table of contents.",
    find: "Find in Document",
    searchPlaceholder: "Search in this Document",
    searchNext: "Next match",
    searchPrevious: "Previous match",
    searchClose: "Close search",
    searchNoMatches: "No matches",
    searchMatches: "{{current}} of {{total}}",
    pageOf: "{{page}} of {{count}}",
    pageLabeled: "{{label}} ({{page}} of {{count}})",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fitWidth: "Fit width",
    fitPage: "Fit page",
    zoomLevel: "{{percent}}%",
    loading: "Opening your Document…",
    empty: "No Document open",
    previousPage: "Previous page",
    nextPage: "Next page",
    passwordTitle: "This PDF is password-protected",
    passwordLabel: "Password",
    passwordSubmit: "Open",
    passwordWrong: "That password didn't work. Try again.",
    errorCorrupt: "This PDF is damaged, so Reader can't open it.",
    errorEncrypted: "This PDF is encrypted, so Reader can't open it.",
    errorUnsupported: "Reader can't open this file format yet.",
    errorGeneric: "Reader can't open this file.",
    errorDrm: "This Document is protected by DRM, so Reader can't open it.",
    errorDamaged: "This file is damaged, so Reader can't open it.",
    errorTooLarge: "This file is too large for Reader to open.",
    errorTimeout: "This file took too long to open. Try again.",
    sectionPage: "{{page}} of {{count}} in this section",
    increaseFontSize: "Increase font size",
    decreaseFontSize: "Decrease font size",
    continuousScroll: "Continuous scroll",
    fullScreen: "Full screen",
    exitFullScreen: "Exit full screen",
  },
  es: {
    back: "Volver al estante",
    contents: "Contenido",
    contentsEmpty: "Este documento no tiene índice.",
    find: "Buscar en el documento",
    searchPlaceholder: "Buscar en este documento",
    searchNext: "Coincidencia siguiente",
    searchPrevious: "Coincidencia anterior",
    searchClose: "Cerrar búsqueda",
    searchNoMatches: "Sin coincidencias",
    searchMatches: "{{current}} de {{total}}",
    pageOf: "{{page}} de {{count}}",
    pageLabeled: "{{label}} ({{page}} de {{count}})",
    zoomIn: "Acercar",
    zoomOut: "Alejar",
    fitWidth: "Ajustar al ancho",
    fitPage: "Ajustar a la página",
    zoomLevel: "{{percent}}%",
    loading: "Abriendo tu documento…",
    empty: "Ningún documento abierto",
    previousPage: "Página anterior",
    nextPage: "Página siguiente",
    passwordTitle: "Este PDF está protegido con contraseña",
    passwordLabel: "Contraseña",
    passwordSubmit: "Abrir",
    passwordWrong: "Esa contraseña no funcionó. Inténtalo de nuevo.",
    errorCorrupt: "Este PDF está dañado, así que Lector no puede abrirlo.",
    errorEncrypted: "Este PDF está cifrado, así que Lector no puede abrirlo.",
    errorUnsupported: "Lector todavía no puede abrir este formato.",
    errorGeneric: "Lector no puede abrir este archivo.",
    errorDrm: "Este documento está protegido con DRM, así que Lector no puede abrirlo.",
    errorDamaged: "Este archivo está dañado, así que Lector no puede abrirlo.",
    errorTooLarge: "Este archivo es demasiado grande para que Lector lo abra.",
    errorTimeout: "Este archivo tardó demasiado en abrirse. Inténtalo de nuevo.",
    sectionPage: "{{page}} de {{count}} en esta sección",
    increaseFontSize: "Aumentar tamaño de letra",
    decreaseFontSize: "Reducir tamaño de letra",
    continuousScroll: "Desplazamiento continuo",
    fullScreen: "Pantalla completa",
    exitFullScreen: "Salir de pantalla completa",
  },
};

const INITIAL_CHUNK_BYTES = 1 << 20;
const RANGE_CHUNK_BYTES = 1 << 20;
const MAX_CACHED_PAGES = 5;
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
/** How far a wheel gesture pushes past a page's edge before it turns the page. */
const WHEEL_PAGE_THRESHOLD = 50;
/** A pause this long between wheel events starts a new gesture. */
const WHEEL_GESTURE_GAP_MS = 180;

function el(id: string): any {
  return document.getElementById(id);
}

const hostWindow = window as Window & { maibuk?: { port?: MessagePort } };
const port = hostWindow.maibuk && hostWindow.maibuk.port;
const protocol = createFrameProtocol(port);
const { post, requestBytes, requestZipList, requestZipEntry } = protocol;
const archive = createArchive({ requestZipList, requestZipEntry });
/* The Document's title, author, page count, and cover, posted once per open. */
const meta = createMeta({
  post,
  pdf: () => pdfDoc,
  document: () => currentDocument,
  format: () => documentFormat,
  comicFiles: () => comicFiles,
  archive,
  isPageMode,
  mediaTypeFor: (name) => sanitizer.mediaTypeFor(name),
});
const backButton = el("back");
const contentsToggle = el("contents-toggle");
const findToggle = el("find-toggle");
const zoomOutButton = el("zoom-out");
const zoomInButton = el("zoom-in");
const fitWidthButton = el("fit-width");
const fitPageButton = el("fit-page");
const layoutToggle = el("layout-toggle");
const fullscreenToggle = el("fullscreen-toggle");
const pagePreviousButton = el("page-previous");
const pageNextButton = el("page-next");
const zoomLevel = el("zoom-level");
const pageIndicator = el("page-indicator");
const searchBar = el("search-bar");
const searchInput = el("search-input");
const searchStatus = el("search-status");
const searchPreviousButton = el("search-previous");
const searchNextButton = el("search-next");
const searchCloseButton = el("search-close");
const contentsPanel = el("contents");
const contentsTitle = el("contents-title");
const contentsTree = el("contents-tree");
const viewer = el("viewer");
const stage = el("stage");
const messageElement = el("message");
const passwordForm = el("password-form");
const passwordTitle = el("password-title");
const passwordLabel = el("password-label");
const passwordInput = el("password-input");
const passwordError = el("password-error");
const passwordSubmit = el("password-submit");

/* The Contents panel: the outline tree, its keyboard navigation, and where its
   entries land. */
const contents = createContents({
  panel: () => contentsPanel,
  button: () => contentsToggle,
  tree: () => contentsTree,
  t: (key) => t(key),
  pdf: () => pdfDoc,
  document: () => currentDocument,
  flowing: () => mode === "flow",
  goToPage,
  goToFlowSection,
});

/* The Find surface: the search bar, matching in either view, and the marks and
   stepping between hits. */
const find = createFind({
  bar: () => searchBar,
  input: () => searchInput,
  status: () => searchStatus,
  toggle: () => findToggle,
  nextButton: () => searchNextButton,
  previousButton: () => searchPreviousButton,
  closeButton: () => searchCloseButton,
  t: (key, values) => t(key, values),
  flowing: () => mode === "flow",
  destroyed: () => destroyed,
  pdf: () => pdfDoc,
  document: () => currentDocument,
  foliate: () => foliate,
  flow: () => flow,
  pages: () => pageCache,
  stage: () => stage,
  textNodes,
  now: () => nowMs(),
  goToPage,
  loadFlowSection,
  applyFlowPage,
  pageForCharOffset,
  schedulePosition,
});

let language = "en";
let providedLabels: FrameLabels | null = null;
let entry: FrameEntry | null = null;
let settings: ReaderSettings = {
  fontSize: 100,
  lineWidth: "medium",
  pdfFit: "width",
  pdfLayout: "single",
};
let position: ReadingPosition | null = null;
let fileSize = 0;

let pdfjs: any = null;
let pdfDoc: any = null;
let loadingTask: any = null;
let pdfWorker: any = null;
let transport: any = null;
let activePdfPort: MessagePort | null = null;

let pageIndex = 0;
let zoomSetting: FrameZoom = "width";
let currentScale = 1;
let destroyed = false;
let viewGeneration = 0;
let positionTimer = 0;
let positionDirty = false;
let resizeTimer = 0;
let passwordCallback: ((password: string) => void) | null = null;

/* Documents: foliate's parsers, the archive, and the three views. */
let foliate: any = null;
let purify: any = null;
let currentDocument: any = null;
let mode: "pdf" | "flow" | "fixed" | "comic" = "pdf";
let documentFormat: string = "";
let flow: any = null;
const comicCache: Map<number, string> = new Map();
let comicFiles: string[] = [];
const FLOW_GAP = 40;

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
let wheelCarry = 0;
let lastWheelAt = 0;
let wheelTurned = false;

let pageLabels: string[] | null = null;

function t(key: string, values?: Record<string, string | number>): string {
  const base = STRINGS[language.split(/[-_]/)[0]] || STRINGS.en;
  const merged = Object.assign({}, base, providedLabels || {});
  const template = typeof merged[key] === "string" ? merged[key] : key;
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : ""
  );
}

/** Names an icon button for screen readers and its tooltip. */
function labelButton(button: any, label: string) {
  if (!button) return;
  button.setAttribute("aria-label", label);
  button.title = label;
}

function setLabels() {
  document.documentElement.lang = language;
  labelButton(backButton, t("back"));
  labelButton(contentsToggle, t("contents"));
  labelButton(findToggle, t("find"));
  labelButton(pagePreviousButton, t("previousPage"));
  labelButton(pageNextButton, t("nextPage"));
  labelButton(fitWidthButton, t("fitWidth"));
  labelButton(fitPageButton, t("fitPage"));
  labelButton(layoutToggle, t("continuousScroll"));
  if (searchInput) searchInput.placeholder = t("searchPlaceholder");
  labelButton(searchPreviousButton, t("searchPrevious"));
  labelButton(searchNextButton, t("searchNext"));
  labelButton(searchCloseButton, t("searchClose"));
  if (contentsTitle) contentsTitle.textContent = t("contents");
  if (passwordTitle) passwordTitle.textContent = t("passwordTitle");
  if (passwordLabel) passwordLabel.textContent = t("passwordLabel");
  if (passwordSubmit) passwordSubmit.textContent = t("passwordSubmit");
  updateIndicator();
  if (searchBar && !searchBar.hidden) find.updateStatus();
}

/** A button that stays focusable while it does nothing, so focus never drops. */
function setInactive(button: any, inactive: boolean) {
  if (!button) return;
  if (inactive) button.setAttribute("aria-disabled", "true");
  else button.removeAttribute("aria-disabled");
}

function isInactive(button: any) {
  return button.getAttribute("aria-disabled") === "true";
}

/** Whether the shown page is the first and the last one. */
function pageBounds() {
  if (pdfDoc) return { first: pageIndex <= 0, last: pageIndex >= pdfDoc.numPages - 1 };
  if (mode === "flow" && flow && currentDocument) {
    return {
      first: flow.index <= 0 && flow.pageIndex <= 0,
      last: flow.index >= currentDocument.sections.length - 1 && flow.pageIndex >= flow.pages - 1,
    };
  }
  if (mode === "comic") return { first: pageIndex <= 0, last: pageIndex >= comicFiles.length - 1 };
  if (currentDocument) {
    return { first: pageIndex <= 0, last: pageIndex >= currentDocument.sections.length - 1 };
  }
  return { first: true, last: true };
}

/** Brings the toolbar in line with the open Document and where the author is. */
function updateControls() {
  const open = hasDocument();
  document.body.dataset.mode = pdfDoc ? "pdf" : open ? mode : "";
  const bounds = pageBounds();
  setInactive(pagePreviousButton, !open || bounds.first);
  setInactive(pageNextButton, !open || bounds.last);
  const flowing = mode === "flow" && !pdfDoc;
  labelButton(zoomOutButton, t(flowing ? "decreaseFontSize" : "zoomOut"));
  labelButton(zoomInButton, t(flowing ? "increaseFontSize" : "zoomIn"));
  if (fitWidthButton) fitWidthButton.setAttribute("aria-pressed", String(zoomSetting === "width"));
  if (fitPageButton) fitPageButton.setAttribute("aria-pressed", String(zoomSetting === "page"));
  if (layoutToggle) layoutToggle.setAttribute("aria-pressed", String(isContinuous()));
  if (fullscreenToggle) {
    fullscreenToggle.hidden = !fullscreenAvailable();
    fullscreenToggle.setAttribute("aria-pressed", String(fullscreen));
    labelButton(fullscreenToggle, t(fullscreen ? "exitFullScreen" : "fullScreen"));
  }
}

function clamp(value: unknown, min: number, max: number): number {
  return Math.min(max, Math.max(min, value as number));
}

function isErrorLike(value: unknown): value is { name?: unknown; message?: unknown } {
  return typeof value === "object" && value !== null;
}

/** The uint16 at `offset`, big-endian (PalmDB and MOBI headers). */
function u16be(bytes: Uint8Array, offset: number) {
  return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) >>> 0;
}

/** The uint32 at `offset`, big-endian (PalmDB and MOBI headers). */
function u32be(bytes: Uint8Array, offset: number) {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

/** The ASCII text at `offset`, or "" when the bytes are too short. */
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  let text = "";
  for (let index = offset; index < offset + length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

/** Every non-empty text node under `root`, in document order. */
function textNodes(root: ParentNode): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if ((node.nodeValue || "").trim() !== "") nodes.push(node);
  }
  return nodes;
}

/** Whether any Document is open, PDF or document. */
function hasDocument() {
  return Boolean(pdfDoc || currentDocument);
}

/** Whether the current Document turns whole pages rather than columns. */
function isPageMode() {
  return Boolean(pdfDoc) || mode === "fixed" || mode === "comic";
}

function isPasswordError(error: unknown): boolean {
  if (!isErrorLike(error)) return false;
  if (error.name === "PasswordException") return true;
  return Boolean(pdfjs && pdfjs.PasswordException && error instanceof pdfjs.PasswordException);
}

/* Messaging ------------------------------------------------------------- */

/** Hands one port message to the protocol client, which settles or dispatches it. */
function onMessage(event: MessageEvent) {
  protocol.receive(event.data);
}

/* Opening --------------------------------------------------------------- */

/** The open timeout, which the test harness may shorten through `hooks`. */
function pdfLoadTimeoutMs() {
  return hooks && typeof hooks.loadTimeoutMs === "number"
    ? hooks.loadTimeoutMs
    : PDF_LOAD_TIMEOUT_MS;
}

/**
 * Rejects when `promise` neither resolves nor rejects within the open
 * timeout, so a wedged pdf.js still reaches {@link handleLoadError}. The
 * underlying work is left to pdf.js and to `destroyDocument`, which the
 * failure path calls.
 */
function withPdfLoadTimeout(promise: Promise<any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("pdf.js did not answer in time");
      (error as any).name = "LoadTimeoutError";
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

async function handleOpen(message: FrameOpenMessage) {
  entry = message.entry || null;
  position = message.position || null;
  settings = message.settings || settings;
  fileSize = typeof message.size === "number" ? message.size : 0;
  providedLabels = message.labels || null;
  language = typeof message.language === "string" ? message.language : language;
  setLabels();
  resetDocument();
  if (!entry) {
    showMessage(t("empty"), false);
    return;
  }
  if (message.pdf && message.pdfPort) {
    await openPdf(message.pdf, message.pdfPort, position);
    return;
  }
  if (message.foliate) {
    await openDocument(message.foliate, position, entry.format);
    return;
  }
  fail("unsupported", t("errorUnsupported"));
}

function resetDocument() {
  destroyDocument();
  pageIndex = 0;
  currentScale = 1;
  meta.reset();
  contents.reset();
  pageLabels = null;
  mode = "pdf";
  documentFormat = "";
  find.reset();
  if (pageIndicator) pageIndicator.textContent = "";
  if (messageElement) {
    messageElement.hidden = true;
    messageElement.textContent = "";
    delete messageElement.dataset.error;
  }
  if (passwordForm) passwordForm.hidden = true;
  if (stage) stage.hidden = true;
  find.close(false);
}

/**
 * Opens a PDF. pdf.js's core answers from the Plugin Worker's nested Worker
 * through `pdfPort`.
 */
async function openPdf(pdf: FramePdf, pdfPort: MessagePort, saved: ReadingPosition | null) {
  try {
    pdfjs = await withPdfLoadTimeout(importPdfjs(pdf.displaySource));
    injectCss(pdf.css);
    activePdfPort = pdfPort;
    pdfPort.start();
    pdfWorker = new pdfjs.PDFWorker({ port: pdfPort });
    zoomSetting =
      saved &&
      (typeof (saved as PagePosition).zoom === "number" ||
        (saved as PagePosition).zoom === "width" ||
        (saved as PagePosition).zoom === "page")
        ? (saved as PagePosition).zoom
        : settings.pdfFit;
    const initialLength = Math.min(fileSize > 0 ? fileSize : 0, INITIAL_CHUNK_BYTES);
    // The first read is as likely to stall as any later one, so it runs under
    // the same deadline; a provider that never answers must not leave the
    // spinner up with no way out.
    const initial = await withPdfLoadTimeout(requestBytes(0, initialLength));
    transport = new pdfjs.PDFDataRangeTransport(fileSize, initial);
    transport.requestDataRange = (begin: number, end: number) => {
      void requestBytes(begin, Math.min(end - begin, RANGE_CHUNK_BYTES))
        .then((bytes) => transport.onDataRange(begin, bytes))
        .catch(() => {
          /* A refused range fails the page render; the Frame reports it once. */
        });
    };
    transport.abort = () => {
      protocol.abortReads("Reader stopped reading");
    };
    await loadDocument(undefined);
  } catch (error) {
    if (!destroyed) handleLoadError(error);
  }
}

async function importPdfjs(displaySource: string): Promise<any> {
  if (hooks && typeof hooks.importPdfjs === "function") return hooks.importPdfjs(displaySource);
  const url = URL.createObjectURL(new Blob([displaySource], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function injectCss(css: string) {
  const previous = document.getElementById("reader-pdf-css");
  if (previous) previous.remove();
  const style = document.createElement("style");
  style.id = "reader-pdf-css";
  style.textContent = css;
  document.head.append(style);
}

async function loadDocument(password: string | undefined) {
  if (!pdfjs || !transport) return;
  const params: Record<string, unknown> = {
    range: transport,
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
  const timeout = new Promise((_resolve, reject) => {
    rejectTimeout = () => {
      const error = new Error("pdf.js did not answer in time");
      (error as any).name = "LoadTimeoutError";
      reject(error);
    };
  });
  const armTimeout = () => {
    if (done) return;
    clearTimeout(timer);
    timer = window.setTimeout(rejectTimeout, pdfLoadTimeoutMs());
  };
  armTimeout();
  if (typeof task === "object" && task !== null) {
    task.onProgress = () => {
      // While the password form is open the deadline stays paused, even if a
      // stray progress frame arrives.
      if (passwordForm && !passwordForm.hidden) return;
      armTimeout();
    };
    task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      clearTimeout(timer);
      passwordCallback = (value) => {
        armTimeout();
        updatePassword(value);
      };
      showPassword(reason === 2);
    };
  }
  try {
    pdfDoc = await Promise.race([task.promise, timeout]);
  } catch (error) {
    if (isPasswordError(error)) {
      showPassword(typeof password === "string");
      return;
    }
    throw error;
  } finally {
    done = true;
    clearTimeout(timer);
  }
  await onOpened();
}

async function onOpened() {
  if (!pdfDoc) return;
  try {
    pageLabels = await pdfDoc.getPageLabels();
  } catch {
    pageLabels = null;
  }
  let outline: OutlineItem[] | null = null;
  try {
    outline = await pdfDoc.getOutline();
  } catch {
    outline = null;
  }
  contents.show(outline);
  const savedIndex = position && position.kind === "page" ? position.page : 0;
  pageIndex = clamp(Math.floor(savedIndex), 0, Math.max(0, pdfDoc.numPages - 1));
  stage.hidden = false;
  messageElement.hidden = true;
  passwordForm.hidden = true;
  try {
    const first = await pdfDoc.getPage(1);
    pdfBase = first.getViewport({ scale: 1 });
  } catch {
    pdfBase = null;
  }
  if (destroyed || !pdfDoc) return;
  updateIndicator();
  await rebuildPdfView();
  void meta.send();
}

/* Documents: archive, parsers, Flowing and Page views ----------------------- */
const sanitizer = (globalThis as any).ReaderSanitizer;
const FB2_MAX_BYTES = 20 * 1024 * 1024;

/** Imports foliate's bundled parsers from the `blob:` URL the `open` carries. */
async function importFoliate(source: string) {
  if (hooks && typeof hooks.importFoliate === "function") return hooks.importFoliate(source);
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Imports DOMPurify's browser build from the `blob:` URL the `open` carries. */
async function importPurify(source: string) {
  if (hooks && typeof hooks.importPurify === "function") return hooks.importPurify(source);
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const module = await import(/* @vite-ignore */ url);
    return module.default || module;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The module or its default export, whichever DOMPurify arrived as. */
function purifyFrom(module: any) {
  return module && module.default ? module.default : module;
}

/* Opening documents --------------------------------------------------------- */

/**
 * Opens one non-PDF Document and picks its view: Flowing for reflowable text,
 * Page for a CBZ or a pre-paginated EPUB.
 */
async function openDocument(
  resources: FrameFoliate,
  saved: ReadingPosition | null,
  format: string
) {
  try {
    foliate = await importFoliate(resources.source);
    purify = purifyFrom(await importPurify(resources.purify));
    documentFormat = format;
    if (format === "epub" || format === "cbz") await archive.open();

    if (format === "epub") {
      currentDocument = new foliate.EPUB(archive.loader());
      await currentDocument.init();
    } else if (format === "cbz") {
      openComic();
    } else if (format === "fb2") {
      if (fileSize > FB2_MAX_BYTES) throw new DocumentError("too-large", "This file is too large");
      const bytes = await requestBytes(0, fileSize);
      currentDocument = await foliate.makeFB2(
        new Blob([bytes as BlobPart], { type: "application/xml" })
      );
    } else if (format === "mobi" || format === "azw3") {
      await checkMobiDrm();
      const mobi = new foliate.MOBI({ unzlib: foliate.unzlibSync });
      currentDocument = await mobi.open(mobiFile());
    } else {
      fail("unsupported", t("errorUnsupported"));
      return;
    }

    if (destroyed || !currentDocument) return;
    contents.show(documentOutline(currentDocument.toc));
    stage.hidden = false;
    messageElement.hidden = true;
    passwordForm.hidden = true;
    const fixed = format === "cbz" || currentDocument.rendition?.layout === "pre-paginated";
    if (format === "cbz") {
      mode = "comic";
      pageIndex = saved && saved.kind === "page" ? Math.max(0, Math.floor(saved.page)) : 0;
      zoomSetting =
        saved && typeof (saved as PagePosition).zoom !== "undefined"
          ? (saved as PagePosition).zoom
          : settings.pdfFit;
      pageIndex = clamp(pageIndex, 0, Math.max(0, comicFiles.length - 1));
      await renderComicPage();
    } else if (fixed) {
      mode = "fixed";
      pageIndex = saved && saved.kind === "page" ? Math.max(0, Math.floor(saved.page)) : 0;
      zoomSetting =
        saved && typeof (saved as PagePosition).zoom !== "undefined"
          ? (saved as PagePosition).zoom
          : settings.pdfFit;
      pageIndex = clamp(pageIndex, 0, Math.max(0, currentDocument.sections.length - 1));
      await renderFixedPage();
    } else {
      mode = "flow";
      const start = flowStart(saved);
      await loadFlowSection(start.index, start.page, start.anchor);
    }
    void meta.sendDocument();
  } catch (error) {
    if (!destroyed) failDocument(error);
  }
}

/** Maps an open failure to the message the author sees and the Worker stores. */
function failDocument(error: unknown) {
  const code = errorCode(error);
  if (code === "drm") {
    fail("encrypted", t("errorDrm"));
    return;
  }
  if (code === "too-large") {
    fail("unsupported", t("errorTooLarge"));
    return;
  }
  fail("corrupt", t("errorDamaged"));
}

/** Refuses a MOBI or AZW3 whose PalmDOC header carries an encryption flag. */
async function checkMobiDrm() {
  if (fileSize < 100) throw new DocumentError("corrupt", "This file is too small");
  let head = await requestBytes(0, Math.min(fileSize, 100));
  if (ascii(head, 60, 8) !== "BOOKMOBI") throw new DocumentError("corrupt", "Not a MOBI file");
  const record = u32be(head, 78);
  const flagOffset = record + 12;
  if (flagOffset + 2 > head.length) {
    head = await requestBytes(0, Math.min(fileSize, flagOffset + 2));
  }
  if (u16be(head, flagOffset) !== 0)
    throw new DocumentError("drm", "This Document is protected by DRM");
}

/** A File-like object whose `slice` reads ranges through the Worker. */
function mobiFile() {
  return {
    name: entry ? entry.title : "document.mobi",
    size: fileSize,

    slice(start: number, end?: number) {
      const from = Math.max(0, Math.floor(start));
      const to = Math.min(fileSize, end === undefined ? fileSize : Math.floor(end));
      return {
        async arrayBuffer() {
          const bytes = await requestBytes(from, Math.max(0, to - from));
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
  };
}

/** A CBZ as a minimal document: one section per image, sorted naturally. */
function openComic() {
  const collator = new Intl.Collator(undefined, { numeric: true });
  comicFiles = archive
    .entries()
    .map((item) => item.name)
    .filter((name) => IMAGE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension)))
    .sort(collator.compare);
  if (comicFiles.length === 0) throw new DocumentError("corrupt", "This archive has no images");
  currentDocument = {
    metadata: { title: entry ? entry.title : "" },
    sections: comicFiles.map((name) => ({ id: name })),
    toc: comicFiles.map((name) => ({ label: name, href: name })),

    resolveHref: (href: string) => ({ index: comicFiles.indexOf(href) }),
    rendition: { layout: "pre-paginated" },
    destroy() {},
  };
}

/* Rendering a section --------------------------------------------------- */

/**
 * Parses, sanitizes, and rewrites one section, then draws its body inside a
 * shadow root. The parsed Document stays alive so CFIs can be computed from
 * it after the shadow copy has been highlighted.
 */
async function renderSection(section: any, options?: { fixed?: boolean }) {
  const doc = await section.createDocument();
  // The viewport meta is captured before sanitizing, because DOMPurify
  // removes `meta` along with every other element that can restyle the Frame.
  const viewport = fixedViewport(doc);
  sanitizer.sanitizeDocument(doc, purify);
  await sanitizer.rewriteDocument(doc, {
    base: typeof section.id === "string" ? section.id : "",
    assetUrl: archive.assetUrl,
    assetText: archive.text,
  });
  const body = doc.body || doc.querySelector("body") || doc.documentElement;

  const host = document.createElement("div");
  host.className = "reader-document";
  host.dataset.section = String(
    currentDocument && currentDocument.sections ? currentDocument.sections.indexOf(section) : 0
  );
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = sanitizer.readingCss(settings);
  if (options && options.fixed) {
    style.textContent +=
      "\n:host { display: block; width: 100%; height: 100%; overflow: hidden; }" +
      "\n.reader-flow { max-width: none; width: 100%; height: 100%; margin: 0; }";
  }
  shadow.append(style);
  for (const element of Array.from(doc.querySelectorAll("style")) as HTMLElement[]) {
    shadow.append(element.cloneNode(true));
  }

  const content = document.createElement("div");
  content.className = "reader-flow";
  for (const child of Array.from(body.childNodes) as ChildNode[])
    content.append(child.cloneNode(true));
  shadow.append(content);
  return { doc, body, host, shadow, content, viewport };
}

/** The width and height the Flowing view pages within. */
function flowGeometry() {
  const availableWidth =
    (hooks && typeof hooks.viewportWidth === "number" ? hooks.viewportWidth : 0) ||
    (viewer.clientWidth > 32 ? viewer.clientWidth - 32 : 800);
  const availableHeight =
    (hooks && typeof hooks.viewportHeight === "number" ? hooks.viewportHeight : 0) ||
    (viewer.clientHeight > 32 ? viewer.clientHeight - 32 : 600);
  const em = Number.parseFloat(sanitizer.LINE_WIDTHS[settings.lineWidth]) || 38;
  const scale = Math.max(0.6, Math.min(2, settings.fontSize / 100));
  const lineWidth = 16 * scale * em;
  return {
    width: Math.max(200, Math.min(availableWidth, lineWidth)),
    height: Math.max(200, availableHeight),
  };
}

function flowPageCount(columns: HTMLElement, pageWidth: number, sectionIndex: number) {
  if (hooks && typeof hooks.measureFlow === "function") {
    return Math.max(1, Math.floor(hooks.measureFlow({ columns, pageWidth, sectionIndex })));
  }
  const scroll = columns.scrollWidth || 0;
  if (scroll <= pageWidth) return 1;
  return Math.max(1, Math.round((scroll + FLOW_GAP) / (pageWidth + FLOW_GAP)));
}

/**
 * Loads one Flowing section and pages to `targetPage` or to the page that
 * holds `anchor`'s range.
 */
async function loadFlowSection(
  index: number,
  targetPage?: number,
  anchor?: ((doc: Document) => Range | null) | null
) {
  if (!currentDocument) return;
  const section = currentDocument.sections[index];
  if (!section) return;
  const generation = ++viewGeneration;
  archive.revoke();
  const geometry = flowGeometry();
  const rendered = await renderSection(section, {});
  if (destroyed || generation !== viewGeneration) return;

  const columns = document.createElement("div");
  columns.className = "reader-columns";
  columns.style.columnWidth = `${geometry.width}px`;
  columns.style.width = `${geometry.width}px`;
  columns.style.height = `${geometry.height}px`;
  columns.style.columnGap = `${FLOW_GAP}px`;
  columns.append(rendered.content);
  const viewport = document.createElement("div");
  viewport.className = "reader-viewport";
  viewport.style.width = `${geometry.width}px`;
  viewport.style.height = `${geometry.height}px`;
  viewport.style.overflow = "hidden";
  viewport.append(columns);
  rendered.shadow.append(viewport);

  // The host must be in the rendered document before the columns are
  // measured: an element outside it has no layout, so `scrollWidth` is 0 and
  // every section would look like a single page.
  stage.textContent = "";
  stage.style.width = `${geometry.width}px`;
  stage.style.height = `${geometry.height}px`;
  stage.hidden = false;
  stage.append(rendered.host);

  const pages = flowPageCount(columns, geometry.width, index);
  flow = {
    index,
    pageIndex: 0,
    pages,
    doc: rendered.doc,
    body: rendered.body,
    host: rendered.host,
    shadow: rendered.shadow,
    columns,
    content: rendered.content,
    pageWidth: geometry.width,
    height: geometry.height,
    gap: FLOW_GAP,
    sectionCfi: typeof section.cfi === "string" ? section.cfi : null,
  };

  let page = typeof targetPage === "number" ? targetPage : 0;
  if (anchor) {
    try {
      const range = anchor(rendered.doc);
      if (range) page = pageForDocRange(range);
    } catch {
      /* A CFI that no longer resolves falls back to the first page. */
    }
  }
  applyFlowPage(page);
  updateIndicator();
  schedulePosition();
  find.highlightFlow();
}

function applyFlowPage(page: number) {
  if (!flow) return;
  flow.pageIndex = clamp(Math.floor(page), 0, Math.max(0, flow.pages - 1));
  flow.columns.style.transform = `translateX(-${flow.pageIndex * (flow.pageWidth + flow.gap)}px)`;
  updateIndicator();
  find.updateStatus();
}

function nextFlowPage() {
  if (!flow) return;
  if (flow.pageIndex + 1 < flow.pages) {
    applyFlowPage(flow.pageIndex + 1);
    schedulePosition();
    return;
  }
  if (flow.index + 1 < currentDocument.sections.length) {
    void loadFlowSection(flow.index + 1, 0);
    schedulePosition();
  }
}

function previousFlowPage() {
  if (!flow) return;
  if (flow.pageIndex > 0) {
    applyFlowPage(flow.pageIndex - 1);
    schedulePosition();
    return;
  }
  if (flow.index > 0) {
    void loadFlowSection(flow.index - 1, Number.MAX_SAFE_INTEGER);
    schedulePosition();
  }
}

async function goToFlowSection(index: number, anchor?: any) {
  if (!flow || flow.index !== index) {
    await loadFlowSection(index, 0, anchor || null);
    return;
  }
  if (anchor) {
    try {
      const range = anchor(flow.doc);
      if (range) applyFlowPage(pageForDocRange(range));
    } catch {
      /* Keep the current page. */
    }
  } else {
    applyFlowPage(0);
  }
  schedulePosition();
}

/** The CFI of the first character on the current Flowing page. */
function flowCfi() {
  if (!foliate || !flow || documentFormat !== "epub") return null;
  const base = flow.sectionCfi || (foliate.CFI ? foliate.CFI.fake.fromIndex(flow.index) : null);
  if (!base) return null;
  const range = rangeForFlowPage();
  if (!range) return base;
  try {
    return foliate.CFI.joinIndir(base, foliate.CFI.fromRange(range));
  } catch {
    return base;
  }
}

/** The range at the first character of the current page, in the parsed Document. */
function rangeForFlowPage() {
  if (!flow) return null;
  const nodes = textNodes(flow.body);
  if (nodes.length === 0) return null;
  const fraction = flow.pages > 1 ? flow.pageIndex / flow.pages : 0;
  return rangeForCharOffset(flow.doc, flow.body, Math.floor(textLength(nodes) * fraction));
}

/** The total length of `nodes`' text. */
function textLength(nodes: Text[]) {
  let total = 0;
  for (const node of nodes) total += (node.nodeValue || "").length;
  return total;
}

/** A collapsed range at `offset` through the body's text. */
function rangeForCharOffset(doc: Document, body: HTMLElement, offset: number): Range | null {
  const nodes = textNodes(body);
  let remaining = Math.max(0, offset);
  for (const node of nodes) {
    const length = (node.nodeValue || "").length;
    if (remaining <= length) {
      const range = doc.createRange();
      range.setStart(node, Math.min(length, remaining));
      range.collapse(true);
      return range;
    }
    remaining -= length;
  }
  if (nodes.length === 0) return null;
  const range = doc.createRange();
  const last = nodes[nodes.length - 1];
  range.setStart(last, (last.nodeValue || "").length);
  range.collapse(true);
  return range;
}

/** The Flowing page a range in the parsed Document falls on. */
function pageForDocRange(range: Range): number {
  if (!flow) return 0;
  const nodes = textNodes(flow.body);
  const total = textLength(nodes);
  if (total === 0) return 0;
  let offset = 0;
  const start = range.startContainer;
  if (start.nodeType === Node.TEXT_NODE) {
    for (const node of nodes) {
      if (node === start) {
        offset += Math.min(range.startOffset, (node.nodeValue || "").length);
        break;
      }
      offset += (node.nodeValue || "").length;
    }
  }
  return clamp(Math.floor((offset / total) * flow.pages), 0, Math.max(0, flow.pages - 1));
}

function pageForCharOffset(doc: Document, offset: number): number {
  if (!flow) return 0;
  const range = rangeForCharOffset(doc, flow.body, offset);
  return range ? pageForDocRange(range) : 0;
}

/** The Reading Position a Flowing Document resumes at. */
function flowStart(saved: ReadingPosition | null) {
  if (
    saved &&
    saved.kind === "cfi" &&
    currentDocument &&
    typeof currentDocument.resolveCFI === "function"
  ) {
    try {
      const resolved = currentDocument.resolveCFI(saved.cfi);
      if (resolved && typeof resolved.index === "number" && resolved.index >= 0) {
        return { index: resolved.index, page: 0, anchor: resolved.anchor };
      }
    } catch {
      /* Fall through to the first section. */
    }
  }
  if (saved && saved.kind === "section") {
    return {
      index: clamp(Math.floor(saved.index), 0, Math.max(0, currentDocument.sections.length - 1)),
      page: 0,
    };
  }
  return { index: 0, page: 0 };
}

/** Re-paginates the current section after a typography change, keeping the CFI. */
async function repaginateFlow(
  cfi: string | null,
  sectionIndex: number,
  page: number
): Promise<void> {
  if (!currentDocument) return;
  let index = typeof sectionIndex === "number" ? sectionIndex : 0;
  let anchor = null;
  if (cfi && typeof currentDocument.resolveCFI === "function") {
    try {
      const resolved = currentDocument.resolveCFI(cfi);
      if (resolved && typeof resolved.index === "number" && resolved.index >= 0) {
        index = resolved.index;
        anchor = resolved.anchor;
      }
    } catch {
      /* Keep the section and page the caller gave. */
    }
  }
  await loadFlowSection(index, typeof page === "number" ? page : 0, anchor);
}

function stepFontSize(delta: number) {
  if (!hasDocument()) return;
  const next = clamp(Math.round((settings.fontSize + delta) / 10) * 10, 60, 200);
  if (next === settings.fontSize) return;
  settings = { ...settings, fontSize: next };
  post({ kind: "settings", settings });
  if (mode === "flow" && flow) {
    const cfi = flowCfi();
    const index = flow.index;
    const page = flow.pageIndex;
    void repaginateFlow(cfi, index, page);
  } else if (zoomLevel) {
    zoomLevel.textContent = t("zoomLevel", { percent: settings.fontSize });
  }
}

/* Fixed-layout pages and comics ----------------------------------------- */

/** The `width`/`height` a fixed-layout section declares, or a document default. */
function fixedViewport(doc: Document) {
  const meta = doc.querySelector('meta[name="viewport"]');
  const content = meta ? meta.getAttribute("content") || "" : "";
  const width = /(?:^|,)\s*width\s*=\s*([\d.]+)/i.exec(content);
  const height = /(?:^|,)\s*height\s*=\s*([\d.]+)/i.exec(content);
  return {
    width: width ? Math.max(1, Number.parseFloat(width[1])) : 1200,
    height: height ? Math.max(1, Number.parseFloat(height[1])) : 1600,
  };
}

/** The scale that fits a fixed-layout page, honoring a numeric zoom. */
function fixedScale(width: number, height: number): number {
  const availableWidth = viewer.clientWidth > 32 ? viewer.clientWidth - 32 : 800;
  const availableHeight = viewer.clientHeight > 32 ? viewer.clientHeight - 32 : 600;
  const fit = Math.min(availableWidth / width, availableHeight / height);
  if (typeof zoomSetting === "number") return clamp(zoomSetting, 0.25, 4);
  if (zoomSetting === "width") return clamp(availableWidth / width, 0.1, 4);
  return clamp(fit, 0.1, 4);
}

async function renderFixedPage() {
  if (!currentDocument) return;
  const section = currentDocument.sections[pageIndex];
  if (!section) return;
  const generation = ++viewGeneration;
  archive.revoke();
  const rendered = await renderSection(section, { fixed: true });
  if (destroyed || generation !== viewGeneration) return;
  const viewport = rendered.viewport || fixedViewport(rendered.doc);
  const scale = fixedScale(viewport.width, viewport.height);
  rendered.host.style.width = `${viewport.width}px`;
  rendered.host.style.height = `${viewport.height}px`;
  rendered.host.style.transform = `scale(${scale})`;
  rendered.host.style.transformOrigin = "top left";

  stage.textContent = "";
  stage.style.width = `${Math.round(viewport.width * scale)}px`;
  stage.style.height = `${Math.round(viewport.height * scale)}px`;
  stage.hidden = false;
  stage.append(rendered.host);
  currentScale = scale;
  updateIndicator();
  schedulePosition();
  if (zoomLevel) zoomLevel.textContent = t("zoomLevel", { percent: Math.round(scale * 100) });
}

async function comicUrl(index: number): Promise<string | null> {
  const cached = comicCache.get(index);
  if (cached) return cached;
  const name = comicFiles[index];
  if (!name) return null;
  const bytes = await archive.bytes(name);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: sanitizer.mediaTypeFor(name) })
  );
  comicCache.set(index, url);
  return url;
}

async function renderComicPage() {
  if (!currentDocument) return;
  const generation = ++viewGeneration;
  const index = pageIndex;
  let url = null;
  try {
    url = await comicUrl(index);
  } catch (error) {
    if (!destroyed && generation === viewGeneration) failDocument(error);
    return;
  }
  if (destroyed || generation !== viewGeneration || index !== pageIndex || url === null) return;

  const image = document.createElement("img");
  image.className = "reader-comic-page";
  image.src = url;
  image.alt = comicFiles[index] || "";
  const width = viewer.clientWidth > 32 ? viewer.clientWidth - 32 : 800;
  if (typeof zoomSetting === "number") {
    image.style.width = `${Math.round(width * clamp(zoomSetting, 0.5, 4))}px`;
    image.style.height = "auto";
    currentScale = clamp(zoomSetting, 0.5, 4);
  } else if (zoomSetting === "page") {
    image.style.maxWidth = "100%";
    image.style.maxHeight = `${viewer.clientHeight > 32 ? viewer.clientHeight - 32 : 600}px`;
    image.style.width = "auto";
    currentScale = 1;
  } else {
    image.style.width = `${width}px`;
    image.style.height = "auto";
    currentScale = 1;
  }

  stage.textContent = "";
  stage.style.width = typeof zoomSetting === "number" ? image.style.width : "auto";
  stage.style.height = "auto";
  stage.hidden = false;
  stage.append(image);
  updateIndicator();
  schedulePosition();
  if (zoomLevel)
    zoomLevel.textContent = t("zoomLevel", { percent: Math.round(currentScale * 100) });
  prefetchComic();
  trimComicCache();
}

function prefetchComic() {
  for (const offset of [1, -1]) {
    const index = pageIndex + offset;
    if (index < 0 || index >= comicFiles.length || comicCache.has(index)) continue;
    void comicUrl(index).catch(() => {
      /* Prefetching is best effort. */
    });
  }
}

function trimComicCache() {
  for (const [index, url] of comicCache) {
    if (comicCache.size <= MAX_CACHED_PAGES) break;
    if (Math.abs(index - pageIndex) <= 1) continue;
    comicCache.delete(index);
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* Already gone. */
    }
  }
}

function clearComicCache() {
  for (const url of comicCache.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* Already gone. */
    }
  }
  comicCache.clear();
}

/* Time ------------------------------------------------------------------ */
/** The clock the Flowing search slices by and the wheel gesture measures, testable through `hooks`. */
function nowMs(): number {
  if (hooks && typeof hooks.now === "function") return hooks.now();
  return performance.now();
}

/* Rendering ------------------------------------------------------------- */
function updateIndicator() {
  updateControls();
  if (!pageIndicator) return;
  if (pdfDoc) {
    const number = pageIndex + 1;
    const count = pdfDoc.numPages;
    const label =
      pageLabels && typeof pageLabels[pageIndex] === "string" ? pageLabels[pageIndex] : "";
    pageIndicator.textContent =
      label !== "" && label !== String(number)
        ? t("pageLabeled", { label, page: number, count })
        : t("pageOf", { page: number, count });
    return;
  }
  if (mode === "flow" && flow) {
    pageIndicator.textContent = t("sectionPage", {
      page: flow.pageIndex + 1,
      count: flow.pages,
    });
    return;
  }
  if (currentDocument) {
    pageIndicator.textContent = t("pageOf", {
      page: pageIndex + 1,
      count: currentDocument.sections.length,
    });
  }
}

function scaleFor(base: { width: number; height: number }): number {
  if (typeof zoomSetting === "number") return clamp(zoomSetting, 0.5, 4);
  const width = viewer.clientWidth > 0 ? viewer.clientWidth - 32 : base.width;
  const height = viewer.clientHeight > 0 ? viewer.clientHeight - 32 : base.height;
  const byWidth = width / Math.max(1, base.width);
  if (zoomSetting === "page") return Math.min(byWidth, height / Math.max(1, base.height));
  return byWidth;
}

function isContinuous() {
  return Boolean(pdfDoc) && settings.pdfLayout === "continuous";
}

/**
 * Lays out one slot per page, each sized from the first page until its own
 * page renders. A drawn canvas stays in its slot until the cache drops it:
 * the Frame never detaches a canvas and shows it again, which WebKit can hand
 * back blank.
 */
function buildPdfSlots() {
  if (!pdfDoc) return;
  viewGeneration += 1;
  stopObserving();
  clearCache();
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
    slot.hidden = !continuous && index !== pageIndex;
    slots.push(slot);
  }
  stage.append(...slots);
  stage.hidden = false;
  currentScale = scale;
  if (zoomLevel) zoomLevel.textContent = t("zoomLevel", { percent: Math.round(scale * 100) });
}

/**
 * Draws the PDF in the current layout and zoom: the shown page and its
 * neighbors, or, in Continuous scroll, the pages near the viewport.
 */
function rebuildPdfView(): Promise<void> {
  if (!pdfDoc) return Promise.resolve();
  buildPdfSlots();
  updateControls();
  if (isContinuous()) {
    observeSlots();
    scrollToSlot(pageIndex);
    return renderPage(pageIndex)
      .then(() => find.revealPdfMatch())
      .catch((error) => {
        if (!destroyed) handleLoadError(error);
      });
  }
  viewer.scrollTop = 0;
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
  if (slots.length !== pdfDoc.numPages) buildPdfSlots();
  const generation = viewGeneration;
  const index = pageIndex;
  if (!isContinuous()) showSlot(index);
  try {
    const rendered = await renderPage(index);
    if (destroyed || generation !== viewGeneration || index !== pageIndex) return;
    showRendered(rendered);
  } catch (error) {
    if (!destroyed && generation === viewGeneration) handleLoadError(error);
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
  const promise = drawPage(index, viewGeneration).finally(() => {
    if (renderingPages.get(index) === promise) renderingPages.delete(index);
  });
  renderingPages.set(index, promise);
  return promise;
}

async function drawPage(index: number, generation: number): Promise<RenderedPage> {
  if (!pdfDoc) throw new Error("No Document open");
  const page = await pdfDoc.getPage(index + 1);
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
  let bitmap = null;
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
  if (destroyed || generation !== viewGeneration) return rendered;
  find.paintPdfMatches(textLayer, index);
  placeRendered(rendered);
  pageCache.set(index, rendered);
  trimCache();
  return rendered;
}

/** Puts a drawn page in its slot, keeping the reading spot when a slot above it grows. */
function placeRendered(rendered: RenderedPage) {
  const slot = slots[rendered.index];
  if (!slot) return;
  const before = slot.offsetHeight;
  const above = isContinuous() && stage.offsetTop + slot.offsetTop < viewer.scrollTop;
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
  currentScale = rendered.scale;
  if (zoomLevel)
    zoomLevel.textContent = t("zoomLevel", { percent: Math.round(rendered.scale * 100) });
  updateIndicator();
  find.revealPdfMatch();
}

function renderNeighbors() {
  if (!pdfDoc) return;
  for (const offset of [1, -1]) {
    const index = pageIndex + offset;
    if (index < 0 || index >= pdfDoc.numPages) continue;
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

/* Continuous scroll ----------------------------------------------------- */

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
    { root: viewer, rootMargin: "50% 0px" }
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
  viewer.scrollTop = Math.max(0, stage.offsetTop + slot.offsetTop - 16);
  scrollTarget = viewer.scrollTop;
}

/** The page under the upper third of the viewport. */
function pageAtScroll() {
  const line = viewer.scrollTop + viewer.clientHeight / 3 - stage.offsetTop;
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
function onViewerScroll() {
  if (!isContinuous() || slots.length === 0) return;
  if (scrollTarget !== null) {
    if (Math.abs(viewer.scrollTop - scrollTarget) < 2) return;
    scrollTarget = null;
  }
  const next = pageAtScroll();
  if (next === pageIndex) return;
  pageIndex = next;
  updateIndicator();
  schedulePosition();
  find.updateStatus();
}

function setPdfLayout(layout: "single" | "continuous") {
  if (!pdfDoc || settings.pdfLayout === layout) return;
  settings = { ...settings, pdfLayout: layout };
  post({ kind: "settings", settings });
  void rebuildPdfView();
}

function toggleContinuous() {
  setPdfLayout(isContinuous() ? "single" : "continuous");
}

/* Full screen ----------------------------------------------------------- */

/**
 * The host fills the screen with the Frame on request (`frame-fullscreen`)
 * and reports every change back; a sandboxed Frame's own Fullscreen API is
 * refused in WebKit.
 */
let fullscreen = false;

/** Every Frame lives in the host, which owns full screen. */
function fullscreenAvailable() {
  return typeof parent !== "undefined";
}

function toggleFullscreen() {
  if (!fullscreenAvailable()) return;
  parent.postMessage({ kind: "frame-fullscreen", on: !fullscreen }, "*");
}

function onHostMessage(event: MessageEvent) {
  if (event.source !== parent) return;
  const data = event.data;
  if (!data || typeof data !== "object" || data.kind !== "frame-fullscreen-state") return;
  fullscreen = data.on === true;
  document.documentElement.dataset.fullscreen = String(fullscreen);
  updateControls();
}

/* Wheel ----------------------------------------------------------------- */

/**
 * The wheel scrolls a page taller than the viewport and turns the page once
 * the author pushes past its edge, one page per gesture. Ctrl or Cmd with the
 * wheel zooms. Continuous scroll just scrolls.
 */
function onWheel(event: WheelEvent) {
  if (!hasDocument()) return;
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    if (event.deltaY !== 0) zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    return;
  }
  if (isContinuous()) return;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewer.clientHeight : 1;
  const delta = event.deltaY * unit;
  if (delta === 0 || Math.abs(delta) < Math.abs(event.deltaX * unit)) return;
  const now = nowMs();
  if (now - lastWheelAt > WHEEL_GESTURE_GAP_MS) {
    wheelCarry = 0;
    wheelTurned = false;
  }
  lastWheelAt = now;
  const forward = delta > 0;
  const canScroll = forward
    ? viewer.scrollTop + viewer.clientHeight < viewer.scrollHeight - 1
    : viewer.scrollTop > 0;
  if (canScroll) {
    wheelCarry = 0;
    return;
  }
  event.preventDefault();
  if (wheelTurned) return;
  if (wheelCarry !== 0 && wheelCarry > 0 !== forward) wheelCarry = 0;
  wheelCarry += delta;
  if (Math.abs(wheelCarry) < WHEEL_PAGE_THRESHOLD) return;
  wheelCarry = 0;
  wheelTurned = true;
  if (forward) nextPage();
  else previousPage({ atEnd: true });
}

function destroyDocument() {
  viewGeneration += 1;
  find.invalidate();
  clearCache();
  archive.revoke();
  clearComicCache();
  protocol.abortArchive("Reader closed");
  if (currentDocument && typeof currentDocument.destroy === "function") {
    try {
      currentDocument.destroy();
    } catch {
      /* Already gone. */
    }
  }
  currentDocument = null;
  flow = null;
  comicFiles = [];
  archive.reset();
  protocol.abortReads("Reader closed");
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
  currentScale = 1;
  stopObserving();
  slots = [];
  pdfBase = null;
  if (stage) {
    stage.textContent = "";
    stage.className = "";
    stage.style.width = "";
    stage.style.height = "";
  }
}

/* Navigation, zoom, position ------------------------------------------- */

/**
 * `atEnd` opens a tall page at its bottom, the way paging back by wheel expects.
 */
function goToPage(index: number, options: { atEnd?: boolean } = {}) {
  if (pdfDoc) {
    const next = clamp(Math.floor(index), 0, Math.max(0, pdfDoc.numPages - 1));
    if (isContinuous()) {
      pageIndex = next;
      updateIndicator();
      schedulePosition();
      scrollToSlot(next);
      void renderPage(next)
        .then(() => {
          if (next === pageIndex) find.revealPdfMatch();
        })
        .catch(() => {
          /* The slot stays blank; scrolling on draws the rest. */
        });
      find.updateStatus();
      return;
    }
    if (next === pageIndex) return;
    pageIndex = next;
    updateIndicator();
    schedulePosition();
    showSlot(next);
    viewer.scrollTop = options.atEnd ? viewer.scrollHeight : 0;
    void renderCurrent();
    renderNeighbors();
    find.updateStatus();
    return;
  }
  if (!currentDocument || mode === "flow") return;
  const next = clamp(Math.floor(index), 0, Math.max(0, currentDocument.sections.length - 1));
  if (next === pageIndex) return;
  pageIndex = next;
  updateIndicator();
  schedulePosition();
  if (mode === "comic") void renderComicPage();
  else void renderFixedPage();
  find.updateStatus();
}

function nextPage() {
  if (pdfDoc) {
    goToPage(pageIndex + 1);
    return;
  }
  if (mode === "flow") {
    nextFlowPage();
    return;
  }
  goToPage(pageIndex + 1);
}

function previousPage(options?: { atEnd?: boolean }) {
  if (pdfDoc) {
    goToPage(pageIndex - 1, options);
    return;
  }
  if (mode === "flow") {
    previousFlowPage();
    return;
  }
  goToPage(pageIndex - 1, options);
}

function setZoom(next: FrameZoom) {
  if (!hasDocument()) return;
  zoomSetting = next;
  schedulePosition();
  if (pdfDoc) {
    void rebuildPdfView();
  } else if (mode === "comic") {
    void renderComicPage();
  } else if (mode === "fixed") {
    void renderFixedPage();
  }
  updateControls();
}

function zoomBy(factor: number) {
  if (mode === "flow") {
    stepFontSize(factor > 1 ? 10 : -10);
    return;
  }
  if (!hasDocument()) return;
  const baseScale = currentScale > 0 ? currentScale : 1;
  setZoom(clamp(baseScale * factor, 0.5, 4));
}

function positionMessage() {
  if (mode === "flow" && flow) {
    const cfi = flowCfi();
    const fraction = flowFraction();
    return {
      kind: "position",
      position: cfi
        ? { kind: "cfi", cfi }
        : { kind: "section", index: flow.index, fraction: flowPageFraction() },
      progress: { fraction },
    };
  }
  if (currentDocument) {
    return {
      kind: "position",
      position: {
        kind: "page",
        page: pageIndex,
        zoom: typeof zoomSetting === "number" ? Math.round(zoomSetting * 1000) / 1000 : zoomSetting,
      },
      progress: { page: pageIndex + 1, pageCount: currentDocument.sections.length },
    };
  }
  return {
    kind: "position",
    position: {
      kind: "page",
      page: pageIndex,
      zoom: typeof zoomSetting === "number" ? Math.round(zoomSetting * 1000) / 1000 : zoomSetting,
    },
    progress: { page: pageIndex + 1, pageCount: pdfDoc ? pdfDoc.numPages : 0 },
  };
}

/** How far into the current Flowing section the author is, from 0 to 1. */
function flowPageFraction() {
  if (!flow || flow.pages <= 1) return 0;
  return flow.pageIndex / flow.pages;
}

/** How far through the whole Flowing Document the author is, from 0 to 1. */
function flowFraction() {
  if (!flow || !currentDocument) return 0;
  const total = Math.max(1, currentDocument.sections.length);
  return clamp((flow.index + flowPageFraction()) / total, 0, 1);
}

function schedulePosition() {
  if (!hasDocument()) return;
  positionDirty = true;
  clearTimeout(positionTimer);
  positionTimer = window.setTimeout(flushPosition, positionDebounceMs);
}

function flushPosition() {
  if (!positionDirty || !hasDocument()) return;
  positionDirty = false;
  clearTimeout(positionTimer);
  post(positionMessage());
}

/* Password and errors --------------------------------------------------- */
function showPassword(wrong: boolean) {
  stage.hidden = true;
  messageElement.hidden = true;
  passwordForm.hidden = false;
  passwordError.hidden = !wrong;
  if (wrong) passwordError.textContent = t("passwordWrong");
  passwordInput.value = "";
  passwordInput.focus();
}

function handleLoadError(error: unknown) {
  const name = isErrorLike(error) && typeof error.name === "string" ? error.name : "";
  const text = isErrorLike(error) && typeof error.message === "string" ? error.message : "";
  if (name === "PasswordException") {
    showPassword(false);
    return;
  }
  if (name === "LoadTimeoutError") {
    // Transient: a slow provider is not a damaged file, so the Worker leaves
    // the Shelf row openable and the author can try again.
    fail("timeout", t("errorTimeout"));
    return;
  }
  if (
    name === "InvalidPDFException" ||
    name === "FormatError" ||
    name === "UnexpectedResponseException"
  ) {
    fail("corrupt", t("errorCorrupt"));
    return;
  }
  if (/encrypt/i.test(name) || /encrypt/i.test(text)) {
    fail("encrypted", t("errorEncrypted"));
    return;
  }
  fail("corrupt", t("errorGeneric"));
}

function fail(code: "corrupt" | "encrypted" | "unsupported" | "timeout", message: string) {
  destroyDocument();
  stage.hidden = true;
  passwordForm.hidden = true;
  messageElement.hidden = false;
  messageElement.dataset.error = "true";
  messageElement.textContent = message;
  post({ kind: "load-error", code, reason: message });
}

function showMessage(message: string, isError: boolean) {
  stage.hidden = true;
  passwordForm.hidden = true;
  messageElement.hidden = false;
  messageElement.textContent = message;
  if (isError) messageElement.dataset.error = "true";
  else delete messageElement.dataset.error;
}

function onPasswordSubmit(event: Event) {
  event.preventDefault();
  const value = passwordInput.value;
  if (value === "") {
    passwordInput.focus();
    return;
  }
  passwordForm.hidden = true;
  passwordError.hidden = true;
  if (passwordCallback) {
    const update = passwordCallback;
    passwordCallback = null;
    update(value);
    return;
  }
  void loadDocument(value).catch((error) => {
    if (!destroyed) handleLoadError(error);
  });
}

/* Commands and keyboard ------------------------------------------------- */
function runCommand(id: string) {
  switch (id) {
    case "nextPage":
      nextPage();
      return;
    case "previousPage":
      previousPage();
      return;
    case "firstPage":
      if (mode === "flow") void goToFlowSection(0);
      else goToPage(0);
      return;
    case "lastPage":
      if (pdfDoc) goToPage(pdfDoc.numPages - 1);
      else if (mode === "flow" && currentDocument)
        void goToFlowSection(currentDocument.sections.length - 1);
      else if (currentDocument) goToPage(currentDocument.sections.length - 1);
      return;
    case "findInDocument":
      find.open();
      return;
    case "toggleContents":
      contents.toggle();
      return;
    case "zoomIn":
      zoomBy(1.1);
      return;
    case "zoomOut":
      zoomBy(1 / 1.1);
      return;
    case "fitWidth":
      setZoom("width");
      return;
    case "fitPage":
      setZoom("page");
      return;
    case "increaseFontSize":
      stepFontSize(10);
      return;
    case "decreaseFontSize":
      stepFontSize(-10);
      return;
    case "toggleContinuousScroll":
      toggleContinuous();
      return;
    case "backToShelf":
      leave();
      return;
    default:
      return;
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    find.open();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (fullscreen) {
      toggleFullscreen();
      return;
    }
    if (!searchBar.hidden) {
      find.close(true);
      return;
    }
    if (!contentsPanel.hidden) {
      contents.toggle(false);
      return;
    }
    leave();
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
      return;
    }
    if (contentsPanel.contains(target)) return;
  }
  if (!hasDocument()) return;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
      event.preventDefault();
      if (event.key === " " && event.shiftKey) previousPage();
      else nextPage();
      return;
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      event.preventDefault();
      previousPage();
      return;
    case "Home":
      event.preventDefault();
      if (mode === "flow") void goToFlowSection(0);
      else goToPage(0);
      return;
    case "End":
      event.preventDefault();
      if (pdfDoc) goToPage(pdfDoc.numPages - 1);
      else if (mode === "flow" && currentDocument)
        void goToFlowSection(currentDocument.sections.length - 1);
      else if (currentDocument) goToPage(currentDocument.sections.length - 1);
      return;
    case "+":
    case "=":
      event.preventDefault();
      zoomBy(1.1);
      return;
    case "-":
    case "_":
      event.preventDefault();
      zoomBy(1 / 1.1);
      return;
    case "f":
    case "F":
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      toggleFullscreen();
      return;
    default:
      return;
  }
}

/* Touch ----------------------------------------------------------------- */
let pointerStart: { x: number; y: number } | null = null;

function onPointerDown(event: PointerEvent) {
  if (event.button !== undefined && event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event: PointerEvent) {
  if (!pointerStart) return;
  const start = pointerStart;
  pointerStart = null;
  // A mouse drags to select text and pages with the toolbar, the keys, or
  // the wheel; the edge taps and swipes are for touch.
  if (event.pointerType === "mouse") return;
  if (!hasDocument()) return;
  const deltaX = event.clientX - start.x;
  const deltaY = event.clientY - start.y;
  if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX < 0) nextPage();
    else previousPage();
    return;
  }
  if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) return;
  const rect = viewer.getBoundingClientRect();
  if (rect.width <= 0) return;
  const x = event.clientX - rect.left;
  if (x < rect.width * 0.2) previousPage();
  else if (x > rect.width * 0.8) nextPage();
}

/* Leaving --------------------------------------------------------------- */
function leave() {
  if (destroyed) return;
  flushPosition();
  destroyDocument();
  post({ kind: "back" });
}

function onPageHide() {
  flushPosition();
  destroyDocument();
  // Gone without a Back: the Worker releases the pdf.js core it holds for us.
  post({ kind: "closed" });
}

function onResize() {
  if (!hasDocument()) return;
  if (typeof zoomSetting === "number" && pdfDoc) return;
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (pdfDoc) {
      void rebuildPdfView();
    } else if (mode === "flow" && flow) {
      void repaginateFlow(flowCfi(), flow.index, flow.pageIndex);
    } else if (mode === "comic") {
      void renderComicPage();
    } else if (mode === "fixed") {
      void renderFixedPage();
    }
  }, 150);
}

function cleanup() {
  destroyed = true;
  protocol.close();
  clearTimeout(positionTimer);
  clearTimeout(resizeTimer);
  document.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("pagehide", onPageHide);
  window.removeEventListener("resize", onResize);
  viewer.removeEventListener("pointerdown", onPointerDown);
  viewer.removeEventListener("pointerup", onPointerUp);
  viewer.removeEventListener("wheel", onWheel);
  viewer.removeEventListener("scroll", onViewerScroll);
  window.removeEventListener("message", onHostMessage);
  destroyDocument();
}

/* Wiring ---------------------------------------------------------------- */
setLabels();

if (backButton) backButton.addEventListener("click", leave);
if (contentsToggle) contentsToggle.addEventListener("click", () => contents.toggle(undefined));
if (findToggle) findToggle.addEventListener("click", () => find.open());
if (zoomOutButton) zoomOutButton.addEventListener("click", () => zoomBy(1 / 1.1));
if (zoomInButton) zoomInButton.addEventListener("click", () => zoomBy(1.1));
if (fitWidthButton) fitWidthButton.addEventListener("click", () => setZoom("width"));
if (fitPageButton) fitPageButton.addEventListener("click", () => setZoom("page"));
if (layoutToggle) layoutToggle.addEventListener("click", toggleContinuous);
if (fullscreenToggle) fullscreenToggle.addEventListener("click", toggleFullscreen);
if (pagePreviousButton)
  pagePreviousButton.addEventListener("click", () => {
    if (!isInactive(pagePreviousButton)) previousPage();
  });
if (pageNextButton)
  pageNextButton.addEventListener("click", () => {
    if (!isInactive(pageNextButton)) nextPage();
  });
find.bind();
// The Frame sandbox has no `allow-forms`, so the password never travels as a
// form submission: the Open button and Enter in the field send it directly.
if (passwordSubmit) passwordSubmit.addEventListener("click", onPasswordSubmit);
if (passwordInput) {
  passwordInput.addEventListener("keydown", (event: KeyboardEvent) => {
    // deprecated-api: Safari's IME-commit Enter has isComposing false; keyCode 229 is its only tell.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") onPasswordSubmit(event);
  });
}
document.addEventListener("keydown", onKeyDown);
window.addEventListener("pagehide", onPageHide);
window.addEventListener("resize", onResize);
viewer.addEventListener("pointerdown", onPointerDown);
viewer.addEventListener("pointerup", onPointerUp);
viewer.addEventListener("wheel", onWheel, { passive: false });
viewer.addEventListener("scroll", onViewerScroll, { passive: true });
window.addEventListener("message", onHostMessage);
updateControls();

protocol.onOpen = handleOpen;
protocol.onCommand = runCommand;
protocol.onLanguage = (nextLanguage, labels) => {
  language = nextLanguage;
  if (labels) providedLabels = labels;
  setLabels();
};

if (port) {
  port.onmessage = onMessage;
  port.start();
  port.postMessage({ kind: "ready" });
}
if (hooks && typeof hooks.onReady === "function") hooks.onReady(cleanup);
