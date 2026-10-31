/**
 * The remove-confirmation dialog (#443). Removing a Plugin deletes its files,
 * its approvals and grants, and its saved credentials; its Library data stays
 * unless the author ticks "Also delete this Plugin's data", and its Custom
 * Shortcuts and Voice Commands always stay. A third-party Plugin warns that
 * Maibuk cannot recover its files. It composes the shared
 * {@link PluginConfirmDialog} alert dialog: Escape and Cancel close it without
 * removing; only Confirm calls `remove`.
 */

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/Checkbox";
import { PluginConfirmDialog } from "@/components/plugins/PluginConfirmDialog";

interface PluginRemoveDialogProps {
  isOpen: boolean;
  /** The Plugin display name, shown in the title. */
  name: string;
  /** A Built-in keeps its bundled copy; a third-party Plugin cannot recover. */
  builtIn: boolean;
  onClose: () => void;
  /** Confirms the removal with the author's data-deletion choice. */
  onConfirm: (deleteData: boolean) => void;
}

export function PluginRemoveDialog({
  isOpen,
  name,
  builtIn,
  onClose,
  onConfirm,
}: PluginRemoveDialogProps) {
  const { t } = useTranslation();
  // A fresh dialog starts unchecked; the whole component unmounts on close, so
  // the choice never carries into the next removal.
  const [deleteData, setDeleteData] = useState(false);
  const checkboxId = useId();

  if (!isOpen) return null;

  return (
    <PluginConfirmDialog
      isOpen={isOpen}
      title={t("plugins.management.removeTitleNamed", { name })}
      text={t("plugins.management.removeText")}
      confirmLabel={t("plugins.management.confirm")}
      onClose={onClose}
      onConfirm={() => onConfirm(deleteData)}
    >
      {!builtIn && (
        <p className="mt-2 text-sm text-destructive">{t("plugins.management.thirdWarning")}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={deleteData}
          onChange={setDeleteData}
          label={t("plugins.management.deleteAlso")}
        />
        <label htmlFor={checkboxId} className="text-sm">
          {t("plugins.management.deleteAlso")}
        </label>
      </div>
    </PluginConfirmDialog>
  );
}
