import { useTranslation } from "react-i18next";
import { Button, Modal } from "@/components/ui";

interface DeleteNoteDialogProps {
  /** The note awaiting confirmation; the dialog is closed while null. */
  note: { title: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * Where focus returns when the dialog closes: the note's row on cancel, or
   * the row that survived a confirmed delete. Falls back to the opener when
   * omitted.
   */
  restoreFocusTarget?: () => HTMLElement | null;
}

export function DeleteNoteDialog({
  note,
  onCancel,
  onConfirm,
  restoreFocusTarget,
}: DeleteNoteDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={note !== null}
      onClose={onCancel}
      title={t("notes.deleteConfirm")}
      restoreFocusTarget={restoreFocusTarget}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("notes.delete")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {t("notes.deleteConfirmBody", { title: note?.title || t("notes.untitled") })}
      </p>
    </Modal>
  );
}
