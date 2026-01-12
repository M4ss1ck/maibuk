import { useState, useCallback } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { Button } from "../ui";
import { useTranslation } from "react-i18next";
import { TrashIcon, ChevronDownIcon } from "../icons";
import type { Book } from "../../features/books/types";

interface BookSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  onUpdateBookInfo: (
    title: string,
    authorName: string,
    status: "draft" | "in-progress" | "completed"
  ) => void;
  onDelete: () => void;
}

export function BookSettingsDialog({
  isOpen,
  onClose,
  book,
  onUpdateBookInfo,
  onDelete,
}: BookSettingsDialogProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"draft" | "in-progress" | "completed">(
    book.status
  );
  const [title, setTitle] = useState(book.title);
  const [authorName, setAuthorName] = useState(book.authorName);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const hasChanges =
    title !== book.title ||
    authorName !== book.authorName ||
    status !== book.status;

  const handleSave = useCallback(() => {
    onUpdateBookInfo(title, authorName, status);
    onClose();
  }, [title, authorName, status, onUpdateBookInfo, onClose]);

  const handleDelete = useCallback(() => {
    onDelete();
    onClose();
  }, [onDelete, onClose]);

  const handleClose = useCallback(() => {
    setShowDeleteConfirm(false);
    // Reset to original values on close
    setTitle(book.title);
    setAuthorName(book.authorName);
    setStatus(book.status);
    onClose();
  }, [onClose, book.title, book.authorName, book.status]);

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
          <div className="mb-6 space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("books.title")}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-muted border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("books.authorName")}
              </label>
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                className="w-full px-3 py-2 bg-muted border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
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
                  onClick={() => setStatus(s)}
                >
                  {t(`common.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Danger zone accordion */}
          <Disclosure>
            {({ open }) => (
              <div className="border-t border-border pt-4 mt-4">
                <DisclosureButton className="flex w-full items-center justify-between text-sm font-medium text-destructive">
                  {t("bookSettings.dangerZone")}
                  <ChevronDownIcon
                    className={`w-4 h-4 transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </DisclosureButton>
                <DisclosurePanel className="mt-3">
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
                </DisclosurePanel>
              </div>
            )}
          </Disclosure>

          {/* Action buttons */}
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={handleClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges}>
              {t("common.save")}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
