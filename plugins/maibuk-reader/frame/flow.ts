/**
 * The Reader Frame's Flowing and fixed-layout engine (#941): one sanitized
 * section drawn inside a shadow root, its text paged into CSS columns, the CFI
 * and character-offset positions a Reading Position and Find need, the
 * repagination a typography or resize change triggers, the font-size step, and
 * the Page view a pre-paginated EPUB draws with the same section renderer.
 * `entry.ts` supplies the containers, the archive, the sanitizer, the live
 * settings, the view guards (`destroyed`, the view generation, the current
 * page), and the callbacks each draw ends with, so the engine knows nothing
 * about the toolbar or the other views.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules.
 */

import { hooks } from "./hooks";
import type { FrameZoom, ReaderSettings, ReadingPosition } from "./types";

/** The gutter between a Flowing section's columns, in pixels. */
export const FLOW_GAP = 40;

/** One section of a foliate Document, as far as the Flowing view reads it. */
export interface FlowSection {
  id?: string;
  cfi?: string;
  createDocument(): Promise<Document>;
}

/** A reference into a section, resolved to a range once the section is parsed. */
export type FlowAnchor = (doc: Document) => Range | null;

/** One CFI resolved against the Document. */
export interface FlowResolvedCfi {
  index: number;
  anchor?: FlowAnchor | null;
}

/** The foliate Document, as far as the Flowing view reads it. */
export interface FlowDocument {
  sections: FlowSection[];
  rendition?: { layout?: string };
  resolveCFI?(cfi: string): FlowResolvedCfi | null | undefined;
}

/** foliate's CFI helpers, as far as the Flowing view uses them. */
export interface FlowFoliate {
  CFI?: {
    fake: { fromIndex(index: number): string };
    fromRange(range: Range): string;
    joinIndir(base: string, cfi: string): string;
  } | null;
}

/** The sanitizer `sanitizer.js` defines before the Frame's script runs. */
export interface FlowSanitizer {
  sanitizeDocument(doc: Document, purify: unknown): void;
  rewriteDocument(
    doc: Document,
    options: {
      base: string;
      assetUrl(path: string, type: string): Promise<string | null>;
      assetText(name: string): Promise<string | null>;
    }
  ): Promise<void>;
  readingCss(settings: ReaderSettings): string;
  LINE_WIDTHS: Record<string, string>;
}

/** A DOM container, as far as the engine sizes and fills it. */
export interface FlowContainer {
  readonly clientWidth: number;
  readonly clientHeight: number;
  textContent: string | null;
  hidden: boolean;
  style: { width: string; height: string };
  append(node: Node): void;
}

/** The section and layout on screen: what a position or a search reads. */
export interface FlowState {
  index: number;
  pageIndex: number;
  pages: number;
  doc: Document;
  body: HTMLElement;
  host: HTMLElement;
  shadow: ShadowRoot;
  columns: HTMLElement;
  content: HTMLElement;
  pageWidth: number;
  height: number;
  gap: number;
  sectionCfi: string | null;
}

/** Where a saved Reading Position resumes: a section, a page, and maybe an anchor. */
export interface FlowStart {
  index: number;
  page: number;
  anchor?: FlowAnchor;
}

/** The containers, live state, and callbacks `entry.ts` gives the engine. */
export interface FrameFlowDeps {
  /** The container the section's host is drawn into. */
  stage(): FlowContainer;
  /** The scroll container the Flowing view is sized against. */
  viewer(): FlowContainer;
  /** The open foliate Document, or null. */
  document(): FlowDocument | null;
  /** foliate's parsers, or null before a Document opens. */
  foliate(): FlowFoliate | null;
  /** The Document's format, which decides whether a CFI can be written. */
  format(): string;
  /** The live Reader settings. */
  settings(): ReaderSettings;
  /** Persists and posts the settings a font-size step produced. */
  saveSettings(settings: ReaderSettings): void;
  /** The sanitizer `sanitizer.js` defines before the Frame's script runs. */
  sanitizer: FlowSanitizer;
  /** DOMPurify, as the open message imported it. */
  purify(): unknown;
  /** The archive's object URLs and asset reads. */
  archive: {
    revoke(): void;
    assetUrl(path: string, type: string): Promise<string | null>;
    text(name: string): Promise<string | null>;
  };
  /** Whether any Document is open. */
  hasDocument(): boolean;
  /** Whether the Document is drawn in the Flowing view. */
  flowing(): boolean;
  /** Whether the Frame was destroyed, which abandons a draw in flight. */
  destroyed(): boolean;
  /** The view generation, read to see whether a newer draw has started. */
  generation(): number;
  /** Starts a new view generation, invalidating draws already in flight. */
  beginGeneration(): number;
  /** The page on screen in the Page view, zero-based. */
  pageIndex(): number;
  /** The current zoom setting. */
  zoom(): FrameZoom;
  /** Records the scale a fixed-layout page was drawn at. */
  setScale(scale: number): void;
  /** Brings the toolbar's page indicator up to date. */
  updateIndicator(): void;
  /** Refreshes Find's status line after a page turn. */
  updateFindStatus(): void;
  /** Repaints Find's marks over the newly loaded section. */
  highlightFlow(): void;
  /** Schedules a debounced Reading Position report. */
  schedulePosition(): void;
  /** Shows a zoom percentage in the toolbar. */
  showZoom(percent: number): void;
}

/** The engine: the loaded section, its columns, and the positions they report. */
export interface FrameFlow {
  /** The section and layout on screen, or null. */
  state(): FlowState | null;
  /** Loads one section and pages to a page or an anchor. */
  loadFlowSection(index: number, targetPage?: number, anchor?: FlowAnchor | null): Promise<void>;
  /** Shows one page of the loaded section. */
  applyFlowPage(page: number): void;
  /** Turns to the next page, crossing into the next section at the end. */
  nextFlowPage(): void;
  /** Turns to the previous page, crossing into the previous section at the start. */
  previousFlowPage(): void;
  /** Moves to a section, optionally at an anchor. */
  goToFlowSection(index: number, anchor?: FlowAnchor | null): Promise<void>;
  /** The CFI of the first character on the current page, or null. */
  flowCfi(): string | null;
  /** The range at the first character of the current page, in the parsed Document. */
  rangeForFlowPage(): Range | null;
  /** The Flowing page a range in the parsed Document falls on. */
  pageForDocRange(range: Range): number;
  /** The Flowing page that holds a character offset in the parsed Document. */
  pageForCharOffset(doc: Document, offset: number): number;
  /** The section and page a saved Reading Position resumes at. */
  flowStart(saved: ReadingPosition | null): FlowStart;
  /** Repaginates after a typography change, keeping the CFI. */
  repaginateFlow(cfi: string | null, sectionIndex: number, page: number): Promise<void>;
  /** Steps the font size, repaginating the Flowing view. */
  stepFontSize(delta: number): void;
  /** Draws the current Page view, a pre-paginated EPUB section. */
  renderFixedPage(): Promise<void>;
  /** Drops the loaded section, as closing a Document does. */
  reset(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Every non-empty text node under `root`, in document order. */
export function textNodes(root: ParentNode): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if ((node.nodeValue || "").trim() !== "") nodes.push(node);
  }
  return nodes;
}

/** The total length of `nodes`' text. */
export function textLength(nodes: Text[]): number {
  let total = 0;
  for (const node of nodes) total += (node.nodeValue || "").length;
  return total;
}

/**
 * The pages a measured column width implies: one column fits its own width,
 * and every page thereafter is a column plus one `gap` gutter. A remainder
 * past half a stride rounds up to the page it spills onto; one below stays on
 * the page it started from.
 */
export function flowPageCountForWidth(scrollWidth: number, pageWidth: number, gap: number): number {
  const scroll = scrollWidth || 0;
  if (scroll <= pageWidth) return 1;
  return Math.max(1, Math.round((scroll + gap) / (pageWidth + gap)));
}

/** A collapsed range at `offset` through the body's text. */
export function rangeForCharOffset(doc: Document, body: HTMLElement, offset: number): Range | null {
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

/**
 * The Flowing engine over the containers and live state `deps` supplies: the
 * section render, its columns, the page turns, the positions, and the single
 * font-size step.
 */
export function createFlow(deps: FrameFlowDeps): FrameFlow {
  let flow: FlowState | null = null;

  /** The `width`/`height` a fixed-layout section declares, or a document default. */
  function fixedViewport(doc: Document): { width: number; height: number } {
    const meta = doc.querySelector('meta[name="viewport"]');
    const content = meta ? meta.getAttribute("content") || "" : "";
    const width = /(?:^|,)\s*width\s*=\s*([\d.]+)/i.exec(content);
    const height = /(?:^|,)\s*height\s*=\s*([\d.]+)/i.exec(content);
    return {
      width: width ? Math.max(1, Number.parseFloat(width[1])) : 1200,
      height: height ? Math.max(1, Number.parseFloat(height[1])) : 1600,
    };
  }

  /**
   * Parses, sanitizes, and rewrites one section, then draws its body inside a
   * shadow root. The parsed Document stays alive so CFIs can be computed from
   * it after the shadow copy has been highlighted.
   */
  async function renderSection(section: FlowSection, options?: { fixed?: boolean }) {
    const doc = await section.createDocument();
    // The viewport meta is captured before sanitizing, because DOMPurify
    // removes `meta` along with every other element that can restyle the Frame.
    const viewport = fixedViewport(doc);
    deps.sanitizer.sanitizeDocument(doc, deps.purify());
    await deps.sanitizer.rewriteDocument(doc, {
      base: typeof section.id === "string" ? section.id : "",
      assetUrl: deps.archive.assetUrl,
      assetText: deps.archive.text,
    });
    const body = doc.body || doc.querySelector("body") || doc.documentElement;

    const host = document.createElement("div");
    host.className = "reader-document";
    const owner = deps.document();
    host.dataset.section = String(owner && owner.sections ? owner.sections.indexOf(section) : 0);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = deps.sanitizer.readingCss(deps.settings());
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
    const settings = deps.settings();
    const viewer = deps.viewer();
    const availableWidth =
      (hooks && typeof hooks.viewportWidth === "number" ? hooks.viewportWidth : 0) ||
      (viewer.clientWidth > 32 ? viewer.clientWidth - 32 : 800);
    const availableHeight =
      (hooks && typeof hooks.viewportHeight === "number" ? hooks.viewportHeight : 0) ||
      (viewer.clientHeight > 32 ? viewer.clientHeight - 32 : 600);
    const em = Number.parseFloat(deps.sanitizer.LINE_WIDTHS[settings.lineWidth]) || 38;
    const scale = Math.max(0.6, Math.min(2, settings.fontSize / 100));
    const lineWidth = 16 * scale * em;
    return {
      width: Math.max(200, Math.min(availableWidth, lineWidth)),
      height: Math.max(200, availableHeight),
    };
  }

  function flowPageCount(columns: HTMLElement, pageWidth: number, sectionIndex: number): number {
    if (hooks && typeof hooks.measureFlow === "function") {
      return Math.max(1, Math.floor(hooks.measureFlow({ columns, pageWidth, sectionIndex })));
    }
    return flowPageCountForWidth(columns.scrollWidth, pageWidth, FLOW_GAP);
  }

  /**
   * Loads one Flowing section and pages to `targetPage` or to the page that
   * holds `anchor`'s range.
   */
  async function loadFlowSection(
    index: number,
    targetPage?: number,
    anchor?: FlowAnchor | null
  ): Promise<void> {
    const owner = deps.document();
    if (!owner) return;
    const section = owner.sections[index];
    if (!section) return;
    const generation = deps.beginGeneration();
    deps.archive.revoke();
    const geometry = flowGeometry();
    const rendered = await renderSection(section);
    if (deps.destroyed() || generation !== deps.generation()) return;

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
    const stage = deps.stage();
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
    deps.updateIndicator();
    deps.schedulePosition();
    deps.highlightFlow();
  }

  function applyFlowPage(page: number): void {
    if (!flow) return;
    flow.pageIndex = clamp(Math.floor(page), 0, Math.max(0, flow.pages - 1));
    flow.columns.style.transform = `translateX(-${flow.pageIndex * (flow.pageWidth + flow.gap)}px)`;
    deps.updateIndicator();
    deps.updateFindStatus();
  }

  function nextFlowPage(): void {
    if (!flow) return;
    if (flow.pageIndex + 1 < flow.pages) {
      applyFlowPage(flow.pageIndex + 1);
      deps.schedulePosition();
      return;
    }
    const owner = deps.document();
    if (owner && flow.index + 1 < owner.sections.length) {
      void loadFlowSection(flow.index + 1, 0);
      deps.schedulePosition();
    }
  }

  function previousFlowPage(): void {
    if (!flow) return;
    if (flow.pageIndex > 0) {
      applyFlowPage(flow.pageIndex - 1);
      deps.schedulePosition();
      return;
    }
    if (flow.index > 0) {
      void loadFlowSection(flow.index - 1, Number.MAX_SAFE_INTEGER);
      deps.schedulePosition();
    }
  }

  async function goToFlowSection(index: number, anchor?: FlowAnchor | null): Promise<void> {
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
    deps.schedulePosition();
  }

  /** The CFI of the first character on the current Flowing page. */
  function flowCfi(): string | null {
    const foliate = deps.foliate();
    if (!foliate || !flow || deps.format() !== "epub") return null;
    const cfi = foliate.CFI || null;
    const base = flow.sectionCfi || (cfi ? cfi.fake.fromIndex(flow.index) : null);
    if (!base) return null;
    const range = rangeForFlowPage();
    if (!range || !cfi) return base;
    try {
      return cfi.joinIndir(base, cfi.fromRange(range));
    } catch {
      return base;
    }
  }

  /** The range at the first character of the current page, in the parsed Document. */
  function rangeForFlowPage(): Range | null {
    if (!flow) return null;
    const nodes = textNodes(flow.body);
    if (nodes.length === 0) return null;
    const fraction = flow.pages > 1 ? flow.pageIndex / flow.pages : 0;
    return rangeForCharOffset(flow.doc, flow.body, Math.floor(textLength(nodes) * fraction));
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
  function flowStart(saved: ReadingPosition | null): FlowStart {
    const owner = deps.document();
    if (saved && saved.kind === "cfi" && owner && typeof owner.resolveCFI === "function") {
      try {
        const resolved = owner.resolveCFI(saved.cfi);
        if (resolved && typeof resolved.index === "number" && resolved.index >= 0) {
          return { index: resolved.index, page: 0, anchor: resolved.anchor || undefined };
        }
      } catch {
        /* Fall through to the first section. */
      }
    }
    if (saved && saved.kind === "section") {
      const sections = owner ? owner.sections.length : 0;
      return {
        index: clamp(Math.floor(saved.index), 0, Math.max(0, sections - 1)),
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
    const owner = deps.document();
    if (!owner) return;
    let index = typeof sectionIndex === "number" ? sectionIndex : 0;
    let anchor: FlowAnchor | null = null;
    if (cfi && typeof owner.resolveCFI === "function") {
      try {
        const resolved = owner.resolveCFI(cfi);
        if (resolved && typeof resolved.index === "number" && resolved.index >= 0) {
          index = resolved.index;
          anchor = resolved.anchor || null;
        }
      } catch {
        /* Keep the section and page the caller gave. */
      }
    }
    await loadFlowSection(index, typeof page === "number" ? page : 0, anchor);
  }

  function stepFontSize(delta: number): void {
    if (!deps.hasDocument()) return;
    const settings = deps.settings();
    const next = clamp(Math.round((settings.fontSize + delta) / 10) * 10, 60, 200);
    if (next === settings.fontSize) return;
    deps.saveSettings({ ...settings, fontSize: next });
    if (deps.flowing() && flow) {
      const cfi = flowCfi();
      const index = flow.index;
      const page = flow.pageIndex;
      void repaginateFlow(cfi, index, page);
    } else {
      deps.showZoom(next);
    }
  }

  /** The scale that fits a fixed-layout page, honoring a numeric zoom. */
  function fixedScale(width: number, height: number): number {
    const viewer = deps.viewer();
    const availableWidth = viewer.clientWidth > 32 ? viewer.clientWidth - 32 : 800;
    const availableHeight = viewer.clientHeight > 32 ? viewer.clientHeight - 32 : 600;
    const fit = Math.min(availableWidth / width, availableHeight / height);
    const zoom = deps.zoom();
    if (typeof zoom === "number") return clamp(zoom, 0.25, 4);
    if (zoom === "width") return clamp(availableWidth / width, 0.1, 4);
    return clamp(fit, 0.1, 4);
  }

  async function renderFixedPage(): Promise<void> {
    const owner = deps.document();
    if (!owner) return;
    const section = owner.sections[deps.pageIndex()];
    if (!section) return;
    const generation = deps.beginGeneration();
    deps.archive.revoke();
    const rendered = await renderSection(section, { fixed: true });
    if (deps.destroyed() || generation !== deps.generation()) return;
    const viewport = rendered.viewport || fixedViewport(rendered.doc);
    const scale = fixedScale(viewport.width, viewport.height);
    rendered.host.style.width = `${viewport.width}px`;
    rendered.host.style.height = `${viewport.height}px`;
    rendered.host.style.transform = `scale(${scale})`;
    rendered.host.style.transformOrigin = "top left";

    const stage = deps.stage();
    stage.textContent = "";
    stage.style.width = `${Math.round(viewport.width * scale)}px`;
    stage.style.height = `${Math.round(viewport.height * scale)}px`;
    stage.hidden = false;
    stage.append(rendered.host);
    deps.setScale(scale);
    deps.updateIndicator();
    deps.schedulePosition();
    deps.showZoom(Math.round(scale * 100));
  }

  function reset(): void {
    flow = null;
  }

  return {
    state: () => flow,
    loadFlowSection,
    applyFlowPage,
    nextFlowPage,
    previousFlowPage,
    goToFlowSection,
    flowCfi,
    rangeForFlowPage,
    pageForDocRange,
    pageForCharOffset,
    flowStart,
    repaginateFlow,
    stepFontSize,
    renderFixedPage,
    reset,
  };
}
