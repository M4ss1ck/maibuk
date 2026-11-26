/** @jsxImportSource preact */
/**
 * The Reader Frame's Shelf (#944 packet 5): the grid of covers the Worker sends
 * with its rows already ordered, localized, and stripped of the File Grant and
 * Fingerprint. The Frame owns only what it draws: the responsive 128 by 192
 * cover grid, its one roving Tab stop, the per-row Document menu, and the
 * Remove from Shelf confirmation. Every action goes back as a callback; the
 * Worker decides what Open, Locate, Import, and Remove really do.
 *
 * Every user-visible string is a label from the Worker's catalogs, and every
 * color comes from `tokens.css` through `shelf.css`. The component composes the
 * shared kit for its buttons, overlays, Menu, Cover, and Chip, so no color,
 * focus ring, or motion is reimplemented here.
 */

import type { ComponentChildren, TargetedKeyboardEvent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  Button,
  Cover,
  Dialog,
  Icon,
  IconButton,
  Menu,
  type MenuItem,
  Popover,
  Sheet,
} from "./kit";
import type {
  FrameShelfCommandId,
  FrameShelfEntry,
  FrameShelfLabels,
  FrameShelfState,
} from "./types";
import { useLayoutMode } from "./use-layout-mode";

/** The artboard's cover box; the Cover keeps its 2:3 ratio from this width. */
const COVER_WIDTH = 128;

/** The More button's size beside a cover's title on Wide, as "Shelf · desktop · grid M" draws it. */
const MORE_WIDE_SIZE = { width: "28px", height: "28px" } as const;

/** The Narrow gutter, gap, and the Wide gutter the design sheet names. */
const NARROW_GUTTER = 16;
const NARROW_GAP = 12;
const WIDE_GUTTER = 24;
const WIDE_GAP = 24;

/** The widest the Wide grid grows before it stops adding columns. */
const WIDE_MAX_COLUMNS = 6;

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
  notice?: ShelfNotice | null;
  removal?: ShelfRemoval | null;
  /** The row whose Document menu is open, or null. */
  menuDocumentId: string | null;
  /** The row to focus when the caller moves focus back into the grid. */
  focusDocumentId?: string | null;
  onCommand: (id: FrameShelfCommandId, documentId?: string) => void;
  onSelect: (documentId: string) => void;
  onMenuChange: (documentId: string | null) => void;
  onRemove: (documentId: string) => void;
  onRemoveClose: () => void;
  onNoticeClose: () => void;
}

/** Fills `{{name}}` placeholders; an unknown name fills empty. */
function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    name in values ? String(values[name]) : ""
  );
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

/**
 * How many 128 px covers fit across the Frame: as many as fit in Narrow, and
 * up to six in Wide, each with the gutter and gap the design sheet names.
 */
function columnsFor(wide: boolean, width: number): number {
  const gutter = wide ? WIDE_GUTTER : NARROW_GUTTER;
  const gap = wide ? WIDE_GAP : NARROW_GAP;
  const fit = Math.floor((width - gutter * 2 + gap) / (COVER_WIDTH + gap));
  return Math.max(1, Math.min(wide ? WIDE_MAX_COLUMNS : Number.POSITIVE_INFINITY, fit));
}

/** Chunks the Worker's row order into the rows the grid draws. */
function rowsOf(entries: readonly FrameShelfEntry[], columns: number): FrameShelfEntry[][] {
  const rows: FrameShelfEntry[][] = [];
  for (let index = 0; index < entries.length; index += columns) {
    rows.push(entries.slice(index, index + columns));
  }
  return rows;
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

/** The Frame-local Shelf: header, states, cover grid, Document menu, and removal. */
export function Shelf({
  state,
  labels,
  notice = null,
  removal = null,
  menuDocumentId,
  focusDocumentId,
  onCommand,
  onSelect,
  onMenuChange,
  onRemove,
  onRemoveClose,
  onNoticeClose,
}: ShelfProps) {
  const { mode } = useLayoutMode();
  const width = useViewportWidth();
  const entries = state.entries;
  const columns = columnsFor(mode === "wide", width);
  const rows = rowsOf(entries, columns);
  const [activeIndex, setActiveIndex] = useState(0);
  const cells = useRef<Array<HTMLDivElement | null>>([]);
  const moreButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const lastFocus = useRef<string | null>(null);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, entries.length - 1)));
  }, [entries.length]);

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
    setActiveIndex(index);
    cells.current[index]?.focus();
  }, [focusDocumentId, entries]);

  const menuEntry =
    menuDocumentId === null
      ? null
      : (entries.find((candidate) => candidate.id === menuDocumentId) ?? null);

  const closeMenu = () => onMenuChange(null);

  const moveTo = (index: number) => {
    if (entries.length === 0) return;
    const target = Math.min(entries.length - 1, Math.max(0, index));
    setActiveIndex(target);
    cells.current[target]?.focus();
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
    else openMenu(entry, cells.current[index]);
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
        openMenu(entry, cells.current[index]);
        return;
      case "F10":
        if (!event.shiftKey) return;
        event.preventDefault();
        openMenu(entry, cells.current[index]);
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

  const renderCell = (entry: FrameShelfEntry, index: number) => {
    const missing = entry.state === "missing" || entry.state === "needs-permission";
    const status = entry.state === "unreadable" ? entry.statusText : null;
    const meta =
      entry.author === "" ? entry.progressText : `${entry.author} · ${entry.progressText}`;
    const moreLabel = fill(labels.moreFor, { title: entry.title });
    return (
      // biome-ignore lint/a11y/useSemanticElements: the Shelf is a cover grid, not tabular data; a WAI-ARIA grid is the right pattern.
      <div
        key={entry.id}
        ref={(node) => {
          cells.current[index] = node;
        }}
        role="gridcell"
        aria-selected={index === activeIndex}
        tabIndex={index === activeIndex ? 0 : -1}
        class="shelf-card"
        onFocus={(event) => {
          if (event.target !== event.currentTarget) return;
          setActiveIndex(index);
          onSelect(entry.id);
        }}
        onKeyDown={(event) => onCellKeyDown(event, index)}
      >
        <div class="shelf-card__cover">
          <Cover
            width={COVER_WIDTH}
            title={entry.title}
            author={entry.author}
            format={entry.format}
            tone={entry.tone}
            src={entry.coverDataUrl}
            missing={missing}
          />
          <span class="shelf-card__format">{entry.format.toUpperCase()}</span>
          {missing ? (
            <span class="shelf-card__chip">
              <Icon name="alert" />
              {labels.missing}
            </span>
          ) : null}
        </div>
        {entry.progressPercent === null ? null : (
          <span class="shelf-card__progress" aria-hidden="true">
            <span
              class="shelf-card__progress-fill"
              style={{ width: `${entry.progressPercent}%` }}
            />
          </span>
        )}
        <span class="shelf-card__info">
          <span class="shelf-card__text">
            <span class="shelf-card__title">{entry.title}</span>
            <span class="shelf-card__meta">{meta}</span>
            {status === null ? null : <span class="shelf-card__status">{status}</span>}
          </span>
          <span class="shelf-card__more">
            <IconButton
              label={moreLabel}
              icon="moreV"
              tabIndex={-1}
              // Drawn at 28 px beside the title on Wide; Narrow keeps the 44 px touch target.
              style={mode === "wide" ? MORE_WIDE_SIZE : undefined}
              buttonRef={(node) => {
                moreButtons.current[index] = node;
              }}
              onClick={() => openMenu(entry, moreButtons.current[index])}
            />
          </span>
        </span>
      </div>
    );
  };

  const openImport = () => onCommand("openFile");

  let content: ComponentChildren;
  if (state.status === "loading") {
    content = <p class="shelf__message">{labels.loading}</p>;
  } else if (state.status === "error") {
    content = <p class="shelf__message shelf__message--error">{labels.error}</p>;
  } else if (entries.length === 0) {
    content = (
      <div class="shelf__empty">
        <h2 class="shelf__empty-title">{labels.emptyTitle}</h2>
        <p class="shelf__empty-text">{labels.emptyDescription}</p>
        <Button variant="primary" onClick={openImport}>
          {labels.importFiles}
        </Button>
      </div>
    );
  } else {
    content = (
      // biome-ignore lint/a11y/useSemanticElements: the Shelf is a cover grid, not tabular data; a WAI-ARIA grid is the right pattern.
      <div class="shelf__grid" role="grid" aria-label={labels.shelf}>
        {rows.map((row, rowIndex) => (
          // biome-ignore lint/a11y/useSemanticElements: the Shelf is a cover grid, not tabular data; a WAI-ARIA grid is the right pattern.
          // biome-ignore lint/a11y/useFocusableInteractive: the cells own focus; a row is only the row group.
          <div
            key={row[0]?.id ?? rowIndex}
            class="shelf__row"
            role="row"
            style={{ gridTemplateColumns: `repeat(${columns}, ${COVER_WIDTH}px)` }}
          >
            {row.map((entry, columnIndex) => renderCell(entry, rowIndex * columns + columnIndex))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div class="shelf">
      <header class="shelf__header">
        <div class="shelf__titles">
          <h1 class="shelf__heading">{labels.shelf}</h1>
          <p class="shelf__count">
            {fill(entries.length === 1 ? labels.documentsCountOne : labels.documentsCountOther, {
              count: entries.length,
            })}
          </p>
        </div>
        {mode === "wide" ? (
          <Button variant="primary" onClick={openImport}>
            {labels.import}
          </Button>
        ) : (
          <IconButton label={labels.import} icon="import" onClick={openImport} />
        )}
      </header>

      <div class="shelf__body">
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

      {menuEntry === null ? null : mode === "wide" ? (
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

      {removal === null ? null : mode === "wide" ? (
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
