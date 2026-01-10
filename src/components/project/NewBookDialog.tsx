import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useBookStore } from "../../features/books/store";
import { useTranslation } from "react-i18next";

interface NewBookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (bookId: string) => void;
}

export function NewBookDialog({ isOpen, onClose, onSuccess }: NewBookDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; authorName?: string }>({});

  const createBook = useBookStore((state) => state.createBook);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    const newErrors: typeof errors = {};
    if (!title.trim()) {
      newErrors.title = t("errors.titleRequired");
    }
    if (!authorName.trim()) {
      newErrors.authorName = t("errors.authorNameRequired");
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    try {
      const book = await createBook({
        title: title.trim(),
        authorName: authorName.trim(),
      });
      handleClose();
      onSuccess(book.id);
    } catch (error) {
      console.error("Failed to create book:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setTitle("");
    setAuthorName("");
    setErrors({});
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("books.newBook")}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? t("common.loading") : t("books.createBook")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t("books.bookTitle")}
          placeholder={t("books.bookTitlePlaceholder")}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setErrors((prev) => ({ ...prev, title: undefined }));
          }}
          error={errors.title}
          autoFocus
        />

        <Input
          label={t("books.authorName")}
          placeholder={t("books.authorNamePlaceholder")}
          value={authorName}
          onChange={(e) => {
            setAuthorName(e.target.value);
            setErrors((prev) => ({ ...prev, authorName: undefined }));
          }}
          error={errors.authorName}
        />
      </form>
    </Modal>
  );
}
