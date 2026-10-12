/**
 * The confirmation dialog a modified Built-in's "Replace modified copy" opens
 * (#442). It is an alert dialog: replacing discards the author's edits to the
 * installed files, so it needs an explicit confirmation. Escape and Cancel
 * close it without replacing; the store only writes when the confirm button
 * calls `replaceBuiltIn(id, true)`.
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface ReplaceBuiltInDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The Plugin display name, interpolated into the body copy. */
  name: string;
  /** Confirms the replace; only called from the confirm button. */
  onConfirm: () => void;
}

export function ReplaceBuiltInDialog({
  isOpen,
  onClose,
  name,
  onConfirm,
}: ReplaceBuiltInDialogProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("plugins.replaceTitle")}
      role="alertdialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("plugins.replace")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t("plugins.replaceBody", { name })}</p>
    </Modal>
  );
}
