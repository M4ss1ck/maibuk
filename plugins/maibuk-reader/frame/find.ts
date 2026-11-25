/**
 * The Reader Frame's Find surface (#941): the search bar's own state and
 * chrome, the Flowing and Page view searches, the marks each view draws on a
 * hit, and the stepping between hits. `entry.ts` supplies the bar's elements,
 * the view state the matching reads (the open pdf.js Document, the foliate
 * Document and its Flowing layout, the rendered pages), and the navigation a
 * hit needs (turning a page, loading a Flowing section), so the engine knows
 * nothing about the toolbar or how a page is drawn.
 *
 * A match is one occurrence of the query, counted case-insensitively, one
 * after another: an overlapping occurrence does not count, and no whole-word
 * or accent rule applies. The Page view stores one match per page, with how
 * many times the query occurs on it; the Flowing view stores the section and
 * the character offset where each match starts, counted over the same text
 * nodes the highlighter walks.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules.
 */

import { hooks } from "./hooks";

/** One fixed-page search match: a page and how many times the query occurs on it. */
interface PageSearchMatch {
  page: number;
  count: number;
}

/** One flowing search match: the section and the character offset in it. */
interface FlowSearchMatch {
  section: number;
  offset: number;
}

/** A search result, shaped by the view the Document is drawn in. */
type SearchMatch = PageSearchMatch | FlowSearchMatch;

/** One pdf.js text item, as far as a search reads it. */
export interface FindTextItem {
  str?: unknown;
}

/** One pdf.js page, as far as a search reads it. */
export interface FindPdfPage {
  getTextContent(): Promise<{ items: FindTextItem[] }>;
}

/** The pdf.js Document, as far as a search reads it. */
export interface FindPdfDocument {
  numPages: number;
  getPage(number: number): Promise<FindPdfPage>;
}

/** One foliate section, as far as a flowing search reads it. */
export interface FindSection {
  linear?: string;
  createDocument(): Promise<Document>;
}

/** The foliate Document, as far as a flowing search reads it. */
export interface FindDocument {
  sections: FindSection[];
}

/** One match foliate's search reports: where it starts in the text it searched. */
export interface FindSearchResult {
  range: { startOffset: number };
}

/** foliate's search helper, as far as the Flowing view uses it. */
export interface FindFoliate {
  search(
    texts: string[],
    query: string,
    options: { granularity: string; sensitivity: string }
  ): Iterable<FindSearchResult>;
}

/** The Flowing view's current section and layout, as far as search reads it. */
export interface FindFlow {
  index: number;
  pageIndex: number;
  pages: number;
  doc: Document;
  shadow: ShadowRoot;
  columns: HTMLElement;
  content: HTMLElement;
  pageWidth: number;
  gap: number;
}

/** One rendered page, as far as a repaint reads it. */
export interface FindRenderedPage {
  textLayer: HTMLElement;
}

/** The elements, view state, and navigation `entry.ts` gives the engine. */
export interface FrameFindDeps {
  /** The search bar, whose `hidden` shows and hides it. */
  bar(): HTMLElement | null;
  /** The query field. */
  input(): HTMLInputElement | null;
  /** The "1 of 3" status line. */
  status(): HTMLElement | null;
  /** The toolbar button that opens the bar, which gets focus back when it closes. */
  toggle(): HTMLElement | null;
  /** The Next, Previous, and Close controls inside the bar. */
  nextButton(): HTMLElement | null;
  previousButton(): HTMLElement | null;
  closeButton(): HTMLElement | null;
  /** One localized string, with its interpolated values. */
  t(key: string, values?: Record<string, string | number>): string;
  /** Whether the Document is drawn in the Flowing view. */
  flowing(): boolean;
  /** Whether the Frame was destroyed, which abandons a search in flight. */
  destroyed(): boolean;
  /** The open pdf.js Document, or null. */
  pdf(): FindPdfDocument | null;
  /** The open foliate Document, or null. */
  document(): FindDocument | null;
  /** foliate's parsers, or null before a Document opens. */
  foliate(): FindFoliate | null;
  /** The Flowing view's current section and layout, or null. */
  flow(): FindFlow | null;
  /** Every rendered page, with the text layer its marks are drawn in. */
  pages(): Iterable<[number, FindRenderedPage]>;
  /** The element the PDF pages are drawn in, where the current mark is revealed. */
  stage(): HTMLElement | null;
  /** Every non-empty text node under a root, in document order. */
  textNodes(root: ParentNode): Text[];
  /** The current time, through the test seam. */
  now(): number;
  /** Turns a page, zero-based. */
  goToPage(index: number): void;
  /** Loads one Flowing section, optionally to a page. */
  loadFlowSection(index: number, page?: number): Promise<void>;
  /** Shows one Flowing page of the loaded section. */
  applyFlowPage(page: number): void;
  /** The Flowing page that holds a character offset in a section. */
  pageForCharOffset(doc: Document, offset: number): number;
  /** Schedules the Reading Position the view now shows. */
  schedulePosition(): void;
}

/** The engine: the search bar's chrome and the two views' matching. */
export interface FrameFind {
  /** Shows the bar, restores its query, and reports where the search stands. */
  open(): void;
  /** Hides the bar, drops the search, and clears every mark. */
  close(restoreFocus: boolean): void;
  /** Searches the bar's query, or steps to the next match when it is the one searched. */
  next(backwards: boolean): void;
  /** Reports "current of total" in the status line. */
  updateStatus(): void;
  /** Clears the search state and the status line, as opening another Document does. */
  reset(): void;
  /** Abandons a search in flight, leaving what is on screen alone. */
  invalidate(): void;
  /** Redraws the Flowing view's marks for the current query. */
  highlightFlow(): void;
  /** Removes the Flowing view's marks. */
  clearFlowHighlights(): void;
  /** Removes every mark, in both views. */
  clearHighlights(): void;
  /** Repaints one page's marks for the current query. */
  paintPdfMatches(container: HTMLElement, index: number): void;
  /** Repaints every rendered page's marks and reveals the current one. */
  repaintPdfMatches(): void;
  /** Scrolls the shown page's current mark into view. */
  revealPdfMatch(): void;
  /** Binds the bar's own controls: Next, Previous, Close, Enter, and typing. */
  bind(): void;
}

/**
 * How many times `query` occurs in `text`: case-insensitively, counting each
 * hit once and skipping past it, so overlapping occurrences do not count.
 */
export function countMatches(text: string, query: string): number {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Waits a turn of the event loop, so a long search does not block the Frame. */
function yieldToLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The Find engine over the bar and view `deps` supplies: the search state, the
 * search in either view, the marks each view draws, and the stepping order.
 */
export function createFind(deps: FrameFindDeps): FrameFind {
  const state = {
    query: "",
    matches: [] as SearchMatch[],
    index: -1,
    generation: 0,
    running: false,
  };

  function open(): void {
    const bar = deps.bar();
    if (!bar) return;
    bar.hidden = false;
    const input = deps.input();
    if (input) {
      input.focus();
      input.select();
      input.value = state.query;
    }
    updateStatus();
  }

  function close(restoreFocus: boolean): void {
    const bar = deps.bar();
    if (!bar) return;
    bar.hidden = true;
    state.query = "";
    state.matches = [];
    state.index = -1;
    state.generation += 1;
    const status = deps.status();
    if (status) status.textContent = "";
    clearHighlights();
    if (restoreFocus !== false) {
      const toggle = deps.toggle();
      if (toggle) toggle.focus();
    }
  }

  function reset(): void {
    state.query = "";
    state.matches = [];
    state.index = -1;
    state.generation += 1;
    const status = deps.status();
    if (status) status.textContent = "";
  }

  function invalidate(): void {
    state.generation += 1;
  }

  async function runFlowSearch(query: string): Promise<void> {
    const doc = deps.document();
    const foliate = deps.foliate();
    if (!doc || !foliate) return;
    const generation = ++state.generation;
    state.query = query;
    state.matches = [];
    state.index = -1;
    state.running = true;
    const status = deps.status();
    if (status) status.textContent = "";
    let sliceStart = deps.now();
    for (let index = 0; index < doc.sections.length; index += 1) {
      if (generation !== state.generation || deps.destroyed()) return;
      const section = doc.sections[index];
      if (section.linear === "no") continue;
      let text = "";
      try {
        const sectionDoc = await section.createDocument();
        const body =
          sectionDoc.body || sectionDoc.querySelector("body") || sectionDoc.documentElement;
        // Join the same text nodes the Flowing view pages by, so a match's
        // offset still names the same character when the page is computed.
        text = deps
          .textNodes(body)
          .map((node) => node.nodeValue || "")
          .join("");
      } catch {
        text = "";
      }
      for (const result of foliate.search([text], query, {
        granularity: "grapheme",
        sensitivity: "base",
      })) {
        state.matches.push({ section: index, offset: result.range.startOffset });
      }
      if (deps.now() - sliceStart > 16) {
        if (hooks && typeof hooks.onSearchSlice === "function") hooks.onSearchSlice();
        await yieldToLoop();
        sliceStart = deps.now();
      }
    }
    if (generation !== state.generation || deps.destroyed()) return;
    state.running = false;
    if (state.matches.length === 0) {
      const none = deps.status();
      if (none) none.textContent = deps.t("searchNoMatches");
      return;
    }
    state.index = 0;
    updateStatus();
    await showFlowMatch(state.matches[0] as FlowSearchMatch);
  }

  async function showFlowMatch(match: FlowSearchMatch): Promise<void> {
    if (!deps.document()) return;
    const loaded = deps.flow();
    if (!loaded || loaded.index !== match.section) {
      await deps.loadFlowSection(match.section, 0);
    }
    const flow = deps.flow();
    if (flow && flow.index === match.section) {
      deps.applyFlowPage(deps.pageForCharOffset(flow.doc, match.offset));
      highlightFlow();
      revealFlowHit();
      deps.schedulePosition();
    }
  }

  /**
   * The character offset of the current match when it lies in the section on
   * screen, or -1. Offsets count the same text nodes `highlightFlow` walks.
   */
  function currentFlowOffset(): number {
    const flow = deps.flow();
    if (!flow || state.index < 0) return -1;
    const match = state.matches[state.index] as FlowSearchMatch | undefined;
    return match && match.section === flow.index ? match.offset : -1;
  }

  /**
   * Turns to the Flowing page that holds the current mark. The estimate in
   * `pageForCharOffset` is by character count, which images and headings skew,
   * so the mark's own column decides. Columns are measured only when there is
   * layout to measure.
   */
  function revealFlowHit(): void {
    const flow = deps.flow();
    if (!flow) return;
    const hit = flow.shadow.querySelector(".reader-search-hit.is-current");
    const columns = flow.columns.getBoundingClientRect();
    if (!hit || columns.width === 0) return;
    const column = hit.getBoundingClientRect().left - columns.left;
    const stride = flow.pageWidth + flow.gap;
    const page = clamp(Math.floor(column / stride), 0, Math.max(0, flow.pages - 1));
    if (page !== flow.pageIndex) deps.applyFlowPage(page);
  }

  function stepFlowMatch(backwards: boolean): void {
    if (state.matches.length === 0) return;
    const length = state.matches.length;
    state.index = (state.index + (backwards ? -1 : 1) + length) % length;
    updateStatus();
    void showFlowMatch(state.matches[state.index] as FlowSearchMatch);
  }

  function highlightFlow(): void {
    clearFlowHighlights();
    const flow = deps.flow();
    if (!flow || state.query === "") return;
    const needle = state.query.toLocaleLowerCase();
    const current = currentFlowOffset();
    // `base` is the section offset where the node starts, the same count the
    // search's match offsets use.
    let base = 0;
    for (const node of deps.textNodes(flow.content)) {
      const text = node.nodeValue || "";
      const haystack = text.toLocaleLowerCase();
      let index = haystack.indexOf(needle);
      if (index === -1) {
        base += text.length;
        continue;
      }
      const fragment = document.createDocumentFragment();
      let last = 0;
      while (index !== -1) {
        fragment.append(text.slice(last, index));
        const mark = document.createElement("mark");
        mark.className =
          base + index === current ? "reader-search-hit is-current" : "reader-search-hit";
        mark.textContent = text.slice(index, index + needle.length);
        fragment.append(mark);
        last = index + needle.length;
        index = haystack.indexOf(needle, last);
      }
      fragment.append(text.slice(last));
      node.parentNode?.replaceChild(fragment, node);
      base += text.length;
    }
  }

  function clearFlowHighlights(): void {
    const flow = deps.flow();
    if (!flow) return;
    for (const hit of Array.from(flow.shadow.querySelectorAll(".reader-search-hit")) as Element[]) {
      const parent = hit.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(hit.textContent || ""), hit);
      parent.normalize();
    }
  }

  /**
   * Marks each match of `query` in the text under `container`. The `current`
   * ordinal, counted in document order across the container, gets the
   * `is-current` class as well.
   */
  function highlightText(container: HTMLElement, query: string, current: number = -1): void {
    if (!query) return;
    const needle = query.toLocaleLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue && walker.currentNode.nodeValue.trim() !== "") {
        nodes.push(walker.currentNode as Text);
      }
    }
    let ordinal = 0;
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
        mark.className = ordinal === current ? "reader-search-hit is-current" : "reader-search-hit";
        mark.textContent = text.slice(index, index + needle.length);
        fragment.append(mark);
        ordinal += 1;
        last = index + needle.length;
        index = haystack.indexOf(needle, last);
      }
      fragment.append(text.slice(last));
      node.parentNode?.replaceChild(fragment, node);
    }
  }

  function unwrapHits(root: ParentNode): void {
    for (const hit of Array.from(root.querySelectorAll(".reader-search-hit"))) {
      const parent = hit.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(hit.textContent || ""), hit);
      parent.normalize();
    }
  }

  function clearHighlights(): void {
    unwrapHits(document);
    clearFlowHighlights();
  }

  /** Every Page view match is one occurrence; the search's index counts them all. */
  function pdfMatchTotal(): number {
    let total = 0;
    for (const match of state.matches as PageSearchMatch[]) total += match.count;
    return total;
  }

  /** The page an occurrence sits on, and its place among that page's matches. */
  function pdfMatchAt(index: number): { page: number; ordinal: number } | null {
    let first = 0;
    for (const match of state.matches as PageSearchMatch[]) {
      if (index < first + match.count) return { page: match.page, ordinal: index - first };
      first += match.count;
    }
    return null;
  }

  /**
   * Repaints one page's marks for the current query, flagging the current
   * occurrence when it sits on this page.
   */
  function paintPdfMatches(container: HTMLElement, index: number): void {
    unwrapHits(container);
    const at = state.index >= 0 ? pdfMatchAt(state.index) : null;
    highlightText(container, state.query, at && at.page === index ? at.ordinal : -1);
  }

  /** Repaints every rendered page, then brings the current mark into view. */
  function repaintPdfMatches(): void {
    for (const [index, rendered] of deps.pages()) paintPdfMatches(rendered.textLayer, index);
    revealPdfMatch();
  }

  /** Scrolls the shown page's current mark into view, if it has one. */
  function revealPdfMatch(): void {
    const stage = deps.stage();
    const hit = stage ? stage.querySelector(".reader-search-hit.is-current") : null;
    if (hit && typeof hit.scrollIntoView === "function") {
      hit.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  async function runSearch(query: string): Promise<void> {
    if (deps.flowing() && deps.document()) {
      await runFlowSearch(query);
      return;
    }
    const pdf = deps.pdf();
    if (!pdf) return;
    const generation = ++state.generation;
    state.query = query;
    state.matches = [];
    state.index = -1;
    state.running = true;
    const status = deps.status();
    if (status) status.textContent = "";
    let sliceStart = performance.now();
    for (let index = 0; index < pdf.numPages; index += 1) {
      if (generation !== state.generation || deps.destroyed()) return;
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");
      const count = countMatches(text, query);
      if (count > 0) state.matches.push({ page: index, count });
      if (performance.now() - sliceStart > 16) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        sliceStart = performance.now();
      }
    }
    if (generation !== state.generation || deps.destroyed()) return;
    state.running = false;
    if (state.matches.length === 0) {
      const none = deps.status();
      if (none) none.textContent = deps.t("searchNoMatches");
      return;
    }
    state.index = 0;
    updateStatus();
    deps.goToPage((state.matches[0] as PageSearchMatch).page);
    repaintPdfMatches();
  }

  function nextOrRun(backwards: boolean): void {
    const input = deps.input();
    const query = input ? input.value.trim() : "";
    if (query === "") {
      const status = deps.status();
      if (status) status.textContent = "";
      return;
    }
    if (query !== state.query || state.matches.length === 0) {
      void runSearch(query);
      return;
    }
    stepMatch(backwards);
  }

  function stepMatch(backwards: boolean): void {
    if (state.matches.length === 0) return;
    if (deps.flowing()) {
      stepFlowMatch(backwards);
      return;
    }
    const length = pdfMatchTotal();
    if (length === 0) return;
    state.index = (state.index + (backwards ? -1 : 1) + length) % length;
    updateStatus();
    const at = pdfMatchAt(state.index);
    if (at) deps.goToPage(at.page);
    repaintPdfMatches();
  }

  function updateStatus(): void {
    const status = deps.status();
    const bar = deps.bar();
    if (!status || !bar || bar.hidden) return;
    if (state.matches.length === 0) {
      if (state.query === "" && status.textContent === deps.t("searchNoMatches")) {
        status.textContent = "";
      }
      return;
    }
    // A search still running has no current match yet.
    if (state.index < 0) return;
    if (deps.flowing()) {
      status.textContent = deps.t("searchMatches", {
        current: state.index + 1,
        total: state.matches.length,
      });
      return;
    }
    status.textContent = deps.t("searchMatches", {
      current: state.index + 1,
      total: pdfMatchTotal(),
    });
  }

  function bind(): void {
    const previous = deps.previousButton();
    if (previous) previous.addEventListener("click", () => nextOrRun(true));
    const nextButton = deps.nextButton();
    if (nextButton) nextButton.addEventListener("click", () => nextOrRun(false));
    const closeButton = deps.closeButton();
    if (closeButton) closeButton.addEventListener("click", () => close(true));
    const input = deps.input();
    if (!input) return;
    input.addEventListener("keydown", (event: KeyboardEvent) => {
      // deprecated-api: Safari's IME-commit Enter has isComposing false; keyCode 229 is its only tell.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        nextOrRun(event.shiftKey);
      }
    });
    input.addEventListener("input", () => {
      if (input.value.trim() !== state.query) {
        state.matches = [];
        state.index = -1;
        state.generation += 1;
        const status = deps.status();
        if (status) status.textContent = "";
      }
    });
  }

  return {
    open,
    close,
    next: nextOrRun,
    updateStatus,
    reset,
    invalidate,
    highlightFlow,
    clearFlowHighlights,
    clearHighlights,
    paintPdfMatches,
    repaintPdfMatches,
    revealPdfMatch,
    bind,
  };
}
