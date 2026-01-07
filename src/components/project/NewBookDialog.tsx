import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useBookStore } from "../../features/books/store";

interface NewBookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (bookId: string) => void;
}

export function NewBookDialog({ isOpen, onClose, onSuccess }: NewBookDialogProps) {
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
      newErrors.title = "Title is required";
    }
    if (!authorName.trim()) {
      newErrors.authorName = "Author name is required";
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
      title="Create New Book"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? "Creating..." : "Create Book"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Book Title"
          placeholder="Enter the title of your book"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setErrors((prev) => ({ ...prev, title: undefined }));
          }}
          error={errors.title}
          autoFocus
        />

        <Input
          label="Author Name"
          placeholder="Enter the author's name"
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
