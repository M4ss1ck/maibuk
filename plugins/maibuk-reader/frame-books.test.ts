// @vitest-environment jsdom
/**
 * Reader's Flowing view and Page view for books (#653) in jsdom: the real
 * `assets/ui/reader.js` and `assets/ui/sanitizer.js` against the real markup,
 * foliate's real bundled parsers, the real DOMPurify build, and a stand-in
 * Worker that answers `read`, `zip-list`, and `zip-entry` from a committed
 * fixture. Layout is the one seam: jsdom lays nothing out, so each test supplies
 * a section page count through `__readerTestHooks.measureFlow`. Every behavior
 * is driven by key presses or Commands and asserted on what the Frame drew or
 * posted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
import purify from "./vendor/dompurify/purify.es.mjs";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
import * as foliate from "./vendor/foliate/foliate-parsers.min.mjs";
import type {
  FrameShelfEntry,
  FrameShelfLabels,
  FrameShelfState,
  ShelfViewSettings,
} from "./frame/types";
import { deflatedArchive } from "./test-support";
import { ZipError, openZip } from "./zip";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";

const HERE = __dirname;
const HTML = readFileSync(join(HERE, "assets/ui/reader.html"), "utf8");
const SCRIPT = readFileSync(join(HERE, "assets/ui/reader.js"), "utf8");
const SANITIZER = readFileSync(join(HERE, "assets/ui/sanitizer.js"), "utf8");

/** The `labels` map the Worker builds from its runtime catalogs. */
function labelsFrom(catalog: Record<string, string>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (key.startsWith("viewer.")) labels[key.slice("viewer.".length)] = value;
  }
  return labels;
}

const LABELS = labelsFrom(en as Record<string, string>);
const LABELS_ES = labelsFrom(es as Record<string, string>);

/** The `shelfLabels` map the Worker builds from its runtime catalog. */
function shelfLabelsFrom(catalog: Record<string, string>): FrameShelfLabels {
  return {
    shelf: catalog["page.shelf"],
    import: catalog["shelf.frame.import"],
    importFiles: catalog["shelf.frame.importFiles"],
    emptyTitle: catalog["shelf.emptyTitle"],
    emptyDescription: catalog["shelf.frame.emptyDescription"],
    loading: catalog["shelf.loading"],
    error: catalog["shelf.frame.error"],
    documentsCountOne: catalog["shelf.frame.documentsCount.one"],
    documentsCountOther: catalog["shelf.frame.documentsCount.other"],
    open: catalog["shelf.open"],
    remove: catalog["shelf.frame.remove"],
    locate: catalog["shelf.frame.locate"],
    missing: catalog["shelf.frame.missing"],
    moreFor: catalog["shelf.frame.moreFor"],
    removeConfirm: catalog["shelf.frame.removeConfirm"],
    cancel: catalog["shelf.frame.cancel"],
    newLabel: catalog["shelf.frame.newLabel"],
    finishedLabel: catalog["shelf.frame.finishedLabel"],
    documentActions: catalog["shelf.frame.documentActions"],
    dismiss: catalog["shelf.frame.dismiss"],
    allDocuments: catalog["shelf.frame.allDocuments"],
    shownOf: catalog["shelf.frame.shownOf"],
    searchLabel: catalog["shelf.frame.searchLabel"],
    searchPlaceholder: catalog["shelf.frame.searchPlaceholder"],
    closeSearch: catalog["shelf.frame.closeSearch"],
    clearSearch: catalog["shelf.frame.clearSearch"],
    searchMatchesOne: catalog["shelf.frame.searchMatches.one"],
    searchMatchesOther: catalog["shelf.frame.searchMatches.other"],
    gridView: catalog["shelf.frame.gridView"],
    listView: catalog["shelf.frame.listView"],
    compactView: catalog["shelf.frame.compactView"],
    viewOptions: catalog["shelf.frame.viewOptions"],
    viewOptionsTitle: catalog["shelf.frame.viewOptionsTitle"],
    reset: catalog["shelf.frame.reset"],
    done: catalog["shelf.frame.done"],
    layout: catalog["shelf.frame.layout"],
    layoutLabel: catalog["shelf.frame.layoutLabel"],
    layoutGrid: catalog["shelf.frame.layoutGrid"],
    layoutList: catalog["shelf.frame.layoutList"],
    layoutCompact: catalog["shelf.frame.layoutCompact"],
    coverSize: catalog["shelf.frame.coverSize"],
    coverSmall: catalog["shelf.frame.coverSmall"],
    coverMedium: catalog["shelf.frame.coverMedium"],
    coverLarge: catalog["shelf.frame.coverLarge"],
    coverSmallShort: catalog["shelf.frame.coverSmallShort"],
    coverMediumShort: catalog["shelf.frame.coverMediumShort"],
    coverLargeShort: catalog["shelf.frame.coverLargeShort"],
    sortBy: catalog["shelf.frame.sortBy"],
    sortRecent: catalog["shelf.frame.sort.recent"],
    sortTitle: catalog["shelf.frame.sort.title"],
    sortAuthor: catalog["shelf.frame.sort.author"],
    sortProgress: catalog["shelf.frame.sort.progress"],
    sortAdded: catalog["shelf.frame.sort.added"],
    reverseOrder: catalog["shelf.frame.reverseOrder"],
    reverseOrderValue: catalog["shelf.frame.reverseOrderValue"],
    sortSummary: catalog["shelf.frame.sortSummary"],
    sortByValue: catalog["shelf.frame.sortByValue"],
    newestFirst: catalog["shelf.frame.newestFirst"],
    oldestFirst: catalog["shelf.frame.oldestFirst"],
    aToZ: catalog["shelf.frame.aToZ"],
    zToA: catalog["shelf.frame.zToA"],
    mostReadFirst: catalog["shelf.frame.mostReadFirst"],
    leastReadFirst: catalog["shelf.frame.leastReadFirst"],
    recentFirst: catalog["shelf.frame.recentFirst"],
    filters: catalog["shelf.frame.filters"],
    status: catalog["shelf.frame.status"],
    format: catalog["shelf.frame.format"],
    all: catalog["shelf.frame.all"],
    statusNew: catalog["shelf.frame.status.new"],
    statusReading: catalog["shelf.frame.status.reading"],
    statusFinished: catalog["shelf.frame.status.finished"],
    statusChip: catalog["shelf.frame.statusChip"],
    formatChip: catalog["shelf.frame.formatChip"],
    removeFilter: catalog["shelf.frame.removeFilter"],
    clearFilters: catalog["shelf.frame.clearFilters"],
    noMatch: catalog["shelf.frame.noMatch"],
    remembered: catalog["shelf.frame.remembered"],
    collections: catalog["shelf.frame.collections"],
    newCollection: catalog["shelf.frame.newCollection"],
    newCollectionName: catalog["shelf.frame.newCollectionName"],
    add: catalog["shelf.frame.add"],
    railHint: catalog["shelf.frame.railHint"],
    collection: catalog["shelf.frame.collection"],
    anyCollection: catalog["shelf.frame.anyCollection"],
    collectionChip: catalog["shelf.frame.collectionChip"],
    moreForCollection: catalog["shelf.frame.moreForCollection"],
    collectionName: catalog["shelf.frame.collectionName"],
    create: catalog["shelf.frame.create"],
    renameCollection: catalog["shelf.frame.renameCollection"],
    renameAction: catalog["shelf.frame.renameAction"],
    rename: catalog["shelf.frame.rename"],
    deleteAction: catalog["shelf.frame.deleteAction"],
    deleteCollectionTitle: catalog["shelf.frame.deleteCollectionTitle"],
    deleteCollectionBody: catalog["shelf.frame.deleteCollectionBody"],
    delete: catalog["shelf.frame.delete"],
    duplicateCollection: catalog["shelf.frame.duplicateCollection"],
    noCollections: catalog["shelf.frame.noCollections"],
  };
}

const SHELF_LABELS = shelfLabelsFrom(en as Record<string, string>);
const SHELF_LABELS_ES = shelfLabelsFrom(es as Record<string, string>);

/**
 * One Shelf row as the Worker sends it, plus the fields the Frame must never
 * draw: the File Grant, the Fingerprint, and the storage key stay in the Worker.
 */
type WireShelfRow = FrameShelfEntry & {
  grant: string;
  fingerprint: string;
  storageKey: string;
};

/**
 * Each wire row is read a moment before the one built ahead of it: the Worker
 * sends its rows most recently read first, so the Frame's default Recent sort
 * keeps the order a test builds them in.
 */
let nextReadAt = 1_000_000;

/** A wire row with every drawn field, and the three the Frame never sees. */
function wireRow(overrides: Partial<FrameShelfEntry> & { id: string }): WireShelfRow {
  return {
    title: "A Document",
    author: "",
    format: "epub",
    state: "ok",
    progressText: "New",
    progressPercent: null,
    statusText: null,
    tone: 0,
    status: "reading",
    lastReadAt: nextReadAt--,
    addedAt: 0,
    progress: 0.42,
    grant: `grant-${overrides.id}`,
    fingerprint: `fingerprint-${overrides.id}`,
    storageKey: `reader.shelf.${overrides.id}`,
    ...overrides,
  };
}

const READABLE_ROW = wireRow({
  id: "doc-1",
  title: "Dune",
  author: "Frank Herbert",
  format: "epub",
  progressText: "42%",
  progressPercent: 42,
});

const MISSING_ROW = wireRow({
  id: "doc-2",
  title: "Emma",
  author: "Jane Austen",
  format: "pdf",
  state: "missing",
  statusText: "Missing",
  tone: 1,
});

const UNREADABLE_ROW = wireRow({
  id: "doc-3",
  title: "Broken Spine",
  format: "mobi",
  state: "unreadable",
  statusText: "Can't open this file",
  tone: 2,
});

/** A ready Shelf holding one readable, one Missing, and one unreadable row. */
const READY_SHELF: FrameShelfState = {
  status: "ready",
  entries: [READABLE_ROW, MISSING_ROW, UNREADABLE_ROW],
};

/** One committed fixture's bytes. */
function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(HERE, "fixtures", name)));
}

/** A ranged read over `bytes`, for opening the same archive in the test. */
function ranged(bytes: Uint8Array) {
  return async (offset: number, length: number) => bytes.subarray(offset, offset + length);
}

/** The fixture archive, opened by the test to build a real content CFI. */
async function archiveOf(bytes: Uint8Array) {
  return openZip(ranged(bytes), bytes.length);
}

/** Every non-empty text node under `root`, in document order. */
function textNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if ((node.nodeValue || "").trim() !== "") nodes.push(node);
  }
  return nodes;
}

/**
 * A CFI for the first character of `needle` in `entry` of `bytes`, the way the
 * Frame writes one after a page turn: the section's CFI joined to a range
 * inside that section's parsed document.
 */
async function savedCfi(bytes: Uint8Array, entry: string, needle: string): Promise<string> {
  const archive = await archiveOf(bytes);
  const markup = await archive.readText(entry);
  if (markup === null) throw new Error(`the fixture has no ${entry}`);
  const doc = new DOMParser().parseFromString(markup, "application/xhtml+xml");
  const node = textNodes(doc.body).find((candidate) =>
    (candidate.nodeValue || "").includes(needle)
  );
  if (!node) throw new Error(`the fixture has no ${needle}`);
  const offset = (node.nodeValue || "").indexOf(needle);
  const range = doc.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sectionIndex = entry.includes("chapter2") ? 1 : 0;
  return foliate.CFI.joinIndir(
    foliate.CFI.fake.fromIndex(sectionIndex),
    foliate.CFI.fromRange(range)
  );
}

interface OpenOptions {
  format?: string;
  position?: unknown;
  settings?: { fontSize: number; lineWidth: string; pdfFit: "width" | "page" };
  /** Extra `__readerTestHooks` seams, such as a search clock. */
  hooks?: Record<string, unknown>;
  /** Re-zip the fixture with every entry deflated, so the Frame inflates each one. */
  deflated?: boolean;
  /** Garble every deflated entry the port hands over, so none inflates. */
  garbled?: boolean;
  /** Opens the Frame on the Shelf, with these rows, instead of a Document. */
  shelf?: FrameShelfState;
  /** The Shelf's localized strings; a shelf open without them draws nothing. */
  shelfLabels?: FrameShelfLabels;
  /** The language the open message names, so `labels` stay a matching set. */
  language?: string;
  /** The Shelf view settings the Worker remembered; a shelf open sends them with the Shelf. */
  shelfView?: ShelfViewSettings;
}

/** One `window.maibuk.port`: answers reads and archive requests from a fixture. */
class FakeBookPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly messages: Record<string, unknown>[] = [];
  private opened: ReturnType<typeof openZip> | null = null;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly garbled = false
  ) {}

  start(): void {}
  close(): void {}

  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
    if (message.kind === "read") {
      const offset = Math.max(0, Number(message.offset));
      const length = Math.max(0, Number(message.length));
      const slice = this.bytes.slice(offset, offset + length);
      queueMicrotask(() =>
        this.deliver({ kind: "bytes", id: message.id, buffer: slice.buffer.slice(0) })
      );
      return;
    }
    if (message.kind === "zip-list" || message.kind === "zip-entry") {
      void this.answerArchive(message);
    }
  }

  private archive() {
    if (this.opened === null) this.opened = openZip(ranged(this.bytes), this.bytes.length);
    return this.opened;
  }

  private async answerArchive(message: Record<string, unknown>): Promise<void> {
    const id = Number(message.id);
    try {
      const archive = await this.archive();
      if (message.kind === "zip-list") {
        this.deliver({
          kind: "zip-list",
          id,
          entries: archive.entries.map(({ name, size }) => ({ name, size })),
        });
        return;
      }
      const name = String(message.name);
      const { bytes, deflated } = await archive.stored(name);
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      // A garbled archive keeps its directory but its deflated data will not inflate.
      if (this.garbled && deflated) new Uint8Array(buffer).fill(0xff);
      this.deliver({ kind: "zip-data", id, buffer, deflated });
    } catch (error) {
      const code = error instanceof ZipError ? error.code : "corrupt";
      this.deliver({ kind: "zip-error", id, code });
    }
  }

  /** Hands the Frame one Worker -> Frame message. */
  deliver(message: Record<string, unknown>): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}

interface Frame {
  port: FakeBookPort;
  cleanups: (() => void)[];
  open(options?: OpenOptions): void;
  shadowText(): string;
  shadowHits(): HTMLElement[];
}

/** Loads the Frame's markup, sanitizer, script, and stubs, with a fixture port. */
function loadFrame(name: string, options: OpenOptions = {}): Frame {
  const bytes = options.deflated === true ? deflatedArchive(fixture(name)) : fixture(name);
  document.documentElement.innerHTML = HTML.replace(/^<!doctype html>\s*/i, "");
  const port = new FakeBookPort(bytes, options.garbled === true);
  (window as unknown as { maibuk: unknown }).maibuk = { port };
  const cleanups: (() => void)[] = [];
  (globalThis as Record<string, unknown>).__readerTestHooks = {
    importFoliate: async () => foliate,
    importPurify: async () => ({ default: purify }),
    viewportWidth: 800,
    viewportHeight: 600,
    // jsdom has no layout: give each fixture section a stable page count.
    measureFlow: ({ sectionIndex }: { sectionIndex: number }) => (sectionIndex === 0 ? 3 : 2),
    positionDebounceMs: 20,
    onReady: (cleanup: () => void) => cleanups.push(cleanup),
    ...(options.hooks ?? {}),
  };
  try {
    new Function(SANITIZER)();
    new Function(SCRIPT)();
  } finally {
    delete (globalThis as Record<string, unknown>).__readerTestHooks;
  }
  const format = options.format ?? "epub";
  const frame: Frame = {
    port,
    cleanups,
    open(openOptions: OpenOptions = {}) {
      const shelf = openOptions.shelf ?? options.shelf;
      const language = openOptions.language ?? options.language ?? "en";
      const shared = {
        kind: "open",
        position: openOptions.position ?? options.position ?? null,
        settings: openOptions.settings ??
          options.settings ?? { fontSize: 100, lineWidth: "medium", pdfFit: "width" },
        size: bytes.length,
        labels: language === "es" ? LABELS_ES : LABELS,
        language,
        appearance: { colorScheme: "light", eink: false },
      };
      if (shelf !== undefined) {
        port.deliver({
          ...shared,
          view: "shelf",
          entry: null,
          shelf,
          shelfLabels: openOptions.shelfLabels ?? options.shelfLabels ?? null,
          ...(openOptions.shelfView === undefined ? {} : { shelfView: openOptions.shelfView }),
        });
        return;
      }
      port.deliver({
        ...shared,
        entry: { id: "doc-1", title: "Fixture", author: "", format: openOptions.format ?? format },
        foliate: { source: "export {};", purify: "export default {};" },
      });
    },
    shadowText() {
      const host = document.getElementById("stage")?.firstElementChild;
      const shadow = host && (host as HTMLElement).shadowRoot;
      return shadow ? shadow.textContent || "" : "";
    },
    shadowHits() {
      const host = document.getElementById("stage")?.firstElementChild as HTMLElement | null;
      const shadow = host?.shadowRoot;
      return shadow ? Array.from(shadow.querySelectorAll<HTMLElement>(".reader-search-hit")) : [];
    },
  };
  return frame;
}

/** The element with `id`, which the loaded markup always carries. */
function el(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element;
}

/** The Shelf's cells, as the Frame drew them, in grid order. */
function shelfCells(): HTMLElement[] {
  return Array.from(el("shelf-root").querySelectorAll<HTMLElement>('[role="gridcell"]'));
}

/** The title line of one drawn cell, in whichever layout the Shelf draws it. */
function cellTitle(cell: HTMLElement): string {
  return (
    cell.querySelector(".shelf-card__title, .shelf-list__title, .shelf-compact__title")
      ?.textContent ?? ""
  );
}

/** The cell whose title line reads `title`. */
function shelfCell(title: string): HTMLElement {
  const cell = shelfCells().find((candidate) => cellTitle(candidate) === title);
  if (cell === undefined) throw new Error(`no Shelf row titled ${title}`);
  return cell;
}

/** The row index the grid draws `cell` in. */
function shelfRowOf(cell: HTMLElement): number {
  const rows = Array.from(el("shelf-root").querySelectorAll('[role="row"]'));
  const row = cell.closest('[role="row"]');
  return row === null ? -1 : rows.indexOf(row);
}

/** The Shelf's heading text. */
/**
 * Tabs from the Shelf's toolbar into its grid: the search field is the first
 * stop on Wide, then the header and toolbar controls, then the grid's one cell.
 */
async function tabToGrid(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  for (let step = 0; step < 12; step++) {
    await user.tab();
    if ((document.activeElement as HTMLElement | null)?.getAttribute("role") === "gridcell") return;
  }
  throw new Error("Tab never reached the Shelf grid");
}

function shelfHeading(): string {
  return el("shelf-root").querySelector(".shelf__heading")?.textContent ?? "";
}

/** The Shelf's count line. */
function shelfCount(): string {
  return el("shelf-root").querySelector(".shelf__count")?.textContent ?? "";
}

/** The Shelf button carrying `label` as its text, or the More button for a title. */
function shelfButton(label: string): HTMLButtonElement {
  const button = Array.from(el("shelf-root").querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label
  );
  if (button === undefined) throw new Error(`no Shelf button labelled ${label}`);
  return button;
}

/** The labels of the Menu rows currently drawn, in order. */
function menuRows(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')).map(
    (item) => item.textContent ?? ""
  );
}

/** The drawn Menu row carrying `label`. */
function menuRow(label: string): HTMLButtonElement {
  const item = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')
  ).find((candidate) => candidate.textContent === label);
  if (item === undefined) throw new Error(`no Menu row labelled ${label}`);
  return item;
}

/** Every message the Frame posted with this `kind`. */
function posted(kind: string): Record<string, unknown>[] {
  return frame?.port.messages.filter((message) => message.kind === kind) ?? [];
}

/** The indexes of the marks the Frame has flagged as the current match. */
function currentHitIndexes(current: Frame): number[] {
  return current
    .shadowHits()
    .flatMap((hit, index) => (hit.classList.contains("is-current") ? [index] : []));
}

let frame: Frame | null = null;
let objectUrls = 0;

beforeEach(() => {
  objectUrls = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => `blob:reader-${++objectUrls}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  // jsdom never decodes an image; a rejected bitmap skips the optional cover.
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    writable: true,
    value: vi.fn(async () => {
      throw new Error("no bitmap in jsdom");
    }),
  });
});

afterEach(() => {
  for (const cleanup of frame?.cleanups ?? []) cleanup();
  frame = null;
  delete (window as unknown as { maibuk?: unknown }).maibuk;
  delete (globalThis as Record<string, unknown>).ReaderSanitizer;
  document.documentElement.innerHTML = "";
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  Reflect.deleteProperty(globalThis, "createImageBitmap");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Flowing view", () => {
  it("opens a reflowable EPUB at its saved CFI", async () => {
    const bytes = fixture("flowing.epub");
    const cfi = await savedCfi(bytes, "OEBPS/chapter2.xhtml", "The journey");
    frame = loadFrame("flowing.epub", { position: { kind: "cfi", cfi } });
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 2 in this section"));
    expect(frame.shadowText()).toContain("The journey continues past the desert.");
    expect(frame.shadowText()).not.toContain("The spice must flow");
  });

  it("crosses into the next section when the last page turns", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 3 in this section"));
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 2 in this section"));
    expect(frame.shadowText()).toContain("The journey continues past the desert.");
  });

  it("keeps the Reading Position when the font size changes", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const positions = () =>
      frame?.port.messages.filter((message) => message.kind === "position") ?? [];
    // Let the debounced opening position land, so the page turn's position is
    // not folded into it before the key press.
    await vi.waitFor(() => expect(positions().length).toBeGreaterThanOrEqual(1));
    await userEvent.setup().keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 3 in this section"));
    await vi.waitFor(() => expect(positions().length).toBeGreaterThanOrEqual(2));
    const before = positions().at(-1) as { position: unknown };
    const beforeCount = positions().length;

    frame.port.deliver({ kind: "command", id: "increaseFontSize" });
    await vi.waitFor(() =>
      expect(frame?.port.messages.find((message) => message.kind === "settings")).toEqual({
        kind: "settings",
        settings: { fontSize: 110, lineWidth: "medium", pdfFit: "width" },
      })
    );
    await vi.waitFor(() => expect(positions().length).toBeGreaterThan(beforeCount));
    expect(el("page-indicator").textContent).toBe("2 of 3 in this section");
    const after = positions().at(-1) as { position: unknown };
    expect(after.position).toEqual(before.position);
  });

  it("searches across sections in time slices and counts every match", async () => {
    const slices: number[] = [];
    let clock = 0;
    frame = loadFrame("flowing.epub", {
      hooks: {
        now: () => (clock += 100),
        onSearchSlice: () => slices.push(clock),
      },
    });
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    await userEvent.setup().keyboard("{Control>}f{/Control}");

    // The search yields with `setTimeout(0)` once a slice runs over 16 ms; the
    // injected clock crosses that on the first section.
    const input = el("search-input") as HTMLInputElement;
    input.value = "spice";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    expect(slices.length).toBeGreaterThan(0);
    expect(frame.shadowText()).toContain("The spice must flow");
  });

  it("marks the current match and moves it with Next and Previous", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    await user.type(el("search-input"), "spice");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    // Section one reads "The spice must flow", "Spice is life ... The spice is
    // the desert.": three marks, and only the first is current.
    expect(frame.shadowHits().map((hit) => hit.textContent)).toEqual(["spice", "Spice", "spice"]);
    expect(currentHitIndexes(frame)).toEqual([0]);

    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("2 of 3"));
    expect(currentHitIndexes(frame)).toEqual([1]);
    expect(frame.shadowHits()[1]?.textContent).toBe("Spice");

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    expect(currentHitIndexes(frame)).toEqual([0]);

    await user.click(el("search-next"));
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("2 of 3"));
    expect(currentHitIndexes(frame)).toEqual([1]);

    await user.click(el("search-previous"));
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    expect(currentHitIndexes(frame)).toEqual([0]);
  });

  it("leaves no native text selection after search, Next, and paging", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    await user.type(el("search-input"), "spice");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    await user.click(el("search-next"));
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("2 of 3"));
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 3 in this section"));

    const selection = window.getSelection();
    expect(selection === null || selection.rangeCount === 0 || selection.isCollapsed).toBe(true);
  });
});

describe("Document markup", () => {
  it("never runs an inline script or handler from a section", async () => {
    delete (globalThis as Record<string, unknown>).__readerScriptRan;
    delete (globalThis as Record<string, unknown>).__readerHandlerRan;
    delete (globalThis as Record<string, unknown>).__readerLinkRan;
    frame = loadFrame("flowing.epub", { position: { kind: "section", index: 1, fraction: 0 } });
    frame.open();
    await vi.waitFor(() =>
      expect(frame?.shadowText()).toContain("The journey continues past the desert.")
    );
    expect((globalThis as Record<string, unknown>).__readerScriptRan).toBeUndefined();
    expect((globalThis as Record<string, unknown>).__readerHandlerRan).toBeUndefined();
    expect((globalThis as Record<string, unknown>).__readerLinkRan).toBeUndefined();
  });

  it("drops external images and turns archive images into blob urls", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const host = document.getElementById("stage")?.firstElementChild as HTMLElement;
    const shadow = host.shadowRoot as ShadowRoot;
    const images = Array.from(shadow.querySelectorAll("img"));
    expect(images).toHaveLength(3);
    const sources = images.map((image) => image.getAttribute("src"));
    expect(sources.filter((src) => src?.startsWith("blob:"))).toHaveLength(1);
    expect(sources.some((src) => src?.includes("example.com"))).toBe(false);
    expect(sources.filter((src) => src === null)).toHaveLength(2);
  });

  // Most real EPUBs deflate their entries. The Worker hands them over as stored
  // and the Frame inflates them natively, so the Worker never stalls on them.
  it("inflates a deflated EPUB's sections and images in the Frame", async () => {
    frame = loadFrame("flowing.epub", { deflated: true });
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    expect(frame.shadowText()).toContain("The spice must flow");
    const host = document.getElementById("stage")?.firstElementChild as HTMLElement;
    const sources = Array.from((host.shadowRoot as ShadowRoot).querySelectorAll("img")).map(
      (image) => image.getAttribute("src")
    );
    expect(sources.filter((src) => src?.startsWith("blob:"))).toHaveLength(1);
  });
});

describe("Escape order", () => {
  it("closes search, then Contents, then leaves for the Shelf", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    expect(el("search-bar").hidden).toBe(false);
    await user.keyboard("{Escape}");
    expect(el("search-bar").hidden).toBe(true);
    expect(frame.port.messages.some((message) => message.kind === "back")).toBe(false);

    await user.click(el("contents-toggle"));
    expect(el("contents").hidden).toBe(false);
    await user.keyboard("{Escape}");
    expect(el("contents").hidden).toBe(true);
    expect(frame.port.messages.some((message) => message.kind === "back")).toBe(false);

    await user.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(frame?.port.messages.some((message) => message.kind === "back")).toBe(true)
    );
  });

  it("never lets an appearance redraw flip a surface the author just opened", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));

    // The author opens Contents: the engine writes the panel's visibility, and
    // the app mirrors it into the toggle's aria-expanded a microtask later. A
    // native click holds the task open across the next two lines, which is the
    // only way to reach the redraw before the mirror lands (user-event flushes
    // microtasks inside every step, and the race never happens there).
    el("contents-toggle").click();
    expect(el("contents").hidden).toBe(false);

    // An appearance change in the same task re-renders the app before that
    // mirror lands. The redraw must never re-impose its stale surfaces state
    // on the DOM: the panel stays open, the toggle reads expanded.
    frame.port.deliver({ kind: "appearance", appearance: { colorScheme: "dark", eink: false } });
    expect(el("contents").hidden).toBe(false);
    await vi.waitFor(() =>
      expect(el("contents-toggle").getAttribute("aria-expanded")).toBe("true")
    );
  });
});

describe("Page view", () => {
  it("turns the pages of a CBZ in natural file-name order", async () => {
    frame = loadFrame("pages.cbz", { format: "cbz" });
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 8"));
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 8"));
    const image = el("stage").querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/^blob:/);
    expect(image?.getAttribute("alt")).toBe("page-2.png");
    await user.keyboard("{End}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("8 of 8"));
    await user.keyboard("{Home}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 8"));
  });

  it("pages a fixed-layout EPUB and reports its page count", async () => {
    frame = loadFrame("fixed-layout.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 2"));
    await userEvent.setup().keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 2"));
    const host = el("stage").firstElementChild as HTMLElement;
    expect(host.style.transform).toContain("scale(");
    await vi.waitFor(() =>
      expect(frame?.port.messages.find((message) => message.kind === "meta")).toMatchObject({
        kind: "meta",
        title: "Plates",
        pageCount: 2,
      })
    );
  });
});

describe("the other reflowable formats", () => {
  it("opens a MOBI and draws its single text section", async () => {
    frame = loadFrame("story.mobi", { format: "mobi" });
    frame.open();
    await vi.waitFor(() =>
      expect(frame?.shadowText()).toContain("The desert keeps its own record of the journey.")
    );
    await vi.waitFor(() =>
      expect(frame?.port.messages.find((message) => message.kind === "meta")).toMatchObject({
        kind: "meta",
        title: "Notes",
      })
    );
  });

  it("opens an FB2 and its second section", async () => {
    frame = loadFrame("story.fb2", {
      format: "fb2",
      position: { kind: "section", index: 1, fraction: 0 },
    });
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 2 in this section"));
    expect(frame.shadowText()).toContain("The archive keeps every draft.");
    frame.port.deliver({ kind: "command", id: "nextPage" });
    frame.port.deliver({ kind: "command", id: "nextPage" });
    await vi.waitFor(() =>
      expect(frame?.shadowText()).toContain("A second section follows the first.")
    );
  });
});

describe("refusing an unreadable Document", () => {
  it("reports a corrupt EPUB as damaged", async () => {
    frame = loadFrame("corrupt.epub");
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    expect(el("message").textContent).toBe(LABELS.errorDamaged);
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "corrupt",
      reason: LABELS.errorDamaged,
    });
  });

  it("reports an EPUB whose entries will not inflate as damaged", async () => {
    frame = loadFrame("flowing.epub", { deflated: true, garbled: true });
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    expect(el("message").textContent).toBe(LABELS.errorDamaged);
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "corrupt",
      reason: LABELS.errorDamaged,
    });
  });

  it("reports an EPUB whose content is encrypted as DRM", async () => {
    frame = loadFrame("encrypted.epub");
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    expect(el("message").textContent).toBe(LABELS.errorDrm);
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "encrypted",
      reason: LABELS.errorDrm,
    });
  });

  it("reports a MOBI with the DRM flag before reading its text", async () => {
    frame = loadFrame("drm.mobi", { format: "mobi" });
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    expect(el("message").textContent).toBe(LABELS.errorDrm);
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "encrypted",
      reason: LABELS.errorDrm,
    });
  });

  it("reports an AZW3 without readable KF8 tables as damaged", async () => {
    frame = loadFrame("story.azw3", { format: "azw3" });
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    expect(el("message").textContent).toBe(LABELS.errorDamaged);
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "corrupt",
      reason: LABELS.errorDamaged,
    });
  });
});

/**
 * The Shelf seam in the built bundle (#944 packet 7): the rows the Worker sends
 * draw into `#shelf-root`, the grid's keys and menus answer, and every Shelf
 * action comes back as the message the Worker acts on. Each test plays the
 * Worker's half by delivering the answer it would post.
 */
describe("the Shelf", () => {
  it("draws a wire-shaped Shelf without the File Grant or Fingerprint", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: READY_SHELF, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(3));

    expect(shelfHeading()).toBe("All Documents");
    expect(shelfCount()).toBe("3 Documents");
    expect(shelfCells().map(cellTitle)).toEqual(["Dune", "Emma", "Broken Spine"]);
    expect(shelfCell("Dune").querySelector(".shelf-card__meta")?.textContent).toBe(
      "Frank Herbert · 42%"
    );
    expect(shelfCell("Emma").querySelector(".shelf-card__meta")?.textContent).toBe(
      "Jane Austen · New"
    );
    expect(shelfCell("Broken Spine").querySelector(".shelf-card__meta")?.textContent).toBe("New");
    expect(shelfCell("Broken Spine").querySelector(".shelf-card__status")?.textContent).toBe(
      "Can't open this file"
    );

    // A Missing Document wears the chip; a readable or unreadable one does not.
    const chip = shelfCell("Emma").querySelector(".shelf-card__chip");
    expect(chip?.textContent).toBe("Missing");
    expect(shelfCell("Dune").querySelector(".shelf-card__chip")).toBeNull();
    expect(shelfCell("Broken Spine").querySelector(".shelf-card__chip")).toBeNull();

    // Whatever the Worker sent alongside a row, the Frame draws none of it.
    const markup = el("shelf-root").innerHTML;
    for (const row of [READABLE_ROW, MISSING_ROW, UNREADABLE_ROW]) {
      expect(markup).not.toContain(row.grant);
      expect(markup).not.toContain(row.fingerprint);
      expect(markup).not.toContain(row.storageKey);
    }
    expect(markup).not.toContain("grant-");
    expect(markup).not.toContain("fingerprint-");
    expect(markup).not.toContain("reader.shelf.");
  });

  it("moves the grid's cell focus by key and opens the menu from the focused row", async () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      wireRow({
        id: `shelf-doc-${index + 1}`,
        title: `Shelf Book ${index + 1}`,
        progressText: `${index * 10}%`,
        progressPercent: index * 10,
      })
    );
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: rows }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(8));
    const user = userEvent.setup();

    // The search field is the first tab stop on Wide and the grid's single
    // cell follows the toolbar: Tab reaches the grid, not each of its rows.
    await user.tab();
    expect(document.activeElement).toBe(
      el("shelf-root").querySelector('input[aria-label="Search the Shelf"]')
    );
    await tabToGrid(user);
    expect(document.activeElement).toBe(shelfCells()[0]);
    expect(el("shelf-root").querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(shelfCells()[1]);
    expect(cellTitle(document.activeElement as HTMLElement)).toBe("Shelf Book 2");
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(shelfCells()[0]);
    // A six-column Wide grid puts the next row six cells along.
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(shelfCells()[6]);
    expect(shelfRowOf(document.activeElement as HTMLElement)).toBe(1);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(shelfCells()[0]);
    expect(shelfRowOf(document.activeElement as HTMLElement)).toBe(0);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(shelfCells()[7]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(shelfCells()[0]);

    // Enter on a readable row asks the Worker for its Document.
    await user.keyboard("{Enter}");
    expect(posted("shelf-command")).toContainEqual({
      kind: "shelf-command",
      id: "openDocument",
      documentId: "shelf-doc-1",
    });

    await user.keyboard("{ContextMenu}");
    await vi.waitFor(() => expect(menuRows()).toEqual(["Open", "Remove from Shelf…"]));
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    expect(document.activeElement).toBe(shelfCells()[0]);

    await user.keyboard("{Shift>}{F10}{/Shift}");
    await vi.waitFor(() => expect(menuRows()).toEqual(["Open", "Remove from Shelf…"]));
    await vi.waitFor(() => expect(document.activeElement).toBe(menuRow("Open")));

    // Escape closes the menu and returns focus to the cell that opened it.
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    expect(document.activeElement).toBe(shelfCells()[0]);
  });

  it("opens the row's Document and comes back to the same Frame with focus on that row", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: READY_SHELF, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(3));
    // The toolbar is hidden on the Shelf, but mounted: its node is the proof
    // that Back never remounts the app.
    const backButton = el("back");

    const user = userEvent.setup();
    await tabToGrid(user);
    expect(document.activeElement).toBe(shelfCell("Dune"));
    await user.keyboard("{Enter}");
    expect(posted("shelf-command")).toContainEqual({
      kind: "shelf-command",
      id: "openDocument",
      documentId: "doc-1",
    });

    // The Worker plays its half: it opens the Document the row named.
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    expect(frame.shadowText()).toContain("The spice must flow");

    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(posted("back")).toHaveLength(1));

    frame.open({ shelf: READY_SHELF, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(3));
    await vi.waitFor(() => expect(document.activeElement).toBe(shelfCell("Dune")));
    expect(el("back")).toBe(backButton);
    expect(posted("back")).toHaveLength(1);
  });

  it("offers a Missing row Locate and Remove only, and posts locateDocument", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: READY_SHELF, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(3));
    const user = userEvent.setup();

    await tabToGrid(user);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(shelfCell("Emma"));
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(menuRows()).toEqual(["Locate", "Remove from Shelf…"]));
    expect(menuRows()).not.toContain("Open");

    await user.click(menuRow("Locate"));
    expect(posted("shelf-command")).toContainEqual({
      kind: "shelf-command",
      id: "locateDocument",
      documentId: "doc-2",
    });
  });

  it("states the Worker's real counts and removes the row the confirmation named", async () => {
    const copy = {
      title: 'Remove "Dune" from the Shelf?',
      body: "Its 3 Bookmarks and 12 Highlights (5 with notes) are deleted too.",
      stats: "Reading Stats are kept. The file stays on your device.",
    };
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: READY_SHELF, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(3));
    const user = userEvent.setup();

    await user.click(shelfButton("More for Dune"));
    await vi.waitFor(() => expect(menuRows()).toEqual(["Open", "Remove from Shelf…"]));
    await user.click(menuRow("Remove from Shelf…"));
    expect(posted("shelf-command")).toContainEqual({
      kind: "shelf-command",
      id: "removeFromShelf",
      documentId: "doc-1",
    });

    frame.port.deliver({ kind: "remove-counts", documentId: "doc-1", ...copy });
    await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.querySelector(".kit-dialog__title")?.textContent).toBe(copy.title);
    expect(dialog.textContent).toContain(copy.body);
    expect(dialog.textContent).toContain(copy.stats);

    const remove = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Remove"
    ) as HTMLButtonElement | undefined;
    expect(remove).toBeDefined();
    await user.click(remove as HTMLButtonElement);
    expect(posted("shelf-remove")).toContainEqual({ kind: "shelf-remove", documentId: "doc-1" });

    frame.port.deliver({
      kind: "shelf",
      state: { status: "ready", entries: [MISSING_ROW, UNREADABLE_ROW] },
    });
    await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    expect(shelfCells().map(cellTitle)).toEqual(["Emma", "Broken Spine"]);
  });

  it("imports files from the empty Shelf through the pick flow", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: [] }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfHeading()).toBe("All Documents"));

    expect(shelfCount()).toBe("0 Documents");
    expect(el("shelf-root").textContent).toContain("Your Shelf is empty");
    expect(el("shelf-root").textContent).toContain(
      "Open PDF, EPUB, MOBI, AZW3, FB2, or CBZ files from your device."
    );

    await userEvent.setup().click(shelfButton("Import files"));
    expect(posted("shelf-command")).toContainEqual({ kind: "shelf-command", id: "openFile" });
  });

  it("re-labels the Shelf copy on a language change", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: READY_SHELF, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfHeading()).toBe("All Documents"));

    frame.port.deliver({
      kind: "language",
      language: "es",
      labels: LABELS_ES,
      shelfLabels: SHELF_LABELS_ES,
    });
    await vi.waitFor(() => expect(shelfHeading()).toBe("Todos los documentos"));
    expect(shelfButton("Importar").textContent).toBe("Importar");
    expect(shelfCount()).toBe("3 documentos");
  });

  it("acts on the selected row for a host Command, and names no row without one", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: READY_SHELF, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(3));

    // A fresh Shelf has no selected row, so the Command names none; the Worker
    // falls back to its own selection (`session.ts`) and, with neither, does
    // nothing.
    frame.port.deliver({ kind: "command", id: "removeFromShelf" });
    expect(posted("shelf-command")).toEqual([{ kind: "shelf-command", id: "removeFromShelf" }]);
    expect(posted("shelf-command")[0]).not.toHaveProperty("documentId");

    // Selecting Emma makes it the row the next Command acts on.
    const user = userEvent.setup();
    await tabToGrid(user);
    await user.keyboard("{ArrowRight}");
    expect(posted("shelf-select")).toContainEqual({ kind: "shelf-select", documentId: "doc-2" });

    frame.port.deliver({ kind: "command", id: "removeFromShelf" });
    expect(posted("shelf-command")).toEqual([
      { kind: "shelf-command", id: "removeFromShelf" },
      { kind: "shelf-command", id: "removeFromShelf", documentId: "doc-2" },
    ]);
  });

  it("ignores a reading Command on the Shelf and runs it once a Document is open", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: READY_SHELF, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(3));
    // Find is a reading Command: with the Shelf as the view nothing it acts on
    // is drawn, so a host Command for it is a no-op.
    expect(el("search-bar").hidden).toBe(true);
    frame.port.deliver({ kind: "command", id: "findInDocument" });
    await Promise.resolve();
    expect(el("search-bar").hidden).toBe(true);

    // The same Command opens the bar once the Frame draws a Document.
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    frame.port.deliver({ kind: "command", id: "findInDocument" });
    await vi.waitFor(() => expect(el("search-bar").hidden).toBe(false));
  });
});

/** The six rows the Shelf views, sort, filter, and search tests share (#945). */
function viewRows(): WireShelfRow[] {
  return [
    wireRow({
      id: "view-a",
      title: "Middlemarch",
      author: "George Eliot",
      format: "epub",
      status: "reading",
      progress: 0.64,
      lastReadAt: 600,
      addedAt: 100,
    }),
    wireRow({
      id: "view-b",
      title: "Dracula",
      author: "Bram Stoker",
      format: "azw3",
      status: "new",
      progress: 0,
      lastReadAt: 500,
      addedAt: 600,
    }),
    wireRow({
      id: "view-c",
      title: "Persuasion",
      author: "Jane Austen",
      format: "mobi",
      status: "finished",
      progress: 1,
      lastReadAt: 400,
      addedAt: 300,
    }),
    wireRow({
      id: "view-d",
      title: "Little Nemo",
      author: "Winsor McCay",
      format: "cbz",
      status: "reading",
      progress: 0.05,
      lastReadAt: 300,
      addedAt: 500,
    }),
    wireRow({
      id: "view-e",
      title: "Origin of Species",
      author: "",
      format: "pdf",
      status: "reading",
      progress: 0.18,
      lastReadAt: 200,
      addedAt: 200,
    }),
    wireRow({
      id: "view-f",
      title: "Fortunata y Jacinta",
      author: "Benito Pérez Galdós",
      format: "fb2",
      status: "new",
      progress: 0,
      lastReadAt: 100,
      addedAt: 400,
    }),
  ];
}

const RECENT_ORDER = [
  "Middlemarch",
  "Dracula",
  "Persuasion",
  "Little Nemo",
  "Origin of Species",
  "Fortunata y Jacinta",
];
const TITLE_ASC = [
  "Dracula",
  "Fortunata y Jacinta",
  "Little Nemo",
  "Middlemarch",
  "Origin of Species",
  "Persuasion",
];
const AUTHOR_ASC = [
  "Fortunata y Jacinta",
  "Dracula",
  "Middlemarch",
  "Persuasion",
  "Little Nemo",
  "Origin of Species",
];
const AUTHOR_DESC = [
  "Little Nemo",
  "Persuasion",
  "Middlemarch",
  "Dracula",
  "Fortunata y Jacinta",
  "Origin of Species",
];
const PROGRESS_DESC = [
  "Persuasion",
  "Middlemarch",
  "Origin of Species",
  "Little Nemo",
  "Dracula",
  "Fortunata y Jacinta",
];
const ADDED_DESC = [
  "Dracula",
  "Little Nemo",
  "Fortunata y Jacinta",
  "Persuasion",
  "Origin of Species",
  "Middlemarch",
];

describe("the Shelf's views, sort, filters, and search (#945)", () => {
  /** The Shelf's titles, in the order the grid draws them. */
  function titles(): string[] {
    return shelfCells().map(cellTitle);
  }

  /** The options popover whose visually hidden title reads `name`. */
  function popover(name: string): HTMLElement {
    const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
      (candidate) => {
        const labelId = candidate.getAttribute("aria-labelledby");
        return labelId !== null && document.getElementById(labelId)?.textContent === name;
      }
    );
    if (dialog === undefined) throw new Error(`no ${name} popover`);
    return dialog;
  }

  /** The radio inside `scope` named by its aria-label, or by its text for a Sort row. */
  function radio(scope: ParentNode, name: string): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (candidate) =>
        (candidate.getAttribute("aria-label") ?? candidate.textContent?.trim()) === name
    );
    if (found === undefined) throw new Error(`no radio named ${name}`);
    return found;
  }

  /** The button inside `scope` whose text is exactly `text`. */
  function buttonIn(scope: ParentNode, text: string): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === text
    );
    if (found === undefined) throw new Error(`no button reading ${text}`);
    return found;
  }

  /** The element in the document whose aria-label is exactly `label`. */
  function byLabel(label: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    if (found === null) throw new Error(`no element labelled ${label}`);
    return found;
  }

  /** The Shelf's Filters toolbar button, which carries a badge once a filter is on. */
  function filtersButton(): HTMLButtonElement {
    const found = Array.from(el("shelf-root").querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.startsWith("Filters") === true
    );
    if (found === undefined) throw new Error("no Filters button");
    return found;
  }

  /** The settings of the last `shelf-view` the Frame posted. */
  function lastSettings(): Record<string, unknown> {
    const posts = posted("shelf-view");
    const last = posts[posts.length - 1];
    if (last === undefined) throw new Error("no shelf-view was posted");
    return last.settings as Record<string, unknown>;
  }

  it("draws the Recent order by default, newest read first", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));

    expect(titles()).toEqual(RECENT_ORDER);
  });

  it("sorts by each order from the Sort popover, reverses it, and moves between orders by key", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));
    const user = userEvent.setup();

    await user.click(byLabel("Sort by: Recent"));
    const sort = popover("Sort by");

    await user.click(radio(sort, "Title"));
    await vi.waitFor(() => expect(titles()).toEqual(TITLE_ASC));
    expect(lastSettings()).toMatchObject({ sort: "title", descending: false });

    await user.click(byLabel("Reverse order: A to Z"));
    await vi.waitFor(() => expect(titles()).toEqual([...TITLE_ASC].reverse()));
    expect(lastSettings()).toMatchObject({ sort: "title", descending: true });

    await user.click(radio(sort, "Author"));
    await vi.waitFor(() => expect(titles()).toEqual(AUTHOR_ASC));
    expect(lastSettings()).toMatchObject({ sort: "author", descending: false });

    await user.click(byLabel("Reverse order: A to Z"));
    await vi.waitFor(() => expect(titles()).toEqual(AUTHOR_DESC));
    expect(lastSettings()).toMatchObject({ sort: "author", descending: true });

    await user.click(radio(sort, "Progress"));
    await vi.waitFor(() => expect(titles()).toEqual(PROGRESS_DESC));
    expect(lastSettings()).toMatchObject({ sort: "progress", descending: true });

    // Progress is the checked radio, so it holds the group's one Tab stop; ArrowDown moves to Date added.
    radio(sort, "Progress").focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(radio(sort, "Date added"));
    await vi.waitFor(() => expect(titles()).toEqual(ADDED_DESC));
    expect(lastSettings()).toMatchObject({ sort: "added", descending: true });
  });

  it("reverses the order by keyboard from its button, with Enter and Space", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));
    const user = userEvent.setup();

    await user.click(byLabel("Sort by: Recent"));
    await user.click(radio(popover("Sort by"), "Title"));
    await vi.waitFor(() => expect(titles()).toEqual(TITLE_ASC));

    byLabel("Reverse order: A to Z").focus();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(titles()).toEqual([...TITLE_ASC].reverse()));
    expect(lastSettings()).toMatchObject({ sort: "title", descending: true });

    byLabel("Reverse order: Z to A").focus();
    await user.keyboard(" ");
    await vi.waitFor(() => expect(titles()).toEqual(TITLE_ASC));
    expect(lastSettings()).toMatchObject({ sort: "title", descending: false });
  });

  it("filters by one status at a time, and removes the status from its toolbar chip", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));
    const user = userEvent.setup();

    await user.click(filtersButton());
    const filters = popover("Filters");

    await user.click(buttonIn(filters, "New"));
    await vi.waitFor(() => expect(titles()).toEqual(["Dracula", "Fortunata y Jacinta"]));
    expect(byLabel("Remove filter Status: New")).toBeDefined();

    await user.click(byLabel("Remove filter Status: New"));
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));

    await user.click(buttonIn(filters, "Reading"));
    await vi.waitFor(() =>
      expect(titles()).toEqual(["Middlemarch", "Little Nemo", "Origin of Species"])
    );
    await user.click(buttonIn(filters, "Reading"));
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));

    await user.click(buttonIn(filters, "Finished"));
    await vi.waitFor(() => expect(titles()).toEqual(["Persuasion"]));
    await user.click(byLabel("Remove filter Status: Finished"));
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));
  });

  it("toggles a status and a format in the Filters popover by keyboard, Enter and Space", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));
    const user = userEvent.setup();

    await user.click(filtersButton());
    const filters = popover("Filters");

    buttonIn(filters, "New").focus();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(titles()).toEqual(["Dracula", "Fortunata y Jacinta"]));
    expect(lastSettings()).toMatchObject({ statuses: ["new"] });

    buttonIn(filters, "New").focus();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));

    buttonIn(filters, "PDF").focus();
    await user.keyboard(" ");
    await vi.waitFor(() => expect(titles()).toEqual(["Origin of Species"]));
    expect(lastSettings()).toMatchObject({ formats: ["pdf"] });

    buttonIn(filters, "PDF").focus();
    await user.keyboard(" ");
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));
    expect(lastSettings()).toMatchObject({ statuses: [], formats: [] });
  });

  it("removes a filter from its toolbar chip by keyboard", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));
    const user = userEvent.setup();

    await user.click(filtersButton());
    await user.click(buttonIn(popover("Filters"), "Finished"));
    await vi.waitFor(() => expect(titles()).toEqual(["Persuasion"]));

    byLabel("Remove filter Status: Finished").focus();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));
    expect(lastSettings()).toMatchObject({ statuses: [] });
  });

  it("filters by each format, combines a status with a format, and badges the Filters button", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));
    const user = userEvent.setup();

    await user.click(filtersButton());
    const filters = popover("Filters");

    const byFormat: Array<[string, string]> = [
      ["PDF", "Origin of Species"],
      ["EPUB", "Middlemarch"],
      ["MOBI", "Persuasion"],
      ["AZW3", "Dracula"],
      ["FB2", "Fortunata y Jacinta"],
      ["CBZ", "Little Nemo"],
    ];
    for (const [format, title] of byFormat) {
      await user.click(buttonIn(filters, format));
      await vi.waitFor(() => expect(titles()).toEqual([title]));
      expect(lastSettings()).toMatchObject({ formats: [format.toLowerCase()] });
      await user.click(buttonIn(filters, format));
      await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));
    }

    await user.click(buttonIn(filters, "Reading"));
    await user.click(buttonIn(filters, "CBZ"));
    await vi.waitFor(() => expect(titles()).toEqual(["Little Nemo"]));
    expect(filtersButton().querySelector(".shelf__badge")?.textContent).toBe("2");
    expect(lastSettings()).toMatchObject({ statuses: ["reading"], formats: ["cbz"] });
  });

  it("says no Document matches, keeps the filter chips, and clears every filter from Clear filters", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));
    const user = userEvent.setup();

    await user.click(filtersButton());
    const filters = popover("Filters");
    await user.click(buttonIn(filters, "Finished"));
    await user.click(buttonIn(filters, "CBZ"));

    await vi.waitFor(() => expect(el("shelf-root").textContent).toContain("No Documents match"));
    expect(shelfCells()).toHaveLength(0);
    expect(shelfButton("Clear filters")).toBeDefined();
    expect(byLabel("Remove filter Status: Finished")).toBeDefined();
    expect(byLabel("Remove filter Format: CBZ")).toBeDefined();

    await user.click(shelfButton("Clear filters"));
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));
    expect(lastSettings()).toMatchObject({ formats: [], statuses: [], search: "" });
  });

  it("focuses the search by the searchShelf Command or Ctrl+F, filters as you type, and Escape clears it and returns focus", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));
    const user = userEvent.setup();
    const searchField = () =>
      el("shelf-root").querySelector<HTMLInputElement>('input[aria-label="Search the Shelf"]');

    // Ctrl+F from the grid focuses the search field; Escape returns focus to the cell it came from.
    await tabToGrid(user);
    const firstCell = document.activeElement as HTMLElement;
    // The Frame handles Ctrl+F itself so the browser's find bar stays shut.
    let findHandled: boolean | null = null;
    const onFind = (event: KeyboardEvent) => {
      if (event.key === "f") findHandled = event.defaultPrevented;
    };
    window.addEventListener("keydown", onFind);
    frame.cleanups.push(() => window.removeEventListener("keydown", onFind));
    await user.keyboard("{Control>}f{/Control}");
    expect(findHandled).toBe(true);
    await vi.waitFor(() => expect(document.activeElement).toBe(searchField()));
    await user.keyboard("{Escape}");
    expect(searchField()?.value).toBe("");
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));
    expect(document.activeElement).toBe(firstCell);

    // "/" is the searchShelf Command's Default Shortcut, so the Frame leaves it
    // unhandled: the shim forwards it and the host, honoring a Custom Shortcut,
    // answers with the Command, which focuses the search field.
    let slashHandled: boolean | null = null;
    const onSlash = (event: KeyboardEvent) => {
      if (event.key === "/") slashHandled = event.defaultPrevented;
    };
    window.addEventListener("keydown", onSlash);
    frame.cleanups.push(() => window.removeEventListener("keydown", onSlash));
    await user.keyboard("/");
    expect(slashHandled).toBe(false);
    expect(document.activeElement).toBe(firstCell);
    frame.port.deliver({ kind: "command", id: "searchShelf" });
    await vi.waitFor(() => expect(document.activeElement).toBe(searchField()));
    await user.keyboard("austen");
    await vi.waitFor(() => expect(titles()).toEqual(["Persuasion"]));
    expect(shelfCount()).toBe("1 of 6");

    // A query that matches nothing draws the empty state, and the field keeps its text.
    await user.keyboard("zz");
    await vi.waitFor(() => expect(el("shelf-root").textContent).toContain("No Documents match"));
    expect(shelfCount()).toBe("0 of 6");

    // Accents are folded: "galdos" finds "Benito Pérez Galdós".
    await user.clear(searchField() as HTMLInputElement);
    await user.keyboard("galdos");
    await vi.waitFor(() => expect(titles()).toEqual(["Fortunata y Jacinta"]));
    expect(shelfCount()).toBe("1 of 6");

    await user.keyboard("{Escape}");
    expect(searchField()?.value).toBe("");
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));
    // Focus goes back to the Middlemarch cell that had it before "/". The search
    // unmounted that cell while it filtered the grid, so the cell focus lands on
    // is a new node for the same Document; the Document is what the author sees.
    expect(document.activeElement?.getAttribute("role")).toBe("gridcell");
    expect(cellTitle(document.activeElement as HTMLElement)).toBe("Middlemarch");
    expect(lastSettings()).toMatchObject({ search: "" });
  });

  it("draws the chosen layout, hides Cover size outside Grid, and posts the cover size", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({ shelf: { status: "ready", entries: viewRows() }, shelfLabels: SHELF_LABELS });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(6));
    const user = userEvent.setup();
    const shelfView = () =>
      document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Shelf view"]');
    const coverSize = () =>
      document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Cover size"]');

    await user.click(radio(shelfView() as HTMLElement, "List"));
    await vi.waitFor(() =>
      expect(shelfCells().every((cell) => cell.classList.contains("shelf-list"))).toBe(true)
    );
    expect(shelfCells()).toHaveLength(6);
    expect(coverSize()).toBeNull();
    expect(lastSettings()).toMatchObject({ layout: "list" });

    await user.click(radio(shelfView() as HTMLElement, "Compact"));
    await vi.waitFor(() =>
      expect(shelfCells().every((cell) => cell.classList.contains("shelf-compact"))).toBe(true)
    );
    expect(coverSize()).toBeNull();

    await user.click(radio(shelfView() as HTMLElement, "Grid"));
    await vi.waitFor(() => expect(coverSize()).not.toBeNull());
    expect(shelfCells().every((cell) => cell.classList.contains("shelf-card"))).toBe(true);

    await user.click(radio(coverSize() as HTMLElement, "Small"));
    await vi.waitFor(() => expect(lastSettings()).toMatchObject({ coverSize: "small" }));
    expect(titles()).toEqual(RECENT_ORDER);
  });

  it("restores the remembered view, sort, status filter, and search with the Shelf", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({
      shelf: { status: "ready", entries: viewRows() },
      shelfLabels: SHELF_LABELS,
      shelfView: {
        layout: "list",
        coverSize: "large",
        sort: "title",
        descending: true,
        formats: [],
        statuses: ["reading"],
        search: "",
        collection: null,
      },
    });
    await vi.waitFor(() => expect(shelfCells()).toHaveLength(3));

    expect(shelfCells().every((cell) => cell.classList.contains("shelf-list"))).toBe(true);
    expect(titles()).toEqual(["Origin of Species", "Middlemarch", "Little Nemo"]);
    expect(byLabel("Sort by: Title").textContent).toContain("Title");
    expect(byLabel("Remove filter Status: Reading")).toBeDefined();
  });

  it("answers the host's search, filter-clear, and options Commands", async () => {
    frame = loadFrame("flowing.epub");
    frame.open({
      shelf: { status: "ready", entries: viewRows() },
      shelfLabels: SHELF_LABELS,
      shelfView: {
        layout: "grid",
        coverSize: "medium",
        sort: "recent",
        descending: true,
        formats: [],
        statuses: ["new"],
        search: "",
        collection: null,
      },
    });
    await vi.waitFor(() => expect(titles()).toEqual(["Dracula", "Fortunata y Jacinta"]));
    const searchField = () =>
      el("shelf-root").querySelector<HTMLInputElement>('input[aria-label="Search the Shelf"]');

    frame.port.deliver({ kind: "command", id: "searchShelf" });
    await vi.waitFor(() => expect(document.activeElement).toBe(searchField()));

    (document.activeElement as HTMLElement).blur();
    frame.port.deliver({ kind: "command", id: "findInDocument" });
    await vi.waitFor(() => expect(document.activeElement).toBe(searchField()));

    frame.port.deliver({ kind: "command", id: "clearShelfFilters" });
    await vi.waitFor(() => expect(titles()).toEqual(RECENT_ORDER));
    expect(lastSettings()).toMatchObject({ statuses: [], formats: [], search: "" });

    frame.port.deliver({ kind: "command", id: "showShelfOptions" });
    await vi.waitFor(() => expect(popover("Filters")).toBeDefined());
  });
});
