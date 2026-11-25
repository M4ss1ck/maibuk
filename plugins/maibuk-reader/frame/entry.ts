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

import {
  mountApp,
  DEFAULT_APPEARANCE,
  type ChromeLabels,
  type ChromeState,
  type FrameBridge,
} from "./app";
import { createArchive, DocumentError } from "./archive";
import { createComic } from "./comic";
import { createContents, documentOutline } from "./contents";
import { createFind } from "./find";
import { createFlow, textNodes, type FlowAnchor } from "./flow";
import { hooks, positionDebounceMs } from "./hooks";
import { createMeta } from "./meta";
import { createPdf, MAX_CACHED_PAGES } from "./pdf";
import { createPosition } from "./position";
import { createFrameProtocol, errorCode, type FrameOpenMessage } from "./protocol";
import type {
  Appearance,
  FrameEntry,
  FrameFoliate,
  FrameLabels,
  FrameZoom,
  PagePosition,
  ReaderSettings,
  ReadingPosition,
} from "./types";

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
  pdf: () => pdf.document(),
  document: () => currentDocument,
  format: () => documentFormat,
  comicFiles: () => comic.files(),
  archive,
  isPageMode,
  mediaTypeFor: (name) => sanitizer.mediaTypeFor(name),
});
/* The Reading Position: the message each view reports, debounced once the author
   settles. */
const positionEngine = createPosition({
  post,
  debounceMs: positionDebounceMs,
  hasDocument,
  flowing: () => mode === "flow",
  flow: () => flowEngine.state(),
  flowCfi: () => flowEngine.flowCfi(),
  sections: () => (currentDocument ? currentDocument.sections.length : null),
  pageIndex: () => pageIndex,
  zoom: () => zoomSetting,
  pdfPageCount: () => pdf.pageCount(),
});
/* The Preact app draws the search bar, the Contents panel, and its tree; the
   Frame adopts those elements once the app mounts, before any Document opens,
   so the non-React engines keep their element accessors. */
let searchBar: HTMLElement | null = null;
let searchInput: HTMLInputElement | null = null;
let searchStatus: HTMLElement | null = null;
let searchPreviousButton: HTMLElement | null = null;
let searchNextButton: HTMLElement | null = null;
let searchCloseButton: HTMLElement | null = null;
let contentsPanel: HTMLElement | null = null;
let contentsTree: HTMLElement | null = null;
const viewer = el("viewer");
const stage = el("stage");

/* The Contents panel: the outline tree, its keyboard navigation, and where its
   entries land. */
const contents = createContents({
  panel: () => contentsPanel,
  // The app owns the toolbar toggle's aria-expanded and post-close focus.
  button: () => null,
  tree: () => contentsTree,
  t: (key) => t(key),
  pdf: () => pdf.document(),
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
  // The app owns the toolbar toggle's post-close focus.
  toggle: () => null,
  nextButton: () => searchNextButton,
  previousButton: () => searchPreviousButton,
  closeButton: () => searchCloseButton,
  t: (key, values) => t(key, values),
  flowing: () => mode === "flow",
  destroyed: () => destroyed,
  pdf: () => pdf.document(),
  document: () => currentDocument,
  foliate: () => foliate,
  flow: () => flowEngine.state(),
  pages: () => pdf.pages(),
  stage: () => stage,
  textNodes,
  now: () => nowMs(),
  goToPage,
  loadFlowSection,
  applyFlowPage,
  pageForCharOffset,
  schedulePosition: () => positionEngine.schedule(),
});

/* The Comic view: a CBZ's pages, the neighbours prefetched around the one on
   screen, and the page cache that keeps them. */
const comic = createComic({
  archive,
  mediaTypeFor: (name) => sanitizer.mediaTypeFor(name),
  title: () => (entry ? entry.title : ""),
  documentOpen: () => currentDocument != null,
  destroyed: () => destroyed,
  generation: () => viewGeneration,
  beginGeneration: () => ++viewGeneration,
  pageIndex: () => pageIndex,
  zoom: () => zoomSetting,
  stage: () => stage,
  viewer: () => viewer,
  setScale: (scale) => {
    currentScale = scale;
  },
  updateIndicator,
  schedulePosition: () => positionEngine.schedule(),
  showZoom: (scale) => {
    bridge.setZoomLevel(t("zoomLevel", { percent: Math.round(scale * 100) }));
  },
  fail: (error) => failDocument(error),
  maxCachedPages: MAX_CACHED_PAGES,
});

let language = "en";
let appearance: Appearance = DEFAULT_APPEARANCE;
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

let pageIndex = 0;
let zoomSetting: FrameZoom = "width";
let currentScale = 1;
let destroyed = false;
let viewGeneration = 0;
let resizeTimer = 0;
let passwordResolver: ((value: string | undefined) => void) | null = null;

/* Documents: foliate's parsers, the archive, and the three views. */
let foliate: any = null;
let purify: any = null;
let currentDocument: any = null;
let mode: "pdf" | "flow" | "fixed" | "comic" = "pdf";
let documentFormat: string = "";

let wheelCarry = 0;
let lastWheelAt = 0;
let wheelTurned = false;

let pageLabels: string[] | null = null;

/* The chrome the Preact app draws: labels, toolbar state, page indicator, zoom
   level, message, and password prompt. `entry.ts` owns the state and hands it
   over the bridge; the app renders it and calls back through the actions. */
let chrome: ChromeState = {
  labels: labelsFromStrings(),
  toolbar: {
    previousDisabled: true,
    nextDisabled: true,
    fitWidthPressed: true,
    fitPagePressed: false,
    layoutPressed: false,
    fullscreenAvailable: fullscreenAvailable(),
    fullscreen: false,
    flowing: false,
  },
  pageIndicator: "",
  zoomLevel: "100%",
  message: { hidden: true, text: "", error: false },
  password: { visible: false, wrong: false },
  surfaces: { contentsOpen: false, findOpen: false, focus: null },
};

const chromeListeners = new Set<(state: ChromeState) => void>();

/** Records the chrome state and hands it to every mounted app listener. */
function publishChrome(next: ChromeState) {
  chrome = next;
  for (const listener of chromeListeners) listener(next);
}

const bridge: FrameBridge = {
  current: () => chrome,
  subscribe(listener) {
    chromeListeners.add(listener);
    return () => {
      chromeListeners.delete(listener);
    };
  },
  setLabels(labels) {
    publishChrome({ ...chrome, labels });
  },
  setToolbar(toolbar) {
    publishChrome({ ...chrome, toolbar });
  },
  setPageIndicator(pageIndicator) {
    publishChrome({ ...chrome, pageIndicator });
  },
  setZoomLevel(zoomLevel) {
    publishChrome({ ...chrome, zoomLevel });
  },
  setMessage(message) {
    publishChrome({ ...chrome, message });
  },
  setPassword(password) {
    publishChrome({ ...chrome, password });
  },
  setSurfaces(surfaces) {
    publishChrome({ ...chrome, surfaces });
  },
  actions: {
    back: () => leave(),
    toggleContents: () => contents.toggle(undefined),
    openFind: () => find.open(),
    zoomIn: () => zoomBy(1.1),
    zoomOut: () => zoomBy(1 / 1.1),
    fitWidth: () => setZoom("width"),
    fitPage: () => setZoom("page"),
    toggleContinuous: () => pdf.toggleContinuous(),
    toggleFullscreen: () => toggleFullscreen(),
    previousPage: () => previousPage(),
    nextPage: () => nextPage(),
    submitPassword: (value) => onPasswordSubmit(value),
  },
};

/* The engines toggle their surface's `hidden` themselves; the observer turns
   that DOM state into chrome the app draws (aria-expanded, the bar's
   visibility), whether the close came from the app, Escape, or the tree. */
let surfacesObserver: MutationObserver | null = null;
let focusToken = 0;

/** Reads the two surfaces' current visibility from the DOM. */
function surfacesFromDom() {
  return {
    contentsOpen: Boolean(contentsPanel && !contentsPanel.hidden),
    findOpen: Boolean(searchBar && !searchBar.hidden),
  };
}

/**
 * Publishes the surfaces' DOM state to the app, when it differs. A surface
 * that just closed asks the app to put focus back on its toolbar toggle,
 * unless the close is a silent reset (`suppressFocus`).
 */
function publishSurfaces(options: { suppressFocus?: boolean } = {}) {
  const open = surfacesFromDom();
  const before = chrome.surfaces;
  if (open.contentsOpen === before.contentsOpen && open.findOpen === before.findOpen) return;
  let focus = before.focus;
  if (!options.suppressFocus) {
    if (before.contentsOpen && !open.contentsOpen) {
      focus = { target: "contents", token: ++focusToken };
    } else if (before.findOpen && !open.findOpen) {
      focus = { target: "find", token: ++focusToken };
    }
  }
  bridge.setSurfaces({ ...open, focus });
}

/** Adopts the elements the app just drew and observes their visibility. */
function adoptSurfaces() {
  searchBar = el("search-bar");
  searchInput = el("search-input") as HTMLInputElement | null;
  searchStatus = el("search-status");
  searchPreviousButton = el("search-previous");
  searchNextButton = el("search-next");
  searchCloseButton = el("search-close");
  contentsPanel = el("contents");
  contentsTree = el("contents-tree");
  publishSurfaces();
  surfacesObserver?.disconnect();
  surfacesObserver = new MutationObserver(() => publishSurfaces());
  for (const node of [contentsPanel, searchBar]) {
    if (node) surfacesObserver.observe(node, { attributes: true, attributeFilter: ["hidden"] });
  }
}

/** Hides the message area, keeping its text and tone for the next failure. */
function hideMessage() {
  bridge.setMessage({ ...chrome.message, hidden: true });
}

/* The PDF engine: pdf.js through the Worker, the page slots and Continuous
   scroll, the zoom and fit math, and the render cache. */
const pdf = createPdf({
  stage: () => stage,
  viewer: () => viewer,
  settings: () => settings,
  saveSettings: (next) => {
    settings = next;
    post({ kind: "settings", settings });
  },
  requestBytes,
  abortReads: (reason) => protocol.abortReads(reason),
  fileSize: () => fileSize,
  destroyed: () => destroyed,
  generation: () => viewGeneration,
  beginGeneration: () => ++viewGeneration,
  pageIndex: () => pageIndex,
  setPage: (index) => {
    pageIndex = index;
  },
  zoom: () => zoomSetting,
  setZoomSetting: (zoom) => {
    zoomSetting = zoom;
  },
  setScale: (scale) => {
    currentScale = scale;
  },
  updateIndicator,
  updateControls,
  updateFindStatus: () => find.updateStatus(),
  revealPdfMatch: () => find.revealPdfMatch(),
  paintPdfMatches: (container, index) => find.paintPdfMatches(container, index),
  schedulePosition: () => positionEngine.schedule(),
  showZoom: (percent) => {
    bridge.setZoomLevel(t("zoomLevel", { percent }));
  },
  showOutline: (outline) => contents.show(outline),
  setPageLabels: (labels) => {
    pageLabels = labels;
  },
  showStage: () => {
    stage.hidden = false;
    hideMessage();
    bridge.setPassword({ visible: false, wrong: false });
  },
  sendMeta: () => {
    void meta.send();
  },
  passwordOpen: () => chrome.password.visible,
  requestPassword,
  handleLoadError,
});

function t(key: string, values?: Record<string, string | number>): string {
  const base = STRINGS[language.split(/[-_]/)[0]] || STRINGS.en;
  const merged = Object.assign({}, base, providedLabels || {});
  const template = typeof merged[key] === "string" ? merged[key] : key;
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : ""
  );
}

/** The label strings the Preact toolbar, search bar, and prompts draw. */
function labelsFromStrings(): ChromeLabels {
  return {
    back: t("back"),
    contents: t("contents"),
    find: t("find"),
    previousPage: t("previousPage"),
    nextPage: t("nextPage"),
    zoomIn: t("zoomIn"),
    zoomOut: t("zoomOut"),
    increaseFontSize: t("increaseFontSize"),
    decreaseFontSize: t("decreaseFontSize"),
    fitWidth: t("fitWidth"),
    fitPage: t("fitPage"),
    continuousScroll: t("continuousScroll"),
    fullScreen: t("fullScreen"),
    exitFullScreen: t("exitFullScreen"),
    passwordTitle: t("passwordTitle"),
    passwordLabel: t("passwordLabel"),
    passwordSubmit: t("passwordSubmit"),
    passwordWrong: t("passwordWrong"),
    searchPlaceholder: t("searchPlaceholder"),
    searchNext: t("searchNext"),
    searchPrevious: t("searchPrevious"),
    searchClose: t("searchClose"),
  };
}

function setLabels() {
  document.documentElement.lang = language;
  bridge.setLabels(labelsFromStrings());
  updateIndicator();
  if (searchBar && !searchBar.hidden) find.updateStatus();
}

/** The Preact app's appearance listeners; nothing else redraws with it. */
const appearanceListeners = new Set<(next: Appearance) => void>();

/** Records Maibuk's appearance and redraws the Preact app in it. */
function applyAppearance(next: Appearance) {
  appearance = next;
  for (const listener of appearanceListeners) listener(next);
}

/** Hands the Preact app every appearance change; returns its unsubscribe. */
function subscribeAppearance(listener: (next: Appearance) => void): () => void {
  appearanceListeners.add(listener);
  return () => appearanceListeners.delete(listener);
}

/** Whether the shown page is the first and the last one. */
function pageBounds() {
  const doc = pdf.document();
  if (doc) return { first: pageIndex <= 0, last: pageIndex >= doc.numPages - 1 };
  const flow = flowEngine.state();
  if (mode === "flow" && flow && currentDocument) {
    return {
      first: flow.index <= 0 && flow.pageIndex <= 0,
      last: flow.index >= currentDocument.sections.length - 1 && flow.pageIndex >= flow.pages - 1,
    };
  }
  if (mode === "comic")
    return { first: pageIndex <= 0, last: pageIndex >= comic.files().length - 1 };
  if (currentDocument) {
    return { first: pageIndex <= 0, last: pageIndex >= currentDocument.sections.length - 1 };
  }
  return { first: true, last: true };
}

/** Brings the toolbar in line with the open Document and where the author is. */
function updateControls() {
  const open = hasDocument();
  const doc = pdf.document();
  const bounds = pageBounds();
  const flowing = mode === "flow" && !doc;
  document.body.dataset.mode = doc ? "pdf" : open ? mode : "";
  bridge.setToolbar({
    previousDisabled: !open || bounds.first,
    nextDisabled: !open || bounds.last,
    fitWidthPressed: zoomSetting === "width",
    fitPagePressed: zoomSetting === "page",
    layoutPressed: pdf.isContinuous(),
    fullscreenAvailable: fullscreenAvailable(),
    fullscreen,
    flowing,
  });
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

/** Whether any Document is open, PDF or document. */
function hasDocument() {
  return Boolean(pdf.document() || currentDocument);
}

/** Whether the current Document turns whole pages rather than columns. */
function isPageMode() {
  return Boolean(pdf.document()) || mode === "fixed" || mode === "comic";
}

/* Messaging ------------------------------------------------------------- */

/** Hands one port message to the protocol client, which settles or dispatches it. */
function onMessage(event: MessageEvent) {
  protocol.receive(event.data);
}

/* Opening --------------------------------------------------------------- */

async function handleOpen(message: FrameOpenMessage) {
  entry = message.entry || null;
  position = message.position || null;
  settings = message.settings || settings;
  fileSize = typeof message.size === "number" ? message.size : 0;
  providedLabels = message.labels || null;
  language = typeof message.language === "string" ? message.language : language;
  applyAppearance(message.appearance);
  setLabels();
  resetDocument();
  if (!entry) {
    showMessage(t("empty"), false);
    return;
  }
  if (message.pdf && message.pdfPort) {
    await pdf.open(message.pdf, message.pdfPort, position);
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
  bridge.setPageIndicator("");
  bridge.setMessage({ hidden: true, text: "", error: false });
  bridge.setPassword({ visible: false, wrong: false });
  if (stage) stage.hidden = true;
  find.close(false);
  // Opening another Document closes the bar without moving focus.
  publishSurfaces({ suppressFocus: true });
}

/* Documents: archive, parsers, Flowing and Page views ----------------------- */
const sanitizer = (globalThis as any).ReaderSanitizer;
const FB2_MAX_BYTES = 20 * 1024 * 1024;

/* The Flowing engine: one sanitized section at a time, its columns, the CFI and
   character offsets they report, and the Page view a pre-paginated EPUB draws
   with the same renderer. */
const flowEngine = createFlow({
  stage: () => stage,
  viewer: () => viewer,
  document: () => currentDocument,
  foliate: () => foliate,
  format: () => documentFormat,
  settings: () => settings,
  saveSettings: (next) => {
    settings = next;
    post({ kind: "settings", settings });
  },
  sanitizer,
  purify: () => purify,
  archive,
  hasDocument,
  flowing: () => mode === "flow",
  destroyed: () => destroyed,
  generation: () => viewGeneration,
  beginGeneration: () => ++viewGeneration,
  pageIndex: () => pageIndex,
  zoom: () => zoomSetting,
  setScale: (scale) => {
    currentScale = scale;
  },
  updateIndicator,
  updateFindStatus: () => find.updateStatus(),
  highlightFlow: () => find.highlightFlow(),
  schedulePosition: () => positionEngine.schedule(),
  showZoom: (percent) => {
    bridge.setZoomLevel(t("zoomLevel", { percent }));
  },
});

/* The Flowing view's navigation, routed to the engine under the names Find and
   Contents already take. */
function loadFlowSection(index: number, page?: number, anchor?: FlowAnchor | null) {
  return flowEngine.loadFlowSection(index, page, anchor);
}

function applyFlowPage(page: number) {
  flowEngine.applyFlowPage(page);
}

function pageForCharOffset(doc: Document, offset: number) {
  return flowEngine.pageForCharOffset(doc, offset);
}

async function goToFlowSection(index: number, anchor?: unknown) {
  await flowEngine.goToFlowSection(index, (anchor as FlowAnchor | null) ?? null);
}

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
      currentDocument = comic.load();
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
    hideMessage();
    bridge.setPassword({ visible: false, wrong: false });
    const fixed = format === "cbz" || currentDocument.rendition?.layout === "pre-paginated";
    if (format === "cbz") {
      mode = "comic";
      pageIndex = saved && saved.kind === "page" ? Math.max(0, Math.floor(saved.page)) : 0;
      zoomSetting =
        saved && typeof (saved as PagePosition).zoom !== "undefined"
          ? (saved as PagePosition).zoom
          : settings.pdfFit;
      pageIndex = clamp(pageIndex, 0, Math.max(0, comic.files().length - 1));
      await comic.render();
    } else if (fixed) {
      mode = "fixed";
      pageIndex = saved && saved.kind === "page" ? Math.max(0, Math.floor(saved.page)) : 0;
      zoomSetting =
        saved && typeof (saved as PagePosition).zoom !== "undefined"
          ? (saved as PagePosition).zoom
          : settings.pdfFit;
      pageIndex = clamp(pageIndex, 0, Math.max(0, currentDocument.sections.length - 1));
      await flowEngine.renderFixedPage();
    } else {
      mode = "flow";
      const start = flowEngine.flowStart(saved);
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

/* Time ------------------------------------------------------------------ */
/** The clock the Flowing search slices by and the wheel gesture measures, testable through `hooks`. */
function nowMs(): number {
  if (hooks && typeof hooks.now === "function") return hooks.now();
  return performance.now();
}

/** Updates the page indicator for the Document now shown. */
function updateIndicator() {
  updateControls();
  const doc = pdf.document();
  if (doc) {
    const number = pageIndex + 1;
    const count = doc.numPages;
    const label =
      pageLabels && typeof pageLabels[pageIndex] === "string" ? pageLabels[pageIndex] : "";
    bridge.setPageIndicator(
      label !== "" && label !== String(number)
        ? t("pageLabeled", { label, page: number, count })
        : t("pageOf", { page: number, count })
    );
    return;
  }
  const flow = flowEngine.state();
  if (mode === "flow" && flow) {
    bridge.setPageIndicator(
      t("sectionPage", {
        page: flow.pageIndex + 1,
        count: flow.pages,
      })
    );
    return;
  }
  if (currentDocument) {
    bridge.setPageIndicator(
      t("pageOf", {
        page: pageIndex + 1,
        count: currentDocument.sections.length,
      })
    );
  }
}

/** In Continuous scroll, the PDF engine syncs the current page to the scroll. */
function onViewerScroll() {
  pdf.handleScroll();
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
  if (pdf.isContinuous()) return;
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
  pdf.clearCache();
  archive.revoke();
  comic.clearCache();
  protocol.abortArchive("Reader closed");
  if (currentDocument && typeof currentDocument.destroy === "function") {
    try {
      currentDocument.destroy();
    } catch {
      /* Already gone. */
    }
  }
  currentDocument = null;
  flowEngine.reset();
  comic.reset();
  archive.reset();
  protocol.abortReads("Reader closed");
  pdf.destroy();
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
  if (pdf.isOpen()) {
    pdf.goToPage(index, options);
    return;
  }
  if (!currentDocument || mode === "flow") return;
  const next = clamp(Math.floor(index), 0, Math.max(0, currentDocument.sections.length - 1));
  if (next === pageIndex) return;
  pageIndex = next;
  updateIndicator();
  positionEngine.schedule();
  if (mode === "comic") void comic.render();
  else void flowEngine.renderFixedPage();
  find.updateStatus();
}

function nextPage() {
  if (pdf.isOpen()) {
    goToPage(pageIndex + 1);
    return;
  }
  if (mode === "flow") {
    flowEngine.nextFlowPage();
    return;
  }
  goToPage(pageIndex + 1);
}

function previousPage(options?: { atEnd?: boolean }) {
  if (pdf.isOpen()) {
    goToPage(pageIndex - 1, options);
    return;
  }
  if (mode === "flow") {
    flowEngine.previousFlowPage();
    return;
  }
  goToPage(pageIndex - 1, options);
}

function setZoom(next: FrameZoom) {
  if (!hasDocument()) return;
  zoomSetting = next;
  positionEngine.schedule();
  if (pdf.isOpen()) {
    void pdf.rebuild();
  } else if (mode === "comic") {
    void comic.render();
  } else if (mode === "fixed") {
    void flowEngine.renderFixedPage();
  }
  updateControls();
}

function zoomBy(factor: number) {
  if (mode === "flow") {
    flowEngine.stepFontSize(factor > 1 ? 10 : -10);
    return;
  }
  if (!hasDocument()) return;
  const baseScale = currentScale > 0 ? currentScale : 1;
  setZoom(clamp(baseScale * factor, 0.5, 4));
}

/* Password and errors --------------------------------------------------- */
function showPassword(wrong: boolean) {
  stage.hidden = true;
  hideMessage();
  bridge.setPassword({ visible: true, wrong });
}

/** Asks for the password the PDF engine needs, resolving with what was submitted. */
function requestPassword(wrong: boolean): Promise<string | undefined> {
  showPassword(wrong);
  return new Promise((resolve) => {
    passwordResolver = resolve;
  });
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
  bridge.setPassword({ visible: false, wrong: false });
  bridge.setMessage({ hidden: false, text: message, error: true });
  post({ kind: "load-error", code, reason: message });
}

function showMessage(message: string, isError: boolean) {
  stage.hidden = true;
  bridge.setPassword({ visible: false, wrong: false });
  bridge.setMessage({ hidden: false, text: message, error: isError });
}

/** Takes the password the prompt submitted and hands it to a waiting engine. */
function onPasswordSubmit(value: string) {
  bridge.setPassword({ visible: false, wrong: false });
  if (passwordResolver) {
    const resolve = passwordResolver;
    passwordResolver = null;
    resolve(value);
    return;
  }
  // No request is waiting: the form was shown outside a load, so retry one.
  pdf.retry(value);
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
      if (pdf.isOpen()) goToPage(pdf.pageCount() - 1);
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
      flowEngine.stepFontSize(10);
      return;
    case "decreaseFontSize":
      flowEngine.stepFontSize(-10);
      return;
    case "toggleContinuousScroll":
      pdf.toggleContinuous();
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
    if (searchBar && !searchBar.hidden) {
      find.close(true);
      return;
    }
    if (contentsPanel && !contentsPanel.hidden) {
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
    if (contentsPanel && contentsPanel.contains(target)) return;
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
      if (pdf.isOpen()) goToPage(pdf.pageCount() - 1);
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
  positionEngine.flush();
  destroyDocument();
  post({ kind: "back" });
}

function onPageHide() {
  positionEngine.flush();
  destroyDocument();
  // Gone without a Back: the Worker releases the pdf.js core it holds for us.
  post({ kind: "closed" });
}

function onResize() {
  if (!hasDocument()) return;
  if (typeof zoomSetting === "number" && pdf.isOpen()) return;
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (pdf.isOpen()) {
      void pdf.rebuild();
    } else if (mode === "flow") {
      const state = flowEngine.state();
      if (state) void flowEngine.repaginateFlow(flowEngine.flowCfi(), state.index, state.pageIndex);
    } else if (mode === "comic") {
      void comic.render();
    } else if (mode === "fixed") {
      void flowEngine.renderFixedPage();
    }
  }, 150);
}

function cleanup() {
  destroyed = true;
  protocol.close();
  positionEngine.stop();
  surfacesObserver?.disconnect();
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

document.addEventListener("keydown", onKeyDown);
window.addEventListener("pagehide", onPageHide);
window.addEventListener("resize", onResize);
viewer.addEventListener("pointerdown", onPointerDown);
viewer.addEventListener("pointerup", onPointerUp);
viewer.addEventListener("wheel", onWheel, { passive: false });
viewer.addEventListener("scroll", onViewerScroll, { passive: true });
window.addEventListener("message", onHostMessage);
updateControls();

/** Mounts the app, then adopts the surfaces it drew and binds the search bar. */
function startApp(root: HTMLElement) {
  mountApp(root, appearance, subscribeAppearance, bridge);
  adoptSurfaces();
  find.bind();
}

/* The Preact app mounts into `#app-root` and draws the appearance, toolbar,
   search bar, Contents panel, message area, and password prompt (#942). */
const appRoot = el("app-root");
if (appRoot) {
  startApp(appRoot);
} else {
  // `#app-root` follows this script in the Frame's HTML, so a fresh parse has
  // not reached it yet; mount once the document is complete.
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      const root = el("app-root");
      if (root) startApp(root);
    },
    { once: true }
  );
}

protocol.onOpen = handleOpen;
protocol.onCommand = runCommand;
protocol.onLanguage = (nextLanguage, labels) => {
  language = nextLanguage;
  if (labels) providedLabels = labels;
  setLabels();
};
protocol.onAppearance = applyAppearance;

if (port) {
  port.onmessage = onMessage;
  port.start();
  port.postMessage({ kind: "ready" });
}
if (hooks && typeof hooks.onReady === "function") hooks.onReady(cleanup);
