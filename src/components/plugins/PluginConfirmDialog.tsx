/**
 * A confirmation dialog for a Plugin management action (#443): the Delete-data,
 * Reinstall, and Remove flows share this one shell. Escape and Cancel close it
 * without acting; only the confirm button runs the action. `text` renders the
 * dialog's body paragraph and `children` any extra controls below it.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface PluginConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** The dialog's body copy; omitted when `children` carries the whole body. */
  text?: string;
  /** The confirm button's label (localized by the caller). */
  confirmLabel: string;
  onClose: () => void;
  /** Runs the confirmed action; only called from the confirm button. */
  onConfirm: () => void;
  /** Extra body content, such as the Remove dialog's data-deletion checkbox. */
  children?: ReactNode;
}

export function PluginConfirmDialog({
  isOpen,
  title,
  text,
  confirmLabel,
  onClose,
  onConfirm,
  children,
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
      {text !== undefined && <p className="text-sm text-muted-foreground">{text}</p>}
      {children}
    </Modal>
  );
}
