import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useDragAutoScroll } from "@/hooks/useDragAutoScroll";
import { Button, Modal, Switch, Tooltip, TooltipGroup } from "@/components/ui";
import { useSettingsStore } from "@/features/settings/store";
import { TOOLBAR_GROUP_META } from "@/components/editor/toolbar/toolbar-groups";
import type { ToolbarEntry, ToolbarSection } from "@/features/settings/toolbar-config";

export const TOOLBAR_SETTINGS_ROW_GRID = "grid-cols-[minmax(0,1fr)_3rem_3rem_3rem_3rem]";
export const TOOLBAR_SETTINGS_ROW_MIN_WIDTH = "min-w-[24rem]";

interface ToolbarSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ToolbarSettingsDialog({ isOpen, onClose }: ToolbarSettingsDialogProps) {
  const { t } = useTranslation();
  const toolbarConfig = useSettingsStore((state) => state.toolbarConfig);
  const resetToolbarConfig = useSettingsStore((state) => state.resetToolbarConfig);
  const moveToolbarEntry = useSettingsStore((state) => state.moveToolbarEntry);
  const moveToolbarEntryTo = useSettingsStore((state) => state.moveToolbarEntryTo);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(
    () => toolbarConfig.start[0]?.id ?? toolbarConfig.end[0]?.id ?? null
  );
  const [announcement, setAnnouncement] = useState("");
  const [draggedEntry, setDraggedEntry] = useState<{ section: ToolbarSection; index: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    section: ToolbarSection;
    index: number;
    placement: "before" | "after";
  } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; sequence: number } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const listItems = useMemo<ToolbarListItem[]>(() => buildListItems(toolbarConfig), [toolbarConfig]);

  useEffect(() => {
    setActiveEntryId((current) => {
      if (!listItems.some((item) => item.kind === "entry" && item.entry.id === current)) {
        const firstEntry = listItems.find((item): item is EntryItem => item.kind === "entry");
        return firstEntry?.entry.id ?? null;
      }
      return current;
    });
  }, [listItems]);

  useEffect(() => {
    if (focusRequest) rowRefs.current.get(focusRequest.id)?.focus();
  }, [focusRequest]);

  const announceMove = (section: ToolbarSection, position: number, total: number) => {
    setAnnouncement(
      t("toolbar.settings.moved", {
        section: t(`toolbar.settings.${section}`),
        position,
        total,
      })
    );
  };

  const handleMove = (section: ToolbarSection, index: number, entryId: string, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= toolbarConfig[section].length) return;
    moveToolbarEntry(section, index, direction);
    setActiveEntryId(entryId);
    setFocusRequest((request) => ({ id: entryId, sequence: (request?.sequence ?? 0) + 1 }));
    announceMove(section, targetIndex + 1, toolbarConfig[section].length);
  };

  const handleResetClick = () => {
    if (confirmingReset) {
      resetToolbarConfig();
      setConfirmingReset(false);
    } else {
      setConfirmingReset(true);
    }
  };

  const clearDrag = () => {
    setDraggedEntry(null);
    setDropTarget(null);
  };

  const handleDrop = (section: ToolbarSection, index: number, placement: "before" | "after") => {
    if (!draggedEntry) return;
    let toIndex = index + (placement === "after" ? 1 : 0);
    if (draggedEntry.section === section && draggedEntry.index < toIndex) toIndex -= 1;
    moveToolbarEntryTo(draggedEntry.section, draggedEntry.index, section, toIndex);
    clearDrag();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("toolbar.settings.title")}
      size="wide"
      footer={
        <>
          <Button
            variant={confirmingReset ? "destructive" : "secondary"}
            onClick={handleResetClick}
          >
            {confirmingReset ? t("toolbar.settings.resetConfirm") : t("toolbar.settings.reset")}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t("toolbar.settings.close")}
          </Button>
        </>
      }
    >
      <div className="overflow-x-auto">
        <div
          className={`grid ${TOOLBAR_SETTINGS_ROW_GRID} ${TOOLBAR_SETTINGS_ROW_MIN_WIDTH} sticky top-0 z-10 gap-2 border-b border-border bg-background px-2 pb-2 text-xs font-medium text-muted-foreground`}
        >
          <ColumnHeader label={t("toolbar.settings.itemColumn")} help={t("toolbar.settings.itemColumnHelp")} />
          <ColumnHeader label={t("toolbar.settings.toolbarColumn")} help={t("toolbar.settings.toolbarColumnHelp")} className="text-center" />
          <ColumnHeader label={t("toolbar.settings.selectionMenuColumn")} help={t("toolbar.settings.selectionMenuColumnHelp")} className="text-center" />
          <ColumnHeader label={t("toolbar.settings.orderColumn")} help={t("toolbar.settings.orderColumnHelp")} className="text-center" />
          <ColumnHeader label={t("toolbar.settings.actionsColumn")} help={t("toolbar.settings.actionsColumnHelp")} className="text-center" />
        </div>
        <ToolbarList
          items={listItems}
          activeEntryId={activeEntryId}
          setActiveEntryId={setActiveEntryId}
          setRowRef={(id, element) => {
            if (element) rowRefs.current.set(id, element);
            else rowRefs.current.delete(id);
          }}
          onMove={handleMove}
          draggedEntry={draggedEntry}
          dropTarget={dropTarget}
          onDragStart={({ section, index }) => setDraggedEntry({ section, index })}
          onDragOver={(section, index, placement) => setDropTarget({ section, index, placement })}
          onDrop={handleDrop}
          onDragEnd={clearDrag}
        />
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </Modal>
  );
}

type ToolbarListItem = SectionItem | EntryItem;

interface SectionItem {
  kind: "section";
  section: ToolbarSection;
}

interface EntryItem {
  kind: "entry";
  section: ToolbarSection;
  index: number;
  entry: ToolbarEntry;
}

function buildListItems(config: { start: ToolbarEntry[]; end: ToolbarEntry[] }): ToolbarListItem[] {
  const items: ToolbarListItem[] = [];
  items.push({ kind: "section", section: "start" });
  config.start.forEach((entry, index) => items.push({ kind: "entry", section: "start", index, entry }));
  items.push({ kind: "section", section: "end" });
  config.end.forEach((entry, index) => items.push({ kind: "entry", section: "end", index, entry }));
  return items;
}

interface ToolbarListProps {
  items: ToolbarListItem[];
  activeEntryId: string | null;
  setActiveEntryId: (id: string) => void;
  setRowRef: (id: string, element: HTMLDivElement | null) => void;
  onMove: (section: ToolbarSection, index: number, entryId: string, direction: "up" | "down") => void;
  draggedEntry: { section: ToolbarSection; index: number } | null;
  dropTarget: { section: ToolbarSection; index: number; placement: "before" | "after" } | null;
  onDragStart: (location: { section: ToolbarSection; index: number }) => void;
  onDragOver: (section: ToolbarSection, index: number, placement: "before" | "after") => void;
  onDrop: (section: ToolbarSection, index: number, placement: "before" | "after") => void;
  onDragEnd: () => void;
}

function ToolbarList({
  items,
  activeEntryId,
  setActiveEntryId,
  setRowRef,
  onMove,
  draggedEntry,
  dropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: ToolbarListProps) {
  const { t } = useTranslation();
  const listboxRef = useRef<HTMLDivElement>(null);
  const autoScroll = useDragAutoScroll(listboxRef);

  useEffect(() => {
    window.addEventListener("dragend", autoScroll.stop);
    return () => window.removeEventListener("dragend", autoScroll.stop);
  }, [autoScroll.stop]);

  const totalEntries = items.filter((item) => item.kind === "entry").length;
  const sectionLengths = useMemo(() => {
    return {
      start: items.filter((item): item is EntryItem => item.kind === "entry" && item.section === "start").length,
      end: items.filter((item): item is EntryItem => item.kind === "entry" && item.section === "end").length,
    };
  }, [items]);

  const computeDrop = (item: ToolbarListItem, placement: "before" | "after"): { section: ToolbarSection; index: number } => {
    if (item.kind === "section") {
      return { section: item.section, index: placement === "before" ? 0 : sectionLengths[item.section] };
    }
    return {
      section: item.section,
      index: item.index + (placement === "after" ? 1 : 0),
    };
  };

  const sectionHeaderDropPlacement = (section: ToolbarSection): "before" | "after" | null => {
    if (!dropTarget || dropTarget.section !== section) return null;
    if (dropTarget.index === 0) return "before";
    if (dropTarget.index === sectionLengths[section]) return "after";
    return null;
  };

  return (
    <TooltipGroup>
      <div
        ref={listboxRef}
        className={`${TOOLBAR_SETTINGS_ROW_MIN_WIDTH} min-h-8 max-h-[55vh] overflow-y-auto space-y-2 py-2`}
        role="listbox"
        aria-label={t("toolbar.settings.title")}
        onDragOver={(event) => {
          if (!draggedEntry || event.currentTarget !== event.target) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          autoScroll.onDragOver(event.clientY);
        }}
        onDrop={(event) => {
          if (!draggedEntry || event.currentTarget !== event.target) return;
          event.preventDefault();
          autoScroll.stop();
          onDrop("end", sectionLengths.end, "before");
        }}
      >
        {items.map((item, flatIndex) => {
          if (item.kind === "section") {
            return (
              <SectionHeaderRow
                key={item.section}
                section={item.section}
                dropPlacement={sectionHeaderDropPlacement(item.section)}
                onDragOver={(placement) => {
                  const target = computeDrop(item, placement);
                  onDragOver(target.section, target.index, placement);
                }}
                onDrop={(placement) => {
                  const target = computeDrop(item, placement);
                  onDrop(target.section, target.index, placement);
                }}
              />
            );
          }

          const { section, index, entry } = item;
          const insertionIndex = index + 1;
          const insertionControl = canInsertDivider(
            items
              .filter((i): i is EntryItem => i.kind === "entry" && i.section === section)
              .map((i) => i.entry),
            insertionIndex
          ) ? (
            <InsertDividerControl key={`add-${entry.id}`} section={section} index={insertionIndex} />
          ) : null;

          const posInSet = items
            .slice(0, flatIndex)
            .filter((i): i is EntryItem => i.kind === "entry").length + 1;

          const dnd = makeRowDndProps(
            section,
            index,
            entry.id,
            dropTarget,
            onDragStart,
            onDragOver,
            onDrop,
            onDragEnd,
            autoScroll
          );

          return entry.kind === "group" ? (
            <GroupRow
              key={entry.id}
              index={index}
              entry={entry}
              laneLength={items.filter((i): i is EntryItem => i.kind === "entry" && i.section === section).length}
              posInSet={posInSet}
              totalEntries={totalEntries}
              active={activeEntryId === entry.id}
              setActive={() => setActiveEntryId(entry.id)}
              setRowRef={(element) => setRowRef(entry.id, element)}
              onMove={(direction) => onMove(section, index, entry.id, direction)}
              dnd={dnd}
              insertionControl={insertionControl}
            />
          ) : (
            <DividerRow
              key={entry.id}
              section={section}
              index={index}
              entry={entry}
              laneLength={items.filter((i): i is EntryItem => i.kind === "entry" && i.section === section).length}
              posInSet={posInSet}
              totalEntries={totalEntries}
              active={activeEntryId === entry.id}
              setActive={() => setActiveEntryId(entry.id)}
              setRowRef={(element) => setRowRef(entry.id, element)}
              onMove={(direction) => onMove(section, index, entry.id, direction)}
              dnd={dnd}
              insertionControl={insertionControl}
            />
          );
        })}
      </div>
    </TooltipGroup>
  );
}

function canInsertDivider(entries: ToolbarEntry[], index: number): boolean {
  if (index <= 0 || index > entries.length) return false;
  const previous = entries[index - 1];
  const next = entries[index];
  return previous?.kind !== "divider" && next?.kind !== "divider";
}

function InsertDividerControl({ section, index }: { section: ToolbarSection; index: number }) {
  const { t } = useTranslation();
  const addToolbarDivider = useSettingsStore((state) => state.addToolbarDivider);
  const label = t("toolbar.settings.addDivider");

  return (
    <div
      data-testid={`toolbar-add-divider-${section}-${index}`}
      className="pointer-events-none absolute bottom-0 left-1/2 z-20 -translate-x-1/2 translate-y-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
    >
      <Tooltip content={label}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          onClick={() => addToolbarDivider(section, index)}
          className="h-5 w-5 p-0 pointer-events-auto"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}

function ColumnHeader({ label, help, className = "" }: { label: string; help: string; className?: string }) {
  return (
    <Tooltip content={help}>
      <span className={`block truncate rounded ${className}`}>{label}</span>
    </Tooltip>
  );
}

interface SectionHeaderRowProps {
  section: ToolbarSection;
  dropPlacement: "before" | "after" | null;
  onDragOver: (placement: "before" | "after") => void;
  onDrop: (placement: "before" | "after") => void;
}

function SectionHeaderRow({ section, dropPlacement, onDragOver, onDrop }: SectionHeaderRowProps) {
  const { t } = useTranslation();
  const rowId = `section-header-${section}`;

  return (
    <div className="group relative">
      <DropIndicator entryId={rowId} placement="before" active={dropPlacement === "before"} />
      <div
        data-testid={`toolbar-section-header-${section}`}
        className={`grid ${TOOLBAR_SETTINGS_ROW_GRID} ${TOOLBAR_SETTINGS_ROW_MIN_WIDTH} select-none items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onDragOver(event.clientY < rect.top + rect.height / 2 ? "before" : "after");
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onDrop(event.clientY < rect.top + rect.height / 2 ? "before" : "after");
        }}
      >
        {t(`toolbar.settings.${section}`)}
      </div>
      <DropIndicator entryId={rowId} placement="after" active={dropPlacement === "after"} />
    </div>
  );
}

interface GroupRowProps {
  index: number;
  entry: Extract<ToolbarEntry, { kind: "group" }>;
  laneLength: number;
  posInSet: number;
  totalEntries: number;
  active: boolean;
  setActive: () => void;
  setRowRef: (element: HTMLDivElement | null) => void;
  onMove: (direction: "up" | "down") => void;
  dnd: RowDndProps;
  insertionControl?: ReactNode;
}

function GroupRow({ index, entry, laneLength, posInSet, totalEntries, active, setActive, setRowRef, onMove, dnd, insertionControl }: GroupRowProps) {
  const { t } = useTranslation();
  const setToolbarGroupVisible = useSettingsStore((state) => state.setToolbarGroupVisible);
  const setToolbarGroupFloatingVisible = useSettingsStore(
    (state) => state.setToolbarGroupFloatingVisible
  );
  const meta = TOOLBAR_GROUP_META[entry.id];
  const Icon = meta.Icon;

  return <div className="group relative">
    <DropIndicator entryId={entry.id} placement="before" active={dnd.dropPlacement === "before"} />
    <div
      ref={setRowRef}
      role="option"
      aria-selected={active}
      aria-setsize={totalEntries}
      aria-posinset={posInSet}
      tabIndex={active ? 0 : -1}
      onFocus={(event) => event.currentTarget === event.target && setActive()}
      onKeyDown={(event) => handleRowKeyDown(event, onMove)}
      className={`grid ${TOOLBAR_SETTINGS_ROW_GRID} ${TOOLBAR_SETTINGS_ROW_MIN_WIDTH} select-none items-center gap-2 rounded-lg border border-border p-2`}
      onDragOver={dnd.onDragOver}
      onDrop={dnd.onDrop}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip content={t("toolbar.settings.dragHandle")}>
          <span
            role="img"
            draggable
            aria-label={t("toolbar.settings.dragHandle")}
            onDragStart={dnd.onDragStart}
            onDragEnd={dnd.onDragEnd}
            className="shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </span>
        </Tooltip>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate text-sm">{t(meta.labelKey)}</span>
      </div>
      <div className="flex justify-center">
        <Switch
          checked={entry.toolbarVisible}
          onChange={(checked) => setToolbarGroupVisible(entry.id, checked)}
          label={t("toolbar.settings.toolbarVisible")}
        />
      </div>
      <div className="flex justify-center">
        <Tooltip
          content={
            meta.floatingEligible
              ? t("toolbar.settings.floatingVisible")
              : t("toolbar.settings.floatingUnavailable")
          }
        >
          <span className="inline-flex">
            <Switch
              checked={entry.floatingVisible}
              onChange={(checked) => setToolbarGroupFloatingVisible(entry.id, checked)}
              disabled={!meta.floatingEligible}
              label={
                meta.floatingEligible
                  ? t("toolbar.settings.floatingVisible")
                  : t("toolbar.settings.floatingUnavailable")
              }
            />
          </span>
        </Tooltip>
      </div>
      <div className="flex justify-center gap-1">
        <Tooltip content={t("toolbar.settings.moveUp")}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("toolbar.settings.moveUp")}
            disabled={index === 0}
            onClick={() => onMove("up")}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t("toolbar.settings.moveDown")}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("toolbar.settings.moveDown")}
            disabled={index === laneLength - 1}
            onClick={() => onMove("down")}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
      <span className="w-10" aria-hidden="true" />
    </div>
    <DropIndicator entryId={entry.id} placement="after" active={dnd.dropPlacement === "after"} />
    {insertionControl}
  </div>;
}

interface DividerRowProps {
  section: ToolbarSection;
  index: number;
  entry: Extract<ToolbarEntry, { kind: "divider" }>;
  laneLength: number;
  posInSet: number;
  totalEntries: number;
  active: boolean;
  setActive: () => void;
  setRowRef: (element: HTMLDivElement | null) => void;
  onMove: (direction: "up" | "down") => void;
  dnd: RowDndProps;
  insertionControl?: ReactNode;
}

function DividerRow({ section, index, entry, laneLength, posInSet, totalEntries, active, setActive, setRowRef, onMove, dnd, insertionControl }: DividerRowProps) {
  const { t } = useTranslation();
  const removeToolbarDivider = useSettingsStore((state) => state.removeToolbarDivider);

  return <div className="group relative">
    <DropIndicator entryId={entry.id} placement="before" active={dnd.dropPlacement === "before"} />
    <div
      ref={setRowRef}
      role="option"
      aria-label={t("toolbar.settings.dividerLabel")}
      aria-selected={active}
      aria-setsize={totalEntries}
      aria-posinset={posInSet}
      tabIndex={active ? 0 : -1}
      onFocus={(event) => event.currentTarget === event.target && setActive()}
      onKeyDown={(event) => handleRowKeyDown(event, onMove)}
      className={`grid ${TOOLBAR_SETTINGS_ROW_GRID} ${TOOLBAR_SETTINGS_ROW_MIN_WIDTH} select-none items-center gap-2 rounded-lg border border-dashed border-border p-2`}
      onDragOver={dnd.onDragOver}
      onDrop={dnd.onDrop}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip content={t("toolbar.settings.dragHandle")}>
          <span
            role="img"
            draggable
            aria-label={t("toolbar.settings.dragHandle")}
            onDragStart={dnd.onDragStart}
            onDragEnd={dnd.onDragEnd}
            className="shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </span>
        </Tooltip>
        <span className="truncate text-sm italic text-muted-foreground">
          {t("toolbar.settings.dividerLabel")}
        </span>
      </div>
      <span className="w-11" aria-hidden="true" />
      <span className="w-11" aria-hidden="true" />
      <div className="flex justify-center gap-1">
        <Tooltip content={t("toolbar.settings.moveUp")}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("toolbar.settings.moveUp")}
            disabled={index === 0}
            onClick={() => onMove("up")}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t("toolbar.settings.moveDown")}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("toolbar.settings.moveDown")}
            disabled={index === laneLength - 1}
            onClick={() => onMove("down")}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
      <div className="flex justify-center">
        <Tooltip content={t("toolbar.settings.remove")}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("toolbar.settings.remove")}
            onClick={() => removeToolbarDivider(section, entry.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
    <DropIndicator entryId={entry.id} placement="after" active={dnd.dropPlacement === "after"} />
    {insertionControl}
  </div>;
}

interface RowDndProps {
  dropPlacement: "before" | "after" | null;
  onDragStart: (event: DragEvent<HTMLSpanElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function makeRowDndProps(
  section: ToolbarSection,
  index: number,
  entryId: string,
  dropTarget: ToolbarListProps["dropTarget"],
  onDragStart: ToolbarListProps["onDragStart"],
  onDragOver: ToolbarListProps["onDragOver"],
  onDrop: ToolbarListProps["onDrop"],
  onDragEnd: () => void,
  autoScroll: ReturnType<typeof useDragAutoScroll>
): RowDndProps {
  return {
    dropPlacement: dropTarget?.section === section && dropTarget.index === index ? dropTarget.placement : null,
    onDragStart: (event) => {
      onDragStart({ section, index });
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", entryId);
    },
    onDragOver: (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      onDragOver(section, index, event.clientY < rect.top + rect.height / 2 ? "before" : "after");
      autoScroll.onDragOver(event.clientY);
    },
    onDrop: (event) => {
      event.preventDefault();
      event.stopPropagation();
      autoScroll.stop();
      const rect = event.currentTarget.getBoundingClientRect();
      onDrop(section, index, event.clientY < rect.top + rect.height / 2 ? "before" : "after");
    },
    onDragEnd: () => {
      autoScroll.stop();
      onDragEnd();
    },
  };
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  onMove: (direction: "up" | "down") => void
) {
  if (event.currentTarget !== event.target) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    onMove(event.key === "ArrowUp" ? "up" : "down");
  }
}

function DropIndicator({ entryId, placement, active }: { entryId: string; placement: "before" | "after"; active: boolean }) {
  return active ? (
    <div
      data-testid={`toolbar-drop-indicator-${placement}-${entryId}`}
      className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary ${placement === "before" ? "top-0" : "bottom-0"}`}
    />
  ) : null;
}
