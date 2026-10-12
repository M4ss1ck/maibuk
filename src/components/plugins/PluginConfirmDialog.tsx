/**
 * A confirmation dialog for a Plugin management action (#443): the Delete-data
 * and Reinstall flows share this one. Escape and Cancel close it without
 * acting; only the confirm button runs the action.
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface PluginConfirmDialogProps {
  isOpen: boolean;
  title: string;
  text: string;
  /** The confirm button's label (localized by the caller). */
  confirmLabel: string;
  onClose: () => void;
  /** Runs the confirmed action; only called from the confirm button. */
  onConfirm: () => void;
}

export function PluginConfirmDialog({
  isOpen,
  title,
  text,
  confirmLabel,
  onClose,
  onConfirm,
}: PluginConfirmDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      role="alertdialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("plugins.management.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{text}</p>
    </Modal>
  );
}
