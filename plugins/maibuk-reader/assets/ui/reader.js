// @ts-check
/* The Reader Frame's reading surface (#653). The Frame's only host channel is
   `window.maibuk.port`: the Worker sends `open` with the Document, its Reading
   Position, the Reader settings, the file's size, and localized labels. For a
   PDF it also transfers the pdf.js display source, the viewer CSS, and one end
   of a MessageChannel wired to the pdf.js core Worker. For every other format it
   carries foliate's parsers and DOMPurify as source the Frame imports from
   `blob:` URLs.

   The Frame then draws one of three views: pdf.js pages, a Flowing view for a
   reflowable EPUB, MOBI, AZW3, or FB2 (one sanitized section at a time, paged
   with CSS multi-columns), or a Page view for a CBZ or a fixed-layout EPUB
   (one image or pre-paginated section at a time). It answers nothing itself and
   asks the Worker for byte ranges with `read`, and for archive entries with
   `zip-list` / `zip-entry`.

   It is a classic script, not a module: a relative `import` cannot resolve in
   the Frame's opaque origin. pdf.js's display module, foliate's parsers, and
   DOMPurify are imported from `blob:` URLs the `open` message carries, and the
   core Worker is the Worker's business, not the Frame's (the Frame CSP forbids
   `worker-src`).

   The wire shapes mirror `frame-protocol.ts`. Tests inject stubs and layout
   seams through `globalThis.__readerTestHooks`; production never defines it. */

(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the Frame loads this file as a classic script, not a module.
  "use strict";

  /**
   * @typedef {number | "width" | "page"} FrameZoom
   * @typedef {{ kind: "page", page: number, zoom: FrameZoom }} PagePosition
   * @typedef {{ kind: "cfi", cfi: string }} CfiPosition
   * @typedef {{ kind: "section", index: number, fraction: number }} SectionPosition
   * @typedef {PagePosition | CfiPosition | SectionPosition} ReadingPosition
   * @typedef {{ id: string, title: string, author: string, format: string }} FrameEntry
   * @typedef {{ fontSize: number, lineWidth: string, pdfFit: "width" | "page" }} ReaderSettings
   * @typedef {{ displaySource: string, css: string }} FramePdf
   * @typedef {{ source: string, purify: string }} FrameFoliate
   * @typedef {{ name: string, size: number }} FrameZipEntry
   * @typedef {Object} FrameLabels
   * @property {string} back
   * @property {string} contents
   * @property {string} contentsEmpty
   * @property {string} find
   * @property {string} searchPlaceholder
   * @property {string} searchNext
   * @property {string} searchPrevious
   * @property {string} searchClose
   * @property {string} searchNoMatches
   * @property {string} searchMatches
   * @property {string} pageOf
   * @property {string} pageLabeled
   * @property {string} zoomIn
   * @property {string} zoomOut
   * @property {string} fitWidth
   * @property {string} fitPage
   * @property {string} zoomLevel
   * @property {string} loading
   * @property {string} empty
   * @property {string} previousPage
   * @property {string} nextPage
   * @property {string} passwordTitle
   * @property {string} passwordLabel
   * @property {string} passwordSubmit
   * @property {string} passwordWrong
   * @property {string} errorCorrupt
   * @property {string} errorEncrypted
   * @property {string} errorUnsupported
   * @property {string} errorGeneric
   * @property {string} errorDrm
   * @property {string} errorDamaged
   * @property {string} errorTooLarge
   * @property {string} sectionPage
   * @property {string} increaseFontSize
   * @property {string} decreaseFontSize
   * @typedef {{ kind: "open", entry: FrameEntry | null, position: ReadingPosition | null, settings: ReaderSettings, size: number, labels: FrameLabels, language: string, pdf?: FramePdf, pdfPort?: MessagePort, foliate?: FrameFoliate }} FrameOpenMessage
   * @typedef {{ kind: "bytes", id: number, buffer: ArrayBuffer }} FrameBytesMessage
   * @typedef {{ kind: "read-error", id: number, code: string }} FrameReadErrorMessage
   * @typedef {{ kind: "command", id: string }} FrameCommandMessage
   * @typedef {{ kind: "language", language: string, labels?: FrameLabels }} FrameLanguageMessage
   * @typedef {{ kind: "zip-list", id: number, entries: FrameZipEntry[] }} FrameZipListMessage
   * @typedef {{ kind: "zip-data", id: number, text?: string, buffer?: ArrayBuffer }} FrameZipDataMessage
   * @typedef {{ kind: "zip-error", id: number, code: "corrupt" | "drm" | "missing" }} FrameZipErrorMessage
   * @typedef {FrameOpenMessage | FrameBytesMessage | FrameReadErrorMessage | FrameCommandMessage | FrameLanguageMessage | FrameZipListMessage | FrameZipDataMessage | FrameZipErrorMessage} WorkerToFrameMessage
   * @typedef {{ index: number, canvas: HTMLCanvasElement, textLayer: HTMLDivElement, page: any, scale: number }} RenderedPage
   */

  const STRINGS = {
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
      sectionPage: "{{page}} of {{count}} in this section",
      increaseFontSize: "Increase font size",
      decreaseFontSize: "Decrease font size",
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
      sectionPage: "{{page}} de {{count}} en esta sección",
      increaseFontSize: "Aumentar tamaño de letra",
      decreaseFontSize: "Reducir tamaño de letra",
    },
  };

  const hooks = /** @type {any} */ (globalThis).__readerTestHooks || null;
  const positionDebounceMs =
    hooks && typeof hooks.positionDebounceMs === "number" ? hooks.positionDebounceMs : 1000;
  const INITIAL_CHUNK_BYTES = 1 << 20;
  const RANGE_CHUNK_BYTES = 1 << 20;
  const MAX_CACHED_PAGES = 5;
  const COVER_MAX_WIDTH = 240;
  const COVER_MAX_BYTES = 50 * 1024;

  /** @param {string} id @returns {any} */
  function el(id) {
    return document.getElementById(id);
  }

  const port = window.maibuk && window.maibuk.port;
  const backButton = el("back");
  const contentsToggle = el("contents-toggle");
  const findToggle = el("find-toggle");
  const zoomOutButton = el("zoom-out");
  const zoomInButton = el("zoom-in");
  const fitWidthButton = el("fit-width");
  const fitPageButton = el("fit-page");
  const zoomLevel = el("zoom-level");
  const pageIndicator = el("page-indicator");
  const searchBar = el("search-bar");
  const searchInput = el("search-input");
  const searchStatus = el("search-status");
  const searchPreviousButton = el("search-previous");
  const searchNextButton = el("search-next");
  const searchCloseButton = el("search-close");
  const contents = el("contents");
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

  let language = "en";
  /** @type {FrameLabels | null} */
  let providedLabels = null;
  /** @type {FrameEntry | null} */
  let entry = null;
  /** @type {ReaderSettings} */
  let settings = { fontSize: 100, lineWidth: "medium", pdfFit: "width" };
  /** @type {ReadingPosition | null} */
  let position = null;
  let fileSize = 0;

  /** @type {any} */
  let pdfjs = null;
  /** @type {any} */
  let pdfDoc = null;
  /** @type {any} */
  let loadingTask = null;
  /** @type {any} */
  let pdfWorker = null;
  /** @type {any} */
  let transport = null;
  /** @type {MessagePort | null} */
  let activePdfPort = null;

  let pageIndex = 0;
  /** @type {FrameZoom} */
  let zoomSetting = "width";
  let currentScale = 1;
  let destroyed = false;
  let viewGeneration = 0;
  let positionTimer = 0;
  let positionDirty = false;
  let metaSent = false;
  let resizeTimer = 0;
  /** @type {((password: string) => void) | null} */
  let passwordCallback = null;

  /* Books: foliate's parsers, the archive, and the three views. */
  /** @type {any} */
  let foliate = null;
  /** @type {any} */
  let purify = null;
  /** @type {any} */
  let book = null;
  /** @type {"pdf" | "flow" | "fixed" | "comic"} */
  let mode = "pdf";
  /** @type {string} */
  let bookFormat = "";
  /** @type {any} */
  let flow = null;
  /** @type {FrameZipEntry[]} */
  let zipEntries = [];
  /** @type {Map<string, FrameZipEntry>} */
  const zipByName = new Map();
  /** @type {Set<string>} */
  const objectUrls = new Set();
  /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void }>} */
  const pendingZip = new Map();
  let nextZipId = 1;
  /** @type {Map<number, string>} */
  const comicCache = new Map();
  /** @type {string[]} */
  let comicFiles = [];
  const FLOW_GAP = 40;

  /** @type {Map<number, RenderedPage>} */
  const pageCache = new Map();
  /** @type {Set<number>} */
  const renderingPages = new Set();
  /** @type {Map<number, { resolve: (bytes: Uint8Array) => void, reject: (error: Error) => void }>} */
  const pendingReads = new Map();
  let nextReadId = 1;

  const search = {
    query: "",
    /** @type {{ page: number, count: number }[]} */
    matches: [],
    index: -1,
    generation: 0,
    running: false,
  };

  /** @type {any[] | null} */
  let outline = null;
  /** @type {string[] | null} */
  let pageLabels = null;

  /** @param {string} key @param {Record<string, string | number>} [values] @returns {string} */
  function t(key, values) {
    const base = STRINGS[language.split(/[-_]/)[0]] || STRINGS.en;
    const merged = Object.assign({}, base, providedLabels || {});
    const template = typeof merged[key] === "string" ? merged[key] : key;
    if (!values) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : ""
    );
  }

  function setLabels() {
    document.documentElement.lang = language;
    if (backButton) {
      backButton.textContent = t("back");
      backButton.setAttribute("aria-label", t("back"));
    }
    if (contentsToggle) {
      contentsToggle.textContent = t("contents");
      contentsToggle.setAttribute("aria-label", t("contents"));
    }
    if (findToggle) {
      findToggle.textContent = t("find");
      findToggle.setAttribute("aria-label", t("find"));
    }
    if (zoomOutButton) {
      zoomOutButton.textContent = "−";
      zoomOutButton.setAttribute("aria-label", t("zoomOut"));
      zoomOutButton.title = t("zoomOut");
    }
    if (zoomInButton) {
      zoomInButton.textContent = "+";
      zoomInButton.setAttribute("aria-label", t("zoomIn"));
      zoomInButton.title = t("zoomIn");
    }
    if (fitWidthButton) {
      fitWidthButton.textContent = t("fitWidth");
      fitWidthButton.setAttribute("aria-label", t("fitWidth"));
    }
    if (fitPageButton) {
      fitPageButton.textContent = t("fitPage");
      fitPageButton.setAttribute("aria-label", t("fitPage"));
    }
    if (searchInput) searchInput.placeholder = t("searchPlaceholder");
    if (searchPreviousButton) {
      searchPreviousButton.textContent = t("searchPrevious");
      searchPreviousButton.setAttribute("aria-label", t("searchPrevious"));
    }
    if (searchNextButton) {
      searchNextButton.textContent = t("searchNext");
      searchNextButton.setAttribute("aria-label", t("searchNext"));
    }
    if (searchCloseButton) {
      searchCloseButton.textContent = t("searchClose");
      searchCloseButton.setAttribute("aria-label", t("searchClose"));
    }
    if (contentsTitle) contentsTitle.textContent = t("contents");
    if (passwordTitle) passwordTitle.textContent = t("passwordTitle");
    if (passwordLabel) passwordLabel.textContent = t("passwordLabel");
    if (passwordSubmit) passwordSubmit.textContent = t("passwordSubmit");
    updateIndicator();
    if (searchBar && !searchBar.hidden) updateSearchStatus();
  }

  /** @param {unknown} message @param {Transferable[]} [transfer] */
  function post(message, transfer) {
    if (destroyed || !port) return;
    if (transfer === undefined) port.postMessage(message);
    else port.postMessage(message, transfer);
  }

  /** @param {unknown} value @param {number} min @param {number} max @returns {number} */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** @param {unknown} value @returns {value is { name?: unknown, message?: unknown }} */
  function isErrorLike(value) {
    return typeof value === "object" && value !== null;
  }

  /** The uint16 at `offset`, big-endian (PalmDB and MOBI headers). @param {Uint8Array} bytes @param {number} offset */
  function u16be(bytes, offset) {
    return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) >>> 0;
  }

  /** The uint32 at `offset`, big-endian (PalmDB and MOBI headers). @param {Uint8Array} bytes @param {number} offset */
  function u32be(bytes, offset) {
    return (
      (((bytes[offset] ?? 0) << 24) |
        ((bytes[offset + 1] ?? 0) << 16) |
        ((bytes[offset + 2] ?? 0) << 8) |
        (bytes[offset + 3] ?? 0)) >>>
      0
    );
  }

  /** The ASCII text at `offset`, or "" when the bytes are too short. */
  function ascii(bytes, offset, length) {
    if (bytes.length < offset + length) return "";
    let text = "";
    for (let index = offset; index < offset + length; index += 1) {
      text += String.fromCharCode(bytes[index]);
    }
    return text;
  }

  /** Every non-empty text node under `root`, in document order. */
  function textNodes(root) {
    /** @type {Text[]} */
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = /** @type {Text} */ (walker.currentNode);
      if ((node.nodeValue || "").trim() !== "") nodes.push(node);
    }
    return nodes;
  }

  /** Whether any Document is open, PDF or book. */
  function hasDocument() {
    return Boolean(pdfDoc || book);
  }

  /** Whether the current Document turns whole pages rather than columns. */
  function isPageMode() {
    return Boolean(pdfDoc) || mode === "fixed" || mode === "comic";
  }

  /** @param {unknown} error @returns {boolean} */
  function isPasswordError(error) {
    if (!isErrorLike(error)) return false;
    if (error.name === "PasswordException") return true;
    return Boolean(pdfjs && pdfjs.PasswordException && error instanceof pdfjs.PasswordException);
  }

  /** @param {string} text @param {string} query @returns {number} */
  function countMatches(text, query) {
    if (query === "") return 0;
    const haystack = text.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      count += 1;
      index = haystack.indexOf(needle, index + needle.length);
    }
    return count;
  }

  /* Messaging ------------------------------------------------------------- */

  /** @param {MessageEvent} event */
  function onMessage(event) {
    const data = /** @type {WorkerToFrameMessage | null} */ (event.data);
    if (!data || typeof data !== "object") return;
    switch (data.kind) {
      case "open":
        void handleOpen(data);
        return;
      case "bytes":
        settleRead(data.id, data.buffer);
        return;
      case "read-error":
        rejectRead(data.id, data.code);
        return;
      case "command":
        runCommand(data.id);
        return;
      case "language":
        if (typeof data.language === "string") {
          language = data.language;
          if (data.labels) providedLabels = data.labels;
          setLabels();
        }
        return;
      case "zip-list":
        settleZip(data.id, { entries: data.entries });
        return;
      case "zip-data":
        settleZip(data.id, { text: data.text, buffer: data.buffer });
        return;
      case "zip-error":
        rejectZip(data.id, data.code);
        return;
      default:
        return;
    }
  }

  /** @param {number} id @param {any} value */
  function settleZip(id, value) {
    const pending = pendingZip.get(id);
    if (!pending) return;
    pendingZip.delete(id);
    pending.resolve(value);
  }

  /** @param {number} id @param {string} code */
  function rejectZip(id, code) {
    const pending = pendingZip.get(id);
    if (!pending) return;
    pendingZip.delete(id);
    const error = new Error(`Reader could not read this archive (${code})`);
    /** @type {any} */ (error).code = code;
    pending.reject(error);
  }

  /** @param {number} id @param {ArrayBuffer} buffer */
  function settleRead(id, buffer) {
    const pending = pendingReads.get(id);
    if (!pending) return;
    pendingReads.delete(id);
    pending.resolve(new Uint8Array(buffer));
  }

  /** @param {number} id @param {string} code */
  function rejectRead(id, code) {
    const pending = pendingReads.get(id);
    if (!pending) return;
    pendingReads.delete(id);
    const error = new Error(`Reader could not read this file (${code})`);
    /** @type {any} */ (error).code = code;
    pending.reject(error);
  }

  /** @param {number} offset @param {number} length @returns {Promise<Uint8Array>} */
  function requestBytes(offset, length) {
    if (length <= 0) return Promise.resolve(new Uint8Array(0));
    const id = nextReadId++;
    return new Promise((resolve, reject) => {
      pendingReads.set(id, { resolve, reject });
      post({ kind: "read", id, offset, length });
    });
  }

  /* Opening --------------------------------------------------------------- */

  /** @param {FrameOpenMessage} message */
  async function handleOpen(message) {
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
      await openBook(message.foliate, position, entry.format);
      return;
    }
    fail("unsupported", t("errorUnsupported"));
  }

  function resetDocument() {
    destroyDocument();
    pageIndex = 0;
    currentScale = 1;
    metaSent = false;
    outline = null;
    pageLabels = null;
    mode = "pdf";
    bookFormat = "";
    search.query = "";
    search.matches = [];
    search.index = -1;
    search.generation += 1;
    if (searchStatus) searchStatus.textContent = "";
    if (pageIndicator) pageIndicator.textContent = "";
    if (contentsTree) contentsTree.textContent = "";
    if (messageElement) {
      messageElement.hidden = true;
      messageElement.textContent = "";
      delete messageElement.dataset.error;
    }
    if (passwordForm) passwordForm.hidden = true;
    if (stage) stage.hidden = true;
    closeSearch(false);
  }

  /**
   * @param {FramePdf} pdf
   * @param {MessagePort} pdfPort
   * @param {ReadingPosition | null} saved
   */
  async function openPdf(pdf, pdfPort, saved) {
    try {
      pdfjs = await importPdfjs(pdf.displaySource);
      injectCss(pdf.css);
      activePdfPort = pdfPort;
      pdfPort.start();
      pdfWorker = new pdfjs.PDFWorker({ port: pdfPort });
      zoomSetting =
        saved && (typeof saved.zoom === "number" || saved.zoom === "width" || saved.zoom === "page")
          ? saved.zoom
          : settings.pdfFit;
      const initialLength = Math.min(fileSize > 0 ? fileSize : 0, INITIAL_CHUNK_BYTES);
      const initial = await requestBytes(0, initialLength);
      transport = new pdfjs.PDFDataRangeTransport(fileSize, initial);
      transport.requestDataRange = (begin, end) => {
        void requestBytes(begin, Math.min(end - begin, RANGE_CHUNK_BYTES))
          .then((bytes) => transport.onDataRange(begin, bytes))
          .catch(() => {
            /* A refused range fails the page render; the Frame reports it once. */
          });
      };
      transport.abort = () => {
        for (const pending of pendingReads.values()) {
          pending.reject(new Error("Reader stopped reading"));
        }
        pendingReads.clear();
      };
      await loadDocument(undefined);
    } catch (error) {
      if (!destroyed) handleLoadError(error);
    }
  }

  /** @param {string} displaySource @returns {Promise<any>} */
  async function importPdfjs(displaySource) {
    if (hooks && typeof hooks.importPdfjs === "function") return hooks.importPdfjs(displaySource);
    const url = URL.createObjectURL(new Blob([displaySource], { type: "text/javascript" }));
    try {
      return await import(/* @vite-ignore */ url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** @param {string} css */
  function injectCss(css) {
    const previous = document.getElementById("reader-pdf-css");
    if (previous) previous.remove();
    const style = document.createElement("style");
    style.id = "reader-pdf-css";
    style.textContent = css;
    document.head.append(style);
  }

  /** @param {string | undefined} password */
  async function loadDocument(password) {
    if (!pdfjs || !transport) return;
    const params = {
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
    if (typeof task === "object" && task !== null) {
      task.onPassword = (updatePassword, reason) => {
        passwordCallback = updatePassword;
        showPassword(reason === 2);
      };
    }
    try {
      pdfDoc = await task.promise;
    } catch (error) {
      if (isPasswordError(error)) {
        showPassword(typeof password === "string");
        return;
      }
      throw error;
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
    try {
      outline = await pdfDoc.getOutline();
    } catch {
      outline = null;
    }
    renderContents();
    const savedIndex = position && position.kind === "page" ? position.page : 0;
    pageIndex = clamp(Math.floor(savedIndex), 0, Math.max(0, pdfDoc.numPages - 1));
    stage.hidden = false;
    messageElement.hidden = true;
    passwordForm.hidden = true;
    updateIndicator();
    await renderCurrent();
    renderNeighbors();
    void sendMeta();
  }

  async function sendMeta() {
    if (metaSent || !pdfDoc) return;
    metaSent = true;
    let info = {};
    try {
      const metadata = await pdfDoc.getMetadata();
      info = metadata && metadata.info ? metadata.info : {};
    } catch {
      info = {};
    }
    /** @type {{ kind: "meta", title?: string, author?: string, pageCount?: number, coverDataUrl?: string }} */
    const message = { kind: "meta", pageCount: pdfDoc.numPages };
    if (typeof info.Title === "string" && info.Title.trim() !== "") message.title = info.Title;
    if (typeof info.Author === "string" && info.Author.trim() !== "") message.author = info.Author;
    try {
      const cover = await makeCover();
      if (cover !== null) message.coverDataUrl = cover;
    } catch {
      /* A cover is optional. */
    }
    post(message);
  }

  /** @returns {Promise<string | null>} */
  async function makeCover() {
    if (!pdfDoc) return null;
    const page = await pdfDoc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1, COVER_MAX_WIDTH / Math.max(1, base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) return null;
    const task = page.render({ canvasContext: context, viewport });
    if (task && task.promise) await task.promise;
    let url = "";
    try {
      url = canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return null;
    }
    if (typeof url !== "string" || !url.startsWith("data:image/jpeg")) return null;
    if (url.length > COVER_MAX_BYTES) return null;
    return url;
  }

  /* Books: archive, parsers, Flowing and Page views ----------------------- */

  const sanitizer = /** @type {any} */ (globalThis).ReaderSanitizer;
  const FB2_MAX_BYTES = 20 * 1024 * 1024;
  const IMAGE_EXTENSIONS = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".webp",
    ".svg",
    ".jxl",
    ".avif",
  ];
  const BOOK_EXTENSIONS = /\.(?:xhtml|html?|xml|css)$/i;

  /** Why a book could not be opened. */
  class BookError extends Error {
    /** @param {"drm" | "corrupt" | "too-large"} code @param {string} message */
    constructor(code, message) {
      super(message);
      this.name = "BookError";
      this.code = code;
    }
  }

  /** Imports foliate's bundled parsers from the `blob:` URL the `open` carries. */
  async function importFoliate(source) {
    if (hooks && typeof hooks.importFoliate === "function") return hooks.importFoliate(source);
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try {
      return await import(/* @vite-ignore */ url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Imports DOMPurify's browser build from the `blob:` URL the `open` carries. */
  async function importPurify(source) {
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
  function purifyFrom(module) {
    return module && module.default ? module.default : module;
  }

  /* Archive access -------------------------------------------------------- */

  /** @returns {Promise<FrameZipEntry[]>} */
  function requestZipList() {
    const id = nextZipId++;
    return new Promise((resolve, reject) => {
      pendingZip.set(id, { resolve, reject });
      post({ kind: "zip-list", id });
    });
  }

  /** @param {string} name @param {"text" | "bytes"} as @returns {Promise<any>} */
  function requestZipEntry(name, as) {
    const id = nextZipId++;
    return new Promise((resolve, reject) => {
      pendingZip.set(id, { resolve, reject });
      post({ kind: "zip-entry", id, name, as });
    });
  }

  /** Lists the archive once and keeps the entry table. */
  async function openZip() {
    if (zipEntries.length > 0) return;
    const response = await requestZipList();
    const list = response && Array.isArray(response.entries) ? response.entries : [];
    zipEntries = list;
    zipByName.clear();
    for (const item of zipEntries) zipByName.set(item.name, item);
  }

  /** @param {string} name @returns {Promise<Uint8Array>} */
  async function zipBytes(name) {
    const data = await requestZipEntry(name, "bytes");
    if (!(data && data.buffer)) throw new BookError("corrupt", `The archive has no ${name}`);
    return new Uint8Array(data.buffer);
  }

  /** @param {string} name @returns {Promise<string | null>} */
  async function zipText(name) {
    try {
      const data = await requestZipEntry(name, "text");
      return typeof data.text === "string" ? data.text : null;
    } catch (error) {
      if (isErrorLike(error) && /** @type {any} */ (error).code === "missing") return null;
      throw error;
    }
  }

  /** @param {string} name @returns {number} */
  function zipSize(name) {
    const item = zipByName.get(name);
    return item ? item.size : 0;
  }

  /** The loader foliate's EPUB parser expects, backed by the Worker's archive. */
  function zipLoader() {
    return {
      loadText: zipText,
      /** @param {string} name */
      loadBlob: async (name) =>
        new Blob([await zipBytes(name)], { type: sanitizer.mediaTypeFor(name) }),
      getSize: zipSize,
    };
  }

  /** Creates a `blob:` URL the Frame owns and revokes when the section changes. */
  function newObjectUrl(blob) {
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return url;
  }

  /** @param {string} path @param {string} type @returns {Promise<string | null>} */
  async function archiveAssetUrl(path, type) {
    if (!path) return null;
    try {
      const bytes = await zipBytes(path);
      return newObjectUrl(new Blob([bytes], { type }));
    } catch {
      return null;
    }
  }

  function revokeObjectUrls() {
    for (const url of objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* The platform may already have dropped it. */
      }
    }
    objectUrls.clear();
  }

  /* Opening books --------------------------------------------------------- */

  /**
   * Opens one non-PDF Document and picks its view: Flowing for reflowable text,
   * Page for a CBZ or a pre-paginated EPUB.
   * @param {FrameFoliate} resources
   * @param {ReadingPosition | null} saved
   * @param {string} format
   */
  async function openBook(resources, saved, format) {
    try {
      foliate = await importFoliate(resources.source);
      purify = purifyFrom(await importPurify(resources.purify));
      bookFormat = format;
      if (format === "epub" || format === "cbz") await openZip();

      if (format === "epub") {
        book = new foliate.EPUB(zipLoader());
        await book.init();
      } else if (format === "cbz") {
        openComic();
      } else if (format === "fb2") {
        if (fileSize > FB2_MAX_BYTES) throw new BookError("too-large", "This file is too large");
        const bytes = await requestBytes(0, fileSize);
        book = await foliate.makeFB2(new Blob([bytes], { type: "application/xml" }));
      } else if (format === "mobi" || format === "azw3") {
        await checkMobiDrm();
        const mobi = new foliate.MOBI({ unzlib: foliate.unzlibSync });
        book = await mobi.open(mobiFile());
      } else {
        fail("unsupported", t("errorUnsupported"));
        return;
      }

      if (destroyed || !book) return;
      outline = bookOutline(book.toc);
      renderContents();
      stage.hidden = false;
      messageElement.hidden = true;
      passwordForm.hidden = true;
      const fixed = format === "cbz" || book.rendition?.layout === "pre-paginated";
      if (format === "cbz") {
        mode = "comic";
        pageIndex = saved && saved.kind === "page" ? Math.max(0, Math.floor(saved.page)) : 0;
        zoomSetting = saved && typeof saved.zoom !== "undefined" ? saved.zoom : settings.pdfFit;
        pageIndex = clamp(pageIndex, 0, Math.max(0, comicFiles.length - 1));
        await renderComicPage();
      } else if (fixed) {
        mode = "fixed";
        pageIndex = saved && saved.kind === "page" ? Math.max(0, Math.floor(saved.page)) : 0;
        zoomSetting = saved && typeof saved.zoom !== "undefined" ? saved.zoom : settings.pdfFit;
        pageIndex = clamp(pageIndex, 0, Math.max(0, book.sections.length - 1));
        await renderFixedPage();
      } else {
        mode = "flow";
        const start = flowStart(saved);
        await loadFlowSection(start.index, start.page, start.anchor);
      }
      void sendBookMeta();
    } catch (error) {
      if (!destroyed) failBook(error);
    }
  }

  /** Maps an open failure to the message the author sees and the Worker stores. */
  function failBook(error) {
    const code =
      isErrorLike(error) && typeof (/** @type {any} */ (error).code) === "string"
        ? /** @type {any} */ (error).code
        : "";
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
    if (fileSize < 100) throw new BookError("corrupt", "This file is too small");
    let head = await requestBytes(0, Math.min(fileSize, 100));
    if (ascii(head, 60, 8) !== "BOOKMOBI") throw new BookError("corrupt", "Not a MOBI file");
    const record = u32be(head, 78);
    const flagOffset = record + 12;
    if (flagOffset + 2 > head.length) {
      head = await requestBytes(0, Math.min(fileSize, flagOffset + 2));
    }
    if (u16be(head, flagOffset) !== 0)
      throw new BookError("drm", "This Document is protected by DRM");
  }

  /** A File-like object whose `slice` reads ranges through the Worker. */
  function mobiFile() {
    return {
      name: entry ? entry.title : "book.mobi",
      size: fileSize,
      /** @param {number} start @param {number} [end] */
      slice(start, end) {
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

  /** A CBZ as a minimal book: one section per image, sorted naturally. */
  function openComic() {
    const collator = new Intl.Collator(undefined, { numeric: true });
    comicFiles = zipEntries
      .map((item) => item.name)
      .filter((name) =>
        IMAGE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
      )
      .sort(collator.compare);
    if (comicFiles.length === 0) throw new BookError("corrupt", "This archive has no images");
    book = {
      metadata: { title: entry ? entry.title : "" },
      sections: comicFiles.map((name) => ({ id: name })),
      toc: comicFiles.map((name) => ({ label: name, href: name })),
      /** @param {string} href */
      resolveHref: (href) => ({ index: comicFiles.indexOf(href) }),
      rendition: { layout: "pre-paginated" },
      destroy() {},
    };
  }

  /** @param {any[] | undefined} items @returns {any[]} */
  function bookOutline(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      title: typeof item.label === "string" ? item.label : "",
      dest: item.href,
      items: bookOutline(item.subitems || item.items),
    }));
  }

  /* Rendering a section --------------------------------------------------- */

  /** Whether the app currently paints a dark scheme. */
  function isDark() {
    try {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue("--maibuk-color-scheme")
        .trim()
        .toLowerCase();
      return value === "dark" || document.documentElement.dataset.theme === "dark";
    } catch {
      return false;
    }
  }

  /**
   * Parses, sanitizes, and rewrites one section, then draws its body inside a
   * shadow root. The parsed Document stays alive so CFIs can be computed from
   * it after the shadow copy has been highlighted.
   * @param {any} section
   * @param {{ fixed?: boolean }} [options]
   */
  async function renderSection(section, options) {
    const doc = await section.createDocument();
    // The viewport meta is captured before sanitizing, because DOMPurify
    // removes `meta` along with every other element that can restyle the Frame.
    const viewport = fixedViewport(doc);
    sanitizer.sanitizeDocument(doc, purify);
    await sanitizer.rewriteDocument(doc, {
      base: typeof section.id === "string" ? section.id : "",
      assetUrl: archiveAssetUrl,
      assetText: zipText,
    });
    const body = doc.body || doc.querySelector("body") || doc.documentElement;

    const host = document.createElement("div");
    host.className = "reader-book";
    host.dataset.section = String(book && book.sections ? book.sections.indexOf(section) : 0);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = sanitizer.readingCss(settings, { dark: isDark() });
    if (options && options.fixed) {
      style.textContent +=
        "\n:host { display: block; width: 100%; height: 100%; overflow: hidden; }" +
        "\n.reader-flow { max-width: none; width: 100%; height: 100%; margin: 0; }";
    }
    shadow.append(style);
    for (const element of Array.from(doc.querySelectorAll("style"))) {
      shadow.append(element.cloneNode(true));
    }

    const content = document.createElement("div");
    content.className = "reader-flow";
    for (const child of Array.from(body.childNodes)) content.append(child.cloneNode(true));
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

  /** @param {HTMLElement} columns @param {number} pageWidth @param {number} sectionIndex */
  function flowPageCount(columns, pageWidth, sectionIndex) {
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
   * @param {number} index
   * @param {number} [targetPage]
   * @param {((doc: Document) => Range | null) | null} [anchor]
   */
  async function loadFlowSection(index, targetPage, anchor) {
    if (!book) return;
    const section = book.sections[index];
    if (!section) return;
    const generation = ++viewGeneration;
    revokeObjectUrls();
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
    highlightFlow();
  }

  /** @param {number} page */
  function applyFlowPage(page) {
    if (!flow) return;
    flow.pageIndex = clamp(Math.floor(page), 0, Math.max(0, flow.pages - 1));
    flow.columns.style.transform = `translateX(-${flow.pageIndex * (flow.pageWidth + flow.gap)}px)`;
    updateIndicator();
    updateSearchStatus();
  }

  function nextFlowPage() {
    if (!flow) return;
    if (flow.pageIndex + 1 < flow.pages) {
      applyFlowPage(flow.pageIndex + 1);
      schedulePosition();
      return;
    }
    if (flow.index + 1 < book.sections.length) {
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

  /** @param {number} index @param {any} [anchor] */
  async function goToFlowSection(index, anchor) {
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
    if (!foliate || !flow || bookFormat !== "epub") return null;
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

  /** The total length of `nodes`' text. @param {Text[]} nodes */
  function textLength(nodes) {
    let total = 0;
    for (const node of nodes) total += (node.nodeValue || "").length;
    return total;
  }

  /** A collapsed range at `offset` through the body's text. */
  function rangeForCharOffset(doc, body, offset) {
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
  function pageForDocRange(range) {
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

  /** @param {number} offset */
  function pageForCharOffset(doc, offset) {
    if (!flow) return 0;
    const range = rangeForCharOffset(doc, flow.body, offset);
    return range ? pageForDocRange(range) : 0;
  }

  /** The Reading Position a Flowing Document resumes at. */
  function flowStart(saved) {
    if (saved && saved.kind === "cfi" && book && typeof book.resolveCFI === "function") {
      try {
        const resolved = book.resolveCFI(saved.cfi);
        if (resolved && typeof resolved.index === "number" && resolved.index >= 0) {
          return { index: resolved.index, page: 0, anchor: resolved.anchor };
        }
      } catch {
        /* Fall through to the first section. */
      }
    }
    if (saved && saved.kind === "section") {
      return {
        index: clamp(Math.floor(saved.index), 0, Math.max(0, book.sections.length - 1)),
        page: 0,
      };
    }
    return { index: 0, page: 0 };
  }

  /** Re-paginates the current section after a typography change, keeping the CFI. */
  async function repaginateFlow(cfi, sectionIndex, page) {
    if (!book) return;
    let index = typeof sectionIndex === "number" ? sectionIndex : 0;
    let anchor = null;
    if (cfi && typeof book.resolveCFI === "function") {
      try {
        const resolved = book.resolveCFI(cfi);
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

  /** @param {number} delta */
  function stepFontSize(delta) {
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

  /** The `width`/`height` a fixed-layout section declares, or a book default. */
  function fixedViewport(doc) {
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
  function fixedScale(width, height) {
    const availableWidth = viewer.clientWidth > 32 ? viewer.clientWidth - 32 : 800;
    const availableHeight = viewer.clientHeight > 32 ? viewer.clientHeight - 32 : 600;
    const fit = Math.min(availableWidth / width, availableHeight / height);
    if (typeof zoomSetting === "number") return clamp(zoomSetting, 0.25, 4);
    if (zoomSetting === "width") return clamp(availableWidth / width, 0.1, 4);
    return clamp(fit, 0.1, 4);
  }

  async function renderFixedPage() {
    if (!book) return;
    const section = book.sections[pageIndex];
    if (!section) return;
    const generation = ++viewGeneration;
    revokeObjectUrls();
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

  /** @param {number} index @returns {Promise<string | null>} */
  async function comicUrl(index) {
    const cached = comicCache.get(index);
    if (cached) return cached;
    const name = comicFiles[index];
    if (!name) return null;
    const bytes = await zipBytes(name);
    const url = URL.createObjectURL(new Blob([bytes], { type: sanitizer.mediaTypeFor(name) }));
    comicCache.set(index, url);
    return url;
  }

  async function renderComicPage() {
    if (!book) return;
    const generation = ++viewGeneration;
    const index = pageIndex;
    let url = null;
    try {
      url = await comicUrl(index);
    } catch (error) {
      if (!destroyed && generation === viewGeneration) failBook(error);
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

  /* Book metadata and covers ---------------------------------------------- */

  /** A metadata value as plain text: a string, a language map, or contributors. */
  function textOf(value) {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) {
      return value
        .map(textOf)
        .filter((part) => part !== "")
        .join(", ");
    }
    if (value && typeof value === "object") {
      if ("name" in value) return textOf(/** @type {any} */ (value).name);
      const values = Object.values(value);
      if (values.length > 0) return textOf(values[0]);
    }
    return "";
  }

  async function sendBookMeta() {
    if (metaSent || !book) return;
    metaSent = true;
    const metadata = book.metadata || {};
    /** @type {{ kind: "meta", title?: string, author?: string, pageCount?: number, coverDataUrl?: string }} */
    const message = { kind: "meta" };
    const title = textOf(metadata.title);
    const author = textOf(metadata.author);
    if (title !== "") message.title = title;
    if (author !== "") message.author = author;
    if (isPageMode()) message.pageCount = book.sections.length;
    try {
      const cover = await bookCover();
      if (cover !== null) message.coverDataUrl = cover;
    } catch {
      /* A cover is optional. */
    }
    post(message);
  }

  /** The cover image as a small JPEG data URL, or null. */
  async function bookCover() {
    if (!book) return null;
    let blob = null;
    try {
      if (bookFormat === "cbz") {
        const bytes = await zipBytes(comicFiles[0]);
        blob = new Blob([bytes], { type: sanitizer.mediaTypeFor(comicFiles[0]) });
      } else if (typeof book.getCover === "function") {
        blob = await book.getCover();
      }
    } catch {
      return null;
    }
    if (!(blob instanceof Blob)) return null;
    return await coverDataUrl(blob);
  }

  /** @param {Blob} blob @returns {Promise<string | null>} */
  async function coverDataUrl(blob) {
    let bitmap = null;
    try {
      if (typeof createImageBitmap === "function") {
        bitmap = await createImageBitmap(blob);
      } else {
        bitmap = await loadImage(blob);
      }
    } catch {
      return null;
    }
    if (!bitmap) return null;
    const width = bitmap.width || 1;
    const height = bitmap.height || 1;
    const scale = Math.min(1, COVER_MAX_WIDTH / Math.max(1, width));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let url = "";
    try {
      url = canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return null;
    }
    if (typeof url !== "string" || !url.startsWith("data:image/jpeg")) return null;
    if (url.length > COVER_MAX_BYTES) return null;
    return url;
  }

  /** Decodes an image Blob through an `<img>`, for platforms without `createImageBitmap`. */
  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("The cover image will not decode"));
      };
      image.src = url;
    });
  }

  /* Flowing search -------------------------------------------------------- */

  /** @returns {number} */
  function nowMs() {
    if (hooks && typeof hooks.now === "function") return hooks.now();
    return performance.now();
  }

  function yieldToLoop() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** @param {string} query */
  async function runFlowSearch(query) {
    if (!book || !foliate) return;
    const generation = ++search.generation;
    search.query = query;
    search.matches = [];
    search.index = -1;
    search.running = true;
    if (searchStatus) searchStatus.textContent = "";
    let sliceStart = nowMs();
    for (let index = 0; index < book.sections.length; index += 1) {
      if (generation !== search.generation || destroyed) return;
      const section = book.sections[index];
      if (section.linear === "no") continue;
      let text = "";
      try {
        const doc = await section.createDocument();
        const body = doc.body || doc.querySelector("body") || doc.documentElement;
        // Join the same text nodes the Flowing view pages by, so a match's
        // offset still names the same character when the page is computed.
        text = textNodes(body)
          .map((node) => node.nodeValue || "")
          .join("");
      } catch {
        text = "";
      }
      for (const result of foliate.search([text], query, {
        granularity: "grapheme",
        sensitivity: "base",
      })) {
        search.matches.push({ section: index, offset: result.range.startOffset });
      }
      if (nowMs() - sliceStart > 16) {
        if (hooks && typeof hooks.onSearchSlice === "function") hooks.onSearchSlice();
        await yieldToLoop();
        sliceStart = nowMs();
      }
    }
    if (generation !== search.generation || destroyed) return;
    search.running = false;
    if (search.matches.length === 0) {
      if (searchStatus) searchStatus.textContent = t("searchNoMatches");
      return;
    }
    search.index = 0;
    updateSearchStatus();
    await showFlowMatch(search.matches[0]);
  }

  /** @param {{ section: number, offset: number }} match */
  async function showFlowMatch(match) {
    if (!book) return;
    if (!flow || flow.index !== match.section) {
      await loadFlowSection(match.section, 0);
    }
    if (flow && flow.index === match.section) {
      applyFlowPage(pageForCharOffset(flow.doc, match.offset));
      highlightFlow();
      schedulePosition();
    }
  }

  /** @param {boolean} backwards */
  function stepFlowMatch(backwards) {
    if (search.matches.length === 0) return;
    const length = search.matches.length;
    search.index = (search.index + (backwards ? -1 : 1) + length) % length;
    updateSearchStatus();
    void showFlowMatch(search.matches[search.index]);
  }

  function highlightFlow() {
    clearFlowHighlights();
    if (!flow || search.query === "") return;
    const needle = search.query.toLocaleLowerCase();
    for (const node of textNodes(flow.content)) {
      const text = node.nodeValue || "";
      const haystack = text.toLocaleLowerCase();
      let index = haystack.indexOf(needle);
      if (index === -1) continue;
      const fragment = document.createDocumentFragment();
      let last = 0;
      while (index !== -1) {
        fragment.append(text.slice(last, index));
        const mark = document.createElement("mark");
        mark.className = "reader-search-hit";
        mark.textContent = text.slice(index, index + needle.length);
        fragment.append(mark);
        last = index + needle.length;
        index = haystack.indexOf(needle, last);
      }
      fragment.append(text.slice(last));
      node.parentNode?.replaceChild(fragment, node);
    }
  }

  function clearFlowHighlights() {
    if (!flow) return;
    for (const hit of Array.from(flow.shadow.querySelectorAll(".reader-search-hit"))) {
      const parent = hit.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(hit.textContent || ""), hit);
      parent.normalize();
    }
  }

  /* Rendering ------------------------------------------------------------- */

  function updateIndicator() {
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
    if (book) {
      pageIndicator.textContent = t("pageOf", {
        page: pageIndex + 1,
        count: book.sections.length,
      });
    }
  }

  /** @param {{ width: number, height: number }} base @returns {number} */
  function scaleFor(base) {
    if (typeof zoomSetting === "number") return clamp(zoomSetting, 0.5, 4);
    const width = viewer.clientWidth > 0 ? viewer.clientWidth - 32 : base.width;
    const height = viewer.clientHeight > 0 ? viewer.clientHeight - 32 : base.height;
    const byWidth = width / Math.max(1, base.width);
    if (zoomSetting === "page") return Math.min(byWidth, height / Math.max(1, base.height));
    return byWidth;
  }

  async function renderCurrent() {
    if (!pdfDoc) return;
    const generation = ++viewGeneration;
    const index = pageIndex;
    try {
      const rendered = await renderPage(index);
      if (destroyed || generation !== viewGeneration || index !== pageIndex) return;
      showRendered(rendered);
    } catch (error) {
      if (!destroyed && generation === viewGeneration) handleLoadError(error);
    }
  }

  /** @param {number} index @returns {Promise<RenderedPage>} */
  async function renderPage(index) {
    const cached = pageCache.get(index);
    if (cached) {
      pageCache.delete(index);
      pageCache.set(index, cached);
      return cached;
    }
    if (!pdfDoc) throw new Error("No Document open");
    renderingPages.add(index);
    try {
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
      highlightText(textLayer, search.query);
      /** @type {RenderedPage} */
      const rendered = { index, canvas, textLayer, page, scale };
      pageCache.set(index, rendered);
      trimCache();
      return rendered;
    } finally {
      renderingPages.delete(index);
    }
  }

  /** @param {RenderedPage} rendered */
  function showRendered(rendered) {
    stage.textContent = "";
    stage.append(rendered.canvas, rendered.textLayer);
    stage.hidden = false;
    currentScale = rendered.scale;
    if (zoomLevel)
      zoomLevel.textContent = t("zoomLevel", { percent: Math.round(rendered.scale * 100) });
    updateIndicator();
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

  function trimCache() {
    for (const [index, rendered] of pageCache) {
      if (pageCache.size <= MAX_CACHED_PAGES) break;
      if (index === pageIndex) continue;
      pageCache.delete(index);
      rendered.canvas.remove();
      rendered.textLayer.remove();
    }
  }

  function clearCache() {
    for (const rendered of pageCache.values()) {
      rendered.canvas.remove();
      rendered.textLayer.remove();
    }
    pageCache.clear();
  }

  function destroyDocument() {
    viewGeneration += 1;
    search.generation += 1;
    clearCache();
    revokeObjectUrls();
    clearComicCache();
    for (const pending of pendingZip.values()) pending.reject(new Error("Reader closed"));
    pendingZip.clear();
    if (book && typeof book.destroy === "function") {
      try {
        book.destroy();
      } catch {
        /* Already gone. */
      }
    }
    book = null;
    flow = null;
    comicFiles = [];
    zipEntries = [];
    zipByName.clear();
    for (const pending of pendingReads.values()) pending.reject(new Error("Reader closed"));
    pendingReads.clear();
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
    if (stage) {
      stage.textContent = "";
      stage.style.width = "";
      stage.style.height = "";
    }
  }

  /* Navigation, zoom, position ------------------------------------------- */

  /** @param {number} index */
  function goToPage(index) {
    if (pdfDoc) {
      const next = clamp(Math.floor(index), 0, Math.max(0, pdfDoc.numPages - 1));
      if (next === pageIndex) return;
      pageIndex = next;
      updateIndicator();
      schedulePosition();
      void renderCurrent();
      renderNeighbors();
      updateSearchStatus();
      return;
    }
    if (!book || mode === "flow") return;
    const next = clamp(Math.floor(index), 0, Math.max(0, book.sections.length - 1));
    if (next === pageIndex) return;
    pageIndex = next;
    updateIndicator();
    schedulePosition();
    if (mode === "comic") void renderComicPage();
    else void renderFixedPage();
    updateSearchStatus();
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

  function previousPage() {
    if (pdfDoc) {
      goToPage(pageIndex - 1);
      return;
    }
    if (mode === "flow") {
      previousFlowPage();
      return;
    }
    goToPage(pageIndex - 1);
  }

  /** @param {FrameZoom} next */
  function setZoom(next) {
    if (!hasDocument()) return;
    zoomSetting = next;
    schedulePosition();
    if (pdfDoc) {
      clearCache();
      void renderCurrent();
    } else if (mode === "comic") {
      void renderComicPage();
    } else if (mode === "fixed") {
      void renderFixedPage();
    }
  }

  /** @param {number} factor */
  function zoomBy(factor) {
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
    if (book) {
      return {
        kind: "position",
        position: {
          kind: "page",
          page: pageIndex,
          zoom:
            typeof zoomSetting === "number" ? Math.round(zoomSetting * 1000) / 1000 : zoomSetting,
        },
        progress: { page: pageIndex + 1, pageCount: book.sections.length },
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
    if (!flow || !book) return 0;
    const total = Math.max(1, book.sections.length);
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

  /* Contents -------------------------------------------------------------- */

  /** @param {boolean | undefined} [open] */
  function toggleContents(open) {
    const next = typeof open === "boolean" ? open : contents.hidden;
    contents.hidden = !next;
    contentsToggle.setAttribute("aria-expanded", String(next));
    if (next) {
      renderContents();
      const first = treeItems()[0];
      if (first) first.focus();
    } else {
      contentsToggle.focus();
    }
  }

  function renderContents() {
    contentsTree.textContent = "";
    if (!outline || outline.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = t("contentsEmpty");
      contentsTree.append(empty);
      return;
    }
    contentsTree.append(buildOutline(outline));
  }

  /** @param {any[]} items @returns {HTMLUListElement} */
  function buildOutline(items) {
    const list = document.createElement("ul");
    list.setAttribute("role", "group");
    for (const item of items) {
      const li = document.createElement("li");
      li.setAttribute("role", "treeitem");
      li.tabIndex = -1;
      const title = document.createElement("span");
      title.textContent = typeof item.title === "string" ? item.title : "";
      li.append(title);
      if (Array.isArray(item.items) && item.items.length > 0) {
        li.setAttribute("aria-expanded", "true");
        li.append(buildOutline(item.items));
      }
      li.addEventListener("click", (event) => {
        if (event.target !== li && event.target !== title) return;
        void activateOutlineItem(item, li);
      });
      li.addEventListener("keydown", (event) => onTreeItemKey(event, li));
      list.append(li);
    }
    return list;
  }

  /** @returns {HTMLElement[]} */
  function treeItems() {
    return Array.from(contentsTree.querySelectorAll('[role="treeitem"]')).filter((item) =>
      isTreeItemVisible(/** @type {HTMLElement} */ (item))
    );
  }

  /** @param {HTMLElement} item @returns {boolean} */
  function isTreeItemVisible(item) {
    let parent = item.parentElement;
    while (parent && parent !== contentsTree) {
      if (parent.tagName === "UL" && parent.hidden) return false;
      parent = parent.parentElement;
    }
    return true;
  }

  /** @param {HTMLElement} item */
  function focusTreeItem(item) {
    for (const other of treeItems()) other.tabIndex = -1;
    item.tabIndex = 0;
    item.focus();
  }

  /**
   * @param {KeyboardEvent} event
   * @param {HTMLElement} item
   */
  function onTreeItemKey(event, item) {
    const items = treeItems();
    const position = items.indexOf(item);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        if (position >= 0 && position < items.length - 1) focusTreeItem(items[position + 1]);
        return;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        if (position > 0) focusTreeItem(items[position - 1]);
        return;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        if (items.length > 0) focusTreeItem(items[0]);
        return;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        if (items.length > 0) focusTreeItem(items[items.length - 1]);
        return;
      case "ArrowRight": {
        event.preventDefault();
        event.stopPropagation();
        const child = item.querySelector(':scope > ul > [role="treeitem"]');
        if (item.getAttribute("aria-expanded") === "false") {
          item.setAttribute("aria-expanded", "true");
          const group = item.querySelector(":scope > ul");
          if (group) group.hidden = false;
        } else if (child) {
          focusTreeItem(/** @type {HTMLElement} */ (child));
        }
        return;
      }
      case "ArrowLeft": {
        event.preventDefault();
        event.stopPropagation();
        if (item.getAttribute("aria-expanded") === "true") {
          item.setAttribute("aria-expanded", "false");
          const group = item.querySelector(":scope > ul");
          if (group) group.hidden = true;
        } else {
          const parent = item.parentElement && item.parentElement.closest('[role="treeitem"]');
          if (parent) focusTreeItem(/** @type {HTMLElement} */ (parent));
        }
        return;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        if (position >= 0) void activateOutlineItemFromElement(item);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        toggleContents(false);
        return;
      default:
        return;
    }
  }

  /** @param {HTMLElement} item */
  async function activateOutlineItemFromElement(item) {
    const items = outline ? flattenOutline(outline) : [];
    const match = items.find((candidate) => candidate.element === item);
    if (match) await activateOutlineItem(match.item, item);
  }

  /** @param {any[]} items @param {any[]} [into] @returns {{ item: any, element?: HTMLElement }[]} */
  function flattenOutline(items, into) {
    const flat = into || [];
    for (const item of items) {
      flat.push({ item });
      if (Array.isArray(item.items)) flattenOutline(item.items, flat);
    }
    return flat;
  }

  /**
   * @param {any} item
   * @param {HTMLElement} element
   */
  async function activateOutlineItem(item, element) {
    if (pdfDoc) {
      const index = await resolveDestination(item.dest);
      if (index === null) return;
      goToPage(index);
      element.focus();
      return;
    }
    if (!book) return;
    let target = null;
    try {
      target = typeof book.resolveHref === "function" ? book.resolveHref(String(item.dest)) : null;
    } catch {
      target = null;
    }
    if (!target || typeof target.index !== "number" || target.index < 0) return;
    if (mode === "flow") {
      await goToFlowSection(target.index, target.anchor || null);
    } else {
      goToPage(target.index);
    }
    element.focus();
  }

  /** @param {unknown} dest @returns {Promise<number | null>} */
  async function resolveDestination(dest) {
    if (!pdfDoc) return null;
    try {
      if (typeof dest === "string") {
        const resolved = await pdfDoc.getDestination(dest);
        return resolved ? await resolveDestination(resolved) : null;
      }
      if (Array.isArray(dest) && dest.length > 0) {
        const target = dest[0];
        if (typeof target === "string") return await resolveDestination(target);
        if (target && typeof pdfDoc.getPageIndex === "function") {
          return await pdfDoc.getPageIndex(target);
        }
        if (typeof target === "number") return target;
      }
    } catch {
      return null;
    }
    return null;
  }

  /* Search ---------------------------------------------------------------- */

  function openSearch() {
    searchBar.hidden = false;
    searchInput.focus();
    searchInput.select();
    searchInput.value = search.query;
    updateSearchStatus();
  }

  /** @param {boolean} restoreFocus */
  function closeSearch(restoreFocus) {
    if (!searchBar) return;
    searchBar.hidden = true;
    search.query = "";
    search.matches = [];
    search.index = -1;
    search.generation += 1;
    if (searchStatus) searchStatus.textContent = "";
    clearHighlights();
    if (restoreFocus !== false) findToggle.focus();
  }

  /** @param {HTMLElement} container @param {string} query */
  function highlightText(container, query) {
    if (!query) return;
    const needle = query.toLocaleLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    /** @type {Text[]} */
    const nodes = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue && walker.currentNode.nodeValue.trim() !== "") {
        nodes.push(/** @type {Text} */ (walker.currentNode));
      }
    }
    for (const node of nodes) {
      const text = node.nodeValue || "";
      const haystack = text.toLocaleLowerCase();
      let index = haystack.indexOf(needle);
      if (index === -1) continue;
      const fragment = document.createDocumentFragment();
      let last = 0;
      while (index !== -1) {
        fragment.append(text.slice(last, index));
        const mark = document.createElement("span");
        mark.className = "reader-search-hit";
        mark.textContent = text.slice(index, index + needle.length);
        fragment.append(mark);
        last = index + needle.length;
        index = haystack.indexOf(needle, last);
      }
      fragment.append(text.slice(last));
      node.parentNode?.replaceChild(fragment, node);
    }
  }

  function clearHighlights() {
    for (const hit of Array.from(document.querySelectorAll(".reader-search-hit"))) {
      const parent = hit.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(hit.textContent || ""), hit);
      parent.normalize();
    }
    clearFlowHighlights();
  }

  /** @param {string} query */
  async function runSearch(query) {
    if (mode === "flow" && book) {
      await runFlowSearch(query);
      return;
    }
    if (!pdfDoc) return;
    const generation = ++search.generation;
    search.query = query;
    search.matches = [];
    search.index = -1;
    search.running = true;
    if (searchStatus) searchStatus.textContent = "";
    let sliceStart = performance.now();
    for (let index = 0; index < pdfDoc.numPages; index += 1) {
      if (generation !== search.generation || destroyed) return;
      const page = await pdfDoc.getPage(index + 1);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");
      const count = countMatches(text, query);
      if (count > 0) search.matches.push({ page: index, count });
      if (performance.now() - sliceStart > 16) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        sliceStart = performance.now();
      }
    }
    if (generation !== search.generation || destroyed) return;
    search.running = false;
    if (search.matches.length === 0) {
      if (searchStatus) searchStatus.textContent = t("searchNoMatches");
      return;
    }
    search.index = 0;
    updateSearchStatus();
    goToPage(search.matches[0].page);
    const rendered = pageCache.get(search.matches[0].page);
    if (rendered) highlightText(rendered.textLayer, search.query);
  }

  /** @param {boolean} backwards */
  function nextOrRun(backwards) {
    const query = searchInput.value.trim();
    if (query === "") {
      if (searchStatus) searchStatus.textContent = "";
      return;
    }
    if (query !== search.query || search.matches.length === 0) {
      void runSearch(query);
      return;
    }
    stepMatch(backwards);
  }

  /** @param {boolean} backwards */
  function stepMatch(backwards) {
    if (search.matches.length === 0) return;
    if (mode === "flow") {
      stepFlowMatch(backwards);
      return;
    }
    const length = search.matches.length;
    search.index = (search.index + (backwards ? -1 : 1) + length) % length;
    updateSearchStatus();
    goToPage(search.matches[search.index].page);
  }

  function updateSearchStatus() {
    if (!searchStatus || searchBar.hidden) return;
    if (search.matches.length === 0) {
      if (search.query === "" && searchStatus.textContent === t("searchNoMatches")) {
        searchStatus.textContent = "";
      }
      return;
    }
    if (mode === "flow") {
      searchStatus.textContent = t("searchMatches", {
        current: search.index + 1,
        total: search.matches.length,
      });
      return;
    }
    let total = 0;
    let before = 0;
    for (let index = 0; index < search.matches.length; index += 1) {
      total += search.matches[index].count;
      if (index < search.index) before += search.matches[index].count;
    }
    searchStatus.textContent = t("searchMatches", { current: before + 1, total });
  }

  /* Password and errors --------------------------------------------------- */

  /** @param {boolean} wrong */
  function showPassword(wrong) {
    stage.hidden = true;
    messageElement.hidden = true;
    passwordForm.hidden = false;
    passwordError.hidden = !wrong;
    if (wrong) passwordError.textContent = t("passwordWrong");
    passwordInput.value = "";
    passwordInput.focus();
  }

  /** @param {unknown} error */
  function handleLoadError(error) {
    const name = isErrorLike(error) && typeof error.name === "string" ? error.name : "";
    const text = isErrorLike(error) && typeof error.message === "string" ? error.message : "";
    if (name === "PasswordException") {
      showPassword(false);
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

  /** @param {"corrupt" | "encrypted" | "unsupported"} code @param {string} message */
  function fail(code, message) {
    destroyDocument();
    stage.hidden = true;
    passwordForm.hidden = true;
    messageElement.hidden = false;
    messageElement.dataset.error = "true";
    messageElement.textContent = message;
    post({ kind: "load-error", code, reason: message });
  }

  function showMessage(message, isError) {
    stage.hidden = true;
    passwordForm.hidden = true;
    messageElement.hidden = false;
    messageElement.textContent = message;
    if (isError) messageElement.dataset.error = "true";
    else delete messageElement.dataset.error;
  }

  function onPasswordSubmit(event) {
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

  /** @param {string} id */
  function runCommand(id) {
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
        else if (mode === "flow" && book) void goToFlowSection(book.sections.length - 1);
        else if (book) goToPage(book.sections.length - 1);
        return;
      case "findInDocument":
        openSearch();
        return;
      case "toggleContents":
        toggleContents();
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
      case "backToShelf":
        leave();
        return;
      default:
        return;
    }
  }

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (!searchBar.hidden) {
        closeSearch(true);
        return;
      }
      if (!contents.hidden) {
        toggleContents(false);
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
      if (contents.contains(target)) return;
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
        else if (mode === "flow" && book) void goToFlowSection(book.sections.length - 1);
        else if (book) goToPage(book.sections.length - 1);
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
      default:
        return;
    }
  }

  /* Touch ----------------------------------------------------------------- */

  let pointerStart = null;

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY };
  }

  /** @param {PointerEvent} event */
  function onPointerUp(event) {
    if (!pointerStart) return;
    const start = pointerStart;
    pointerStart = null;
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
        clearCache();
        void renderCurrent();
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
    clearTimeout(positionTimer);
    clearTimeout(resizeTimer);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("resize", onResize);
    viewer.removeEventListener("pointerdown", onPointerDown);
    viewer.removeEventListener("pointerup", onPointerUp);
    destroyDocument();
  }

  /* Wiring ---------------------------------------------------------------- */

  setLabels();

  if (backButton) backButton.addEventListener("click", leave);
  if (contentsToggle) contentsToggle.addEventListener("click", () => toggleContents(undefined));
  if (findToggle) findToggle.addEventListener("click", openSearch);
  if (zoomOutButton) zoomOutButton.addEventListener("click", () => zoomBy(1 / 1.1));
  if (zoomInButton) zoomInButton.addEventListener("click", () => zoomBy(1.1));
  if (fitWidthButton) fitWidthButton.addEventListener("click", () => setZoom("width"));
  if (fitPageButton) fitPageButton.addEventListener("click", () => setZoom("page"));
  if (searchPreviousButton) searchPreviousButton.addEventListener("click", () => nextOrRun(true));
  if (searchNextButton) searchNextButton.addEventListener("click", () => nextOrRun(false));
  if (searchCloseButton) searchCloseButton.addEventListener("click", () => closeSearch(true));
  if (searchInput) {
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        nextOrRun(event.shiftKey);
      }
    });
    searchInput.addEventListener("input", () => {
      if (searchInput.value.trim() !== search.query) {
        search.matches = [];
        search.index = -1;
        search.generation += 1;
        if (searchStatus) searchStatus.textContent = "";
      }
    });
  }
  if (passwordForm) passwordForm.addEventListener("submit", onPasswordSubmit);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("resize", onResize);
  viewer.addEventListener("pointerdown", onPointerDown);
  viewer.addEventListener("pointerup", onPointerUp);

  if (port) {
    port.onmessage = onMessage;
    port.start();
    port.postMessage({ kind: "ready" });
  }
  if (hooks && typeof hooks.onReady === "function") hooks.onReady(cleanup);
})();
