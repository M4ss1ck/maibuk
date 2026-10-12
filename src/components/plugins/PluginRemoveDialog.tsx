/**
 * The remove-confirmation dialog (#443). Removing a Plugin deletes its files,
 * its approvals and grants, and its saved credentials; its Library data stays
 * unless the author ticks "Also delete this Plugin's data", and its Custom
 * Shortcuts and Voice Commands always stay. A third-party Plugin warns that
 * Maibuk cannot recover its files. The dialog is an alert dialog: Escape and
 * Cancel close it without removing; only Confirm calls `remove`.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";

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

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("plugins.management.removeTitleNamed", { name })}
      role="alertdialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("plugins.management.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(deleteData)}>
            {t("plugins.management.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t("plugins.management.removeText")}</p>
      {!builtIn && (
        <p className="mt-2 text-sm text-destructive">{t("plugins.management.thirdWarning")}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Checkbox
          checked={deleteData}
          onChange={setDeleteData}
          label={t("plugins.management.deleteAlso")}
        />
        <span className="text-sm">{t("plugins.management.deleteAlso")}</span>
      </div>
    </Modal>
  );
}
