import { useState, useCallback } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { Button, Select } from "../ui";
import { useTranslation } from "react-i18next";
import { TrashIcon, ChevronDownIcon } from "../icons";
import type { Book, UpdateBookInput } from "../../features/books/types";

interface BookSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  onUpdateBookInfo: (input: UpdateBookInput) => void;
  onDelete: () => void;
}

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "zh", name: "中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
];

export function BookSettingsDialog({
  isOpen,
  onClose,
  book,
  onUpdateBookInfo,
  onDelete,
}: BookSettingsDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(book.title);
  const [subtitle, setSubtitle] = useState(book.subtitle || "");
  const [authorName, setAuthorName] = useState(book.authorName);
  const [description, setDescription] = useState(book.description || "");
  const [genre, setGenre] = useState(book.genre || "");
  const [language, setLanguage] = useState(book.language);
  const [targetWordCount, setTargetWordCount] = useState<string>(
    book.targetWordCount?.toString() || ""
  );
  const [status, setStatus] = useState<"draft" | "in-progress" | "completed">(
    book.status
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const hasChanges =
    title !== book.title ||
    subtitle !== (book.subtitle || "") ||
    authorName !== book.authorName ||
    description !== (book.description || "") ||
    genre !== (book.genre || "") ||
    language !== book.language ||
    targetWordCount !== (book.targetWordCount?.toString() || "") ||
    status !== book.status;

  const handleSave = useCallback(() => {
    const parsedTargetWordCount = targetWordCount
      ? parseInt(targetWordCount, 10)
      : undefined;

    onUpdateBookInfo({
      title,
      subtitle: subtitle || undefined,
      authorName,
      description: description || undefined,
      genre: genre || undefined,
      language,
      targetWordCount:
        parsedTargetWordCount && !isNaN(parsedTargetWordCount)
          ? parsedTargetWordCount
          : undefined,
      status,
    });
    onClose();
  }, [
    title,
    subtitle,
    authorName,
    description,
    genre,
    language,
    targetWordCount,
    status,
    onUpdateBookInfo,
    onClose,
  ]);

  const handleDelete = useCallback(() => {
    onDelete();
    onClose();
  }, [onDelete, onClose]);

  const handleClose = useCallback(() => {
    setShowDeleteConfirm(false);
    // Reset to original values on close
    setTitle(book.title);
    setSubtitle(book.subtitle || "");
    setAuthorName(book.authorName);
    setDescription(book.description || "");
    setGenre(book.genre || "");
    setLanguage(book.language);
    setTargetWordCount(book.targetWordCount?.toString() || "");
    setStatus(book.status);
    onClose();
  }, [onClose, book]);

  const inputClassName =
    "w-full px-3 py-2 bg-muted border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-accent";

  return (
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Dialog container */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-background rounded-lg shadow-xl max-w-md w-full p-6 border border-border max-h-[90vh] overflow-y-auto">
          <DialogTitle className="text-xl font-semibold text-foreground mb-4">
            {t("bookSettings.title")}
          </DialogTitle>

          {/* Book info */}
          <div className="mb-6 space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("books.bookTitle")}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClassName}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("books.subtitle")}
              </label>
              <input
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder={t("books.subtitlePlaceholder")}
                className={inputClassName}
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
                className={inputClassName}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("books.description")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("books.descriptionPlaceholder")}
                rows={3}
                className={inputClassName + " resize-none"}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t("books.genre")}
                </label>
                <input
                  type="text"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder={t("books.genrePlaceholder")}
                  className={inputClassName}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t("books.language")}
                </label>
                <Select
                  value={language}
                  onChange={setLanguage}
                  options={LANGUAGES.map((lang) => ({ value: lang.code, label: lang.name }))}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t("books.targetWordCount")}
              </label>
              <input
                type="number"
                value={targetWordCount}
                onChange={(e) => setTargetWordCount(e.target.value)}
                placeholder={t("books.targetWordCountPlaceholder")}
                min="0"
                className={inputClassName}
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
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors border-2 ${status === s
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
                    className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""
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
