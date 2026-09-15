import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { SyncConflict } from "@/features/sync/types";

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
    conflict.entityType === "note"
      ? t("sync.entityNote")
      : conflict.entityType === "canvas"
        ? t("sync.entityCanvas")
        : t("sync.entityBook");
  // Deleted elsewhere: "push" restores this copy on the server, "pull" deletes it here.
  const deleted = conflict.remoteDeleted === true;

  return (
    <Modal
      isOpen={true}
      onClose={() => onResolve("cancel")}
      title={deleted ? t("sync.deletedConflictTitle") : t("sync.conflictTitle")}
      footer={
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => onResolve("push")}>
            {deleted ? t("sync.keepAndRestore") : t("sync.keepLocal")}
          </Button>
          <Button variant="destructive" onClick={() => onResolve("pull")}>
            {deleted ? t("sync.deleteHere") : t("sync.useRemote")}
          </Button>
          <Button variant="ghost" onClick={() => onResolve("cancel")}>
            {t("sync.cancelSync")}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">
        {deleted
          ? t("sync.deletedConflictDescription", { title, entity: entityLabel })
          : t("sync.conflictDescription", { title, entity: entityLabel })}
      </p>
      <div className="mt-4 space-y-1 text-sm text-foreground">
        <p>{t("sync.localLastModified", { date: localDate })}</p>
        <p>
          {deleted
            ? t("sync.remoteDeletedAt", { date: remoteDate })
            : t("sync.remoteLastSynced", { date: remoteDate })}
        </p>
      </div>
    </Modal>
  );
}
