import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button as AriaButton, Disclosure, DisclosurePanel } from "react-aria-components";
import { Button, Modal, Select } from "@/components/ui";
import { useTranslation } from "react-i18next";
import { TrashIcon, ChevronDownIcon } from "@/components/icons";
import {
  BOOK_STATUSES,
  type Book,
  type BookStatus,
  type UpdateBookInput,
} from "@/features/books/types";

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
  const [status, setStatus] = useState<BookStatus>(book.status);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [errors, setErrors] = useState<{
    title?: string;
    authorName?: string;
    targetWordCount?: string;
  }>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const authorNameRef = useRef<HTMLInputElement>(null);
  const targetWordCountRef = useRef<HTMLInputElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const deleteConfirmMessageId = useId();
  const wasDeleteConfirmShownRef = useRef(false);

  // The confirmation replaces the button that asked for it: focus the safe
  // choice, and return to the button when the author backs out.
  useEffect(() => {
    if (showDeleteConfirm) cancelDeleteRef.current?.focus();
    else if (wasDeleteConfirmShownRef.current) deleteButtonRef.current?.focus();
    wasDeleteConfirmShownRef.current = showDeleteConfirm;
  }, [showDeleteConfirm]);

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
    const nextErrors: typeof errors = {};
    if (!title.trim()) nextErrors.title = t("errors.titleRequired");
    if (!authorName.trim()) nextErrors.authorName = t("errors.authorNameRequired");
    if (targetWordCount.trim() && !/^\d+$/.test(targetWordCount.trim())) {
      nextErrors.targetWordCount = t("errors.targetWordCountInvalid");
    }
    setErrors(nextErrors);
    const firstInvalid = nextErrors.title
      ? titleRef
      : nextErrors.authorName
        ? authorNameRef
        : nextErrors.targetWordCount
          ? targetWordCountRef
          : null;
    if (firstInvalid) {
      firstInvalid.current?.focus();
      return;
    }

    const parsedTargetWordCount = targetWordCount ? parseInt(targetWordCount, 10) : undefined;

    onUpdateBookInfo({
      title,
      subtitle: subtitle || undefined,
      authorName,
      description: description || undefined,
      genre: genre || undefined,
      language,
      targetWordCount:
        parsedTargetWordCount && !Number.isNaN(parsedTargetWordCount)
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
    t,
  ]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (hasChanges) handleSave();
  };

  const handleDelete = useCallback(() => {
    onDelete();
    onClose();
  }, [onDelete, onClose]);

  const handleClose = useCallback(() => {
    setShowDeleteConfirm(false);
    setErrors({});
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
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("bookSettings.title")}
      unstyled
      panelClassName="bg-background rounded-lg shadow-xl max-w-md w-full mx-4 p-6 border border-border max-h-[90vh] overflow-y-auto"
      panelStyle={{ maxHeight: "90dvh" }}
      titleClassName="text-xl font-semibold text-foreground mb-4"
    >
      <form onSubmit={handleSubmit} noValidate>
        {/* Book info */}
        <div className="mb-6 space-y-3">
          <div>
            <label htmlFor="book-title" className="block text-sm font-medium text-foreground mb-1">
              {t("books.bookTitle")}
            </label>
            <input
              ref={titleRef}
              id="book-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClassName}
              {...fieldErrorProps("book-title", errors.title)}
            />
            <FieldError id="book-title" error={errors.title} />
          </div>

          <div>
            <label
              htmlFor="book-subtitle"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("books.subtitle")}
            </label>
            <input
              id="book-subtitle"
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder={t("books.subtitlePlaceholder")}
              className={inputClassName}
            />
          </div>

          <div>
            <label
              htmlFor="book-author-name"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("books.authorName")}
            </label>
            <input
              ref={authorNameRef}
              id="book-author-name"
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              className={inputClassName}
              {...fieldErrorProps("book-author-name", errors.authorName)}
            />
            <FieldError id="book-author-name" error={errors.authorName} />
          </div>

          <div>
            <label
              htmlFor="book-description"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("books.description")}
            </label>
            <textarea
              id="book-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("books.descriptionPlaceholder")}
              rows={3}
              className={`${inputClassName} resize-none`}
            />
          </div>

          <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            data-testid="book-settings-genre-grid"
          >
            <div>
              <label
                htmlFor="book-genre"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t("books.genre")}
              </label>
              <input
                id="book-genre"
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={t("books.genrePlaceholder")}
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="book-language"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t("books.language")}
              </label>
              <Select
                id="book-language"
                ariaLabel={t("books.language")}
                value={language}
                onChange={setLanguage}
                options={LANGUAGES.map((lang) => ({
                  value: lang.code,
                  label: lang.name,
                }))}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="book-target-word-count"
              className="block text-sm font-medium text-foreground mb-1"
            >
              {t("books.targetWordCount")}
            </label>
            <input
              ref={targetWordCountRef}
              id="book-target-word-count"
              type="number"
              value={targetWordCount}
              onChange={(e) => setTargetWordCount(e.target.value)}
              placeholder={t("books.targetWordCountPlaceholder")}
              min="0"
              step="1"
              className={inputClassName}
              {...fieldErrorProps("book-target-word-count", errors.targetWordCount)}
            />
            <FieldError id="book-target-word-count" error={errors.targetWordCount} />
          </div>
        </div>

        {/* Status selector */}
        <div className="mb-6">
          <p id="book-status-label" className="block text-sm font-medium text-foreground mb-2">
            {t("bookSettings.status")}
          </p>
          <fieldset
            aria-labelledby="book-status-label"
            className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
          >
            {BOOK_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`flex-1 whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium transition-colors border-2 ${
                  status === s
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                }`}
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
              >
                {t(`common.${s}`)}
              </button>
            ))}
          </fieldset>
        </div>

        {/* Danger zone accordion */}
        <Disclosure className="border-t border-border pt-4 mt-4">
          {({ isExpanded }) => (
            <>
              <AriaButton
                slot="trigger"
                className="flex w-full items-center justify-between text-sm font-medium text-destructive"
              >
                {t("bookSettings.dangerZone")}
                <ChevronDownIcon
                  className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </AriaButton>
              <DisclosurePanel className="mt-3">
                {!showDeleteConfirm ? (
                  <button
                    ref={deleteButtonRef}
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-destructive border border-destructive rounded-md hover:bg-destructive/10 transition-colors"
                  >
                    <TrashIcon className="w-4 h-4" />
                    {t("books.deleteBook")}
                  </button>
                ) : (
                  <fieldset
                    aria-labelledby={deleteConfirmMessageId}
                    className="m-0 min-w-0 p-3 bg-destructive/10 border border-destructive rounded-md"
                  >
                    <p id={deleteConfirmMessageId} className="text-sm text-foreground mb-3">
                      {t("bookSettings.deleteConfirmMessage")}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="destructive" onClick={handleDelete} className="flex-1">
                        {t("bookSettings.confirmDelete")}
                      </Button>
                      <Button
                        ref={cancelDeleteRef}
                        variant="ghost"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1"
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </fieldset>
                )}
              </DisclosurePanel>
            </>
          )}
        </Disclosure>

        {/* Action buttons */}
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="ghost" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!hasChanges}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function fieldErrorProps(id: string, error: string | undefined) {
  return error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
}

function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="mt-1 text-sm text-destructive">
      {error}
    </p>
  );
}
