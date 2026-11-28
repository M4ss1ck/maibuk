/** @jsxImportSource preact */
/**
 * The Reader Frame's Shelf (#944 packet 5): the ready grid, its roving focus,
 * the per-row Document menu, and the Remove confirmation, driven through a real
 * Preact tree in jsdom. Every keyboard path is a real `user-event` press and
 * every assertion is the behavior a reader sees (focus, the open layer, the
 * command fired), never an attached handler or an attribute standing in for
 * operability.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configure, fireEvent, getConfig, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentChild } from "preact";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameShelfCollectionMessage } from "./protocol";
import { Shelf, type ShelfCollectionRequest, type ShelfNotice, type ShelfRemoval } from "./shelf";
import { defaultShelfView } from "./shelf-options";
import type {
  FrameCollection,
  FrameImportState,
  FrameShelfEntry,
  FrameShelfLabels,
  FrameShelfState,
  ShelfViewSettings,
} from "./types";

const containers: HTMLElement[] = [];
const nativeWidth = window.innerWidth;
const baseConfig = getConfig();
const shelfCss = readFileSync(join(__dirname, "..", "assets", "ui", "shelf.css"), "utf8");

const LABELS: FrameShelfLabels = {
  shelf: "Shelf",
  import: "Import",
  importFiles: "Import files",
  emptyTitle: "Your Shelf is empty",
  emptyDescription: "Open PDF, EPUB, MOBI, AZW3, FB2, or CBZ files from your device.",
  loading: "Loading your Shelf…",
  error: "Reader couldn't load your Shelf.",
  documentsCountOne: "{{count}} Document",
  documentsCountOther: "{{count}} Documents",
  open: "Open",
  remove: "Remove from Shelf…",
  locate: "Locate",
  missing: "Missing",
  moreFor: "More for {{title}}",
  removeConfirm: "Remove",
  cancel: "Cancel",
  newLabel: "New",
  finishedLabel: "Finished",
  documentActions: "Document actions",
  dismiss: "Dismiss",
  allDocuments: "All Documents",
  shownOf: "{{shown}} of {{total}}",
  searchLabel: "Search the Shelf",
  searchPlaceholder: "Search title or author",
  closeSearch: "Close search",
  clearSearch: "Clear search",
  searchMatchesOne: '{{count}} Document matches "{{search}}" · {{layout}}',
  searchMatchesOther: '{{count}} Documents match "{{search}}" · {{layout}}',
  gridView: "Grid view",
  listView: "List view",
  compactView: "Compact view",
  viewOptions: "View, sort and filter",
  viewOptionsTitle: "View and filters",
  reset: "Reset",
  done: "Done",
  layout: "View",
  layoutLabel: "Shelf view",
  layoutGrid: "Grid",
  layoutList: "List",
  layoutCompact: "Compact",
  coverSize: "Cover size",
  coverSmall: "Small",
  coverMedium: "Medium",
  coverLarge: "Large",
  coverSmallShort: "S",
  coverMediumShort: "M",
  coverLargeShort: "L",
  sortBy: "Sort by",
  sortRecent: "Recent",
  sortTitle: "Title",
  sortAuthor: "Author",
  sortProgress: "Progress",
  sortAdded: "Date added",
  reverseOrder: "Reverse order",
  reverseOrderValue: "Reverse order: {{direction}}",
  sortSummary: "{{sort}} · {{direction}}",
  sortByValue: "Sort by: {{sort}}",
  newestFirst: "Newest first",
  oldestFirst: "Oldest first",
  aToZ: "A to Z",
  zToA: "Z to A",
  mostReadFirst: "Most read first",
  leastReadFirst: "Least read first",
  recentFirst: "Recent first",
  filters: "Filters",
  status: "Status",
  format: "Format",
  all: "All",
  statusNew: "New",
  statusReading: "Reading",
  statusFinished: "Finished",
  statusChip: "Status: {{status}}",
  formatChip: "Format: {{format}}",
  removeFilter: "Remove filter {{filter}}",
  clearFilters: "Clear filters",
  noMatch: "No Documents match",
  remembered: "Showing {{shown}} of {{total}}. Reader remembers these choices on this device.",
  collections: "Collections",
  newCollection: "New Collection",
  newCollectionName: "New Collection name",
  add: "Add",
  railHint: "Drag a Document onto a Collection, or use its menu.",
  collection: "Collection",
  anyCollection: "Any Collection",
  collectionChip: "Collection: {{name}}",
  moreForCollection: "More for {{name}}",
  collectionName: "Name",
  create: "Create",
  renameCollection: "Rename Collection",
  renameAction: "Rename…",
  rename: "Rename",
  deleteAction: "Delete…",
  deleteCollectionTitle: "Delete “{{name}}”?",
  deleteCollectionBody: "Its Documents stay on the Shelf.",
  delete: "Delete",
  duplicateCollection: "A Collection with that name already exists.",
  noCollections: "No Collections yet",
  importDescription:
    "PDF, EPUB, MOBI, AZW3, FB2 and CBZ. Reader opens files where they are and never copies them.",
  importFilesOption: "Files",
  importFilesHint: "Pick one or several files.",
  importFolderOption: "Folder",
  importFolderHint:
    "Every supported file in a folder and its subfolders. Reader reads it once, now, and does not watch it. Importing it again adds only what is new.",
  importFolder: "Import folder",
  importClose: "Close",
  importProgressLabel: "Import progress",
  importCancel: "Cancel",
  importViewReport: "View report",
  importDismiss: "Dismiss",
  importKeepReading:
    "Keep reading; the import runs in the background. Cancel keeps what was added.",
  reportTitle: "Import report",
  reportAdded: "Added",
  reportAlreadyOnShelf: "Already on the Shelf",
  reportRelinked: "Relinked (were Missing)",
  reportRelinkedShort: "Relinked",
  reportUnreadable: "Unreadable",
  reportUnreadableHint: "Reader could not open these. Deal with them outside Reader.",
  reportDetails: "Details",
  reportNone: "None",
};

const REMOVAL: ShelfRemoval = {
  documentId: "doc-1",
  title: 'Remove "Dune" from the Shelf?',
  body: "Its 3 Bookmarks and 12 Highlights (5 with notes) are deleted too.",
  stats: "Reading Stats are kept. The file stays on your device.",
};

function entry(overrides: Partial<FrameShelfEntry> = {}): FrameShelfEntry {
  return {
    id: "doc-1",
    title: "Dune",
    author: "Frank Herbert",
    format: "epub",
    state: "ok",
    progressText: "42%",
    progressPercent: 42,
    statusText: null,
    tone: 0,
    status: "reading",
    lastReadAt: 0,
    addedAt: 0,
    progress: 0.42,
    ...overrides,
  };
}

/**
 * The Worker sends its rows most recently read first; a fixture that leaves
 * `lastReadAt` unset gets times in its own order, so the default Recent sort
 * keeps the order the test wrote.
 */
function workerOrder(entries: FrameShelfEntry[]): FrameShelfEntry[] {
  return entries.map((row, index) =>
    row.lastReadAt === 0 ? { ...row, lastReadAt: entries.length - index } : row
  );
}

function many(count: number): FrameShelfEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry({
      id: `doc-${index + 1}`,
      title: `Book ${index + 1}`,
      author: `Author ${index + 1}`,
      progressPercent: 10 * (index + 1),
      progressText: `${10 * (index + 1)}%`,
    })
  );
}

interface HarnessProps {
  entries?: FrameShelfEntry[];
  status?: FrameShelfState["status"];
  notice?: ShelfNotice | null;
  removal?: ShelfRemoval | null;
  focusDocumentId?: string | null;
  onCommand?: (id: string, documentId?: string) => void;
  onSelect?: (documentId: string) => void;
  onRemove?: (documentId: string) => void;
  onRemoveClose?: () => void;
  onNoticeClose?: () => void;
  /** Omitted keeps the Shelf uncontrolled; given, the caller owns the settings. */
  settings?: ShelfViewSettings;
  onSettingsChange?: (settings: ShelfViewSettings) => void;
  /** Bumped by the searchShelf Command. */
  searchRequest?: number;
  collections?: FrameCollection[];
  onCollection?: (message: FrameShelfCollectionMessage) => void;
  collectionRequest?: ShelfCollectionRequest | null;
}

/** The controlled Shelf a real caller draws, with its menu and removal state. */
function Harness(props: HarnessProps) {
  const { entries = [entry()], status = "ready" } = props;
  const [menuDocumentId, setMenuDocumentId] = useState<string | null>(null);
  const [removal, setRemoval] = useState<ShelfRemoval | null>(props.removal ?? null);
  const [notice, setNotice] = useState<ShelfNotice | null>(props.notice ?? null);
  return (
    <div>
      <button type="button">Before</button>
      <Shelf
        state={{ status, entries: workerOrder(entries), collections: props.collections }}
        labels={LABELS}
        notice={notice}
        removal={removal}
        menuDocumentId={menuDocumentId}
        focusDocumentId={props.focusDocumentId}
        settings={props.settings}
        onSettingsChange={props.onSettingsChange}
        searchRequest={props.searchRequest}
        onCollection={props.onCollection}
        collectionRequest={props.collectionRequest}
        onCommand={props.onCommand ?? (() => {})}
        onSelect={props.onSelect ?? (() => {})}
        onMenuChange={setMenuDocumentId}
        onRemove={(documentId) => {
          props.onRemove?.(documentId);
          setRemoval(null);
        }}
        onRemoveClose={() => {
          props.onRemoveClose?.();
          setRemoval(null);
        }}
        onNoticeClose={() => {
          props.onNoticeClose?.();
          setNotice(null);
        }}
      />
      <button type="button">After</button>
    </div>
  );
}

/** A trigger that opens the Remove confirmation, so focus return can be checked. */
function RemovalCase({
  removal = REMOVAL,
  onRemove = () => {},
  onRemoveClose = () => {},
}: {
  removal?: ShelfRemoval;
  onRemove?: (documentId: string) => void;
  onRemoveClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Request removal
      </button>
      <Shelf
        state={{ status: "ready", entries: [entry()] }}
        labels={LABELS}
        removal={open ? removal : null}
        menuDocumentId={null}
        onCommand={() => {}}
        onSelect={() => {}}
        onMenuChange={() => {}}
        onRemove={(documentId) => onRemove(documentId)}
        onRemoveClose={() => {
          onRemoveClose();
          setOpen(false);
        }}
        onNoticeClose={() => {}}
      />
    </div>
  );
}

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function mount(node: ComponentChild): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  await act(() => {
    render(node, container);
  });
  return container;
}

async function press(action: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await action();
  });
}

beforeEach(() => {
  setWidth(nativeWidth);
  configure({ asyncWrapper: async (callback) => callback() });
});

afterEach(async () => {
  await act(() => {
    for (const container of containers.splice(0)) {
      render(null, container);
      container.remove();
    }
  });
  vi.restoreAllMocks();
  configure({ asyncWrapper: baseConfig.asyncWrapper });
  setWidth(nativeWidth);
});

describe("Shelf grid", () => {
  it("fills three medium columns across a 390 px phone, as the artboard sizes them", async () => {
    setWidth(390);
    const container = await mount(<Harness entries={many(7)} />);

    // (390 - 2 x 16 gutter - 2 x 12 gap) / 3 columns, floored; the height keeps 2:3.
    const covers = Array.from(container.querySelectorAll<HTMLElement>(".kit-cover"));
    expect(covers[0].style.width).toBe("111px");
    expect(covers[0].style.height).toBe("167px");

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getAllByRole("gridcell")).toHaveLength(3);
    expect(within(rows[1]).getAllByRole("gridcell")).toHaveLength(3);
    expect(within(rows[2]).getAllByRole("gridcell")).toHaveLength(1);
  });

  it("draws six columns beside the rail at the artboard's 1280 px Wide and keeps the Worker order", async () => {
    // The artboard's 240 px Collections rail leaves the grid 1040 px.
    setWidth(1280);
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-b", title: "Second in the Worker" }),
          entry({ id: "doc-a", title: "First in the Worker" }),
          ...many(5),
        ]}
      />
    );

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByRole("gridcell")).toHaveLength(6);
    expect(within(rows[1]).getAllByRole("gridcell")).toHaveLength(1);

    const titles = screen
      .getAllByRole("gridcell")
      .map((cell) => cell.querySelector(".shelf-card__title")?.textContent);
    expect(titles.slice(0, 2)).toEqual(["Second in the Worker", "First in the Worker"]);
  });

  it("draws the header, scrolling body, centered empty state, and ink progress from tokens", () => {
    const shell = shelfCss.match(/\.shelf\s*\{[^}]*\}/);
    expect(shell?.[0]).toMatch(/height:\s*100%/);

    const header = shelfCss.match(/\.shelf__header\s*\{[^}]*\}/);
    expect(header?.[0]).toMatch(/height:\s*56px/);
    expect(header?.[0]).toMatch(/border-bottom:\s*1px solid var\(--chrome-border\)/);

    const body = shelfCss.match(/\.shelf__body\s*\{[^}]*\}/);
    expect(body?.[0]).toMatch(/overflow-y:\s*auto/);

    const empty = shelfCss.match(/\.shelf__empty\s*\{[^}]*\}/);
    expect(empty?.[0]).toMatch(/align-items:\s*center/);
    expect(empty?.[0]).toMatch(/text-align:\s*center/);

    const format = shelfCss.match(/\.shelf-card__format\s*\{[^}]*\}/);
    // The drawn badge: 6 px in from the corner, an ink pill from the tokens.
    expect(format?.[0]).toMatch(/right:\s*6px/);
    expect(format?.[0]).toMatch(/background:\s*var\(--format-badge-bg\)/);
    expect(format?.[0]).toMatch(/color:\s*var\(--format-badge-fg\)/);

    const progress = shelfCss.match(/\.shelf-card__progress\s*\{[^}]*\}/);
    expect(progress?.[0]).toMatch(/height:\s*3px/);
    const fill = shelfCss.match(/\.shelf-card__progress-fill\s*\{[^}]*\}/);
    expect(fill?.[0]).toMatch(/background:\s*var\(--chrome-fg\)/);
  });

  it("draws the Missing chip and 40% cover for Missing and permission rows only", async () => {
    setWidth(1200);
    const container = await mount(
      <Harness
        entries={[
          entry({ id: "doc-1", title: "Missing one", state: "missing", statusText: "Missing" }),
          entry({
            id: "doc-2",
            title: "Permission one",
            state: "needs-permission",
            statusText: "Missing",
          }),
          entry({
            id: "doc-3",
            title: "Unreadable one",
            state: "unreadable",
            statusText: "Can't open this file",
          }),
          entry({ id: "doc-4", title: "Readable one" }),
        ]}
      />
    );

    const covers = Array.from(container.querySelectorAll<HTMLElement>(".kit-cover"));
    expect(covers[0].style.opacity).toBe("0.4");
    expect(covers[1].style.opacity).toBe("0.4");
    expect(covers[2].style.opacity).toBe("1");
    expect(covers[3].style.opacity).toBe("1");

    // The chip carries the alert icon and the "Missing" label, as drawn.
    const chips = screen.getAllByText("Missing");
    expect(chips).toHaveLength(2);
    for (const chip of chips) expect(chip.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Can't open this file")).toBeInTheDocument();
  });
});

describe("Shelf keyboard", () => {
  it("keeps one Tab stop and moves by cell with the arrow keys, Home, and End", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    const selected: string[] = [];
    const commands: Array<[string, string | undefined]> = [];
    await mount(
      <Harness
        entries={many(7)}
        onSelect={(id) => selected.push(id)}
        onCommand={(id, documentId) => commands.push([id, documentId])}
      />
    );

    const cells = screen.getAllByRole("gridcell");
    await press(() => user.click(cells[0]));
    expect(document.activeElement).toBe(cells[0]);

    await press(() => user.keyboard("{ArrowRight}"));
    expect(document.activeElement).toBe(cells[1]);
    expect(selected.at(-1)).toBe("doc-2");

    await press(() => user.keyboard("{ArrowDown}"));
    expect(document.activeElement).toBe(cells[4]);

    await press(() => user.keyboard("{End}"));
    expect(document.activeElement).toBe(cells[6]);

    await press(() => user.keyboard("{Home}"));
    expect(document.activeElement).toBe(cells[0]);

    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual([["openDocument", "doc-1"]]);

    // Tab leaves the grid and Shift+Tab returns: the grid owns exactly one tab
    // stop, and a More button is pointer-reachable without being another one.
    await press(() => user.tab());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "After" }));
    await press(() => user.tab({ shift: true }));
    expect(document.activeElement).toBe(cells[0]);
  });

  it("opens the Document menu instead of acting when a row is not readable", async () => {
    setWidth(1200);
    const user = userEvent.setup({ delay: null });
    const commands: Array<[string, string | undefined]> = [];
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-1" }),
          entry({ id: "doc-2", title: "Gone", state: "missing", statusText: "Missing" }),
          entry({
            id: "doc-3",
            title: "Needs permission",
            state: "needs-permission",
            statusText: "Missing",
          }),
          entry({
            id: "doc-4",
            title: "Broken",
            state: "unreadable",
            statusText: "Can't open this file",
          }),
        ]}
        onCommand={(id, documentId) => commands.push([id, documentId])}
      />
    );

    const cells = screen.getAllByRole("gridcell");
    await press(() => user.click(cells[0]));

    await press(() => user.keyboard("{ArrowRight}"));
    await press(() => user.keyboard(" "));
    expect(commands).toEqual([]);
    expect(
      within(screen.getByRole("menu", { name: "Document actions" }))
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Locate", "Remove from Shelf…"]);
    await press(() => user.keyboard("{Escape}"));
    expect(document.activeElement).toBe(cells[1]);

    await press(() => user.keyboard("{ArrowRight}"));
    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual([]);
    expect(
      within(screen.getByRole("menu", { name: "Document actions" }))
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Locate", "Remove from Shelf…"]);
    await press(() => user.keyboard("{Escape}"));

    await press(() => user.keyboard("{ArrowRight}"));
    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual([]);
    expect(
      within(screen.getByRole("menu", { name: "Document actions" }))
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Remove from Shelf…"]);
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Remove from Shelf…" })
    );
    expect(document.activeElement).not.toBe(cells[3]);
  });

  it("opens the Document menu with Shift+F10 and ContextMenu, and returns focus", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<Harness />);

    const cell = screen.getByRole("gridcell");
    await press(() => user.click(cell));
    expect(document.activeElement).toBe(cell);

    await press(() => user.keyboard("{Shift>}{F10}{/Shift}"));
    expect(screen.getByRole("menu", { name: "Document actions" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Open" }));

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(cell);

    await press(() => user.keyboard("{ContextMenu}"));
    expect(screen.getByRole("menu", { name: "Document actions" })).toBeInTheDocument();
  });

  it("returns focus to focusDocumentId when the caller supplies it", async () => {
    setWidth(1200);
    await mount(<Harness entries={many(2)} focusDocumentId="doc-2" />);
    expect(document.activeElement).toBe(screen.getAllByRole("gridcell")[1]);
  });
});

describe("Document menu", () => {
  it("shows Open and Remove for a readable row, Locate for Missing rows, and Remove alone for unreadable", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const commands: Array<[string, string | undefined]> = [];
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-1", title: "Readable" }),
          entry({ id: "doc-2", title: "Gone", state: "missing", statusText: "Missing" }),
          entry({
            id: "doc-3",
            title: "Needs permission",
            state: "needs-permission",
            statusText: "Missing",
          }),
          entry({
            id: "doc-4",
            title: "Broken",
            state: "unreadable",
            statusText: "Can't open this file",
          }),
        ]}
        onCommand={(id, documentId) => commands.push([id, documentId])}
      />
    );

    await press(() => user.click(screen.getByRole("button", { name: "More for Readable" })));
    expect(
      within(screen.getByRole("menu", { name: "Document actions" }))
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Open", "Remove from Shelf…"]);
    expect(commands).toEqual([]);
    await press(() => user.keyboard("{Escape}"));

    await press(() => user.click(screen.getByRole("button", { name: "More for Gone" })));
    expect(
      within(screen.getByRole("menu", { name: "Document actions" }))
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Locate", "Remove from Shelf…"]);
    await press(() => user.keyboard("{Escape}"));

    await press(() =>
      user.click(screen.getByRole("button", { name: "More for Needs permission" }))
    );
    expect(
      within(screen.getByRole("menu", { name: "Document actions" }))
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Locate", "Remove from Shelf…"]);
    await press(() => user.keyboard("{Escape}"));

    await press(() => user.click(screen.getByRole("button", { name: "More for Broken" })));
    expect(
      within(screen.getByRole("menu", { name: "Document actions" }))
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Remove from Shelf…"]);
  });

  it("uses a Popover plus Menu in Wide and a Sheet plus Menu in Narrow", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<Harness />);
    await press(() => user.click(screen.getByRole("button", { name: "More for Dune" })));
    const popover = screen.getByRole("dialog", { name: "Dune" });
    expect(popover).toHaveClass("kit-popover");
    // The rows are drawn inside the Popover, not in a second floating layer.
    expect(within(popover).getByRole("menu", { name: "Document actions" })).toBeInTheDocument();
    await press(() => user.keyboard("{Escape}"));

    setWidth(500);
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await press(() => user.click(screen.getByRole("button", { name: "More for Dune" })));
    // As drawn, the Sheet is named by its Document; the summary is its heading.
    const sheet = screen.getByRole("dialog", { name: "Dune" });
    expect(within(sheet).queryByText("Document actions")).not.toBeInTheDocument();
    expect(sheet).toHaveClass("kit-sheet");
    // The rows are the Sheet's body: a Menu floating beside it sits under the
    // Sheet's scrim, where a tap cannot reach it.
    expect(within(sheet).getByRole("menu", { name: "Document actions" })).toBeInTheDocument();
    expect(within(sheet).getByRole("menuitem", { name: "Open" })).toHaveFocus();
    await press(() => user.keyboard("{ArrowDown}"));
    expect(within(sheet).getByRole("menuitem", { name: "Remove from Shelf…" })).toHaveFocus();
    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Dune" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More for Dune" })).toHaveFocus();
  });

  it("counts one Document in the singular and more in the plural", async () => {
    setWidth(1024);
    await mount(<Harness entries={[entry()]} />);
    expect(screen.getByText("1 Document", { exact: true })).toBeInTheDocument();
    await mount(<Harness entries={many(2)} />);
    expect(screen.getByText("2 Documents", { exact: true })).toBeInTheDocument();
  });

  it("draws the row summary above the menu rows in Wide and Narrow", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<Harness />);

    await press(() => user.click(screen.getByRole("button", { name: "More for Dune" })));
    let menu = screen.getByRole("menu", { name: "Document actions" });
    let summary = menu.querySelector(".shelf-summary");
    expect(summary).not.toBeNull();
    expect(menu.firstElementChild).toBe(summary);
    expect(summary?.querySelector<HTMLElement>(".kit-cover")?.style.width).toBe("40px");
    expect(summary?.querySelector(".shelf-summary__title")?.textContent).toBe("Dune");
    expect(summary?.querySelector(".shelf-summary__meta")?.textContent).toBe("Frank Herbert · 42%");
    expect(summary?.querySelector(".shelf-summary__format")?.textContent).toBe("EPUB");
    await press(() => user.keyboard("{Escape}"));

    setWidth(500);
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await press(() => user.click(screen.getByRole("button", { name: "More for Dune" })));
    menu = screen.getByRole("menu", { name: "Document actions" });
    summary = menu.querySelector(".shelf-summary");
    expect(summary).not.toBeNull();
    expect(menu.firstElementChild).toBe(summary);
    expect(summary?.querySelector(".shelf-summary__title")?.textContent).toBe("Dune");
    expect(summary?.querySelector(".shelf-summary__meta")?.textContent).toBe("Frank Herbert · 42%");
    expect(summary?.querySelector(".shelf-summary__format")?.textContent).toBe("EPUB");
  });

  it("fires the command for the row it acts on", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const commands: Array<[string, string | undefined]> = [];
    await mount(<Harness onCommand={(id, documentId) => commands.push([id, documentId])} />);

    await press(() => user.click(screen.getByRole("button", { name: "More for Dune" })));
    await press(() => user.click(screen.getByRole("menuitem", { name: "Remove from Shelf…" })));
    expect(commands).toEqual([["removeFromShelf", "doc-1"]]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("Shelf states", () => {
  it("shows the empty state and imports files", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const commands: Array<[string, string | undefined]> = [];
    await mount(
      <Harness entries={[]} onCommand={(id, documentId) => commands.push([id, documentId])} />
    );

    expect(screen.getByRole("heading", { name: "Your Shelf is empty" })).toBeInTheDocument();
    expect(
      screen.getByText("Open PDF, EPUB, MOBI, AZW3, FB2, or CBZ files from your device.")
    ).toBeInTheDocument();
    await press(() => user.click(screen.getByRole("button", { name: "Import files" })));
    expect(commands).toEqual([["importFiles", undefined]]);
  });

  it("shows the loading and error states", async () => {
    setWidth(1024);
    await mount(<Harness status="loading" entries={[]} />);
    expect(screen.getByText("Loading your Shelf…")).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    setWidth(1024);
    await mount(<Harness status="error" entries={[]} />);
    expect(screen.getByText("Reader couldn't load your Shelf.")).toBeInTheDocument();
  });

  it("shows a dismissible notice", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const onNoticeClose = vi.fn();
    await mount(
      <Harness
        notice={{ text: "That file is a different Document.", error: true }}
        onNoticeClose={onNoticeClose}
      />
    );

    const status = screen.getByRole("status");
    expect(within(status).getByText("That file is a different Document.")).toBeInTheDocument();
    await press(() => user.click(within(status).getByRole("button", { name: "Dismiss" })));
    expect(onNoticeClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses the primary labeled Import button in Wide and the labeled icon button in Narrow", async () => {
    setWidth(1024);
    const wide = await mount(<Harness />);
    expect(screen.getByRole("button", { name: "Import" })).toHaveClass("kit-button--primary");
    wide.remove();

    setWidth(500);
    await mount(<Harness />);
    const narrowImport = screen.getByRole("button", { name: "Import" });
    expect(narrowImport).toHaveClass("kit-icon-button__button");
  });
});

describe("Remove confirmation", () => {
  it("renders the exact seeded counts as a Wide alertdialog and returns focus on Escape", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const onRemoveClose = vi.fn();
    await mount(<RemovalCase onRemoveClose={onRemoveClose} />);

    const trigger = screen.getByRole("button", { name: "Request removal" });
    await press(() => user.click(trigger));
    const dialog = screen.getByRole("alertdialog", { name: REMOVAL.title });
    expect(dialog).toHaveClass("kit-dialog");
    expect(within(dialog).getByText(REMOVAL.body)).toBeInTheDocument();
    expect(within(dialog).getByText(REMOVAL.stats)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveClass(
      "kit-button--secondary"
    );
    expect(within(dialog).getByRole("button", { name: "Remove" })).toHaveClass(
      "kit-button--destructive"
    );

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("alertdialog", { name: REMOVAL.title })).not.toBeInTheDocument();
    expect(onRemoveClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("removes the Document from the Wide alertdialog", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const onRemove = vi.fn();
    await mount(<RemovalCase onRemove={onRemove} />);

    await press(() => user.click(screen.getByRole("button", { name: "Request removal" })));
    await press(() => user.click(screen.getByRole("button", { name: "Remove" })));
    expect(onRemove).toHaveBeenCalledWith("doc-1");
  });

  it("renders the exact seeded counts as a Narrow alertdialog sheet with no Done", async () => {
    setWidth(500);
    const user = userEvent.setup({ delay: null });
    const onRemove = vi.fn();
    const onRemoveClose = vi.fn();
    await mount(<RemovalCase onRemove={onRemove} onRemoveClose={onRemoveClose} />);

    const trigger = screen.getByRole("button", { name: "Request removal" });
    await press(() => user.click(trigger));
    const sheet = screen.getByRole("alertdialog", { name: REMOVAL.title });
    expect(sheet).toHaveClass("kit-sheet");
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(within(sheet).getByText(REMOVAL.body)).toBeInTheDocument();
    expect(within(sheet).getByText(REMOVAL.stats)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toHaveClass(
      "kit-button--secondary"
    );
    expect(within(sheet).getByRole("button", { name: "Remove" })).toHaveClass(
      "kit-button--destructive"
    );

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("alertdialog", { name: REMOVAL.title })).not.toBeInTheDocument();
    expect(onRemoveClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);

    await press(() => user.click(trigger));
    await press(() => user.click(screen.getByRole("button", { name: "Remove" })));
    expect(onRemove).toHaveBeenCalledWith("doc-1");
  });
});

/** The settings a test starts from: the default view with the given changes. */
function view(overrides: Partial<ShelfViewSettings> = {}): ShelfViewSettings {
  return { ...defaultShelfView(), ...overrides };
}

/** The grid cell whose drawn title is `title`, or undefined when it is not drawn. */
function gridCell(title: string): HTMLElement | undefined {
  return screen
    .queryAllByRole("gridcell")
    .find((cell) => cell.querySelector(".shelf-card__title")?.textContent === title);
}

/** The drawn grid cells' titles, in the order they are drawn. */
function drawnTitles(): Array<string | null | undefined> {
  return screen
    .getAllByRole("gridcell")
    .map((cell) => cell.querySelector(".shelf-card__title")?.textContent);
}

describe("Shelf views, sort, and filters (#945)", () => {
  it("draws the grid at each cover size on a Narrow phone", async () => {
    setWidth(390);
    const rows = async (coverSize: ShelfViewSettings["coverSize"]) => {
      const container = await mount(
        <Harness entries={many(9)} settings={view({ layout: "grid", coverSize })} />
      );
      const first = screen.getAllByRole("row")[0];
      const count = within(first).getAllByRole("gridcell").length;
      container.remove();
      return count;
    };

    // The Narrow column count is round((390 - 32) / cover width): 88, 128, 176 px covers.
    expect(await rows("small")).toBe(4);
    expect(await rows("medium")).toBe(3);
    expect(await rows("large")).toBe(2);
  });

  it("shows the Narrow header buttons, status chips, and summary, and filters by status", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-1", title: "Dune", status: "reading" }),
          entry({ id: "doc-2", title: "Emma", status: "new" }),
          entry({ id: "doc-3", title: "Persuasion", status: "finished" }),
        ]}
        onSettingsChange={onSettingsChange}
      />
    );

    expect(screen.getByRole("button", { name: "Search the Shelf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View, sort and filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "New" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Reading" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Finished" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    expect(screen.getByText("3 Documents", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Recent first", { exact: true })).toBeInTheDocument();

    await press(() => user.click(screen.getByRole("button", { name: "Reading" })));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ statuses: ["reading"] })
    );
    expect(screen.getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
    expect(drawnTitles()).toEqual(["Dune"]);
  });

  it("opens the View and filters Sheet, changes the view, sort, and filters, and resets", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-1", title: "Zeta", format: "epub" }),
          entry({ id: "doc-2", title: "Alpha", format: "pdf" }),
          entry({ id: "doc-3", title: "Mid", format: "epub" }),
        ]}
        onSettingsChange={onSettingsChange}
      />
    );

    const trigger = screen.getByRole("button", { name: "View, sort and filter" });
    await press(() => user.click(trigger));
    const dialog = screen.getByRole("dialog", { name: "View and filters" });
    expect(within(dialog).getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);

    // The footer counts what the Shelf shows, out of what it holds.
    expect(
      within(dialog).getByText("Showing 3 of 3. Reader remembers these choices on this device.", {
        exact: true,
      })
    ).toBeInTheDocument();

    // List draws the rows as list rows and hides the cover size group.
    expect(within(dialog).getByRole("radiogroup", { name: "Cover size" })).toBeInTheDocument();
    await press(() => user.click(within(dialog).getByRole("radio", { name: "List" })));
    expect(
      within(dialog).queryByRole("radiogroup", { name: "Cover size" })
    ).not.toBeInTheDocument();
    for (const cell of screen.getAllByRole("gridcell")) {
      expect(cell).toHaveClass("shelf-list");
    }
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ layout: "list" }));

    // Title sorts A to Z; the rows follow it.
    await press(() => user.click(within(dialog).getByRole("radio", { name: "Title" })));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "title", descending: false })
    );
    expect(
      screen
        .getAllByRole("gridcell")
        .map((cell) => cell.querySelector(".shelf-list__title")?.textContent)
    ).toEqual(["Alpha", "Mid", "Zeta"]);

    // The EPUB chip toggles that format and the footer follows the count.
    await press(() => user.click(within(dialog).getByRole("button", { name: "EPUB" })));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ formats: ["epub"] })
    );
    expect(
      within(dialog).getByText("Showing 2 of 3. Reader remembers these choices on this device.", {
        exact: true,
      })
    ).toBeInTheDocument();

    await press(() => user.click(within(dialog).getByRole("button", { name: "Reset" })));
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      layout: "grid",
      coverSize: "medium",
      sort: "recent",
      descending: true,
      formats: [],
      statuses: [],
      search: "",
      collection: null,
    });
  });

  it("resets every view choice from the View and filters Sheet by keyboard", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-1", title: "Zeta", format: "epub" }),
          entry({ id: "doc-2", title: "Alpha", format: "pdf" }),
          entry({ id: "doc-3", title: "Mid", format: "epub" }),
        ]}
        onSettingsChange={onSettingsChange}
      />
    );

    const trigger = screen.getByRole("button", { name: "View, sort and filter" });
    await press(() => user.click(trigger));
    const dialog = screen.getByRole("dialog", { name: "View and filters" });
    await press(() => user.click(within(dialog).getByRole("button", { name: "EPUB" })));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ formats: ["epub"] })
    );

    const reset = within(dialog).getByRole("button", { name: "Reset" });
    act(() => {
      reset.focus();
    });
    expect(document.activeElement).toBe(reset);
    await press(() => user.keyboard("{Enter}"));
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      layout: "grid",
      coverSize: "medium",
      sort: "recent",
      descending: true,
      formats: [],
      statuses: [],
      search: "",
      collection: null,
    });
  });

  it("closes the View and filters Sheet on Escape and returns focus to its trigger", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    await mount(<Harness entries={many(2)} />);

    const trigger = screen.getByRole("button", { name: "View, sort and filter" });
    await press(() => user.click(trigger));
    expect(screen.getByRole("dialog", { name: "View and filters" })).toBeInTheDocument();

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "View and filters" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("searches on a Narrow phone, marks the matched text, and clears on Escape", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-1", title: "Dune", author: "Frank Herbert" }),
          entry({ id: "doc-2", title: "Emma", author: "Jane Austen" }),
        ]}
      />
    );

    await press(() => user.click(screen.getByRole("button", { name: "Search the Shelf" })));
    expect(screen.getByRole("button", { name: "Close search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveFocus();

    await press(() => user.type(screen.getByRole("searchbox"), "dune"));
    expect(drawnTitles()).toEqual(["Dune"]);
    expect(
      screen.getByText('1 Document matches "dune" · Grid view', { exact: true })
    ).toBeInTheDocument();
    expect(gridCell("Dune")?.querySelector(".shelf-card__title")?.innerHTML).toBe(
      "<mark>Dune</mark>"
    );

    await press(() => user.keyboard("{Escape}"));
    expect(screen.getByRole("button", { name: "Search the Shelf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close search" })).not.toBeInTheDocument();
    expect(drawnTitles()).toEqual(["Dune", "Emma"]);
  });

  it("keeps focus in an open layer when the search Command arrives, and searches once it closes", async () => {
    setWidth(1200);
    const user = userEvent.setup({ delay: null });
    const container = await mount(<Harness />);
    const filters = screen.getByRole("button", { name: "Filters" });
    act(() => filters.focus());
    await press(() => user.keyboard("{Enter}"));
    const layer = screen.getByRole("dialog", { name: "Filters" });
    expect(layer).toContainElement(document.activeElement as HTMLElement);
    const inLayer = document.activeElement;

    // "/" or Ctrl+F typed in the popover reaches the host, which answers with
    // the Command; the search stays behind the layer.
    await act(() => {
      render(<Harness searchRequest={1} />, container);
    });
    expect(document.activeElement).toBe(inLayer);
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    await act(() => {
      render(<Harness searchRequest={2} />, container);
    });
    expect(screen.getByRole("searchbox", { name: "Search the Shelf" })).toHaveFocus();
  });

  it("hands focus back to the row it came from when Escape clears a search that matched nothing", async () => {
    setWidth(1200);
    const user = userEvent.setup({ delay: null });
    const dune = entry({ id: "doc-1", title: "Dune", author: "Frank Herbert" });
    const emmaEntry = entry({ id: "doc-2", title: "Emma", author: "Jane Austen" });
    const container = await mount(<Harness entries={[dune, emmaEntry]} />);
    // The rows reorder before the search opens, so focus return must follow
    // the Document, not the first render's order.
    await act(() => {
      render(<Harness entries={[emmaEntry, dune]} />, container);
    });
    expect(drawnTitles()).toEqual(["Emma", "Dune"]);
    const emma = gridCell("Emma") as HTMLElement;
    act(() => emma.focus());

    // The searchShelf Command ("/" by default) opens the search.
    await act(() => {
      render(<Harness entries={[emmaEntry, dune]} searchRequest={1} />, container);
    });
    expect(screen.getByRole("searchbox", { name: "Search the Shelf" })).toHaveFocus();
    await press(() => user.keyboard("zz"));
    // No row is drawn while nothing matches, so the row focus came from is gone.
    expect(screen.getByRole("heading", { name: "No Documents match" })).toBeInTheDocument();
    expect(gridCell("Emma")).toBeUndefined();

    await press(() => user.keyboard("{Escape}"));
    expect(drawnTitles()).toEqual(["Emma", "Dune"]);
    expect(gridCell("Emma")).toHaveFocus();
  });

  it("draws a list row with its title, author and format, and a compact row with its title, author and format", async () => {
    setWidth(390);
    const list = await mount(<Harness settings={view({ layout: "list" })} />);
    const listCell = list.querySelector<HTMLElement>(".shelf-list");
    expect(listCell).not.toBeNull();
    expect(listCell?.querySelector(".shelf-list__title")?.textContent).toBe("Dune");
    expect(listCell?.querySelector(".shelf-list__meta")?.textContent).toBe("Frank Herbert · EPUB");
    expect(listCell?.querySelector(".shelf-list__status")?.textContent).toBe("42%");
    expect(
      within(listCell as HTMLElement).getByRole("button", { name: "More for Dune" })
    ).toBeInTheDocument();

    const compact = await mount(<Harness settings={view({ layout: "compact" })} />);
    const compactCell = compact.querySelector<HTMLElement>(".shelf-compact");
    expect(compactCell).not.toBeNull();
    expect(compactCell?.querySelector(".shelf-compact__title")?.textContent).toBe("Dune");
    expect(compactCell?.querySelector(".shelf-compact__author")?.textContent).toBe(
      " · Frank Herbert"
    );
    expect(compactCell?.querySelector(".shelf-compact__format")?.textContent).toBe("EPUB");
  });

  it("virtualizes 500 Documents in Wide and moves focus across the whole list", async () => {
    setWidth(1280);
    const user = userEvent.setup({ delay: null });
    await mount(<Harness entries={many(500)} />);

    const drawn = screen.getAllByRole("gridcell");
    expect(drawn.length).toBeLessThan(200);

    const columns = within(screen.getAllByRole("row")[0]).getAllByRole("gridcell").length;
    expect(screen.getByRole("grid")).toHaveAttribute(
      "aria-rowcount",
      String(Math.ceil(500 / columns))
    );

    await press(() => user.click(gridCell("Book 1") as HTMLElement));
    await press(() => user.keyboard("{End}"));
    expect(document.activeElement).toBe(gridCell("Book 500"));

    await press(() => user.keyboard("{Home}"));
    expect(document.activeElement).toBe(gridCell("Book 1"));
  });

  it("offers Clear filters on an empty match that resets the filters", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-1", title: "Dune", status: "reading" }),
          entry({ id: "doc-2", title: "Emma", status: "new" }),
        ]}
        settings={view({ statuses: ["finished"] })}
        onSettingsChange={onSettingsChange}
      />
    );

    expect(screen.getByRole("heading", { name: "No Documents match" })).toBeInTheDocument();
    await press(() => user.click(screen.getByRole("button", { name: "Clear filters" })));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ statuses: [], formats: [], search: "" })
    );
  });

  it("draws removable filter chips and a Filters badge on Wide, and removes one filter", async () => {
    setWidth(1200);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-1", title: "Pdf new", status: "new", format: "pdf" }),
          entry({ id: "doc-2", title: "Epub reading" }),
        ]}
        settings={view({ statuses: ["new"], formats: ["pdf"] })}
        onSettingsChange={onSettingsChange}
      />
    );

    expect(screen.getByRole("button", { name: "Remove filter Status: New" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove filter Format: PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filters\s*2/ })).toBeInTheDocument();

    await press(() =>
      user.click(screen.getByRole("button", { name: "Remove filter Format: PDF" }))
    );
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ statuses: ["new"], formats: [] })
    );
    const next = onSettingsChange.mock.lastCall?.[0] as ShelfViewSettings;
    expect(next.formats).not.toContain("pdf");
  });

  it("removes a filter from its chip by keyboard", async () => {
    setWidth(1200);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness
        entries={[
          entry({ id: "doc-1", title: "Pdf new", status: "new", format: "pdf" }),
          entry({ id: "doc-2", title: "Epub reading" }),
        ]}
        settings={view({ statuses: ["new"], formats: ["pdf"] })}
        onSettingsChange={onSettingsChange}
      />
    );

    const chip = screen.getByRole("button", { name: "Remove filter Format: PDF" });
    act(() => {
      chip.focus();
    });
    expect(document.activeElement).toBe(chip);
    await press(() => user.keyboard("{Enter}"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ statuses: ["new"], formats: [] })
    );
    const next = onSettingsChange.mock.lastCall?.[0] as ShelfViewSettings;
    expect(next.formats).not.toContain("pdf");
  });
});

describe("Collections (#946)", () => {
  const COLLECTIONS: FrameCollection[] = [
    { id: "col-1", name: "Research" },
    { id: "col-2", name: "To read next" },
  ];

  /** Three Documents: Dune in Research, Emma in both, Kindred in none. */
  function filed(): FrameShelfEntry[] {
    return [
      entry({ id: "doc-1", title: "Dune", collections: ["col-1"] }),
      entry({ id: "doc-2", title: "Emma", collections: ["col-1", "col-2"] }),
      entry({ id: "doc-3", title: "Kindred" }),
    ];
  }

  /** The DataTransfer jsdom lacks: what a drag carries, by type. */
  function dragData() {
    const data = new Map<string, string>();
    return {
      get types() {
        return [...data.keys()];
      },
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      dropEffect: "none",
      effectAllowed: "all",
    };
  }

  function rail(): HTMLElement {
    return screen.getByRole("complementary", { name: "Collections" });
  }

  it("keeps the rail's rows at their height and their counts in the rows' names", () => {
    // jsdom draws no layout: these are the two rules a browser run caught.
    const item = shelfCss.match(/^\.shelf-rail__item\s*\{[^}]*\}/m)?.[0] ?? "";
    expect(item).toMatch(/flex:\s*none/);
    const rail = shelfCss.slice(shelfCss.indexOf(".shelf-rail {"));
    // A hidden count drops out of the accessible name; it may only fade.
    expect(rail).not.toMatch(/shelf-rail__count[^{]*\{[^}]*visibility:\s*hidden/);
  });

  it("draws the rail on Wide from 960 px, and not at 959", async () => {
    setWidth(959);
    const first = await mount(<Harness entries={filed()} collections={COLLECTIONS} />);
    expect(screen.queryByRole("complementary", { name: "Collections" })).toBeNull();
    await act(() => {
      render(null, first);
    });

    setWidth(960);
    await mount(<Harness entries={filed()} collections={COLLECTIONS} />);
    const aside = rail();
    const all = within(aside).getByRole("button", { name: /All Documents\s*3/ });
    expect(all).toHaveAttribute("aria-current", "true");
    expect(within(aside).getByRole("button", { name: /Research\s*2/ })).toBeInTheDocument();
    expect(within(aside).getByRole("button", { name: /To read next\s*1/ })).toBeInTheDocument();
    expect(within(aside).getByText(LABELS.railHint)).toBeInTheDocument();
  });

  it("filters the Shelf to a Collection from the rail, names it in the heading, and goes back to All Documents", async () => {
    setWidth(1280);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness entries={filed()} collections={COLLECTIONS} onSettingsChange={onSettingsChange} />
    );

    await press(() => user.click(within(rail()).getByRole("button", { name: /^Research/ })));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: "col-1" })
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Research");
    expect(screen.getAllByRole("gridcell").map((cell) => cell.dataset.documentId)).toEqual([
      "doc-1",
      "doc-2",
    ]);
    expect(within(rail()).getByRole("button", { name: /^Research/ })).toHaveAttribute(
      "aria-current",
      "true"
    );
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove filter Collection: Research" })
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Filters\s*1/ })).toBeInTheDocument();

    // Keyboard: Tab reaches All Documents, and Enter shows every Document again.
    const all = within(rail()).getByRole("button", { name: /All Documents/ });
    act(() => {
      all.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: null })
    );
    expect(screen.getAllByRole("gridcell")).toHaveLength(3);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All Documents");
  });

  it("ignores a remembered Collection that no longer exists", async () => {
    setWidth(1280);
    await mount(
      <Harness
        entries={filed()}
        collections={COLLECTIONS}
        settings={{ ...defaultShelfView(), collection: "gone" }}
      />
    );
    expect(screen.getAllByRole("gridcell")).toHaveLength(3);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All Documents");
    expect(screen.queryByRole("button", { name: /Remove filter Collection/ })).toBeNull();
  });

  it("files a Document dropped on a rail Collection", async () => {
    setWidth(1280);
    const onCollection = vi.fn();
    await mount(
      <Harness entries={filed()} collections={COLLECTIONS} onCollection={onCollection} />
    );

    const kindred = screen
      .getAllByRole("gridcell")
      .find((cell) => cell.dataset.documentId === "doc-3") as HTMLElement;
    expect(kindred).toHaveAttribute("draggable", "true");
    const data = dragData();
    const target = within(rail()).getByRole("button", { name: /^To read next/ })
      .parentElement as HTMLElement;
    await act(() => {
      fireEvent.dragStart(kindred, { dataTransfer: data });
      fireEvent.dragOver(target, { dataTransfer: data });
    });
    expect(target).toHaveClass("shelf-rail__row--drop");
    await act(() => {
      fireEvent.drop(target, { dataTransfer: data });
    });
    expect(onCollection).toHaveBeenCalledWith({
      kind: "shelf-collection",
      action: "file",
      collectionId: "col-2",
      documentId: "doc-3",
      member: true,
    });
    expect(target).not.toHaveClass("shelf-rail__row--drop");
  });

  it("makes a New Collection from the rail: Create waits for a name and refuses a duplicate", async () => {
    setWidth(1280);
    const user = userEvent.setup({ delay: null });
    const onCollection = vi.fn();
    await mount(
      <Harness entries={filed()} collections={COLLECTIONS} onCollection={onCollection} />
    );

    const newButton = within(rail()).getByRole("button", { name: "New Collection" });
    await press(() => user.click(newButton));
    const dialog = screen.getByRole("dialog", { name: "New Collection" });
    const field = within(dialog).getByRole("textbox", { name: "Name" });
    const create = within(dialog).getByRole("button", { name: "Create" });
    expect(document.activeElement).toBe(field);
    expect(create).toBeDisabled();

    await press(() => user.keyboard(" research "));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(LABELS.duplicateCollection);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(create).toBeDisabled();
    // Enter on a refused name does nothing.
    await press(() => user.keyboard("{Enter}"));
    expect(onCollection).not.toHaveBeenCalled();

    await press(() => user.clear(field));
    await press(() => user.keyboard("  Poetry "));
    // An Enter that commits an IME composition is the composition's, not a submit.
    await act(() => {
      fireEvent.keyDown(field, { key: "Enter", isComposing: true });
      fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    });
    expect(onCollection).not.toHaveBeenCalled();
    await press(() => user.keyboard("{Enter}"));
    expect(onCollection).toHaveBeenCalledWith({
      kind: "shelf-collection",
      action: "create",
      name: "Poetry",
    });
    expect(screen.queryByRole("dialog", { name: "New Collection" })).toBeNull();
    expect(document.activeElement).toBe(newButton);
  });

  it("renames and deletes a rail Collection from its menu, by keyboard", async () => {
    setWidth(1280);
    const user = userEvent.setup({ delay: null });
    const onCollection = vi.fn();
    const onSettingsChange = vi.fn();
    await mount(
      <Harness
        entries={filed()}
        collections={COLLECTIONS}
        onCollection={onCollection}
        onSettingsChange={onSettingsChange}
      />
    );
    const research = within(rail()).getByRole("button", { name: /^Research/ });

    // Shift+F10 opens the row's menu, the keyboard twin of its More button.
    act(() => {
      research.focus();
    });
    await press(() => user.keyboard("{Shift>}{F10}{/Shift}"));
    const menu = screen.getByRole("menu", { name: "Research" });
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Rename…" }));
    await press(() => user.keyboard("{Enter}"));
    const rename = screen.getByRole("dialog", { name: "Rename Collection" });
    const field = within(rename).getByRole("textbox", { name: "Name" });
    expect(field).toHaveValue("Research");
    // The Collection's own name, in another case, is not a duplicate.
    await press(() => user.clear(field));
    await press(() => user.keyboard("RESEARCH{Enter}"));
    expect(onCollection).toHaveBeenLastCalledWith({
      kind: "shelf-collection",
      action: "rename",
      collectionId: "col-1",
      name: "RESEARCH",
    });
    expect(screen.queryByRole("dialog", { name: "Rename Collection" })).toBeNull();

    // Filter to it, then delete it: the Shelf goes back to every Document.
    await press(() => user.click(research));
    act(() => {
      research.focus();
    });
    await press(() => user.keyboard("{ContextMenu}"));
    await press(() => user.keyboard("{ArrowDown}{Enter}"));
    const confirm = screen.getByRole("alertdialog", { name: "Delete “Research”?" });
    expect(within(confirm).getByText(LABELS.deleteCollectionBody)).toBeInTheDocument();
    await press(() => user.click(within(confirm).getByRole("button", { name: "Delete" })));
    expect(onCollection).toHaveBeenLastCalledWith({
      kind: "shelf-collection",
      action: "delete",
      collectionId: "col-1",
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: null })
    );
  });

  it("cancels a Delete with Escape and keeps the Collection", async () => {
    setWidth(1280);
    const user = userEvent.setup({ delay: null });
    const onCollection = vi.fn();
    await mount(
      <Harness entries={filed()} collections={COLLECTIONS} onCollection={onCollection} />
    );
    await press(() =>
      user.click(within(rail()).getByRole("button", { name: "More for To read next" }))
    );
    await press(() => user.click(screen.getByRole("menuitem", { name: "Delete…" })));
    expect(screen.getByRole("alertdialog", { name: "Delete “To read next”?" })).toBeInTheDocument();
    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onCollection).not.toHaveBeenCalled();
  });

  it("files and unfiles a Document from its menu's check boxes, which keep the menu open", async () => {
    setWidth(1280);
    const user = userEvent.setup({ delay: null });
    const onCollection = vi.fn();
    await mount(
      <Harness entries={filed()} collections={COLLECTIONS} onCollection={onCollection} />
    );

    const dune = screen
      .getAllByRole("gridcell")
      .find((cell) => cell.dataset.documentId === "doc-1") as HTMLElement;
    act(() => {
      dune.focus();
    });
    await press(() => user.keyboard("{Shift>}{F10}{/Shift}"));
    const menu = screen.getByRole("menu", { name: "Document actions" });
    const group = within(menu).getByRole("group", { name: "Collections" });
    const research = within(group).getByRole("menuitemcheckbox", { name: /^Research/ });
    const later = within(group).getByRole("menuitemcheckbox", { name: /^To read next/ });
    expect(research).toHaveAttribute("aria-checked", "true");
    expect(research).toHaveTextContent("2");
    expect(later).toHaveAttribute("aria-checked", "false");

    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Open" }));
    // Open, then the two check boxes: the arrow keys walk the rows, not the field.
    await press(() => user.keyboard("{ArrowDown}"));
    expect(document.activeElement).toBe(research);
    await press(() => user.keyboard("{ArrowDown}"));
    expect(document.activeElement).toBe(later);
    await press(() => user.keyboard(" "));
    expect(onCollection).toHaveBeenLastCalledWith({
      kind: "shelf-collection",
      action: "file",
      collectionId: "col-2",
      documentId: "doc-1",
      member: true,
    });
    await press(() => user.keyboard("{ArrowUp}{Enter}"));
    expect(onCollection).toHaveBeenLastCalledWith({
      kind: "shelf-collection",
      action: "file",
      collectionId: "col-1",
      documentId: "doc-1",
      member: false,
    });
    expect(screen.getByRole("menu", { name: "Document actions" })).toBeInTheDocument();
    // From Research, past To read next, to Remove: the field between them is skipped.
    await press(() => user.keyboard("{ArrowDown}{ArrowDown}"));
    expect(document.activeElement).toBe(
      within(menu).getByRole("menuitem", { name: "Remove from Shelf…" })
    );
  });

  it("adds a New Collection from the Document menu's field and files the Document in it", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    const onCollection = vi.fn();
    await mount(<Harness entries={filed()} collections={[]} onCollection={onCollection} />);

    await press(() => user.click(screen.getByRole("button", { name: "More for Kindred" })));
    const sheet = screen.getByRole("dialog", { name: "Kindred" });
    // With no Collection yet, the field draws the Collections label itself.
    expect(within(sheet).getByText("Collections")).toBeInTheDocument();
    const field = within(sheet).getByRole("textbox", { name: "New Collection name" });
    const add = within(sheet).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await press(() => user.click(field));
    // Keys typed in the field are the field's: no type-ahead jumps to "Open".
    await press(() => user.keyboard("Open shelf"));
    expect(field).toHaveValue("Open shelf");
    expect(document.activeElement).toBe(field);
    await press(() => user.keyboard("{Enter}"));
    expect(onCollection).toHaveBeenCalledWith({
      kind: "shelf-collection",
      action: "create",
      name: "Open shelf",
      documentId: "doc-3",
    });
    expect(field).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "Kindred" })).toBeInTheDocument();
  });

  it("picks a Collection in the Narrow Sheet, shows its chip, and removes it", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness entries={filed()} collections={COLLECTIONS} onSettingsChange={onSettingsChange} />
    );

    await press(() => user.click(screen.getByRole("button", { name: "View, sort and filter" })));
    const sheet = screen.getByRole("dialog", { name: "View and filters" });
    const pickerButton = within(sheet).getByRole("button", {
      name: "Collection: Any Collection",
    });
    await press(() => user.click(pickerButton));
    const picker = screen.getByRole("dialog", { name: "Collection" });
    const any = within(picker).getByRole("radio", { name: "Any Collection" });
    expect(any).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(any);
    // The arrow keys choose, as Sort by does.
    await press(() => user.keyboard("{ArrowDown}"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: "col-1" })
    );
    await press(() => user.keyboard("{ArrowDown}{Enter}"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: "col-2" })
    );
    expect(screen.queryByRole("dialog", { name: "Collection" })).toBeNull();
    expect(
      within(sheet).getByRole("button", { name: "Collection: To read next" })
    ).toBeInTheDocument();
    await press(() => user.click(within(sheet).getByRole("button", { name: "Done" })));

    expect(screen.getAllByRole("gridcell").map((cell) => cell.dataset.documentId)).toEqual([
      "doc-2",
    ]);
    await press(() =>
      user.click(screen.getByRole("button", { name: "Remove filter Collection: To read next" }))
    );
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: null })
    );
    expect(screen.getAllByRole("gridcell")).toHaveLength(3);
  });

  it("renames the filtered Collection on Narrow from the More button beside its picker", async () => {
    setWidth(390);
    const user = userEvent.setup({ delay: null });
    const onCollection = vi.fn();
    await mount(
      <Harness
        entries={filed()}
        collections={COLLECTIONS}
        settings={{ ...defaultShelfView(), collection: "col-2" }}
        onCollection={onCollection}
      />
    );
    await press(() => user.click(screen.getByRole("button", { name: "View, sort and filter" })));
    await press(() => user.click(screen.getByRole("button", { name: "More for To read next" })));
    await press(() => user.click(screen.getByRole("menuitem", { name: "Rename…" })));
    const rename = screen.getByRole("dialog", { name: "Rename Collection" });
    const field = within(rename).getByRole("textbox", { name: "Name" });
    await press(() => user.clear(field));
    await press(() => user.type(field, "Soon"));
    await press(() => user.click(within(rename).getByRole("button", { name: "Rename" })));
    expect(onCollection).toHaveBeenCalledWith({
      kind: "shelf-collection",
      action: "rename",
      collectionId: "col-2",
      name: "Soon",
    });
  });

  it("picks a Collection from the Wide Filters popover", async () => {
    setWidth(800);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness entries={filed()} collections={COLLECTIONS} onSettingsChange={onSettingsChange} />
    );
    // Under 960 px the rail is not drawn; the Filters popover holds the choice.
    expect(screen.queryByRole("complementary", { name: "Collections" })).toBeNull();
    await press(() => user.click(screen.getByRole("button", { name: "Filters" })));
    await press(() =>
      user.click(screen.getByRole("button", { name: "Collection: Any Collection" }))
    );
    await press(() => user.click(screen.getByRole("radio", { name: "Research" })));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: "col-1" })
    );
    expect(screen.queryByRole("radio", { name: "Research" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Research");
  });

  it("answers the host's Collection Commands: New always, Rename and Delete only while filtered", async () => {
    setWidth(1280);
    const user = userEvent.setup({ delay: null });
    const container = await mount(<Harness entries={filed()} collections={COLLECTIONS} />);
    const rerender = (props: HarnessProps) =>
      act(() => {
        render(<Harness entries={filed()} collections={COLLECTIONS} {...props} />, container);
      });

    await rerender({ collectionRequest: { command: "renameCollection", serial: 1 } });
    expect(screen.queryByRole("dialog")).toBeNull();
    await rerender({ collectionRequest: { command: "deleteCollection", serial: 2 } });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await rerender({ collectionRequest: { command: "newCollection", serial: 3 } });
    expect(screen.getByRole("dialog", { name: "New Collection" })).toBeInTheDocument();
    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog")).toBeNull();

    const filtered = { ...defaultShelfView(), collection: "col-2" };
    await rerender({
      settings: filtered,
      collectionRequest: { command: "renameCollection", serial: 4 },
    });
    expect(
      within(screen.getByRole("dialog", { name: "Rename Collection" })).getByRole("textbox")
    ).toHaveValue("To read next");
    await press(() => user.keyboard("{Escape}"));
    await rerender({
      settings: filtered,
      collectionRequest: { command: "deleteCollection", serial: 5 },
    });
    expect(screen.getByRole("alertdialog", { name: "Delete “To read next”?" })).toBeInTheDocument();
  });

  it("resets the Collection with the rest of the view and with Clear filters", async () => {
    setWidth(1280);
    const user = userEvent.setup({ delay: null });
    const onSettingsChange = vi.fn();
    await mount(
      <Harness
        entries={filed()}
        collections={COLLECTIONS}
        settings={{ ...defaultShelfView(), collection: "col-1", formats: ["pdf"] }}
        onSettingsChange={onSettingsChange}
      />
    );
    // The empty match and the chip row both offer it; the chip row's is the toolbar's.
    const chips = document.querySelector(".shelf-chips") as HTMLElement;
    await press(() => user.click(within(chips).getByRole("button", { name: "Clear filters" })));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: null, formats: [] })
    );
  });
});

/** A background Import in progress, with the counts the card and report draw. */
function running(overrides: Partial<FrameImportState> = {}): FrameImportState {
  return {
    status: "running",
    source: "folder",
    title: 'Importing "Library"',
    processed: 128,
    found: 312,
    progressText: "128 of 312 files",
    countsText: "96 added · 22 already on Shelf · 3 relinked · 1 unreadable",
    report: {
      subtitle: "From the folder Library",
      added: [],
      alreadyOnShelf: [],
      relinked: [],
      unreadable: [],
      duplicatesText: "",
    },
    ...overrides,
  };
}

/** A finished Import whose report lists every kind of row. */
function finished(overrides: Partial<FrameImportState> = {}): FrameImportState {
  return running({
    status: "done",
    title: 'Imported "Library"',
    processed: 312,
    progressText: "312 of 312 files",
    countsText: "2 added · 1 already on Shelf · 1 relinked · 1 unreadable",
    report: {
      subtitle: "From the folder Library · 312 files found",
      added: ["Dune", "Emma"],
      alreadyOnShelf: ["Persuasion"],
      relinked: ["Hyperion"],
      unreadable: [{ name: "broken.epub", reason: "Could not open the archive" }],
      duplicatesText: "1 duplicate was added once",
    },
    ...overrides,
  });
}

interface ImportHarnessProps {
  entries?: FrameShelfEntry[];
  importState?: FrameImportState | null;
  importReportRequest?: number;
  onCommand?: (id: string, documentId?: string) => void;
}

/** The Shelf a real caller draws, with its Import state and report Command. */
function ImportHarness({
  entries = [entry()],
  importState = null,
  importReportRequest = 0,
  onCommand = () => {},
}: ImportHarnessProps) {
  return (
    <div>
      <button type="button">Before</button>
      <Shelf
        state={{ status: "ready", entries: workerOrder(entries) }}
        labels={LABELS}
        menuDocumentId={null}
        importState={importState}
        importReportRequest={importReportRequest}
        onCommand={onCommand}
        onSelect={() => {}}
        onMenuChange={() => {}}
        onRemove={() => {}}
        onRemoveClose={() => {}}
        onNoticeClose={() => {}}
      />
    </div>
  );
}

/**
 * jsdom and user-event do not activate a focused `<summary>` on Enter, though
 * a browser does: Enter fires the summary's click and the native details
 * toggles. This stands in for that one browser activation, so the real key
 * press still moves focus to the summary and the assertion reads the open state.
 */
function activateSummaryOnEnter(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (event.key === "Enter" && target instanceof HTMLElement && target.tagName === "SUMMARY") {
      target.click();
    }
  };
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}

describe("Import (#948)", () => {
  it("opens the Wide chooser from the Import button, sends the Folder pick by keyboard, and closes", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const commands: string[] = [];
    await mount(<ImportHarness onCommand={(id) => commands.push(id)} />);

    const importButton = screen.getByRole("button", { name: "Import" });
    act(() => {
      importButton.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    const chooser = screen.getByRole("dialog", { name: "Import" });
    expect(chooser).toHaveClass("kit-dialog");
    expect(within(chooser).getByText(LABELS.importDescription)).toBeInTheDocument();

    // The chooser opens on its first option; one Tab reaches Folder.
    await press(() => user.tab());
    expect(document.activeElement).toBe(within(chooser).getByRole("button", { name: /Folder/ }));
    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual(["importFolder"]);
    expect(screen.queryByRole("dialog", { name: "Import" })).not.toBeInTheDocument();
  });

  it("sends the Files pick from the chooser and closes it", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const commands: string[] = [];
    await mount(<ImportHarness onCommand={(id) => commands.push(id)} />);

    act(() => {
      screen.getByRole("button", { name: "Import" }).focus();
    });
    await press(() => user.keyboard("{Enter}"));
    const chooser = screen.getByRole("dialog", { name: "Import" });
    expect(document.activeElement).toBe(within(chooser).getByRole("button", { name: /Files/ }));
    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual(["importFiles"]);
    expect(screen.queryByRole("dialog", { name: "Import" })).not.toBeInTheDocument();
  });

  it("closes the chooser on Escape without sending a command and returns focus to Import", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const onCommand = vi.fn();
    await mount(<ImportHarness onCommand={onCommand} />);

    const importButton = screen.getByRole("button", { name: "Import" });
    act(() => {
      importButton.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    expect(screen.getByRole("dialog", { name: "Import" })).toBeInTheDocument();

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Import" })).not.toBeInTheDocument();
    expect(onCommand).not.toHaveBeenCalled();
    expect(importButton).toHaveFocus();
  });

  it("opens the Narrow chooser as a Sheet from the header icon, and both options work by keyboard", async () => {
    setWidth(500);
    const user = userEvent.setup({ delay: null });
    const commands: string[] = [];
    await mount(<ImportHarness onCommand={(id) => commands.push(id)} />);

    act(() => {
      screen.getByRole("button", { name: "Import" }).focus();
    });
    await press(() => user.keyboard("{Enter}"));
    const sheet = screen.getByRole("dialog", { name: "Import" });
    expect(sheet).toHaveClass("kit-sheet");

    // The Sheet opens on its Close button, so one Tab reaches Files.
    await press(() => user.tab());
    expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: /Files/ }));
    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual(["importFiles"]);
    expect(screen.queryByRole("dialog", { name: "Import" })).not.toBeInTheDocument();

    act(() => {
      screen.getByRole("button", { name: "Import" }).focus();
    });
    await press(() => user.keyboard("{Enter}"));
    await press(() => user.tab());
    await press(() => user.tab());
    expect(document.activeElement).toBe(
      within(screen.getByRole("dialog", { name: "Import" })).getByRole("button", { name: /Folder/ })
    );
    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual(["importFiles", "importFolder"]);
  });

  it("offers both Import files and Import folder on an empty Shelf, each sent by keyboard", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const commands: string[] = [];
    await mount(<ImportHarness entries={[]} onCommand={(id) => commands.push(id)} />);

    const files = screen.getByRole("button", { name: "Import files" });
    const folder = screen.getByRole("button", { name: "Import folder" });
    expect(files.parentElement).toHaveClass("shelf__empty-actions");
    expect(folder.parentElement).toBe(files.parentElement);

    act(() => {
      files.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    act(() => {
      folder.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual(["importFiles", "importFolder"]);
  });

  it("draws the running card as a live status with its counts, cancels by keyboard, and disables Import", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const commands: string[] = [];
    await mount(<ImportHarness importState={running()} onCommand={(id) => commands.push(id)} />);

    const status = screen.getByRole("status", { name: "Import progress" });
    expect(within(status).getByText('Importing "Library"')).toBeInTheDocument();
    expect(within(status).getByText("128 of 312 files")).toBeInTheDocument();
    expect(
      within(status).getByText("96 added · 22 already on Shelf · 3 relinked · 1 unreadable")
    ).toBeInTheDocument();
    expect(within(status).getByText(LABELS.importKeepReading)).toBeInTheDocument();
    expect(within(status).queryByRole("button", { name: "View report" })).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();

    const cancel = within(status).getByRole("button", { name: "Cancel" });
    act(() => {
      cancel.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual(["cancelImport"]);
  });

  it("keeps the empty Shelf's Import buttons from starting a second Import while one runs", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const commands: string[] = [];
    await mount(
      <ImportHarness entries={[]} importState={running()} onCommand={(id) => commands.push(id)} />
    );
    await user.click(screen.getByRole("button", { name: LABELS.importFiles }));
    await user.click(screen.getByRole("button", { name: LABELS.importFolder }));
    expect(commands).toEqual([]);
  });

  it("shows View report on a done card, opens the report by keyboard, and returns focus on Escape", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<ImportHarness importState={finished()} />);

    const status = screen.getByRole("status", { name: "Import progress" });
    const viewReport = within(status).getByRole("button", { name: "View report" });
    act(() => {
      viewReport.focus();
    });
    await press(() => user.keyboard("{Enter}"));

    const report = screen.getByRole("dialog", { name: "Import report" });
    expect(
      within(report).getByText("From the folder Library · 312 files found")
    ).toBeInTheDocument();
    const tiles = Array.from(report.querySelectorAll(".shelf-report__tile")).map((tile) => [
      tile.querySelector("b")?.textContent,
      tile.querySelector("span")?.textContent,
    ]);
    expect(tiles).toEqual([
      ["2", "Added"],
      ["1", "Already on the Shelf"],
      ["1", "Relinked (were Missing)"],
      ["1", "Unreadable"],
    ]);
    const unreadable = report.querySelector(".shelf-report__unreadable") as HTMLElement;
    expect(within(unreadable).getByText("broken.epub")).toBeInTheDocument();
    expect(within(unreadable).getByText("Could not open the archive")).toBeInTheDocument();
    expect(within(report).getByText("1 duplicate was added once")).toBeInTheDocument();

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Import report" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(viewReport);
  });

  it("sends Dismiss from a done card by keyboard", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const commands: string[] = [];
    await mount(<ImportHarness importState={finished()} onCommand={(id) => commands.push(id)} />);

    const status = screen.getByRole("status", { name: "Import progress" });
    const dismiss = within(status).getByRole("button", { name: "Dismiss" });
    act(() => {
      dismiss.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    expect(commands).toEqual(["dismissImport"]);
  });

  it("opens the details accordions by keyboard and says None for an empty list", async () => {
    const stopActivation = activateSummaryOnEnter();
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<ImportHarness importState={finished()} />);

    act(() => {
      screen.getByRole("button", { name: "View report" }).focus();
    });
    await press(() => user.keyboard("{Enter}"));
    const report = screen.getByRole("dialog", { name: "Import report" });

    const added = Array.from(report.querySelectorAll("details")).find((details) =>
      details.querySelector("summary")?.textContent?.startsWith("Added")
    ) as HTMLElement;
    const addedSummary = added.querySelector("summary") as HTMLElement;
    act(() => {
      addedSummary.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    expect(within(added).getByText("Dune")).toBeVisible();
    expect(within(added).getByText("Emma")).toBeVisible();

    const relinked = Array.from(report.querySelectorAll("details")).find((details) =>
      details.querySelector("summary")?.textContent?.startsWith("Relinked")
    ) as HTMLElement;
    const relinkedSummary = relinked.querySelector("summary") as HTMLElement;
    act(() => {
      relinkedSummary.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    expect(within(relinked).getByText("Hyperion")).toBeVisible();
    stopActivation();
  });

  it("says None inside a details list with no names", async () => {
    const stopActivation = activateSummaryOnEnter();
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    const base = finished();
    await mount(
      <ImportHarness importState={finished({ report: { ...base.report, relinked: [] } })} />
    );

    act(() => {
      screen.getByRole("button", { name: "View report" }).focus();
    });
    await press(() => user.keyboard("{Enter}"));
    const report = screen.getByRole("dialog", { name: "Import report" });
    const relinked = Array.from(report.querySelectorAll("details")).find((details) =>
      details.querySelector("summary")?.textContent?.startsWith("Relinked")
    ) as HTMLElement;
    const relinkedSummary = relinked.querySelector("summary") as HTMLElement;
    act(() => {
      relinkedSummary.focus();
    });
    await press(() => user.keyboard("{Enter}"));
    expect(within(relinked).getByText("None")).toBeVisible();
    stopActivation();
  });

  it("opens the report when a finished Import's report Command arrives, and not while it runs", async () => {
    setWidth(1024);
    const container = await mount(
      <ImportHarness importState={finished()} importReportRequest={0} />
    );
    expect(screen.queryByRole("dialog", { name: "Import report" })).not.toBeInTheDocument();

    await act(() => {
      render(<ImportHarness importState={finished()} importReportRequest={1} />, container);
    });
    expect(screen.getByRole("dialog", { name: "Import report" })).toBeInTheDocument();
  });

  it("ignores the report Command while the Import is still running", async () => {
    setWidth(1024);
    const container = await mount(
      <ImportHarness importState={running()} importReportRequest={0} />
    );
    await act(() => {
      render(<ImportHarness importState={running()} importReportRequest={1} />, container);
    });
    expect(screen.queryByRole("dialog", { name: "Import report" })).not.toBeInTheDocument();
  });

  it("draws the pending cover for a Document still being imported, and keeps its title", async () => {
    setWidth(1024);
    await mount(
      <ImportHarness
        entries={[entry({ id: "doc-p", title: "Arriving Book", coverPending: true })]}
      />
    );

    const cell = gridCell("Arriving Book");
    expect(cell).toBeDefined();
    expect(cell?.querySelector(".kit-cover__pending")).not.toBeNull();
  });
});
