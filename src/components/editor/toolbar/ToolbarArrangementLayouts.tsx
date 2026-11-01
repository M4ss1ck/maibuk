import {
  useLayoutEffect,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Editor } from "@tiptap/react";
import { Trans, useTranslation } from "react-i18next";
import { ListBox, ListBoxItem, type ListBoxItemRenderProps } from "react-aria-components/ListBox";
import {
  DropIndicator,
  useDragAndDrop,
  type DragAndDropOptions,
  type DropTarget,
  type TextDropItem,
} from "react-aria-components/useDragAndDrop";
import { useDrop } from "react-aria";
import { ResizeHandle } from "@/components/ui";
import { Divider } from "@/components/editor/ToolbarButton";
import {
  EditorToolbarGroups,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";
import { toolbarButtonPresentation } from "@/components/editor/toolbar/toolbar-groups";
import {
  ToolbarFixedUtilities,
  ToolbarUtilityCluster,
} from "@/components/editor/toolbar/ToolbarUtilities";
import { useSettingsStore } from "@/features/settings/store";
import {
  ALL_GROUP_IDS,
  FLOATING_ELIGIBLE_IDS,
  displayedToolbarEntries,
  isLiveToolbarEntry,
  liveSelectionToolbarIds,
  makeDividerId,
  registeredToolbarButtonIds,
  toolbarSlotAcceptsDivider,
  type ToolbarConfig,
  type ToolbarEntry,
  type ToolbarEntryId,
  type ToolbarSection,
  type ToolbarSlot,
} from "@/features/settings/toolbar-config";
import { useParkSelectionWhileDragging } from "@/hooks/useParkSelectionWhileDragging";
import { useToolbarRegistryRevision } from "@/hooks/useToolbarRegistryRevision";

const DRAG_TYPE = "application/x-maibuk-toolbar-button";
export const DIVIDER_SOURCE_KEY = "divider-source";
const END_SLOT_KEY = "end-slot";
const FIXED_KEY = "fixed";
const HANDLE_GRIP =
  "z-10 flex items-center justify-center max-sm:hidden before:h-9 before:w-1 before:rounded-full before:bg-border before:content-[''] hover:before:bg-primary focus-visible:before:bg-primary";
/** Items whose centers sit this close vertically share a row. */
const ROW_TOLERANCE_PX = 14;

const NOOP_CALLBACKS: ToolbarGroupCallbacks = {
  spellCheckLanguage: "en",
  onSpellCheckLanguageChange: () => {},
  openFindReplace: () => {},
  isFindReplaceOpen: false,
  onToggleFindReplace: () => {},
  openImageDialog: () => {},
  openFootnote: () => {},
  openLinkDialog: () => {},
  openDictionary: () => {},
  openSymbols: () => {},
  openHtmlPanel: () => {},
};

export interface ArrangementLayoutProps {
  editor: Editor;
  announce: (message: string) => void;
}

type CarryAt<Slot> = Slot | "tray";

interface Carry<Slot> {
  id: string;
  at: CarryAt<Slot>;
  snapshot: ToolbarConfig;
  /** A divider pulled from the Divider source that has not reached the toolbar. */
  fresh: boolean;
}

interface SlotRowItem<Slot> {
  rect: DOMRect;
  before: Slot | null;
  after: Slot | null;
}

/** The preview's options grouped into visual rows, top to bottom. */
function rowsOf<Slot>(items: SlotRowItem<Slot>[]): { cy: number; items: SlotRowItem<Slot>[] }[] {
  const rows: { cy: number; items: SlotRowItem<Slot>[] }[] = [];
  for (const item of items) {
    const cy = item.rect.top + item.rect.height / 2;
    let row = rows.find((candidate) => Math.abs(candidate.cy - cy) < ROW_TOLERANCE_PX);
    if (!row) {
      row = { cy, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  return rows.sort((a, b) => a.cy - b.cy);
}

function nearestSlotInRow<Slot>(
  row: { items: SlotRowItem<Slot>[] } | undefined,
  x: number,
  skip: (slot: Slot) => boolean = () => false
): Slot | null {
  let best: { distance: number; slot: Slot } | null = null;
  for (const item of row?.items ?? []) {
    for (const [edge, slot] of [
      [item.rect.left, item.before],
      [item.rect.right, item.after],
    ] as const) {
      if (slot === null || skip(slot)) continue;
      const distance = Math.abs(edge - x);
      if (!best || distance < best.distance) best = { distance, slot };
    }
  }
  return best?.slot ?? null;
}

/**
 * Where Up or Down takes a carried entry drawn at `from`: the nearest slot in
 * the wrapped row above or below, the tray past the last row, or null to stay.
 * A row's last slot is also the next row's first, so the slot the entry holds
 * is skipped; otherwise the arrow would land where it already is and stick.
 */
export function verticalMoveTarget<Slot>(
  items: SlotRowItem<Slot>[],
  from: { x: number; y: number },
  at: CarryAt<Slot>,
  step: 1 | -1,
  sameSlot: (a: Slot, b: Slot) => boolean
): CarryAt<Slot> | null {
  const rows = rowsOf(items);
  if (at === "tray") return step > 0 ? null : nearestSlotInRow(rows[rows.length - 1], from.x);
  const rowIndex = rows.findIndex((row) => Math.abs(row.cy - from.y) < ROW_TOLERANCE_PX);
  const target =
    rowIndex < 0
      ? step > 0
        ? rows.find((row) => row.cy > from.y)
        : undefined
      : rows[rowIndex + step];
  const slot = nearestSlotInRow(target, from.x, (candidate) => sameSlot(candidate, at));
  if (slot !== null) return slot;
  return step > 0 ? "tray" : null;
}

function center(el: Element | null): { x: number; y: number } {
  const rect = el?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
}

function optionByKey(root: HTMLElement | null, key: string): HTMLElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLElement>('[role="option"][data-key]')) {
    if (el.dataset.key === key) return el;
  }
  return null;
}

interface MoveModeAdapter<Slot> {
  /** Every slot the carried entry may take, in reading order. */
  slots: (carriedId: string) => Slot[];
  sameSlot: (a: Slot, b: Slot) => boolean;
  /** The preview's options without the carried one, with the slot on each side. */
  rowItems: (carriedId: string) => SlotRowItem<Slot>[];
  /** Writes the carried entry at `at` to the store, so the preview updates live. */
  place: (carry: Carry<Slot>, at: CarryAt<Slot>) => void;
  describe: (carry: Carry<Slot>, at: CarryAt<Slot>) => string;
  dropMessage: (carry: Carry<Slot>) => string;
  /** Called after the drop is written; returns the key focus lands on. */
  afterDrop: (carry: Carry<Slot>) => string;
  label: (id: string) => string;
  /** The option focus stays on while carrying; the carried entry's own unless it has none there. */
  carriedFocusKey?: (carry: Carry<Slot>) => string;
  /** What Enter on an option picks up, and from where. */
  startFrom: (key: string) => { id: string; at: CarryAt<Slot>; fresh?: boolean } | null;
}

/**
 * The keyboard move mode (#672): Enter picks a button up, arrows move it with
 * the preview updating live, Enter drops, Escape restores the snapshot. It is
 * hand-written because React Aria's keyboard drag moves between drop targets
 * without moving the button; the dialog's arrows are owned only while carrying
 * (`data-owns-arrows`), over the arrow navigation of ADR 0025.
 */
function useMoveMode<Slot>(
  rootRef: RefObject<HTMLDivElement | null>,
  adapter: MoveModeAdapter<Slot>,
  announce: (message: string) => void
) {
  const { t } = useTranslation();
  const [carry, setCarry] = useState<Carry<Slot> | null>(null);
  const restoreToolbarConfig = useSettingsStore((state) => state.restoreToolbarConfig);
  const config = useSettingsStore((state) => state.toolbarConfig);
  const focusKeyRef = useRef<string | null>(null);
  const carriedKey = carry ? (adapter.carriedFocusKey?.(carry) ?? carry.id) : null;

  const moveTo = (next: Carry<Slot>, at: CarryAt<Slot>) => {
    adapter.place(next, at);
    const moved = { ...next, at };
    setCarry(moved);
    announce(adapter.describe(moved, at));
  };

  const pickUp = (id: string, at: CarryAt<Slot>, fresh = false) => {
    const next: Carry<Slot> = {
      id,
      at,
      fresh,
      snapshot: useSettingsStore.getState().toolbarConfig,
    };
    setCarry(next);
    announce(
      t("toolbar.settings.pickedUp", { name: adapter.label(id), where: adapter.describe(next, at) })
    );
  };

  const drop = (current: Carry<Slot>) => {
    const message = adapter.dropMessage(current);
    focusKeyRef.current = adapter.afterDrop(current);
    setCarry(null);
    announce(message);
  };

  const cancel = useCallback(
    (current: Carry<Slot>) => {
      restoreToolbarConfig(current.snapshot);
      focusKeyRef.current = current.fresh ? DIVIDER_SOURCE_KEY : current.id;
      setCarry(null);
      announce(
        current.fresh
          ? t("toolbar.settings.cancelledDivider")
          : t("toolbar.settings.cancelled", { name: adapter.label(current.id) })
      );
    },
    [adapter, announce, restoreToolbarConfig, t]
  );

  const moveHorizontal = (current: Carry<Slot>, step: 1 | -1) => {
    if (current.at === "tray") return;
    const slots = adapter.slots(current.id);
    const here = current.at;
    const index = slots.findIndex((slot) => adapter.sameSlot(slot, here));
    const next = slots[(index < 0 ? 0 : index) + step];
    if (next !== undefined) moveTo(current, next);
  };

  const moveVertical = (current: Carry<Slot>, step: 1 | -1) => {
    const from = center(optionByKey(rootRef.current, current.id));
    const target =
      verticalMoveTarget(adapter.rowItems(current.id), from, current.at, step, adapter.sameSlot) ??
      (current.at === "tray" && step < 0 ? adapter.slots(current.id)[0] : undefined);
    if (target !== undefined) moveTo(current, target);
  };

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    // A key of the author's own ends the wait for focus to settle after a drop.
    if (!carry) focusKeyRef.current = null;
    const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"][data-key]');
    if (!option || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!carry) {
      if (event.key !== "Enter" && event.key !== " ") return;
      // React Aria's own keyboard drag must not take Enter in these previews.
      const start = adapter.startFrom(option.dataset.key ?? "");
      if (!start) return;
      event.preventDefault();
      event.stopPropagation();
      pickUp(start.id, start.at, start.fresh);
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowLeft: () => moveHorizontal(carry, -1),
      ArrowRight: () => moveHorizontal(carry, 1),
      ArrowUp: () => moveVertical(carry, -1),
      ArrowDown: () => moveVertical(carry, 1),
      Enter: () => drop(carry),
      " ": () => drop(carry),
      Escape: () => cancel(carry),
    };
    if (keys[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      keys[event.key]();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  };

  // Focus follows the carried button as it moves between the preview and the
  // tray, and lands where a drop or cancel left it. A passive effect, so it
  // runs after React Aria hands focus to a list whose focused item just left.
  useEffect(() => {
    const key = carriedKey ?? focusKeyRef.current;
    if (key === null) return;
    const target = optionByKey(rootRef.current, key);
    if (target && document.activeElement !== target) target.focus();
    if (carry) return;
    // React Aria's follow-up focus lands within this task; after it, focus is the author's again.
    const settle = setTimeout(() => {
      focusKeyRef.current = null;
    }, 0);
    return () => clearTimeout(settle);
  }, [carry, carriedKey, config, rootRef]);

  // When the carried button leaves a list, React Aria focuses that list's
  // neighbouring item a render later; focus goes back to the button.
  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const key = carriedKey ?? focusKeyRef.current;
    if (key === null) return;
    const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"][data-key]');
    if (!option || option.dataset.key === key) return;
    const target = optionByKey(rootRef.current, key);
    if (target) queueMicrotask(() => target.focus());
  };

  // Focus leaving the layout while carrying cancels the move.
  const onBlurCapture = () => {
    if (!carry) return;
    setTimeout(() => {
      const root = rootRef.current;
      if (root && !root.contains(document.activeElement)) cancel(carry);
    }, 0);
  };

  // React Aria's press handling completes a press on keyup, which would start
  // its own keyboard drag; the move mode owns Enter and Space on these options.
  const onKeyUpCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!(event.target as HTMLElement).closest('[role="option"][data-key]')) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    carry,
    rootProps: {
      onKeyDownCapture,
      onKeyUpCapture,
      onFocusCapture,
      onBlurCapture,
      "data-owns-arrows": carry ? "" : undefined,
    },
  };
}

/** The text a drag carries: which button, and whether it left the preview or the tray. */
function dragItems(
  keys: Iterable<unknown>,
  from: "preview" | "tray",
  label: (id: string) => string
) {
  return [...keys].map((key) => ({
    [DRAG_TYPE]: JSON.stringify({ id: String(key), from }),
    "text/plain": label(String(key)),
  }));
}

async function readDrag(items: readonly unknown[]): Promise<{ id: string; from: string } | null> {
  const item = items[0] as TextDropItem | undefined;
  if (!item || item.kind !== "text" || !item.types.has(DRAG_TYPE)) return null;
  return JSON.parse(await item.getText(DRAG_TYPE));
}

const itemClass =
  (carried: boolean, extra = "") =>
  ({ isFocusVisible, isDragging }: ListBoxItemRenderProps) =>
    `relative inline-flex shrink-0 items-center rounded-lg outline-none select-none cursor-grab transition-[box-shadow,transform] motion-reduce:transition-none ${extra} ${
      carried
        ? "z-10 -translate-y-0.5 cursor-grabbing bg-primary/20 shadow-lg ring-2 ring-primary"
        : `hover:bg-primary/10 ${isFocusVisible ? "ring-2 ring-primary" : ""}`
    } ${isDragging ? "opacity-40" : ""}`;

/**
 * The real controls of each Toolbar Button, rendered once outside the
 * previews' lists. React Aria controls (the font Selects, the color pickers)
 * nested inside a list item rebuild that list's collection without end, so
 * each item shows a copy of this markup instead; it is inert either way.
 */
function useControlMarkup(ids: string[]) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const [markup, setMarkup] = useState<Record<string, string>>({});
  const idsKey = ids.join("|");
  useLayoutEffect(() => {
    const next: Record<string, string> = {};
    for (const el of sourceRef.current?.querySelectorAll<HTMLElement>("[data-markup-for]") ?? []) {
      next[el.dataset.markupFor ?? ""] = el.innerHTML;
    }
    setMarkup((previous) =>
      Object.keys(next).length === Object.keys(previous).length &&
      Object.entries(next).every(([id, html]) => previous[id] === html)
        ? previous
        : next
    );
  }, [idsKey]);
  return { sourceRef, markup };
}

function ControlMarkupSource({
  sourceRef,
  ids,
  render,
}: {
  sourceRef: RefObject<HTMLDivElement | null>;
  ids: string[];
  render: (id: string) => ReactNode;
}) {
  return (
    <div ref={sourceRef} hidden inert aria-hidden="true">
      {ids.map((id) => (
        <span key={id} data-markup-for={id}>
          {render(id)}
        </span>
      ))}
    </div>
  );
}

function InertControls({ html }: { html: string | undefined }) {
  return (
    <span
      inert
      className="contents pointer-events-none"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markup React rendered from the app's own toolbar components, copied so no React Aria control nests in a list item.
      dangerouslySetInnerHTML={{ __html: html ?? "" }}
    />
  );
}

function dropIndicator(target: DropTarget) {
  return (
    <DropIndicator
      target={target}
      className={({ isDropTarget }) =>
        isDropTarget ? "w-0.5 -mx-px self-stretch rounded-full bg-primary" : "hidden"
      }
    />
  );
}

function TrayHeading({ id, title, note }: { id: string; title: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3
        id={id}
        className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      >
        {title}
      </h3>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

/** The layouts' hint, with each key drawn as a chip. */
function KeyboardHint({
  i18nKey,
}: {
  i18nKey: "toolbar.settings.toolbarHint" | "toolbar.settings.selectionHint";
}) {
  const { t } = useTranslation();
  return (
    <p className="text-[13px] leading-normal text-muted-foreground">
      <Trans
        t={t}
        i18nKey={i18nKey}
        components={{
          kbd: (
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none" />
          ),
        }}
      />
    </p>
  );
}

const trayClass = (hot: boolean) =>
  `flex min-h-[58px] flex-wrap items-center gap-1.5 rounded-xl border-[1.5px] border-dashed p-2 outline-none transition-colors data-[drop-target]:border-primary data-[drop-target]:bg-primary/10 has-[[data-drop-target]]:border-primary has-[[data-drop-target]]:bg-primary/10 ${
    hot ? "border-primary bg-primary/10" : "border-border bg-muted/20"
  }`;

function SkeletonBar({ className = "", width }: { className?: string; width: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block h-2 shrink-0 rounded-full bg-foreground/10 ${className}`}
      style={{ width }}
    />
  );
}

function SkeletonHeader() {
  return (
    <div
      aria-hidden="true"
      className="flex h-9 shrink-0 items-center gap-2.5 border-b border-border px-3.5"
    >
      <span className="h-4 w-4 rounded-[5px] bg-foreground/10" />
      <SkeletonBar width="72px" />
      <span className="flex-1" />
      <span className="h-4 w-4 rounded-[5px] bg-foreground/10" />
      <SkeletonBar width="54px" />
    </div>
  );
}

const BODY_LINES = ["100%", "96%", "99%", "62%", "", "98%", "100%", "93%", "40%"];

function SkeletonBody() {
  return (
    <div aria-hidden="true" className="h-[150px] overflow-hidden px-6 py-7 sm:h-[190px]">
      <div className="mx-auto flex max-w-[560px] flex-col gap-3">
        <SkeletonBar className="mb-2 h-4 bg-foreground/15" width="46%" />
        {BODY_LINES.map((width, index) =>
          width ? <SkeletonBar key={index} width={width} /> : <span key={index} className="h-2" />
        )}
      </div>
    </div>
  );
}

/** Hidden Toolbar Buttons in default order: core groups, then Plugin buttons as they registered. */
function hiddenButtons(config: ToolbarConfig): ToolbarEntryId[] {
  const hidden = new Set(
    [...config.start, ...config.end]
      .filter(
        (entry) => entry.kind === "group" && !entry.toolbarVisible && isLiveToolbarEntry(entry.id)
      )
      .map((entry) => entry.id)
  );
  return [...ALL_GROUP_IDS, ...registeredToolbarButtonIds()].filter((id) => hidden.has(id));
}

function sectionOf(config: ToolbarConfig, id: string): ToolbarSection | null {
  if (config.start.some((entry) => entry.id === id)) return "start";
  if (config.end.some((entry) => entry.id === id)) return "end";
  return null;
}

function shownWithout(config: ToolbarConfig, section: ToolbarSection, id: string | null) {
  return displayedToolbarEntries(config[section].filter((entry) => entry.id !== id));
}

/** The slot an entry holds now, counted among the shown entries without it. */
function slotOf(config: ToolbarConfig, id: string): ToolbarSlot | null {
  const section = sectionOf(config, id);
  if (!section) return null;
  const lane = config[section];
  const at = lane.findIndex((entry) => entry.id === id);
  const index = shownWithout(config, section, id).filter(
    (entry) => lane.indexOf(entry) < at
  ).length;
  return { section, index };
}

/**
 * The slot a pointer drop target stands for in the Editor Toolbar preview, with
 * the dragged entry left out of the count, or null where nothing may land.
 */
export function previewSlotOfDropTarget(
  config: ToolbarConfig,
  target: DropTarget,
  draggedId: string
): ToolbarSlot | null {
  if (target.type === "root") return { section: "start", index: 0 };
  if (target.dropPosition === "on") return null;
  const key = String(target.key);
  if (key === END_SLOT_KEY) return { section: "end", index: 0 };
  if (key === FIXED_KEY) {
    return target.dropPosition === "before"
      ? { section: "end", index: shownWithout(config, "end", draggedId).length }
      : null;
  }
  if (key === draggedId) return slotOf(config, key);
  const section = sectionOf(config, key);
  if (!section) return null;
  const index = shownWithout(config, section, draggedId).findIndex((entry) => entry.id === key);
  if (index < 0) return null;
  return { section, index: target.dropPosition === "after" ? index + 1 : index };
}

/** Whether the dragged entry may land at a slot: a divider never beside another, or at a lane's end. */
export function previewAcceptsDrop(
  config: ToolbarConfig,
  slot: ToolbarSlot | null,
  draggedId: string
): boolean {
  if (!slot) return false;
  const isDivider =
    draggedId === DIVIDER_SOURCE_KEY ||
    [...config.start, ...config.end].some(
      (entry) => entry.id === draggedId && entry.kind === "divider"
    );
  if (!isDivider) return true;
  return toolbarSlotAcceptsDivider(shownWithout(config, slot.section, draggedId), slot.index);
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * The Toolbar layout: the real Editor Toolbar, inert and always expanded, in a
 * card that sketches the app, with the hidden buttons and the Divider source
 * in a tray below it.
 */
export function ToolbarArrangementLayout({ editor, announce }: ArrangementLayoutProps) {
  const { t } = useTranslation();
  useToolbarRegistryRevision();
  const config = useSettingsStore((state) => state.toolbarConfig);
  const placeToolbarEntry = useSettingsStore((state) => state.placeToolbarEntry);
  const hideToolbarEntry = useSettingsStore((state) => state.hideToolbarEntry);
  const mergeToolbarDividers = useSettingsStore((state) => state.mergeToolbarDividers);
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);
  const [isPointerDragging, setIsPointerDragging] = useState(false);
  const cardWidth = useWidth(cardRef);
  const [sidebarWidth, setSidebarWidth] = useState(18);
  const [appWidth, setAppWidth] = useState<number | null>(null);

  const label = useCallback(
    (id: string) =>
      id === DIVIDER_SOURCE_KEY || id.startsWith("divider-")
        ? t("toolbar.settings.dividerLabel")
        : toolbarButtonPresentation(id, t).label,
    [t]
  );
  const entryOf = (id: string): ToolbarEntry => {
    const found = [...config.start, ...config.end].find((entry) => entry.id === id);
    return found ?? { kind: "divider", id };
  };
  const isDividerId = (id: string) => entryOf(id).kind === "divider";

  const adapter: MoveModeAdapter<ToolbarSlot> = {
    label,
    slots: (carriedId) => {
      const current = useSettingsStore.getState().toolbarConfig;
      const divider = isDividerId(carriedId);
      return (["start", "end"] as const).flatMap((section) => {
        const shown = shownWithout(current, section, carriedId);
        return Array.from({ length: shown.length + 1 }, (_, index) => ({ section, index })).filter(
          (slot) => !divider || toolbarSlotAcceptsDivider(shown, slot.index)
        );
      });
    },
    sameSlot: (a, b) => a.section === b.section && a.index === b.index,
    rowItems: (carriedId) => {
      const current = useSettingsStore.getState().toolbarConfig;
      const divider = isDividerId(carriedId);
      const accepts = (slot: ToolbarSlot) =>
        !divider ||
        toolbarSlotAcceptsDivider(shownWithout(current, slot.section, carriedId), slot.index);
      const options = [
        ...(previewRef.current?.querySelectorAll<HTMLElement>('[role="option"][data-key]') ?? []),
      ];
      return options.flatMap((el) => {
        const key = el.dataset.key ?? "";
        if (key === carriedId || key === FIXED_KEY) return [];
        if (key === END_SLOT_KEY) {
          const slot = { section: "end" as const, index: 0 };
          const open = accepts(slot) ? slot : null;
          return [{ rect: el.getBoundingClientRect(), before: open, after: open }];
        }
        const section = sectionOf(current, key);
        if (!section) return [];
        const index = shownWithout(current, section, carriedId).findIndex(
          (entry) => entry.id === key
        );
        const before = { section, index };
        const after = { section, index: index + 1 };
        return [
          {
            rect: el.getBoundingClientRect(),
            before: accepts(before) ? before : null,
            after: accepts(after) ? after : null,
          },
        ];
      });
    },
    place: (carry, at) => {
      if (at === "tray") hideToolbarEntry(carry.id);
      else placeToolbarEntry(entryOf(carry.id), at);
    },
    describe: (carry, at) => {
      if (at === "tray") {
        return isDividerId(carry.id)
          ? t("toolbar.settings.whereDividerOut")
          : t("toolbar.settings.whereHidden");
      }
      const current = useSettingsStore.getState().toolbarConfig;
      return t("toolbar.settings.moved", {
        section: t(`toolbar.settings.${at.section}`),
        position: at.index + 1,
        total: shownWithout(current, at.section, carry.id).length + 1,
      });
    },
    dropMessage: (carry) => {
      if (carry.at !== "tray") {
        return t("toolbar.settings.dropped", {
          name: label(carry.id),
          where: adapter.describe(carry, carry.at),
        });
      }
      if (!isDividerId(carry.id)) return t("toolbar.settings.hidden", { name: label(carry.id) });
      return carry.fresh
        ? t("toolbar.settings.dividerNotAdded")
        : t("toolbar.settings.dividerRemoved");
    },
    startFrom: (key) => {
      if (key === FIXED_KEY || key === END_SLOT_KEY) return null;
      if (key === DIVIDER_SOURCE_KEY) return { id: makeDividerId(), at: "tray", fresh: true };
      const current = useSettingsStore.getState().toolbarConfig;
      const slot = isShownInPreview(current, key) ? slotOf(current, key) : null;
      return { id: key, at: slot ?? "tray" };
    },
    afterDrop: (carry) => {
      mergeToolbarDividers();
      const stillShown = sectionOf(useSettingsStore.getState().toolbarConfig, carry.id) !== null;
      return isDividerId(carry.id) && !stillShown ? DIVIDER_SOURCE_KEY : carry.id;
    },
    // A divider in the tray has no option of its own; the Divider source stands in for it.
    carriedFocusKey: (carry) =>
      carry.at === "tray" && isDividerId(carry.id) ? DIVIDER_SOURCE_KEY : carry.id,
  };

  const { carry, rootProps } = useMoveMode(rootRef, adapter, announce);
  const moving = carry !== null || isPointerDragging;

  const dragHandlers = useParkSelectionWhileDragging<
    Parameters<NonNullable<DragAndDropOptions["onDragStart"]>>[0],
    Parameters<NonNullable<DragAndDropOptions["onDragEnd"]>>[0]
  >({
    onDragStart: (event) => {
      draggingRef.current = String([...event.keys][0] ?? "");
      setIsPointerDragging(true);
    },
    onDragEnd: () => {
      draggingRef.current = null;
      setIsPointerDragging(false);
    },
  });

  const dropInPreview = async (items: readonly unknown[], target: DropTarget) => {
    const data = await readDrag(items);
    if (!data) return;
    const current = useSettingsStore.getState().toolbarConfig;
    const slot = previewSlotOfDropTarget(current, target, data.id);
    if (!slot || !previewAcceptsDrop(current, slot, data.id)) return;
    const id = data.id === DIVIDER_SOURCE_KEY ? makeDividerId() : data.id;
    placeToolbarEntry(entryOf(id), slot);
    mergeToolbarDividers();
    announce(
      t("toolbar.settings.dropped", {
        name: label(id),
        where: adapter.describe({ id, at: slot, snapshot: current, fresh: false }, slot),
      })
    );
  };

  const hideDropped = async (items: readonly unknown[]) => {
    const data = await readDrag(items);
    if (!data || data.from !== "preview") return;
    const divider = isDividerId(data.id);
    hideToolbarEntry(data.id);
    mergeToolbarDividers();
    announce(
      divider
        ? t("toolbar.settings.dividerRemoved")
        : t("toolbar.settings.hidden", { name: label(data.id) })
    );
  };

  const { dragAndDropHooks: previewDnd } = useDragAndDrop({
    getItems: (keys) => dragItems(keys, "preview", label),
    ...dragHandlers,
    acceptedDragTypes: [DRAG_TYPE],
    renderDropIndicator: dropIndicator,
    getDropOperation: (target) => {
      const dragged = draggingRef.current;
      if (dragged === null) return "move";
      const current = useSettingsStore.getState().toolbarConfig;
      return previewAcceptsDrop(current, previewSlotOfDropTarget(current, target, dragged), dragged)
        ? "move"
        : "cancel";
    },
    onReorder: (event) =>
      dropInPreview(dragItems(event.keys, "preview", label).map(asTextItem), event.target),
    onInsert: (event) => dropInPreview(event.items, event.target),
    onRootDrop: (event) => dropInPreview(event.items, { type: "root" }),
  });

  const { dragAndDropHooks: trayDnd } = useDragAndDrop({
    getItems: (keys) => dragItems(keys, "tray", label),
    ...dragHandlers,
    acceptedDragTypes: [DRAG_TYPE],
    getDropOperation: () =>
      draggingRef.current &&
      sectionOf(config, draggingRef.current) &&
      isShownInPreview(config, draggingRef.current)
        ? "move"
        : "cancel",
    onInsert: (event) => hideDropped(event.items),
    onRootDrop: (event) => hideDropped(event.items),
  });

  // Anywhere outside the toolbar hides what was dragged out of it.
  const { dropProps } = useDrop({
    ref: rootRef,
    getDropOperationForPoint: (types, _allowed, x, y) => {
      if (!types.has(DRAG_TYPE)) return "cancel";
      const preview = previewRef.current?.getBoundingClientRect();
      if (
        preview &&
        x >= preview.left &&
        x <= preview.right &&
        y >= preview.top &&
        y <= preview.bottom
      ) {
        return "cancel";
      }
      return draggingRef.current && isShownInPreview(config, draggingRef.current)
        ? "move"
        : "cancel";
    },
    onDrop: (event) => hideDropped(event.items),
  });

  const shownStart = displayedToolbarEntries(config.start);
  const shownEnd = displayedToolbarEntries(config.end);
  const previewItems: { id: string; entry?: ToolbarEntry }[] = [
    ...shownStart.map((entry) => ({ id: entry.id, entry })),
    ...(shownEnd.length === 0 ? [{ id: END_SLOT_KEY }] : []),
    ...shownEnd.map((entry) => ({ id: entry.id, entry })),
    { id: FIXED_KEY },
  ];
  const firstEndKey = shownEnd[0]?.id ?? END_SLOT_KEY;

  const trayDivider = carry?.at === "tray" && isDividerId(carry.id) ? [carry.id] : [];
  const hidden = hiddenButtons(config);
  const trayItems = [DIVIDER_SOURCE_KEY, ...trayDivider, ...hidden];
  const markupIds = [
    ...[...config.start, ...config.end]
      .filter((entry) => entry.kind === "group" && isLiveToolbarEntry(entry.id))
      .map((entry) => entry.id),
    FIXED_KEY,
  ];
  const { sourceRef, markup } = useControlMarkup(markupIds);
  const trayHot = carry?.at === "tray";

  const maxApp = Math.max(0, cardWidth - 28);
  const minApp = Math.min(maxApp, 420);
  const shownAppWidth = appWidth === null ? maxApp : Math.max(minApp, Math.min(maxApp, appWidth));
  const shownSidebar = Math.max(0, Math.min(sidebarWidth, Math.max(0, shownAppWidth - 360), 280));

  return (
    <div ref={rootRef} {...dropProps} {...rootProps} className="flex flex-col gap-3.5">
      <KeyboardHint i18nKey="toolbar.settings.toolbarHint" />
      <ControlMarkupSource
        sourceRef={sourceRef}
        ids={markupIds}
        render={(id) =>
          id === FIXED_KEY ? (
            <>
              <ToolbarUtilityCluster onShortcutsHelp={() => {}} onToolbarSettings={() => {}} />
              <ToolbarFixedUtilities isExpanded onToggleExpanded={() => {}} />
            </>
          ) : (
            <EditorToolbarGroups
              editor={editor}
              groupIds={[id as ToolbarEntryId]}
              callbacks={NOOP_CALLBACKS}
            />
          )
        }
      />
      <div
        ref={cardRef}
        className="relative overflow-hidden rounded-[14px] border border-border bg-foreground/5 pt-3.5"
      >
        <div
          className="relative flex min-h-[300px] overflow-hidden rounded-tr-[10px] border border-b-0 border-l-0 border-border bg-background max-sm:w-full! max-sm:border-r-0"
          style={{ width: cardWidth ? shownAppWidth : "calc(100% - 28px)" }}
        >
          <div
            className="relative shrink-0 border-r border-border bg-card max-sm:hidden"
            style={{ width: shownSidebar }}
          >
            <div aria-hidden="true" className="flex flex-col gap-2.5 overflow-hidden px-2.5 py-3">
              <SkeletonBar className="h-2.5 bg-foreground/15" width="70%" />
              <SkeletonBar width="88%" />
              <SkeletonBar width="64%" />
              <SkeletonBar width="76%" />
            </div>
            <ResizeHandle
              side="right"
              value={shownSidebar}
              min={0}
              max={280}
              onResize={setSidebarWidth}
              label={t("toolbar.settings.sidebarWidth")}
              className={HANDLE_GRIP}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <SkeletonHeader />
            <div className="border-b border-border bg-background">
              <ListBox
                ref={previewRef}
                aria-label={t("toolbar.settings.toolbarPreview")}
                layout="grid"
                orientation="horizontal"
                items={previewItems}
                disabledKeys={[END_SLOT_KEY, FIXED_KEY]}
                dragAndDropHooks={previewDnd}
                className="flex flex-wrap items-center justify-start gap-1 px-2 py-1 outline-none sm:px-4 sm:py-2"
              >
                {(item) => {
                  const endStart = item.id === firstEndKey ? "ml-auto" : "";
                  if (item.id === FIXED_KEY) {
                    return (
                      <ListBoxItem
                        id={FIXED_KEY}
                        textValue={t("toolbar.settings.fixedButtons")}
                        aria-label={t("toolbar.settings.fixedButtons")}
                        className={`flex shrink-0 items-center gap-0.5 transition-opacity sm:gap-1 ${endStart} ${moving ? "opacity-40" : ""}`}
                      >
                        <InertControls html={markup[FIXED_KEY]} />
                      </ListBoxItem>
                    );
                  }
                  if (item.id === END_SLOT_KEY) {
                    return (
                      <ListBoxItem
                        id={END_SLOT_KEY}
                        textValue={t("toolbar.settings.end")}
                        aria-label={t("toolbar.settings.end")}
                        // Mounted always, so the collection does not change under
                        // a carried button; shown only while something moves.
                        className={`inline-flex h-[30px] items-center justify-center rounded-lg border-dashed text-[11px] font-medium uppercase tracking-[0.04em] ${endStart} ${
                          !moving
                            ? "invisible w-0 overflow-hidden border-0 px-0"
                            : carry && carry.at !== "tray" && carry.at.section === "end"
                              ? "border-[1.5px] border-primary bg-primary/10 px-2.5 text-primary"
                              : "border-[1.5px] border-border px-2.5 text-muted-foreground"
                        }`}
                      >
                        {t("toolbar.settings.end")}
                      </ListBoxItem>
                    );
                  }
                  const carried = carry?.id === item.id;
                  if (item.entry?.kind === "divider") {
                    return (
                      <ListBoxItem
                        id={item.id}
                        textValue={t("toolbar.settings.dividerLabel")}
                        aria-label={t("toolbar.settings.dividerLabel")}
                        className={itemClass(
                          carried,
                          `self-stretch justify-center px-[3px] ${endStart}`
                        )}
                      >
                        <Divider />
                      </ListBoxItem>
                    );
                  }
                  return (
                    <ListBoxItem
                      id={item.id}
                      textValue={label(item.id)}
                      aria-label={label(item.id)}
                      className={itemClass(carried, endStart)}
                    >
                      <InertControls html={markup[item.id]} />
                    </ListBoxItem>
                  );
                }}
              </ListBox>
            </div>
            <SkeletonBody />
          </div>
          <ResizeHandle
            side="right"
            value={shownAppWidth}
            min={minApp}
            max={maxApp}
            onResize={setAppWidth}
            label={t("toolbar.settings.windowWidth")}
            className={HANDLE_GRIP}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <TrayHeading
          id="toolbar-tray-title"
          title={t("toolbar.settings.trayHidden")}
          note={
            trayHot
              ? isDividerId(carry.id)
                ? t("toolbar.settings.dropToRemoveDivider")
                : t("toolbar.settings.dropToHide", { name: label(carry.id) })
              : t("toolbar.settings.hiddenCount", { count: hidden.length })
          }
        />
        {/* The tray's frame holds the list and, when nothing is hidden, the note beside it. */}
        <div className={trayClass(trayHot)}>
          <ListBox
            aria-labelledby="toolbar-tray-title"
            layout="grid"
            orientation="horizontal"
            items={trayItems.map((id) => ({ id }))}
            dragAndDropHooks={trayDnd}
            className="flex flex-wrap items-center gap-1.5 outline-none"
            renderEmptyState={() => null}
          >
            {({ id }) => {
              const carried = carry?.id === id;
              if (id === DIVIDER_SOURCE_KEY || isDividerId(id)) {
                const source = id === DIVIDER_SOURCE_KEY;
                return (
                  <ListBoxItem
                    id={id}
                    textValue={
                      source
                        ? t("toolbar.settings.dividerSource")
                        : t("toolbar.settings.dividerLabel")
                    }
                    aria-label={
                      source
                        ? t("toolbar.settings.dividerSource")
                        : t("toolbar.settings.dividerLabel")
                    }
                    className={itemClass(carried, "bg-background ring-1 ring-border")}
                  >
                    <span className="inline-flex h-[34px] items-center gap-2 px-2.5 text-xs font-medium text-muted-foreground">
                      <span aria-hidden="true" className="h-5 w-px bg-foreground/45" />
                      {t("toolbar.settings.dividerLabel")}
                      <span className="text-[11px] opacity-70">
                        {source
                          ? t("toolbar.settings.dividerSourceHint")
                          : t("toolbar.settings.remove")}
                      </span>
                    </span>
                  </ListBoxItem>
                );
              }
              return (
                <ListBoxItem
                  id={id}
                  textValue={label(id)}
                  aria-label={label(id)}
                  className={itemClass(carried, "bg-background px-0.5 ring-1 ring-border")}
                >
                  <InertControls html={markup[id]} />
                </ListBoxItem>
              );
            }}
          </ListBox>
          {hidden.length === 0 && !trayHot && (
            <p className="px-1.5 text-xs text-muted-foreground">
              {t("toolbar.settings.trayEmpty")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function isShownInPreview(config: ToolbarConfig, id: string): boolean {
  return [...config.start, ...config.end].some(
    (entry) => entry.id === id && (entry.kind === "divider" || entry.toolbarVisible)
  );
}

function asTextItem(data: Record<string, string>): TextDropItem {
  return {
    kind: "text",
    types: new Set(Object.keys(data)),
    getText: async (type: string) => data[type],
  };
}

const SELECTION_TOOLBAR_ELIGIBLE = (config: ToolbarConfig): ToolbarEntryId[] => [
  ...ALL_GROUP_IDS.filter((id) => FLOATING_ELIGIBLE_IDS.has(id)),
  ...registeredToolbarButtonIds().filter((id) =>
    [...config.start, ...config.end].some((entry) => entry.id === id)
  ),
];

/**
 * The Selection layout: localized selected text with the real Selection
 * Toolbar above it, and a tray of the buttons it may hold but does not.
 */
export function SelectionArrangementLayout({ editor, announce }: ArrangementLayoutProps) {
  const { t } = useTranslation();
  useToolbarRegistryRevision();
  const config = useSettingsStore((state) => state.toolbarConfig);
  const placeSelectionToolbarEntry = useSettingsStore((state) => state.placeSelectionToolbarEntry);
  const removeSelectionToolbarEntry = useSettingsStore(
    (state) => state.removeSelectionToolbarEntry
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);
  const label = useCallback((id: string) => toolbarButtonPresentation(id, t).label, [t]);

  const shownWithoutId = (id: string | null) =>
    liveSelectionToolbarIds(useSettingsStore.getState().toolbarConfig).filter(
      (other) => other !== id
    );

  const adapter: MoveModeAdapter<number> = {
    label,
    slots: (carriedId) => Array.from({ length: shownWithoutId(carriedId).length + 1 }, (_, i) => i),
    sameSlot: (a, b) => a === b,
    rowItems: (carriedId) => {
      const shown = shownWithoutId(carriedId);
      return [
        ...(previewRef.current?.querySelectorAll<HTMLElement>('[role="option"][data-key]') ?? []),
      ].flatMap((el) => {
        const index = shown.indexOf(el.dataset.key as ToolbarEntryId);
        return index < 0
          ? []
          : [{ rect: el.getBoundingClientRect(), before: index, after: index + 1 }];
      });
    },
    place: (carry, at) => {
      if (at === "tray") removeSelectionToolbarEntry(carry.id as ToolbarEntryId);
      else placeSelectionToolbarEntry(carry.id as ToolbarEntryId, at);
    },
    describe: (carry, at) =>
      at === "tray"
        ? t("toolbar.settings.whereOutOfSelection")
        : t("toolbar.settings.whereSelection", {
            position: at + 1,
            total: shownWithoutId(carry.id).length + 1,
          }),
    dropMessage: (carry) =>
      carry.at === "tray"
        ? t("toolbar.settings.takenOut", { name: label(carry.id) })
        : t("toolbar.settings.dropped", {
            name: label(carry.id),
            where: adapter.describe(carry, carry.at),
          }),
    afterDrop: (carry) => carry.id,
    startFrom: (key) => {
      const index = liveSelectionToolbarIds(useSettingsStore.getState().toolbarConfig).indexOf(
        key as ToolbarEntryId
      );
      return { id: key, at: index < 0 ? "tray" : index };
    },
  };

  const { carry, rootProps } = useMoveMode(rootRef, adapter, announce);

  const shown = liveSelectionToolbarIds(config);
  const tray = SELECTION_TOOLBAR_ELIGIBLE(config).filter(
    (id) => isLiveToolbarEntry(id) && !config.selectionToolbar.includes(id)
  );
  const markupIds = SELECTION_TOOLBAR_ELIGIBLE(config).filter((id) => isLiveToolbarEntry(id));
  const { sourceRef, markup } = useControlMarkup(markupIds);
  const trayHot = carry?.at === "tray";

  const dragHandlers = useParkSelectionWhileDragging<
    Parameters<NonNullable<DragAndDropOptions["onDragStart"]>>[0],
    Parameters<NonNullable<DragAndDropOptions["onDragEnd"]>>[0]
  >({
    onDragStart: (event) => {
      draggingRef.current = String([...event.keys][0] ?? "");
    },
    onDragEnd: () => {
      draggingRef.current = null;
    },
  });

  const dropInBubble = async (items: readonly unknown[], target: DropTarget) => {
    const data = await readDrag(items);
    if (!data) return;
    const others = shownWithoutId(data.id);
    let index = 0;
    if (target.type === "item") {
      if (String(target.key) === data.id) return;
      index = others.indexOf(String(target.key) as ToolbarEntryId);
      if (index < 0) return;
      if (target.dropPosition === "after") index += 1;
    }
    placeSelectionToolbarEntry(data.id as ToolbarEntryId, index);
    announce(
      t("toolbar.settings.dropped", {
        name: label(data.id),
        where: t("toolbar.settings.whereSelection", {
          position: index + 1,
          total: others.length + 1,
        }),
      })
    );
  };

  const takeOut = async (items: readonly unknown[]) => {
    const data = await readDrag(items);
    if (!data || data.from !== "preview") return;
    removeSelectionToolbarEntry(data.id as ToolbarEntryId);
    announce(t("toolbar.settings.takenOut", { name: label(data.id) }));
  };

  const { dragAndDropHooks: bubbleDnd } = useDragAndDrop({
    getItems: (keys) => dragItems(keys, "preview", label),
    ...dragHandlers,
    acceptedDragTypes: [DRAG_TYPE],
    renderDropIndicator: dropIndicator,
    getDropOperation: (target) =>
      target.type === "item" && target.dropPosition === "on" ? "cancel" : "move",
    onReorder: (event) =>
      dropInBubble(dragItems(event.keys, "preview", label).map(asTextItem), event.target),
    onInsert: (event) => dropInBubble(event.items, event.target),
    onRootDrop: (event) => dropInBubble(event.items, { type: "root" }),
  });

  const { dragAndDropHooks: trayDnd } = useDragAndDrop({
    getItems: (keys) => dragItems(keys, "tray", label),
    ...dragHandlers,
    acceptedDragTypes: [DRAG_TYPE],
    getDropOperation: () =>
      draggingRef.current && config.selectionToolbar.includes(draggingRef.current as ToolbarEntryId)
        ? "move"
        : "cancel",
    onInsert: (event) => takeOut(event.items),
    onRootDrop: (event) => takeOut(event.items),
  });

  const { dropProps } = useDrop({
    ref: rootRef,
    getDropOperationForPoint: (types, _allowed, x, y) => {
      if (!types.has(DRAG_TYPE)) return "cancel";
      const bubble = previewRef.current?.getBoundingClientRect();
      if (
        bubble &&
        x >= bubble.left &&
        x <= bubble.right &&
        y >= bubble.top &&
        y <= bubble.bottom
      ) {
        return "cancel";
      }
      return draggingRef.current &&
        config.selectionToolbar.includes(draggingRef.current as ToolbarEntryId)
        ? "move"
        : "cancel";
    },
    onDrop: (event) => takeOut(event.items),
  });

  const renderButton = (id: string, extra: string) => (
    <ListBoxItem
      id={id}
      textValue={label(id)}
      aria-label={label(id)}
      className={itemClass(carry?.id === id, extra)}
    >
      <InertControls html={markup[id]} />
    </ListBoxItem>
  );

  return (
    <div ref={rootRef} {...dropProps} {...rootProps} className="flex flex-col gap-3.5">
      <KeyboardHint i18nKey="toolbar.settings.selectionHint" />
      <ControlMarkupSource
        sourceRef={sourceRef}
        ids={markupIds}
        render={(id) => (
          <EditorToolbarGroups
            editor={editor}
            groupIds={[id as ToolbarEntryId]}
            iconSize="sm"
            callbacks={NOOP_CALLBACKS}
          />
        )}
      />
      <div className="relative overflow-hidden rounded-[14px] border border-border bg-foreground/5 pt-3.5">
        <div className="relative w-[calc(100%-28px)] overflow-hidden rounded-tr-[10px] border border-b-0 border-l-0 border-border bg-background max-sm:w-full max-sm:border-r-0">
          <SkeletonHeader />
          <div className="px-6 pt-12 pb-8">
            <div className="mx-auto flex max-w-[560px] flex-col gap-3">
              <SkeletonBar className="mb-2 h-4 bg-foreground/15" width="46%" />
              <SkeletonBar width="100%" />
              <SkeletonBar width="94%" />
              <span className="h-14" />
              {/* The selected text sits mid-row, so the bubble centred over the row is
                  centred over it too, and wraps rather than leave a narrow preview. */}
              <div className="relative flex items-center gap-2">
                <SkeletonBar className="flex-1" width="auto" />
                <span className="whitespace-nowrap rounded-sm bg-primary/30 px-0.5 font-serif text-[17px] leading-relaxed">
                  {t("toolbar.settings.selectedText")}
                  <span className="absolute inset-x-0 bottom-[calc(100%+10px)] flex justify-center">
                    <ListBox
                      ref={previewRef}
                      aria-label={t("toolbar.settings.selectionPreview")}
                      layout="grid"
                      orientation="horizontal"
                      items={shown.map((id) => ({ id }))}
                      dragAndDropHooks={bubbleDnd}
                      renderEmptyState={() => (
                        <span className="block whitespace-nowrap px-1.5 py-1 font-sans text-xs text-muted-foreground">
                          {t("toolbar.settings.selectionEmpty")}
                        </span>
                      )}
                      className="flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-1.5 py-1 font-sans text-base shadow-lg outline-none"
                    >
                      {({ id }) => renderButton(id, "")}
                    </ListBox>
                  </span>
                </span>
                <SkeletonBar className="flex-1" width="auto" />
              </div>
              <SkeletonBar width="97%" />
              <SkeletonBar width="66%" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <TrayHeading
          id="selection-tray-title"
          title={t("toolbar.settings.traySelection")}
          note={
            trayHot
              ? t("toolbar.settings.dropToTakeOut", { name: label(carry.id) })
              : t("toolbar.settings.availableCount", { count: tray.length })
          }
        />
        <ListBox
          aria-labelledby="selection-tray-title"
          layout="grid"
          orientation="horizontal"
          items={tray.map((id) => ({ id }))}
          dragAndDropHooks={trayDnd}
          className={trayClass(trayHot)}
          renderEmptyState={() => (
            <span className="px-1.5 text-xs text-muted-foreground">
              {t("toolbar.settings.traySelectionEmpty")}
            </span>
          )}
        >
          {({ id }) => renderButton(id, "bg-background px-0.5 ring-1 ring-border")}
        </ListBox>
      </div>
    </div>
  );
}
