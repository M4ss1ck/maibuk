import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useDragAutoScroll } from "@/hooks/useDragAutoScroll";
import { Button, Modal, Switch, Tooltip } from "@/components/ui";
import { useSettingsStore } from "@/features/settings/store";
import { TOOLBAR_GROUP_META } from "@/components/editor/toolbar/toolbar-groups";
import type { ToolbarEntry, ToolbarSection } from "@/features/settings/toolbar-config";

interface ToolbarSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ToolbarSettingsDialog({ isOpen, onClose }: ToolbarSettingsDialogProps) {
  const { t } = useTranslation();
  const toolbarConfig = useSettingsStore((state) => state.toolbarConfig);
  const resetToolbarConfig = useSettingsStore((state) => state.resetToolbarConfig);
  const moveToolbarEntry = useSettingsStore((state) => state.moveToolbarEntry);
  const transferToolbarEntry = useSettingsStore((state) => state.transferToolbarEntry);
  const moveToolbarEntryTo = useSettingsStore((state) => state.moveToolbarEntryTo);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [activeEntryIds, setActiveEntryIds] = useState<Record<ToolbarSection, string | null>>(
    () => ({
      start: toolbarConfig.start[0]?.id ?? null,
      end: toolbarConfig.end[0]?.id ?? null,
    })
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

  useEffect(() => {
    setActiveEntryIds((current) => {
      const next = { ...current };
      for (const section of ["start", "end"] as const) {
        if (!toolbarConfig[section].some((entry) => entry.id === current[section])) {
          next[section] = toolbarConfig[section][0]?.id ?? null;
        }
      }
      return next.start === current.start && next.end === current.end ? current : next;
    });
  }, [toolbarConfig]);

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

  const handleMove = (
    section: ToolbarSection,
    index: number,
    entryId: string,
    direction: "up" | "down"
  ) => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= toolbarConfig[section].length) return;
    moveToolbarEntry(section, index, direction);
    setActiveEntryIds((current) => ({ ...current, [section]: entryId }));
    setFocusRequest((request) => ({ id: entryId, sequence: (request?.sequence ?? 0) + 1 }));
    announceMove(section, targetIndex + 1, toolbarConfig[section].length);
  };

  const handleTransfer = (section: ToolbarSection, index: number, entryId: string) => {
    const targetSection = section === "start" ? "end" : "start";
    const targetPosition = toolbarConfig[targetSection].length + 1;
    const sourceFallback = toolbarConfig[section][index + 1]?.id ?? toolbarConfig[section][index - 1]?.id ?? null;
    transferToolbarEntry(section, index);
    setActiveEntryIds((current) => ({
      ...current,
      [section]: sourceFallback,
      [targetSection]: entryId,
    }));
    setFocusRequest((request) => ({ id: entryId, sequence: (request?.sequence ?? 0) + 1 }));
    announceMove(targetSection, targetPosition, targetPosition);
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
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <ToolbarLane
          section="start"
          title={t("toolbar.settings.start")}
          entries={toolbarConfig.start}
          activeEntryId={activeEntryIds.start}
          setActiveEntryId={(id) => setActiveEntryIds((current) => ({ ...current, start: id }))}
          setRowRef={(id, element) => {
            if (element) rowRefs.current.set(id, element);
            else rowRefs.current.delete(id);
          }}
          onMove={handleMove}
          onTransfer={handleTransfer}
          draggedEntry={draggedEntry}
          dropTarget={dropTarget}
          onDragStart={(index) => setDraggedEntry({ section: "start", index })}
          onDragOver={(index, placement) => setDropTarget({ section: "start", index, placement })}
          onDrop={handleDrop}
          onDragEnd={clearDrag}
        />
        <ToolbarLane
          section="end"
          title={t("toolbar.settings.end")}
          entries={toolbarConfig.end}
          activeEntryId={activeEntryIds.end}
          setActiveEntryId={(id) => setActiveEntryIds((current) => ({ ...current, end: id }))}
          setRowRef={(id, element) => {
            if (element) rowRefs.current.set(id, element);
            else rowRefs.current.delete(id);
          }}
          onMove={handleMove}
          onTransfer={handleTransfer}
          draggedEntry={draggedEntry}
          dropTarget={dropTarget}
          onDragStart={(index) => setDraggedEntry({ section: "end", index })}
          onDragOver={(index, placement) => setDropTarget({ section: "end", index, placement })}
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

interface ToolbarLaneProps {
  section: ToolbarSection;
  title: string;
  entries: ToolbarEntry[];
  activeEntryId: string | null;
  setActiveEntryId: (id: string) => void;
  setRowRef: (id: string, element: HTMLDivElement | null) => void;
  onMove: (section: ToolbarSection, index: number, entryId: string, direction: "up" | "down") => void;
  onTransfer: (section: ToolbarSection, index: number, entryId: string) => void;
  draggedEntry: { section: ToolbarSection; index: number } | null;
  dropTarget: { section: ToolbarSection; index: number; placement: "before" | "after" } | null;
  onDragStart: (index: number) => void;
  onDragOver: (index: number, placement: "before" | "after") => void;
  onDrop: (section: ToolbarSection, index: number, placement: "before" | "after") => void;
  onDragEnd: () => void;
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

function ToolbarLane({ section, title, entries, activeEntryId, setActiveEntryId, setRowRef, onMove, onTransfer, draggedEntry, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd }: ToolbarLaneProps) {
  const listboxRef = useRef<HTMLDivElement>(null);
  const autoScroll = useDragAutoScroll(listboxRef);

  useEffect(() => {
    window.addEventListener("dragend", autoScroll.stop);
    return () => window.removeEventListener("dragend", autoScroll.stop);
  }, [autoScroll.stop]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div
        ref={listboxRef}
        className="min-h-8 max-h-[55vh] overflow-y-auto space-y-2"
        role="listbox"
        aria-label={title}
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
          onDrop(section, entries.length, "before");
        }}
      >
        {entries.map((entry, index) => {
          const insertionIndex = index + 1;
          const insertionControl = canInsertDivider(entries, insertionIndex) ? (
            <InsertDividerControl key={`add-${entry.id}`} section={section} index={insertionIndex} />
          ) : null;
          return entry.kind === "group" ? (
            <GroupRow
              key={entry.id}
              section={section}
              index={index}
              entry={entry}
              laneLength={entries.length}
              active={activeEntryId === entry.id}
              setActive={() => setActiveEntryId(entry.id)}
              setRowRef={(element) => setRowRef(entry.id, element)}
              onMove={(direction) => onMove(section, index, entry.id, direction)}
              onTransfer={() => onTransfer(section, index, entry.id)}
              dnd={makeRowDndProps(section, index, entry.id, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd, autoScroll)}
              insertionControl={insertionControl}
            />
          ) : (
            <DividerRow
              key={entry.id}
              section={section}
              index={index}
              entry={entry}
              laneLength={entries.length}
              active={activeEntryId === entry.id}
              setActive={() => setActiveEntryId(entry.id)}
              setRowRef={(element) => setRowRef(entry.id, element)}
              onMove={(direction) => onMove(section, index, entry.id, direction)}
              onTransfer={() => onTransfer(section, index, entry.id)}
              dnd={makeRowDndProps(section, index, entry.id, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd, autoScroll)}
              insertionControl={insertionControl}
            />
          );
        })}
      </div>
    </div>
  );
}

interface GroupRowProps {
  section: ToolbarSection;
  index: number;
  entry: Extract<ToolbarEntry, { kind: "group" }>;
  laneLength: number;
  active: boolean;
  setActive: () => void;
  setRowRef: (element: HTMLDivElement | null) => void;
  onMove: (direction: "up" | "down") => void;
  onTransfer: () => void;
  dnd: RowDndProps;
  insertionControl?: ReactNode;
}

function GroupRow({ section, index, entry, laneLength, active, setActive, setRowRef, onMove, onTransfer, dnd, insertionControl }: GroupRowProps) {
  const { t } = useTranslation();
  const setToolbarGroupVisible = useSettingsStore((state) => state.setToolbarGroupVisible);
  const setToolbarGroupFloatingVisible = useSettingsStore(
    (state) => state.setToolbarGroupFloatingVisible
  );
  const meta = TOOLBAR_GROUP_META[entry.id];
  const Icon = meta.Icon;
  const transferLabel =
    section === "start"
      ? t("toolbar.settings.transferToEnd")
      : t("toolbar.settings.transferToStart");

  return <div className="group relative">
    <DropIndicator entryId={entry.id} placement="before" active={dnd.dropPlacement === "before"} />
    <div
      ref={setRowRef}
      role="option"
      aria-selected={active}
      aria-setsize={laneLength}
      aria-posinset={index + 1}
      tabIndex={active ? 0 : -1}
      onFocus={(event) => event.currentTarget === event.target && setActive()}
      onKeyDown={(event) => handleRowKeyDown(event, section, onMove, onTransfer)}
      className="flex items-center gap-2 rounded-lg border border-border p-2"
      onDragOver={dnd.onDragOver}
      onDrop={dnd.onDrop}
    >
      <DragHandle onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd} />
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate text-sm">{t(meta.labelKey)}</span>
      <Switch
        checked={entry.toolbarVisible}
        onChange={(checked) => setToolbarGroupVisible(entry.id, checked)}
        label={t("toolbar.settings.toolbarVisible")}
      />
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
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("toolbar.settings.moveUp")}
        disabled={index === 0}
        onClick={() => onMove("up")}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("toolbar.settings.moveDown")}
        disabled={index === laneLength - 1}
        onClick={() => onMove("down")}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={transferLabel}
        onClick={onTransfer}
      >
        <ArrowLeftRight className="h-4 w-4" />
      </Button>
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
  active: boolean;
  setActive: () => void;
  setRowRef: (element: HTMLDivElement | null) => void;
  onMove: (direction: "up" | "down") => void;
  onTransfer: () => void;
  dnd: RowDndProps;
  insertionControl?: ReactNode;
}

function DividerRow({ section, index, entry, laneLength, active, setActive, setRowRef, onMove, onTransfer, dnd, insertionControl }: DividerRowProps) {
  const { t } = useTranslation();
  const removeToolbarDivider = useSettingsStore((state) => state.removeToolbarDivider);
  const transferLabel =
    section === "start"
      ? t("toolbar.settings.transferToEnd")
      : t("toolbar.settings.transferToStart");

  return <div className="group relative">
    <DropIndicator entryId={entry.id} placement="before" active={dnd.dropPlacement === "before"} />
    <div
      ref={setRowRef}
      role="option"
      aria-label={t("toolbar.settings.dividerLabel")}
      aria-selected={active}
      aria-setsize={laneLength}
      aria-posinset={index + 1}
      tabIndex={active ? 0 : -1}
      onFocus={(event) => event.currentTarget === event.target && setActive()}
      onKeyDown={(event) => handleRowKeyDown(event, section, onMove, onTransfer)}
      className="flex items-center gap-2 rounded-lg border border-dashed border-border p-2"
      onDragOver={dnd.onDragOver}
      onDrop={dnd.onDrop}
    >
      <DragHandle onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd} />
      <span className="flex-1 text-sm italic text-muted-foreground">
        {t("toolbar.settings.dividerLabel")}
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("toolbar.settings.moveUp")}
        disabled={index === 0}
        onClick={() => onMove("up")}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("toolbar.settings.moveDown")}
        disabled={index === laneLength - 1}
        onClick={() => onMove("down")}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={transferLabel}
        onClick={onTransfer}
      >
        <ArrowLeftRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("toolbar.settings.remove")}
        onClick={() => removeToolbarDivider(section, entry.id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
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
  dropTarget: ToolbarLaneProps["dropTarget"],
  onDragStart: ToolbarLaneProps["onDragStart"],
  onDragOver: ToolbarLaneProps["onDragOver"],
  onDrop: ToolbarLaneProps["onDrop"],
  onDragEnd: () => void,
  autoScroll: ReturnType<typeof useDragAutoScroll>
): RowDndProps {
  return {
    dropPlacement: dropTarget?.section === section && dropTarget.index === index ? dropTarget.placement : null,
    onDragStart: (event) => {
      onDragStart(index);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", entryId);
    },
    onDragOver: (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      onDragOver(index, event.clientY < rect.top + rect.height / 2 ? "before" : "after");
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

function DragHandle({ onDragStart, onDragEnd }: Pick<RowDndProps, "onDragStart" | "onDragEnd">) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      draggable
      aria-label={t("toolbar.settings.dragHandle")}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

function DropIndicator({ entryId, placement, active }: { entryId: string; placement: "before" | "after"; active: boolean }) {
  return active ? (
    <div
      data-testid={`toolbar-drop-indicator-${placement}-${entryId}`}
      className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary ${placement === "before" ? "top-0" : "bottom-0"}`}
    />
  ) : null;
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  section: ToolbarSection,
  onMove: (direction: "up" | "down") => void,
  onTransfer: () => void
) {
  if (event.currentTarget !== event.target) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    onMove(event.key === "ArrowUp" ? "up" : "down");
  } else if (
    (event.key === "ArrowLeft" && section === "end") ||
    (event.key === "ArrowRight" && section === "start")
  ) {
    event.preventDefault();
    onTransfer();
  }
}
