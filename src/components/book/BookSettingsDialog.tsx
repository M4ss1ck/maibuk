import { useState, useCallback } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { Button } from "../ui";
import { useTranslation } from "react-i18next";
import { TrashIcon } from "../icons";
import type { Book } from "../../features/books/types";

interface BookSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  onUpdateStatus: (status: "draft" | "in-progress" | "completed") => void;
  onDelete: () => void;
}

export function BookSettingsDialog({
  isOpen,
  onClose,
  book,
  onUpdateStatus,
  onDelete,
}: BookSettingsDialogProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"draft" | "in-progress" | "completed">(
    book.status
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleStatusChange = useCallback(
    (newStatus: "draft" | "in-progress" | "completed") => {
      setStatus(newStatus);
      onUpdateStatus(newStatus);
    },
    [onUpdateStatus]
  );

  const handleDelete = useCallback(() => {
    onDelete();
    onClose();
  }, [onDelete, onClose]);

  const handleClose = useCallback(() => {
    setShowDeleteConfirm(false);
    onClose();
  }, [onClose]);

  return (
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Dialog container */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-background rounded-lg shadow-xl max-w-md w-full p-6 border border-border">
          <DialogTitle className="text-xl font-semibold text-foreground mb-4">
            {t("bookSettings.title")}
          </DialogTitle>

          {/* Book info */}
          <div className="mb-6 p-3 bg-primary rounded-md">
            <p className="font-medium text-foreground">{book.title}</p>
            <p className="text-sm text-success">
              {t("common.by")} {book.authorName}
            </p>
          </div>

          {/* Status selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-foreground mb-2">
              {t("bookSettings.status")}
            </label>
            <div className="flex gap-2">
              {(["draft", "in-progress", "completed"] as const).map((s) => (
                <button
                  key={s}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors border-2 ${
                    status === s
                      ? "bg-accent text-accent-foreground border-accent"
                      : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                  }`}
                  onClick={() => handleStatusChange(s)}
                >
                  {t(`common.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Danger zone */}
          <div className="border-t border-border pt-4 mt-4">
            <h3 className="text-sm font-medium text-destructive mb-3">
              {t("bookSettings.dangerZone")}
            </h3>

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-destructive border border-destructive rounded-md hover:bg-destructive/10 transition-colors"
              >
                <TrashIcon className="w-4 h-4" />
                {t("books.deleteBook")}
              </button>
            ) : (
              <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
                <p className="text-sm text-foreground mb-3">
                  {t("bookSettings.deleteConfirmMessage")}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    className="flex-1"
                  >
                    {t("bookSettings.confirmDelete")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1"
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Close button */}
          <div className="flex justify-end mt-6">
            <Button variant="ghost" onClick={handleClose}>
              {t("common.close")}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
