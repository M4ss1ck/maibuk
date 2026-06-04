import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import type { SyncConflict } from "../../features/sync/types";

interface ConflictDialogProps {
  conflict: SyncConflict;
  onResolve: (choice: "push" | "pull" | "cancel") => void;
}

export function ConflictDialog({ conflict, onResolve }: ConflictDialogProps) {
  const { t } = useTranslation();

  const localDate = new Date(conflict.localUpdatedAt * 1000).toLocaleString();
  const remoteDate = new Date(conflict.remoteUpdatedAt * 1000).toLocaleString();
  const title = conflict.entityTitle ?? conflict.bookTitle;
  const entityLabel =
    conflict.entityType === "note" ? t("sync.entityNote") : t("sync.entityBook");

  return (
    <Modal
      isOpen={true}
      onClose={() => onResolve("cancel")}
      title={t("sync.conflictTitle")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => onResolve("push")}>
            {t("sync.keepLocal")}
          </Button>
          <Button variant="destructive" onClick={() => onResolve("pull")}>
            {t("sync.useRemote")}
          </Button>
          <Button variant="ghost" onClick={() => onResolve("cancel")}>
            {t("sync.cancelSync")}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">
        {t("sync.conflictDescription", { title, entity: entityLabel })}
      </p>
      <div className="mt-4 space-y-1 text-sm text-foreground">
        <p>{t("sync.localLastModified", { date: localDate })}</p>
        <p>{t("sync.remoteLastSynced", { date: remoteDate })}</p>
      </div>
    </Modal>
  );
}
