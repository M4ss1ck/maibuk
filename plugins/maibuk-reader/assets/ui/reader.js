// @ts-check
/* The Reader Frame's Page view (#653). The Frame's only host channel is
   `window.maibuk.port`: the Worker sends `open` with the Document, its Reading
   Position, the Reader settings, the file's size, and localized labels; for a
   PDF it also transfers the pdf.js display source, the viewer CSS, and one end
   of a MessageChannel wired to the pdf.js core Worker. This script then draws
   one page at a time, answers nothing itself, and asks the Worker for byte
   ranges with `read`.

   It is a classic script, not a module: a relative `import` cannot resolve in
   the Frame's opaque origin. pdf.js's display module is imported from the
   `blob:` URL the `open` message carries, and the core Worker is the Worker's
   business, not the Frame's (the Frame CSP forbids `worker-src`).

   The wire shapes mirror `frame-protocol.ts`. Tests inject a stub pdf.js and a
   short position debounce through `globalThis.__readerTestHooks`; production
   never defines it. */

(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the Frame loads this file as a classic script, not a module.
  "use strict";

  /**
   * @typedef {number | "width" | "page"} FrameZoom
   * @typedef {{ kind: "page", page: number, zoom: FrameZoom }} ReadingPosition
   * @typedef {{ id: string, title: string, author: string, format: string }} FrameEntry
   * @typedef {{ fontSize: number, lineWidth: string, pdfFit: "width" | "page" }} ReaderSettings
   * @typedef {{ displaySource: string, css: string }} FramePdf
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
   * @typedef {{ kind: "open", entry: FrameEntry | null, position: ReadingPosition | null, settings: ReaderSettings, size: number, labels: FrameLabels, language: string, pdf?: FramePdf, pdfPort?: MessagePort }} FrameOpenMessage
   * @typedef {{ kind: "bytes", id: number, buffer: ArrayBuffer }} FrameBytesMessage
   * @typedef {{ kind: "read-error", id: number, code: string }} FrameReadErrorMessage
   * @typedef {{ kind: "command", id: string }} FrameCommandMessage
   * @typedef {{ kind: "language", language: string, labels?: FrameLabels }} FrameLanguageMessage
   * @typedef {FrameOpenMessage | FrameBytesMessage | FrameReadErrorMessage | FrameCommandMessage | FrameLanguageMessage} WorkerToFrameMessage
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
      default:
        return;
    }
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
    if (!message.pdf || !message.pdfPort) {
      fail("unsupported", t("errorUnsupported"));
      return;
    }
    await openPdf(message.pdf, message.pdfPort, position);
  }

  function resetDocument() {
    destroyDocument();
    pageIndex = 0;
    currentScale = 1;
    metaSent = false;
    outline = null;
    pageLabels = null;
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

  /* Rendering ------------------------------------------------------------- */

  function updateIndicator() {
    if (!pdfDoc || !pageIndicator) return;
    const number = pageIndex + 1;
    const count = pdfDoc.numPages;
    const label =
      pageLabels && typeof pageLabels[pageIndex] === "string" ? pageLabels[pageIndex] : "";
    pageIndicator.textContent =
      label !== "" && label !== String(number)
        ? t("pageLabeled", { label, page: number, count })
        : t("pageOf", { page: number, count });
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
    if (stage) stage.textContent = "";
  }

  /* Navigation, zoom, position ------------------------------------------- */

  /** @param {number} index */
  function goToPage(index) {
    if (!pdfDoc) return;
    const next = clamp(Math.floor(index), 0, Math.max(0, pdfDoc.numPages - 1));
    if (next === pageIndex) return;
    pageIndex = next;
    updateIndicator();
    schedulePosition();
    void renderCurrent();
    renderNeighbors();
    updateSearchStatus();
  }

  function nextPage() {
    goToPage(pageIndex + 1);
  }

  function previousPage() {
    goToPage(pageIndex - 1);
  }

  /** @param {FrameZoom} next */
  function setZoom(next) {
    if (!pdfDoc) return;
    zoomSetting = next;
    clearCache();
    schedulePosition();
    void renderCurrent();
  }

  /** @param {number} factor */
  function zoomBy(factor) {
    if (!pdfDoc) return;
    const baseScale = currentScale > 0 ? currentScale : 1;
    setZoom(clamp(baseScale * factor, 0.5, 4));
  }

  function positionMessage() {
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

  function schedulePosition() {
    if (!pdfDoc) return;
    positionDirty = true;
    clearTimeout(positionTimer);
    positionTimer = window.setTimeout(flushPosition, positionDebounceMs);
  }

  function flushPosition() {
    if (!positionDirty || !pdfDoc) return;
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
    const index = await resolveDestination(item.dest);
    if (index === null) return;
    goToPage(index);
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
  }

  /** @param {string} query */
  async function runSearch(query) {
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
        goToPage(0);
        return;
      case "lastPage":
        if (pdfDoc) goToPage(pdfDoc.numPages - 1);
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
    if (!pdfDoc) return;
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
        goToPage(0);
        return;
      case "End":
        event.preventDefault();
        if (pdfDoc) goToPage(pdfDoc.numPages - 1);
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
    if (!pdfDoc) return;
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
  }

  function onResize() {
    if (!pdfDoc) return;
    if (typeof zoomSetting === "number") return;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      clearCache();
      void renderCurrent();
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
