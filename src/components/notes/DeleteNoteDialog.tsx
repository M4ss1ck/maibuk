import { useTranslation } from "react-i18next";
import { Button, Modal } from "@/components/ui";

interface DeleteNoteDialogProps {
  /** The note awaiting confirmation; the dialog is closed while null. */
  note: { title: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteNoteDialog({ note, onCancel, onConfirm }: DeleteNoteDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={note !== null}
      onClose={onCancel}
      title={t("notes.deleteConfirm")}
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
