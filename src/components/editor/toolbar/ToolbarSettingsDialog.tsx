import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
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
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [activeEntryIds, setActiveEntryIds] = useState<Record<ToolbarSection, string | null>>(
    () => ({
      start: toolbarConfig.start[0]?.id ?? null,
      end: toolbarConfig.end[0]?.id ?? null,
    })
  );
  const [announcement, setAnnouncement] = useState("");
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
}

function ToolbarLane({ section, title, entries, activeEntryId, setActiveEntryId, setRowRef, onMove, onTransfer }: ToolbarLaneProps) {
  const { t } = useTranslation();
  const addToolbarDivider = useSettingsStore((state) => state.addToolbarDivider);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="space-y-2" role="listbox" aria-label={title}>
        {entries.map((entry, index) =>
          entry.kind === "group" ? (
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
            />
          )
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={() => addToolbarDivider(section)}>
        <Plus className="h-4 w-4" />
        {t("toolbar.settings.addDivider")}
      </Button>
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
}

function GroupRow({ section, index, entry, laneLength, active, setActive, setRowRef, onMove, onTransfer }: GroupRowProps) {
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

  return (
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
    >
      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
  );
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
}

function DividerRow({ section, index, entry, laneLength, active, setActive, setRowRef, onMove, onTransfer }: DividerRowProps) {
  const { t } = useTranslation();
  const removeToolbarDivider = useSettingsStore((state) => state.removeToolbarDivider);
  const transferLabel =
    section === "start"
      ? t("toolbar.settings.transferToEnd")
      : t("toolbar.settings.transferToStart");

  return (
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
    >
      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
  );
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
