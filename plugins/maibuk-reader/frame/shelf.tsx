/** @jsxImportSource preact */
/**
 * The Reader Frame's Shelf (#944, #945): every Document the Worker sends, drawn
 * in the layout, cover size, sort, filters, and search the author picked. The
 * Worker sends the rows localized and stripped of the File Grant and
 * Fingerprint, and stores the author's choices; the Frame owns what it draws:
 * the query over the rows, the virtualized grid, list, or compact rows with
 * their one roving Tab stop, the toolbar or phone header, the "View and
 * filters" Sheet and its Wide popovers, the per-row Document menu, and the
 * Remove from Shelf confirmation. Every action goes back as a callback.
 *
 * Every user-visible string is a label from the Worker's catalogs, and every
 * color comes from `tokens.css` through `shelf.css`. The component composes the
 * shared kit, so no color, focus ring, or motion is reimplemented here.
 */

import type { ComponentChildren, TargetedKeyboardEvent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Button,
  Chip,
  Cover,
  Dialog,
  Icon,
  IconButton,
  Menu,
  type MenuItem,
  Popover,
  Sheet,
} from "./kit";
import {
  CoverSizeControl,
  clearFilters,
  defaultShelfView,
  LayoutControl,
  layoutViewLabel,
  type ShelfOptionsPart,
  ShelfOptions,
  sortLabel,
  sortSummary,
  statusLabel,
} from "./shelf-options";
import {
  COVER_WIDTHS,
  fill,
  gridColumns,
  hasActiveFilters,
  matchRanges,
  queryShelf,
} from "./shelf-query";
import type {
  FrameShelfCommandId,
  FrameShelfEntry,
  FrameShelfLabels,
  FrameShelfState,
  ShelfViewSettings,
} from "./types";
import { useLayoutMode } from "./use-layout-mode";

/** The More button's size beside a cover's title on Wide, as "Shelf · desktop · grid M" draws it. */
const MORE_WIDE_SIZE = { width: "28px", height: "28px" } as const;

/** The Narrow and Wide page gutters and the gaps between covers the artboards draw. */
const NARROW_GUTTER = 16;
const NARROW_COLUMN_GAP = 12;
const NARROW_ROW_GAP = 18;
const WIDE_ROW_GAP = 28;

/** The list and compact row heights the spec sheet fixes. */
const LIST_ROW = 76;
const COMPACT_ROW = 44;

/** Rows drawn beyond each edge of the viewport, so a fast scroll never shows a gap. */
const OVERSCAN_ROWS = 3;

/** The dismissible status a failed Shelf action leaves above the grid. */
export interface ShelfNotice {
  text: string;
  error?: boolean;
}

/** The localized Remove from Shelf copy and the Document it removes. */
export interface ShelfRemoval {
  documentId: string;
  title: string;
  body: string;
  stats: string;
}

/** The props the Shelf draws and the actions it hands back to the Worker. */
export interface ShelfProps {
  state: FrameShelfState;
  labels: FrameShelfLabels;
  /** The author's view, sort, filters, and search; omitted means the defaults. */
  settings?: ShelfViewSettings;
  /** The app language, which decides how titles and authors sort. */
  language?: string;
  notice?: ShelfNotice | null;
  removal?: ShelfRemoval | null;
  /** The row whose Document menu is open, or null. */
  menuDocumentId: string | null;
  /** The row to focus when the caller moves focus back into the grid. */
  focusDocumentId?: string | null;
  /** Bumped by the host's Search the Shelf Command: focuses the search field. */
  searchRequest?: number;
  /** Bumped by the host's View, sort and filter Command: opens the options. */
  optionsRequest?: number;
  onCommand: (id: FrameShelfCommandId, documentId?: string) => void;
  onSelect: (documentId: string) => void;
  onMenuChange: (documentId: string | null) => void;
  onRemove: (documentId: string) => void;
  onRemoveClose: () => void;
  onNoticeClose: () => void;
  /** The author changed the view, sort, filters, or search. */
  onSettingsChange?: (settings: ShelfViewSettings) => void;
}

/** The Frame's own width, updated when the Pane resizes. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

/** `text` with every stretch the search matched wrapped in a mark. */
function Marked({ text, search }: { text: string; search: string }) {
  const ranges = matchRanges(text, search);
  if (ranges.length === 0) return <>{text}</>;
  const parts: ComponentChildren[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** The remove actions, drawn in a Dialog's footer or a Sheet's body. */
function RemoveActions({
  labels,
  onCancel,
  onRemove,
}: {
  labels: FrameShelfLabels;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onCancel}>
        {labels.cancel}
      </Button>
      <Button variant="destructive" onClick={onRemove}>
        <Icon name="trash" />
        {labels.removeConfirm}
      </Button>
    </>
  );
}

/** The Document a menu acts on: its cover, title, author, format, and progress. */
function DocumentSummary({ entry }: { entry: FrameShelfEntry }) {
  const missing = entry.state === "missing" || entry.state === "needs-permission";
  const meta = entry.author === "" ? entry.progressText : `${entry.author} · ${entry.progressText}`;
  return (
    <div class="shelf-summary">
      <Cover
        width={40}
        title={entry.title}
        author={entry.author}
        format={entry.format}
        tone={entry.tone}
        src={entry.coverDataUrl}
        missing={missing}
      />
      <div class="shelf-summary__text">
        <span class="shelf-summary__title">{entry.title}</span>
        <span class="shelf-summary__meta">{meta}</span>
        <span class="shelf-summary__format">{entry.format.toUpperCase()}</span>
      </div>
    </div>
  );
}

/** The status line a phone card, list row, or compact row shows: New and Finished stand out. */
function StatusMeta({ entry, class: extra }: { entry: FrameShelfEntry; class: string }) {
  const tone =
    entry.status === "new"
      ? `${extra} shelf-meta--new`
      : entry.status === "finished"
        ? `${extra} shelf-meta--finished`
        : extra;
  return (
    <span class={tone}>
      {entry.status === "finished" ? <Icon name="check" /> : null}
      {entry.progressText}
    </span>
  );
}

/**
 * The virtual window over `rowCount` rows of `stride` px: the first and last
 * row to draw, from the scroll position and the viewport's height.
 */
function windowOf(
  rowCount: number,
  stride: number,
  scrollTop: number,
  listTop: number,
  viewport: number
): { first: number; last: number } {
  if (rowCount === 0 || stride <= 0) return { first: 0, last: rowCount };
  const top = Math.max(0, scrollTop - listTop);
  const first = Math.max(0, Math.floor(top / stride) - OVERSCAN_ROWS);
  const last = Math.min(rowCount, Math.ceil((top + viewport) / stride) + OVERSCAN_ROWS);
  return { first, last: Math.max(first, last) };
}

/** The Frame-local Shelf: header, toolbar, states, rows, options, menu, and removal. */
export function Shelf({
  state,
  labels,
  settings: given,
  language = "en",
  notice = null,
  removal = null,
  menuDocumentId,
  focusDocumentId,
  searchRequest = 0,
  optionsRequest = 0,
  onCommand,
  onSelect,
  onMenuChange,
  onRemove,
  onRemoveClose,
  onNoticeClose,
  onSettingsChange,
}: ShelfProps) {
  const { mode } = useLayoutMode();
  const wide = mode === "wide";
  const width = useViewportWidth();
  // An uncontrolled Shelf (a test, or a caller with no store) keeps its own copy.
  const [local, setLocal] = useState<ShelfViewSettings>(() => given ?? defaultShelfView());
  const settings = given ?? local;
  const change = (next: ShelfViewSettings) => {
    if (given === undefined) setLocal(next);
    onSettingsChange?.(next);
  };

  const all = state.entries;
  const entries = useMemo(() => queryShelf(all, settings, language), [all, settings, language]);
  const filtering = hasActiveFilters(settings);
  const layout = settings.layout;
  const columns = layout === "grid" ? gridColumns(wide, width, settings.coverSize) : 1;

  const [activeIndex, setActiveIndex] = useState(0);
  const [options, setOptions] = useState<ShelfOptionsPart | null>(null);
  const [searchOpen, setSearchOpen] = useState(() => settings.search !== "");
  const cells = useRef(new Map<number, HTMLDivElement>());
  const moreButtons = useRef(new Map<number, HTMLButtonElement>());
  const menuAnchor = useRef<HTMLElement | null>(null);
  const lastFocus = useRef<string | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const searchButton = useRef<HTMLButtonElement | null>(null);
  const searchReturn = useRef<HTMLElement | null>(null);
  /** The Document whose row the search was opened from, found again by id. */
  const searchReturnId = useRef<string | null>(null);
  /** A Document whose row takes focus once a render draws it. */
  const pendingFocusId = useRef<string | null>(null);
  const focusSearchNext = useRef(false);
  const sortAnchor = useRef<HTMLSpanElement | null>(null);
  const filtersAnchor = useRef<HTMLSpanElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(() => window.innerHeight);
  const [measured, setMeasured] = useState(0);

  // The row stride the window math uses: the drawn row's real height once it is
  // measured, otherwise the height the artboard's sizes add up to.
  const coverWidth = wide
    ? COVER_WIDTHS[settings.coverSize]
    : (width - NARROW_GUTTER * 2 - NARROW_COLUMN_GAP * (columns - 1)) / columns;
  const estimated =
    layout === "list"
      ? LIST_ROW
      : layout === "compact"
        ? COMPACT_ROW
        : Math.round(coverWidth * 1.5) + (wide ? 76 + WIDE_ROW_GAP : 50 + NARROW_ROW_GAP);
  const rowGap = layout === "grid" ? (wide ? WIDE_ROW_GAP : NARROW_ROW_GAP) : 0;
  const stride = measured > 0 ? measured + rowGap : estimated;
  const rowCount = Math.ceil(entries.length / columns);
  const listTop = list.current && body.current ? list.current.offsetTop : 0;
  const { first, last } = windowOf(rowCount, stride, scrollTop, listTop, viewport);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  // A new layout or size starts from a fresh measurement.
  useEffect(() => setMeasured(0), [layout, settings.coverSize, columns, wide]);

  useEffect(() => {
    const node = body.current;
    if (!node) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrollTop(node.scrollTop);
      setViewport(node.clientHeight > 0 ? node.clientHeight : window.innerHeight);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    node.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      node.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  // Measures the first drawn row so the window keeps step with the real CSS.
  useLayoutEffect(() => {
    const row = list.current?.querySelector<HTMLElement>("[data-shelf-row]");
    const height = row ? row.getBoundingClientRect().height : 0;
    if (height > 0 && Math.abs(height - measured) > 0.5) setMeasured(height);
  });

  // A focus the keyboard asked for lands once its row is drawn.
  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    const cell = cells.current.get(index);
    // A row drawn by an earlier render may linger, unmounted, in the map.
    if (!cell?.isConnected) return;
    pendingFocus.current = null;
    cell.focus();
  });

  // The same, by Document: the renders before the one that draws its row may
  // still list other Documents at that index, so the row is matched by id.
  useLayoutEffect(() => {
    const id = pendingFocusId.current;
    if (id === null) return;
    const index = entries.findIndex((candidate) => candidate.id === id);
    if (index === -1) return;
    const cell = cells.current.get(index);
    if (cell?.isConnected && cell.dataset.documentId === id) {
      pendingFocusId.current = null;
      setActiveIndex(index);
      cell.focus();
      return;
    }
    reveal(Math.floor(index / columns));
  });

  /** Scrolls the body until row `row` is fully on screen. */
  const reveal = (row: number) => {
    const node = body.current;
    if (!node) return;
    const top = listTop + row * stride;
    const height = node.clientHeight > 0 ? node.clientHeight : viewport;
    let next = node.scrollTop;
    if (top < next) next = top;
    else if (top + stride > next + height) next = top + stride - height;
    if (next !== node.scrollTop) {
      node.scrollTop = next;
      setScrollTop(next);
    }
  };

  const focusIndex = (index: number) => {
    setActiveIndex(index);
    pendingFocus.current = index;
    reveal(Math.floor(index / columns));
    const cell = cells.current.get(index);
    if (cell) {
      pendingFocus.current = null;
      cell.focus();
    }
  };

  // A caller that names the row to focus gets it, once per request, so a
  // repeated render never steals focus from a surface the author just opened.
  useLayoutEffect(() => {
    if (!focusDocumentId) {
      lastFocus.current = null;
      return;
    }
    if (lastFocus.current === focusDocumentId) return;
    const index = entries.findIndex((candidate) => candidate.id === focusDocumentId);
    if (index === -1) return;
    lastFocus.current = focusDocumentId;
    focusIndex(index);
  }, [focusDocumentId, entries]);

  const menuEntry =
    menuDocumentId === null
      ? null
      : (all.find((candidate) => candidate.id === menuDocumentId) ?? null);
  const layerOpen = menuEntry !== null || removal !== null || options !== null;

  const closeMenu = () => onMenuChange(null);

  const moveTo = (index: number) => {
    if (entries.length === 0) return;
    focusIndex(Math.min(entries.length - 1, Math.max(0, index)));
  };

  /** Focuses the search field, remembering where focus was so Escape can return it. */
  const focusSearch = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== searchInput.current) {
      searchReturn.current = active;
      // Read from the cell itself: the `/` listener holds an older render's
      // rows, whose order may differ from what is drawn.
      searchReturnId.current =
        active.closest<HTMLElement>("[data-document-id]")?.dataset.documentId ?? null;
    }
    if (searchInput.current) {
      searchInput.current.focus();
      searchInput.current.select();
      return;
    }
    focusSearchNext.current = true;
    setSearchOpen(true);
  };

  // The phone header swaps to its search field first; focus follows it.
  useLayoutEffect(() => {
    if (!focusSearchNext.current || !searchInput.current) return;
    focusSearchNext.current = false;
    searchInput.current.focus();
  });

  // The searchShelf Command ("/" by default) and Find in Document (Ctrl or
  // Cmd+F) reach here through the host, so a Custom Shortcut rebinds them. An
  // open layer keeps focus: the search waits behind it.
  useEffect(() => {
    if (searchRequest > 0 && !layerOpen) focusSearch();
  }, [searchRequest]);

  useEffect(() => {
    if (optionsRequest > 0) setOptions(wide ? "filters" : "all");
  }, [optionsRequest, wide]);

  /** Returns focus where it was before the search took it, or to the Shelf. */
  const returnFromSearch = () => {
    const target = searchReturn.current;
    const targetId = searchReturnId.current;
    searchReturn.current = null;
    searchReturnId.current = null;
    if (target?.isConnected && target !== searchInput.current) {
      target.focus();
      return;
    }
    // A search that matched nothing unmounted the row: focus it again by its
    // Document once the cleared Shelf draws it.
    if (targetId !== null && all.some((candidate) => candidate.id === targetId)) {
      pendingFocusId.current = targetId;
      return;
    }
    if (entries.length > 0) {
      focusIndex(Math.min(activeIndex, entries.length - 1));
      return;
    }
    searchButton.current?.focus();
  };

  const setSearch = (search: string) => change({ ...settings, search });

  const onSearchKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    // Return first: the cleared Shelf may draw synchronously, and a row it
    // brings back must already be the one waiting for focus.
    returnFromSearch();
    setSearch("");
    if (!wide) setSearchOpen(false);
  };

  const closeSearch = () => {
    setSearch("");
    setSearchOpen(false);
    searchReturn.current = null;
    searchReturnId.current = null;
    // The header swaps back; its Search button is where the author was.
    requestAnimationFrame(() => searchButton.current?.focus());
  };

  const openMenu = (entry: FrameShelfEntry, anchor: HTMLElement | null) => {
    onSelect(entry.id);
    menuAnchor.current = anchor;
    onMenuChange(entry.id);
  };

  // Only a readable row opens its Document. Every other row opens its menu, so
  // the author sees Locate or Remove instead of a command that cannot run.
  const activate = (entry: FrameShelfEntry, index: number) => {
    onSelect(entry.id);
    if (entry.state === "ok") onCommand("openDocument", entry.id);
    else openMenu(entry, cells.current.get(index) ?? null);
  };

  const onCellKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>, index: number) => {
    // A key pressed on the More button is the button's, not the cell's.
    if (event.target !== event.currentTarget) return;
    const entry = entries[index];
    if (!entry) return;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveTo(index + 1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        moveTo(index - 1);
        return;
      case "ArrowDown":
        event.preventDefault();
        moveTo(index + columns);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveTo(index - columns);
        return;
      case "Home":
        event.preventDefault();
        moveTo(0);
        return;
      case "End":
        event.preventDefault();
        moveTo(entries.length - 1);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        activate(entry, index);
        return;
      case "ContextMenu":
        event.preventDefault();
        openMenu(entry, cells.current.get(index) ?? null);
        return;
      case "F10":
        if (!event.shiftKey) return;
        event.preventDefault();
        openMenu(entry, cells.current.get(index) ?? null);
        return;
      default:
        return;
    }
  };

  const menuItems = (entry: FrameShelfEntry): MenuItem[] => {
    const items: MenuItem[] = [];
    if (entry.state === "ok") {
      items.push({ id: "openDocument", label: labels.open, icon: "book" });
    } else if (entry.state === "missing" || entry.state === "needs-permission") {
      items.push({ id: "locateDocument", label: labels.locate, icon: "relink" });
    }
    // As drawn, Remove is the destructive row, set apart below the others.
    items.push({
      id: "removeFromShelf",
      label: labels.remove,
      icon: "trash",
      destructive: true,
      groupStart: items.length > 0,
    });
    return items;
  };

  const selectMenuItem = (id: string) => {
    if (!menuEntry) return;
    onCommand(id as FrameShelfCommandId, menuEntry.id);
    onMenuChange(null);
  };

  // While the active row is scrolled out of the window, the first drawn cell
  // holds the Tab stop, so Tab always finds the Shelf.
  const activeDrawn = activeIndex >= first * columns && activeIndex < last * columns;
  const tabStop = activeDrawn ? activeIndex : first * columns;

  const moreButton = (entry: FrameShelfEntry, index: number, small: boolean) => (
    <span class="shelf-card__more">
      <IconButton
        label={fill(labels.moreFor, { title: entry.title })}
        icon="moreV"
        tabIndex={-1}
        // Drawn at 28 px beside the title on Wide; Narrow keeps the 44 px touch target.
        style={small ? MORE_WIDE_SIZE : undefined}
        buttonRef={(node) => {
          if (node) moreButtons.current.set(index, node);
          else moreButtons.current.delete(index);
        }}
        onClick={() => openMenu(entry, moreButtons.current.get(index) ?? null)}
      />
    </span>
  );

  const cellContent = (entry: FrameShelfEntry, index: number) => {
    const missing = entry.state === "missing" || entry.state === "needs-permission";
    const search = settings.search;
    if (layout === "compact") {
      return (
        <>
          <span class="shelf-compact__text">
            <strong class="shelf-compact__title">
              <Marked text={entry.title} search={search} />
            </strong>
            {entry.author === "" ? null : (
              <span class="shelf-compact__author">
                {" · "}
                <Marked text={entry.author} search={search} />
              </span>
            )}
          </span>
          {missing ? <span class="shelf-row__missing">{labels.missing}</span> : null}
          <span class="shelf-compact__format">{entry.format.toUpperCase()}</span>
          <StatusMeta entry={entry} class="shelf-compact__meta" />
        </>
      );
    }
    const cover = (coverWidthPx: number) => (
      <Cover
        width={coverWidthPx}
        title={entry.title}
        author={entry.author}
        format={entry.format}
        tone={entry.tone}
        src={entry.coverDataUrl}
        missing={missing}
      />
    );
    if (layout === "list") {
      return (
        <>
          {cover(40)}
          <span class="shelf-list__text">
            <span class="shelf-list__title">
              <Marked text={entry.title} search={search} />
            </span>
            <span class="shelf-list__meta">
              {entry.author === "" ? null : (
                <>
                  <Marked text={entry.author} search={search} />
                  {" · "}
                </>
              )}
              {entry.format.toUpperCase()}
              {missing ? ` · ${labels.missing}` : ""}
            </span>
            <span class="shelf-list__progress">
              <span class="shelf-list__bar" aria-hidden="true">
                <span
                  class="shelf-card__progress-fill"
                  style={{ width: `${entry.progressPercent ?? 0}%` }}
                />
              </span>
              <StatusMeta entry={entry} class="shelf-list__status" />
            </span>
          </span>
          {moreButton(entry, index, false)}
        </>
      );
    }
    const status = entry.state === "unreadable" ? entry.statusText : null;
    const meta =
      entry.author === "" ? entry.progressText : `${entry.author} · ${entry.progressText}`;
    return (
      <>
        <div class="shelf-card__cover">
          {cover(wide ? COVER_WIDTHS[settings.coverSize] : Math.floor(coverWidth))}
          {wide ? <span class="shelf-card__format">{entry.format.toUpperCase()}</span> : null}
          {missing ? (
            <span class="shelf-card__chip">
              <Icon name="alert" />
              {labels.missing}
            </span>
          ) : null}
        </div>
        {!wide || entry.progressPercent === null ? null : (
          <span class="shelf-card__progress" aria-hidden="true">
            <span
              class="shelf-card__progress-fill"
              style={{ width: `${entry.progressPercent}%` }}
            />
          </span>
        )}
        <span class="shelf-card__info">
          <span class="shelf-card__text">
            <span class="shelf-card__title">
              <Marked text={entry.title} search={search} />
            </span>
            {wide ? (
              <span class="shelf-card__meta">{meta}</span>
            ) : (
              <StatusMeta entry={entry} class="shelf-card__meta" />
            )}
            {status === null ? null : <span class="shelf-card__status">{status}</span>}
          </span>
          {moreButton(entry, index, wide)}
        </span>
      </>
    );
  };

  const renderCell = (entry: FrameShelfEntry, index: number) => (
    // biome-ignore lint/a11y/useSemanticElements: the Shelf is a cover grid, not tabular data; a WAI-ARIA grid is the right pattern.
    <div
      key={entry.id}
      data-document-id={entry.id}
      ref={(node) => {
        if (node) cells.current.set(index, node);
        else cells.current.delete(index);
      }}
      role="gridcell"
      aria-selected={index === activeIndex}
      tabIndex={index === tabStop ? 0 : -1}
      class={
        layout === "grid"
          ? wide
            ? "shelf-card"
            : "shelf-card shelf-card--narrow"
          : layout === "list"
            ? "shelf-list"
            : "shelf-compact"
      }
      onFocus={(event) => {
        if (event.target !== event.currentTarget) return;
        setActiveIndex(index);
        onSelect(entry.id);
      }}
      onKeyDown={(event) => onCellKeyDown(event, index)}
    >
      {cellContent(entry, index)}
    </div>
  );

  const openImport = () => onCommand("openFile");
  const clear = () => change(clearFilters(settings));
  const optionsCount = settings.formats.length + settings.statuses.length;
  const countText = filtering
    ? fill(labels.shownOf, { shown: entries.length, total: all.length })
    : fill(all.length === 1 ? labels.documentsCountOne : labels.documentsCountOther, {
        count: all.length,
      });

  /** The removable chips of every active status and format filter. */
  const activeChips = () => [
    ...settings.statuses.map((status) => {
      const text = fill(labels.statusChip, { status: statusLabel(labels, status) });
      return (
        <Chip
          key={`status-${status}`}
          onRemove={() =>
            change({ ...settings, statuses: settings.statuses.filter((item) => item !== status) })
          }
          removeLabel={fill(labels.removeFilter, { filter: text })}
        >
          {text}
        </Chip>
      );
    }),
    ...settings.formats.map((format) => {
      const text = fill(labels.formatChip, { format: format.toUpperCase() });
      return (
        <Chip
          key={`format-${format}`}
          onRemove={() =>
            change({ ...settings, formats: settings.formats.filter((item) => item !== format) })
          }
          removeLabel={fill(labels.removeFilter, { filter: text })}
        >
          {text}
        </Chip>
      );
    }),
  ];

  let content: ComponentChildren;
  if (state.status === "loading") {
    content = <p class="shelf__message">{labels.loading}</p>;
  } else if (state.status === "error") {
    content = <p class="shelf__message shelf__message--error">{labels.error}</p>;
  } else if (all.length === 0) {
    content = (
      <div class="shelf__empty">
        <h2 class="shelf__empty-title">{labels.emptyTitle}</h2>
        <p class="shelf__empty-text">{labels.emptyDescription}</p>
        <Button variant="primary" onClick={openImport}>
          {labels.importFiles}
        </Button>
      </div>
    );
  } else if (entries.length === 0) {
    content = (
      <div class="shelf__empty">
        <h2 class="shelf__empty-title">{labels.noMatch}</h2>
        <Button variant="secondary" onClick={clear}>
          {labels.clearFilters}
        </Button>
      </div>
    );
  } else {
    const rows: ComponentChildren[] = [];
    for (let row = first; row < last; row++) {
      const start = row * columns;
      rows.push(
        // biome-ignore lint/a11y/useSemanticElements: the Shelf is a cover grid, not tabular data; a WAI-ARIA grid is the right pattern.
        // biome-ignore lint/a11y/useFocusableInteractive: the cells own focus; a row is only the row group.
        <div
          key={entries[start]?.id ?? row}
          data-shelf-row
          class={layout === "grid" ? "shelf__row" : "shelf__row shelf__row--line"}
          role="row"
          aria-rowindex={row + 1}
          style={
            layout === "grid"
              ? {
                  gridTemplateColumns: wide
                    ? `repeat(${columns}, ${COVER_WIDTHS[settings.coverSize]}px)`
                    : `repeat(${columns}, minmax(0, 1fr))`,
                  ...(wide && { "--shelf-cover-width": `${COVER_WIDTHS[settings.coverSize]}px` }),
                }
              : undefined
          }
        >
          {entries
            .slice(start, start + columns)
            .map((entry, column) => renderCell(entry, start + column))}
        </div>
      );
    }
    content = (
      // biome-ignore lint/a11y/useSemanticElements: the Shelf is a cover grid, not tabular data; a WAI-ARIA grid is the right pattern.
      <div
        ref={list}
        class={`shelf__grid shelf__grid--${layout}`}
        role="grid"
        aria-label={labels.shelf}
        aria-rowcount={rowCount}
        style={{
          paddingTop: `${first * stride}px`,
          paddingBottom: `${Math.max(0, rowCount - last) * stride}px`,
        }}
      >
        {rows}
      </div>
    );
  }

  const searchField = (
    <input
      ref={searchInput}
      type="search"
      class="shelf-search__input"
      value={settings.search}
      placeholder={wide ? labels.searchPlaceholder : undefined}
      aria-label={labels.searchLabel}
      onInput={(event) => setSearch(event.currentTarget.value)}
      onKeyDown={onSearchKeyDown}
    />
  );

  const ready = state.status === "ready" && all.length > 0;

  const header = wide ? (
    <>
      <header class="shelf__header shelf__header--wide">
        <div class="shelf__spacer" />
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the input inside is the control; its aria-label names it. */}
        <label class="shelf-search">
          <Icon name="search" />
          {searchField}
          <span class="shelf-search__key" aria-hidden="true">
            /
          </span>
        </label>
        <Button variant="primary" onClick={openImport}>
          <Icon name="import" />
          {labels.import}
        </Button>
      </header>
      <div class="shelf__toolbar">
        <h1 class="shelf__heading">{labels.allDocuments}</h1>
        <span class="shelf__count">{countText}</span>
        <div class="shelf__spacer" />
        {ready ? (
          <>
            <span ref={sortAnchor}>
              <Button
                aria-haspopup="dialog"
                aria-expanded={options === "sort"}
                aria-label={fill(labels.sortByValue, { sort: sortLabel(labels, settings.sort) })}
                onClick={() => setOptions(options === "sort" ? null : "sort")}
              >
                <Icon name="sort" />
                {sortLabel(labels, settings.sort)}
                <Icon name="down" />
              </Button>
            </span>
            <span ref={filtersAnchor}>
              <Button
                aria-haspopup="dialog"
                aria-expanded={options === "filters"}
                onClick={() => setOptions(options === "filters" ? null : "filters")}
              >
                <Icon name="filter" />
                {labels.filters}
                {optionsCount > 0 ? <span class="shelf__badge">{optionsCount}</span> : null}
              </Button>
            </span>
            <LayoutControl labels={labels} settings={settings} onChange={change} compact />
            {layout === "grid" ? (
              <CoverSizeControl labels={labels} settings={settings} onChange={change} compact />
            ) : null}
          </>
        ) : null}
      </div>
      {optionsCount > 0 ? (
        <div class="shelf-chips">
          {activeChips()}
          <Button variant="ghost" class="shelf-chips__clear" onClick={clear}>
            {labels.clearFilters}
          </Button>
        </div>
      ) : null}
    </>
  ) : searchOpen ? (
    <>
      <header class="shelf__header shelf__header--search">
        <IconButton label={labels.closeSearch} icon="back" onClick={closeSearch} />
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the input inside is the control; its aria-label names it. */}
        <label class="shelf-search shelf-search--open">{searchField}</label>
        <IconButton
          label={labels.clearSearch}
          icon="close"
          onClick={() => {
            setSearch("");
            searchInput.current?.focus();
          }}
        />
      </header>
      {searchTokensShown(settings.search) ? (
        <p class="shelf__result">
          {fill(entries.length === 1 ? labels.searchMatchesOne : labels.searchMatchesOther, {
            count: entries.length,
            search: settings.search.trim(),
            layout: layoutViewLabel(labels, layout),
          })}
        </p>
      ) : null}
    </>
  ) : (
    <>
      <header class="shelf__header">
        <div class="shelf__titles">
          <h1 class="shelf__heading">{labels.shelf}</h1>
        </div>
        {ready ? (
          <>
            <IconButton
              label={labels.searchLabel}
              icon="search"
              buttonRef={(node) => {
                searchButton.current = node;
              }}
              onClick={focusSearch}
            />
            <IconButton
              label={labels.viewOptions}
              icon="sliders"
              onClick={() => setOptions("all")}
            />
          </>
        ) : null}
        <IconButton label={labels.import} icon="import" onClick={openImport} />
      </header>
      {ready ? (
        <>
          <div class="shelf-chips shelf-chips--scroll">
            <Chip
              pressed={settings.statuses.length === 0}
              onPressedChange={() => change({ ...settings, statuses: [] })}
            >
              {labels.all}
            </Chip>
            {(["new", "reading", "finished"] as const).map((status) => (
              <Chip
                key={status}
                pressed={settings.statuses.includes(status)}
                onPressedChange={(pressed) =>
                  change({
                    ...settings,
                    statuses: (["new", "reading", "finished"] as const).filter((item) =>
                      item === status ? pressed : settings.statuses.includes(item)
                    ),
                  })
                }
              >
                {statusLabel(labels, status)}
              </Chip>
            ))}
            {settings.formats.map((format) => {
              const text = fill(labels.formatChip, { format: format.toUpperCase() });
              return (
                <Chip
                  key={`format-${format}`}
                  onRemove={() =>
                    change({
                      ...settings,
                      formats: settings.formats.filter((item) => item !== format),
                    })
                  }
                  removeLabel={fill(labels.removeFilter, { filter: text })}
                >
                  {text}
                </Chip>
              );
            })}
          </div>
          <p class="shelf__summary">
            <span>{countText}</span>
            <span>{sortSummary(labels, settings)}</span>
          </p>
        </>
      ) : null}
    </>
  );

  return (
    <div class="shelf">
      {header}

      <div class="shelf__body" ref={body}>
        {notice ? (
          <div
            class={notice.error ? "shelf-notice shelf-notice--error" : "shelf-notice"}
            role="status"
          >
            <span class="shelf-notice__text">{notice.text}</span>
            <IconButton label={labels.dismiss} icon="close" onClick={onNoticeClose} />
          </div>
        ) : null}

        {content}
      </div>

      {options === null ? null : wide ? (
        <Popover
          open
          onClose={() => setOptions(null)}
          triggerRef={options === "sort" ? sortAnchor : filtersAnchor}
          label={options === "sort" ? labels.sortBy : labels.filters}
          class="shelf-popover"
        >
          <ShelfOptions
            labels={labels}
            settings={settings}
            onChange={change}
            part={options === "sort" ? "sort" : "filters"}
          />
        </Popover>
      ) : (
        <Sheet
          open
          onClose={() => setOptions(null)}
          title={labels.viewOptionsTitle}
          doneLabel={labels.done}
          actions={
            <Button variant="ghost" onClick={() => change(defaultShelfView())}>
              {labels.reset}
            </Button>
          }
          class="shelf-options-sheet"
        >
          <ShelfOptions labels={labels} settings={settings} onChange={change} part="all" />
          <p class="shelf-options__footer">
            {fill(labels.remembered, { shown: entries.length, total: all.length })}
          </p>
        </Sheet>
      )}

      {menuEntry === null ? null : wide ? (
        <Popover open onClose={closeMenu} triggerRef={menuAnchor} label={menuEntry.title}>
          <Menu
            open
            onClose={closeMenu}
            label={labels.documentActions}
            items={menuItems(menuEntry)}
            onSelect={selectMenuItem}
            header={<DocumentSummary entry={menuEntry} />}
            inline
          />
        </Popover>
      ) : (
        <Sheet open onClose={closeMenu} title={menuEntry.title} titleHidden>
          <Menu
            open
            onClose={closeMenu}
            label={labels.documentActions}
            items={menuItems(menuEntry)}
            onSelect={selectMenuItem}
            header={<DocumentSummary entry={menuEntry} />}
            inline
          />
        </Sheet>
      )}

      {removal === null ? null : wide ? (
        <Dialog
          open
          onClose={onRemoveClose}
          title={removal.title}
          role="alertdialog"
          actions={
            <RemoveActions
              labels={labels}
              onCancel={onRemoveClose}
              onRemove={() => onRemove(removal.documentId)}
            />
          }
        >
          <p class="shelf-remove__body">{removal.body}</p>
          <p class="shelf-remove__stats">{removal.stats}</p>
        </Dialog>
      ) : (
        <Sheet open onClose={onRemoveClose} title={removal.title} role="alertdialog">
          <p class="shelf-remove__body">{removal.body}</p>
          <p class="shelf-remove__stats">{removal.stats}</p>
          <div class="shelf-remove__actions">
            <RemoveActions
              labels={labels}
              onCancel={onRemoveClose}
              onRemove={() => onRemove(removal.documentId)}
            />
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Whether the search has any word in it, so the phone's result line has something to name. */
function searchTokensShown(search: string): boolean {
  return search.trim() !== "";
}
