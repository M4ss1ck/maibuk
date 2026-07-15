import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { GridList, GridListItem } from "react-aria-components/GridList";
import { Button as AriaButton } from "react-aria-components/Button";
import {
  useDragAndDrop,
  type TextDropItem,
} from "react-aria-components/useDragAndDrop";
import { Button, Modal, Switch, Tooltip, TooltipGroup } from "@/components/ui";
import { useSettingsStore } from "@/features/settings/store";
import { TOOLBAR_GROUP_META } from "@/components/editor/toolbar/toolbar-groups";
import type { ToolbarEntry, ToolbarSection } from "@/features/settings/toolbar-config";

export const TOOLBAR_SETTINGS_ROW_GRID = "grid-cols-[minmax(0,1fr)_3rem_3rem_3rem_3rem]";
export const TOOLBAR_SETTINGS_ROW_MIN_WIDTH = "min-w-[24rem]";
const TOOLBAR_DND_TYPE = "toolbar-entry";

interface ToolbarSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ToolbarSettingsDialog({ isOpen, onClose }: ToolbarSettingsDialogProps) {
  const { t } = useTranslation();
  const toolbarConfig = useSettingsStore((state) => state.toolbarConfig);
  const resetToolbarConfig = useSettingsStore((state) => state.resetToolbarConfig);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const announceMove = (section: ToolbarSection, position: number, total: number) => {
    setAnnouncement(
      t("toolbar.settings.moved", {
        section: t(`toolbar.settings.${section}`),
        position,
        total,
      })
    );
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
        <SectionHeaderRow section="start" />
        <ToolbarSectionGrid
          section="start"
          entries={toolbarConfig.start}
          announceMove={announceMove}
        />
        <SectionHeaderRow section="end" />
        <ToolbarSectionGrid
          section="end"
          entries={toolbarConfig.end}
          announceMove={announceMove}
        />
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </Modal>
  );
}

interface ToolbarSectionGridProps {
  section: ToolbarSection;
  entries: ToolbarEntry[];
  announceMove: (section: ToolbarSection, position: number, total: number) => void;
}

function ToolbarSectionGrid({ section, entries, announceMove }: ToolbarSectionGridProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const moveToolbarEntry = useSettingsStore((state) => state.moveToolbarEntry);
  const moveToolbarEntryTo = useSettingsStore((state) => state.moveToolbarEntryTo);

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) =>
      [...keys].map((key) => ({
        [TOOLBAR_DND_TYPE]: JSON.stringify({ section, id: String(key) }),
      })),
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    onReorder: (e) => {
      const key = [...e.keys][0];
      if (key === undefined) return;
      const currentEntries = useSettingsStore.getState().toolbarConfig[section];
      const fromIndex = currentEntries.findIndex((entry) => entry.id === key);
      if (fromIndex === -1) return;

      let toIndex = currentEntries.findIndex((entry) => entry.id === e.target.key);
      if (e.target.dropPosition === "after") toIndex++;
      if (fromIndex < toIndex) toIndex--;

      moveToolbarEntryTo(section, fromIndex, section, toIndex);

      const updated = useSettingsStore.getState().toolbarConfig[section];
      const movedEntry = updated.find((entry) => entry.id === key);
      if (movedEntry) {
        announceMove(section, updated.indexOf(movedEntry) + 1, updated.length);
      }
    },
    onInsert: async (e) => {
      const item = e.items[0] as TextDropItem;
      const data = JSON.parse(await item.getText(TOOLBAR_DND_TYPE));
      const from = data.section as ToolbarSection;
      const fromEntries = useSettingsStore.getState().toolbarConfig[from];
      const fromIndex = fromEntries.findIndex((entry) => entry.id === data.id);
      if (fromIndex === -1) return;

      const toEntries = useSettingsStore.getState().toolbarConfig[section];
      let toIndex = toEntries.findIndex((entry) => entry.id === e.target.key);
      if (e.target.dropPosition === "after") toIndex++;
      if (from === section && fromIndex < toIndex) toIndex--;

      moveToolbarEntryTo(from, fromIndex, section, toIndex);

      const updated = useSettingsStore.getState().toolbarConfig[section];
      const movedEntry = updated.find((entry) => entry.id === data.id);
      if (movedEntry) {
        announceMove(section, updated.indexOf(movedEntry) + 1, updated.length);
      }
    },
    onRootDrop: async (e) => {
      const item = e.items[0] as TextDropItem;
      const data = JSON.parse(await item.getText(TOOLBAR_DND_TYPE));
      const from = data.section as ToolbarSection;
      const fromEntries = useSettingsStore.getState().toolbarConfig[from];
      const fromIndex = fromEntries.findIndex((entry) => entry.id === data.id);
      if (fromIndex === -1) return;

      moveToolbarEntryTo(from, fromIndex, section, 0);

      const updated = useSettingsStore.getState().toolbarConfig[section];
      const movedEntry = updated.find((entry) => entry.id === data.id);
      if (movedEntry) {
        announceMove(section, updated.indexOf(movedEntry) + 1, updated.length);
      }
    },
    getDropOperation: (_target, types, allowedOperations) =>
      types.has(TOOLBAR_DND_TYPE) && allowedOperations.includes("move") ? "move" : "cancel",
  });

  const handleMove = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const laneLength = useSettingsStore.getState().toolbarConfig[section].length;
    if (targetIndex < 0 || targetIndex >= laneLength) return;
    moveToolbarEntry(section, index, direction);
    announceMove(section, targetIndex + 1, laneLength);
  };

  return (
    <TooltipGroup>
      <GridList
        keyboardNavigationBehavior="tab"
        items={entries}
        aria-label={t(`toolbar.settings.${section}`)}
        className={`${TOOLBAR_SETTINGS_ROW_MIN_WIDTH} min-h-8 max-h-[55vh] overflow-y-auto space-y-2 py-2`}
        dragAndDropHooks={dragAndDropHooks}
        renderEmptyState={() => null}
      >
        {(entry) =>
          entry.kind === "group" ? (
            <GroupGridItem
              section={section}
              entry={entry}
              isDragging={isDragging}
              onMove={handleMove}
            />
          ) : (
            <DividerGridItem
              section={section}
              entry={entry}
              isDragging={isDragging}
              onMove={handleMove}
            />
          )
        }
      </GridList>
    </TooltipGroup>
  );
}

interface GroupGridItemProps {
  section: ToolbarSection;
  entry: Extract<ToolbarEntry, { kind: "group" }>;
  isDragging: boolean;
  onMove: (index: number, direction: "up" | "down") => void;
}

function GroupGridItem({ section, entry, isDragging, onMove }: GroupGridItemProps) {
  const { t } = useTranslation();
  const index = useSettingsStore((state) =>
    state.toolbarConfig[section].findIndex((candidate) => candidate.id === entry.id)
  );
  const laneLength = useSettingsStore((state) => state.toolbarConfig[section].length);
  const setToolbarGroupVisible = useSettingsStore((state) => state.setToolbarGroupVisible);
  const setToolbarGroupFloatingVisible = useSettingsStore((state) => state.setToolbarGroupFloatingVisible);
  const meta = TOOLBAR_GROUP_META[entry.id];
  const Icon = meta.Icon;
  const label = t(meta.labelKey);

  return (
    <GridListItem
      id={entry.id}
      textValue={label}
      className={`group relative grid ${TOOLBAR_SETTINGS_ROW_GRID} ${TOOLBAR_SETTINGS_ROW_MIN_WIDTH} select-none items-center gap-2 rounded-lg border border-border p-2`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AriaButton
          slot="drag"
          aria-label={t("toolbar.settings.dragHandle")}
          className="shrink-0 cursor-grab rounded p-0.5 text-muted-foreground active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </AriaButton>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate text-sm">{label}</span>
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
            onClick={() => onMove(index, "up")}
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
            onClick={() => onMove(index, "down")}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
      <span className="w-10" aria-hidden="true" />
      <InsertDividerControl section={section} index={index + 1} isDragging={isDragging} />
    </GridListItem>
  );
}

interface DividerGridItemProps {
  section: ToolbarSection;
  entry: Extract<ToolbarEntry, { kind: "divider" }>;
  isDragging: boolean;
  onMove: (index: number, direction: "up" | "down") => void;
}

function DividerGridItem({ section, entry, isDragging, onMove }: DividerGridItemProps) {
  const { t } = useTranslation();
  const index = useSettingsStore((state) =>
    state.toolbarConfig[section].findIndex((candidate) => candidate.id === entry.id)
  );
  const laneLength = useSettingsStore((state) => state.toolbarConfig[section].length);
  const removeToolbarDivider = useSettingsStore((state) => state.removeToolbarDivider);

  return (
    <GridListItem
      id={entry.id}
      textValue={t("toolbar.settings.dividerLabel")}
      className={`group relative grid ${TOOLBAR_SETTINGS_ROW_GRID} ${TOOLBAR_SETTINGS_ROW_MIN_WIDTH} select-none items-center gap-2 rounded-lg border border-dashed border-border p-2`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AriaButton
          slot="drag"
          aria-label={t("toolbar.settings.dragHandle")}
          className="shrink-0 cursor-grab rounded p-0.5 text-muted-foreground active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </AriaButton>
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
            onClick={() => onMove(index, "up")}
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
            onClick={() => onMove(index, "down")}
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
      <InsertDividerControl section={section} index={index + 1} isDragging={isDragging} />
    </GridListItem>
  );
}

function canInsertDividerAt(entries: ToolbarEntry[], index: number): boolean {
  if (index <= 0 || index > entries.length) return false;
  const previous = entries[index - 1];
  const next = entries[index];
  return previous?.kind !== "divider" && next?.kind !== "divider";
}

function InsertDividerControl({
  section,
  index,
  isDragging,
}: {
  section: ToolbarSection;
  index: number;
  isDragging: boolean;
}) {
  const { t } = useTranslation();
  const addToolbarDivider = useSettingsStore((state) => state.addToolbarDivider);
  const entries = useSettingsStore((s) => s.toolbarConfig[section]);
  const label = t("toolbar.settings.addDivider");

  if (!canInsertDividerAt(entries, index)) return null;

  return (
    <div
      data-testid={`toolbar-add-divider-${section}-${index}`}
      className={`absolute bottom-0 left-1/2 z-20 w-[90%] -translate-x-1/2 translate-y-1/2 transition-opacity ${
        isDragging
          ? "pointer-events-none opacity-0"
          : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
      }`}
    >
      <button
        type="button"
        aria-label={label}
        onClick={() => addToolbarDivider(section, index)}
        className="flex h-6 w-full items-center gap-2 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <span className="flex shrink-0 items-center gap-1 bg-background px-2">
          <Plus className="h-3 w-3" aria-hidden="true" />
          {label}
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </button>
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

function SectionHeaderRow({ section }: { section: ToolbarSection }) {
  const { t } = useTranslation();

  return (
    <div className="group relative">
      <div
        data-testid={`toolbar-section-header-${section}`}
        className={`grid ${TOOLBAR_SETTINGS_ROW_GRID} ${TOOLBAR_SETTINGS_ROW_MIN_WIDTH} select-none items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}
      >
        <span className="col-span-5">{t(`toolbar.settings.${section}`)}</span>
      </div>
    </div>
  );
}
