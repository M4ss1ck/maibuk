import { useState } from "react";
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
  const [confirmingReset, setConfirmingReset] = useState(false);

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
        />
        <ToolbarLane section="end" title={t("toolbar.settings.end")} entries={toolbarConfig.end} />
      </div>
    </Modal>
  );
}

interface ToolbarLaneProps {
  section: ToolbarSection;
  title: string;
  entries: ToolbarEntry[];
}

function ToolbarLane({ section, title, entries }: ToolbarLaneProps) {
  const { t } = useTranslation();
  const addToolbarDivider = useSettingsStore((state) => state.addToolbarDivider);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="space-y-2">
        {entries.map((entry, index) =>
          entry.kind === "group" ? (
            <GroupRow
              key={entry.id}
              section={section}
              index={index}
              entry={entry}
              laneLength={entries.length}
            />
          ) : (
            <DividerRow
              key={entry.id}
              section={section}
              index={index}
              entry={entry}
              laneLength={entries.length}
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
}

function GroupRow({ section, index, entry, laneLength }: GroupRowProps) {
  const { t } = useTranslation();
  const moveToolbarEntry = useSettingsStore((state) => state.moveToolbarEntry);
  const transferToolbarEntry = useSettingsStore((state) => state.transferToolbarEntry);
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
    <div className="flex items-center gap-2 rounded-lg border border-border p-2">
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
        onClick={() => moveToolbarEntry(section, index, "up")}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("toolbar.settings.moveDown")}
        disabled={index === laneLength - 1}
        onClick={() => moveToolbarEntry(section, index, "down")}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={transferLabel}
        onClick={() => transferToolbarEntry(section, index)}
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
}

function DividerRow({ section, index, entry, laneLength }: DividerRowProps) {
  const { t } = useTranslation();
  const moveToolbarEntry = useSettingsStore((state) => state.moveToolbarEntry);
  const transferToolbarEntry = useSettingsStore((state) => state.transferToolbarEntry);
  const removeToolbarDivider = useSettingsStore((state) => state.removeToolbarDivider);
  const transferLabel =
    section === "start"
      ? t("toolbar.settings.transferToEnd")
      : t("toolbar.settings.transferToStart");

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-2">
      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex-1 text-sm italic text-muted-foreground">
        {t("toolbar.settings.dividerLabel")}
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("toolbar.settings.moveUp")}
        disabled={index === 0}
        onClick={() => moveToolbarEntry(section, index, "up")}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("toolbar.settings.moveDown")}
        disabled={index === laneLength - 1}
        onClick={() => moveToolbarEntry(section, index, "down")}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={transferLabel}
        onClick={() => transferToolbarEntry(section, index)}
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
