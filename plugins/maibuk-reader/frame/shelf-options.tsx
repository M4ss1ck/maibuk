/** @jsxImportSource preact */
/**
 * The Shelf's view, sort, and filter controls (#945): the sections of the
 * "View and filters" Sheet on Narrow, reused as the Wide toolbar's Sort and
 * Filters popovers. Every control is controlled: it draws the settings it is
 * given and hands the next settings back, and the Shelf stores nothing itself.
 *
 * Copy comes from the Worker's catalogs through `FrameShelfLabels`; the kit
 * draws every control, so color, focus ring, and motion live in `kit.css`.
 */

import type { TargetedKeyboardEvent } from "preact";
import { useRef } from "preact/hooks";
import { Chip, Icon, Segmented, type SegmentedOption } from "./kit";
import { fill } from "./shelf-query";
import type {
  FrameShelfLabels,
  ShelfCoverSize,
  ShelfLayout,
  ShelfSort,
  ShelfStatus,
  ShelfViewSettings,
} from "./types";

/** The formats the Format filter offers, in the order the Sheet draws them. */
export const SHELF_FORMATS: readonly string[] = ["pdf", "epub", "mobi", "azw3", "fb2", "cbz"];

/** The sort orders, in the order the Sheet draws them. */
export const SHELF_SORTS: readonly ShelfSort[] = ["recent", "title", "author", "progress", "added"];

/** The statuses, in the order the Sheet draws them. */
export const SHELF_STATUSES: readonly ShelfStatus[] = ["new", "reading", "finished"];

/** Whether a sort starts from its largest value: newest, most read. Names start from A. */
export function defaultDescending(sort: ShelfSort): boolean {
  return sort !== "title" && sort !== "author";
}

/** The Shelf a fresh Reader shows; the Worker's `DEFAULT_SHELF_VIEW` mirrors it. */
export const DEFAULT_SHELF_VIEW: Readonly<ShelfViewSettings> = Object.freeze({
  layout: "grid",
  coverSize: "medium",
  sort: "recent",
  descending: true,
  formats: [],
  statuses: [],
  search: "",
});

/** A fresh copy of the default settings, with its own arrays. */
export function defaultShelfView(): ShelfViewSettings {
  return { ...DEFAULT_SHELF_VIEW, formats: [], statuses: [] };
}

/** The settings with filters and search cleared; view and sort stay. */
export function clearFilters(settings: ShelfViewSettings): ShelfViewSettings {
  return { ...settings, formats: [], statuses: [], search: "" };
}

/** The settings with `sort` chosen, in that sort's own starting direction. */
export function withSort(settings: ShelfViewSettings, sort: ShelfSort): ShelfViewSettings {
  if (settings.sort === sort) return settings;
  return { ...settings, sort, descending: defaultDescending(sort) };
}

/** `list` with `value` added or removed, kept in `order`. */
export function toggled<T extends string>(list: readonly T[], value: T, order: readonly T[]): T[] {
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return order.filter((item) => next.includes(item));
}

/** The name of one sort order. */
export function sortLabel(labels: FrameShelfLabels, sort: ShelfSort): string {
  switch (sort) {
    case "recent":
      return labels.sortRecent;
    case "title":
      return labels.sortTitle;
    case "author":
      return labels.sortAuthor;
    case "progress":
      return labels.sortProgress;
    case "added":
      return labels.sortAdded;
  }
}

/** Which way a sort runs, in the words the Reverse order button shows. */
export function directionLabel(
  labels: FrameShelfLabels,
  sort: ShelfSort,
  descending: boolean
): string {
  switch (sort) {
    case "title":
    case "author":
      return descending ? labels.zToA : labels.aToZ;
    case "progress":
      return descending ? labels.mostReadFirst : labels.leastReadFirst;
    default:
      return descending ? labels.newestFirst : labels.oldestFirst;
  }
}

/**
 * The phone summary of the sort, such as "Recent first": the drawn phrase for
 * Recent from newest, and the sort and its direction for every other order.
 */
export function sortSummary(labels: FrameShelfLabels, settings: ShelfViewSettings): string {
  if (settings.sort === "recent" && settings.descending) return labels.recentFirst;
  return fill(labels.sortSummary, {
    sort: sortLabel(labels, settings.sort),
    direction: directionLabel(labels, settings.sort, settings.descending),
  });
}

/** The name of one status. */
export function statusLabel(labels: FrameShelfLabels, status: ShelfStatus): string {
  switch (status) {
    case "new":
      return labels.statusNew;
    case "reading":
      return labels.statusReading;
    case "finished":
      return labels.statusFinished;
  }
}

/** The name of one layout, as the search result line says it ("List view"). */
export function layoutViewLabel(labels: FrameShelfLabels, layout: ShelfLayout): string {
  switch (layout) {
    case "grid":
      return labels.gridView;
    case "list":
      return labels.listView;
    case "compact":
      return labels.compactView;
  }
}

/** The three layouts; on the Wide toolbar they are drawn as icons alone. */
function layoutOptions(
  labels: FrameShelfLabels,
  iconOnly: boolean
): Array<SegmentedOption<ShelfLayout>> {
  return [
    { value: "grid", label: labels.layoutGrid, icon: "grid", iconOnly },
    { value: "list", label: labels.layoutList, icon: "list", iconOnly },
    { value: "compact", label: labels.layoutCompact, icon: "compact", iconOnly },
  ];
}

/** The three cover sizes; on the Wide toolbar they are drawn as S, M, L. */
function coverOptions(
  labels: FrameShelfLabels,
  short: boolean
): Array<SegmentedOption<ShelfCoverSize>> {
  const option = (value: ShelfCoverSize, label: string, text: string) =>
    short ? { value, label, text } : { value, label };
  return [
    option("small", labels.coverSmall, labels.coverSmallShort),
    option("medium", labels.coverMedium, labels.coverMediumShort),
    option("large", labels.coverLarge, labels.coverLargeShort),
  ];
}

/** The props every options control takes. */
export interface ShelfOptionsControlProps {
  labels: FrameShelfLabels;
  settings: ShelfViewSettings;
  onChange: (settings: ShelfViewSettings) => void;
}

/** Grid, List, Compact: icons alone on the Wide toolbar, icon and name in the Sheet. */
export function LayoutControl({
  labels,
  settings,
  onChange,
  compact = false,
}: ShelfOptionsControlProps & { compact?: boolean }) {
  return (
    <Segmented
      label={labels.layoutLabel}
      value={settings.layout}
      options={layoutOptions(labels, compact)}
      onChange={(layout) => onChange({ ...settings, layout })}
      class={compact ? "shelf-segmented" : "shelf-segmented shelf-segmented--fill"}
    />
  );
}

/** Small, Medium, Large: S, M, L on the Wide toolbar. */
export function CoverSizeControl({
  labels,
  settings,
  onChange,
  compact = false,
}: ShelfOptionsControlProps & { compact?: boolean }) {
  return (
    <Segmented
      label={labels.coverSize}
      value={settings.coverSize}
      options={coverOptions(labels, compact)}
      onChange={(coverSize) => onChange({ ...settings, coverSize })}
      class={compact ? "shelf-segmented" : "shelf-segmented shelf-segmented--fill"}
    />
  );
}

/**
 * The Sort by radio list: one Tab stop on the chosen order, arrow keys move and
 * choose, and the chosen row carries its Reverse order button.
 */
export function SortOptions({ labels, settings, onChange }: ShelfOptionsControlProps) {
  const radios = useRef<Array<HTMLButtonElement | null>>([]);

  const choose = (index: number) => {
    const sort = SHELF_SORTS[(index + SHELF_SORTS.length) % SHELF_SORTS.length];
    if (sort === undefined) return;
    onChange(withSort(settings, sort));
    radios.current[SHELF_SORTS.indexOf(sort)]?.focus();
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        choose(index + 1);
        return;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        choose(index - 1);
        return;
      case "Home":
        event.preventDefault();
        choose(0);
        return;
      case "End":
        event.preventDefault();
        choose(SHELF_SORTS.length - 1);
        return;
      default:
        return;
    }
  };

  return (
    <div class="shelf-sort" role="radiogroup" aria-label={labels.sortBy}>
      {SHELF_SORTS.map((sort, index) => {
        const chosen = settings.sort === sort;
        return (
          <div key={sort} class="shelf-sort__row">
            {/* biome-ignore lint/a11y/useSemanticElements: a Frame owns its roving radio group (ADR 0021), as the kit Segmented does. */}
            <button
              ref={(node) => {
                radios.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen ? 0 : -1}
              class="shelf-sort__option"
              onClick={() => choose(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span class="shelf-sort__check">{chosen ? <Icon name="check" /> : null}</span>
              {sortLabel(labels, sort)}
            </button>
            {chosen ? (
              <button
                type="button"
                class="shelf-sort__reverse"
                aria-label={fill(labels.reverseOrderValue, {
                  direction: directionLabel(labels, sort, settings.descending),
                })}
                onClick={() => onChange({ ...settings, descending: !settings.descending })}
              >
                <Icon name="sort" />
                {directionLabel(labels, sort, settings.descending)}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The Status toggle chips: New, Reading, Finished. */
export function StatusChips({ labels, settings, onChange }: ShelfOptionsControlProps) {
  return (
    <div class="shelf-chips shelf-chips--wrap">
      {SHELF_STATUSES.map((status) => {
        const pressed = settings.statuses.includes(status);
        return (
          <Chip
            key={status}
            pressed={pressed}
            onPressedChange={() =>
              onChange({
                ...settings,
                statuses: toggled(settings.statuses, status, SHELF_STATUSES),
              })
            }
          >
            {pressed ? <Icon name="check" /> : null}
            {statusLabel(labels, status)}
          </Chip>
        );
      })}
    </div>
  );
}

/** The Format toggle chips, one per format Reader opens. */
export function FormatChips({ settings, onChange }: ShelfOptionsControlProps) {
  return (
    <div class="shelf-chips shelf-chips--wrap">
      {SHELF_FORMATS.map((format) => {
        const pressed = settings.formats.includes(format);
        return (
          <Chip
            key={format}
            pressed={pressed}
            onPressedChange={() =>
              onChange({
                ...settings,
                formats: toggled(settings.formats, format, SHELF_FORMATS),
              })
            }
          >
            {pressed ? <Icon name="check" /> : null}
            {format.toUpperCase()}
          </Chip>
        );
      })}
    </div>
  );
}

/** One labelled section of the options, as the Sheet draws them. */
function Section({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <section class="shelf-options__section" aria-label={label}>
      <p class="shelf-options__label" aria-hidden="true">
        {label}
      </p>
      {children}
    </section>
  );
}

/** Which sections an options surface draws. */
export type ShelfOptionsPart = "all" | "sort" | "filters";

/**
 * The options body: every section in the Narrow Sheet, or only Sort or only
 * the filters in a Wide popover. Cover size is drawn only for the grid, the one
 * layout it changes.
 */
export function ShelfOptions({
  labels,
  settings,
  onChange,
  part = "all",
}: ShelfOptionsControlProps & { part?: ShelfOptionsPart }) {
  const all = part === "all";
  return (
    <div class="shelf-options">
      {all ? (
        <Section label={labels.layout}>
          <LayoutControl labels={labels} settings={settings} onChange={onChange} />
        </Section>
      ) : null}
      {all && settings.layout === "grid" ? (
        <Section label={labels.coverSize}>
          <CoverSizeControl labels={labels} settings={settings} onChange={onChange} />
        </Section>
      ) : null}
      {all || part === "sort" ? (
        <Section label={labels.sortBy}>
          <SortOptions labels={labels} settings={settings} onChange={onChange} />
        </Section>
      ) : null}
      {all || part === "filters" ? (
        <>
          <Section label={labels.status}>
            <StatusChips labels={labels} settings={settings} onChange={onChange} />
          </Section>
          <Section label={labels.format}>
            <FormatChips labels={labels} settings={settings} onChange={onChange} />
          </Section>
        </>
      ) : null}
    </div>
  );
}
