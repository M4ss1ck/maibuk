import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBookStore } from "../features/books/store";
import { BookCard } from "../components/project/BookCard";
import { NewBookDialog } from "../components/project/NewBookDialog";
import { Button } from "../components/ui/Button";
import { useTranslation } from "react-i18next";
import { AddIcon, BookStackIcon } from "../components/icons";
import { Download } from "lucide-react";
import { IS_WEB } from "../lib/platform";
import { DOWNLOAD_PAGE } from "../constants";
import { KeyboardShortcut } from "../components/ui";
import { isModKey, isTypingTarget } from "../lib/keyboard";
import { useShortcuts } from "../lib/shortcuts";

export function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isNewBookOpen, setIsNewBookOpen] = useState(false);
  const [focusedBookIndex, setFocusedBookIndex] = useState(0);

  const { books, isLoading, loadBooks } = useBookStore();

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    if (books.length === 0) {
      setFocusedBookIndex(0);
      return;
    }

    if (focusedBookIndex > books.length - 1) {
      setFocusedBookIndex(books.length - 1);
    }
  }, [books.length, focusedBookIndex]);

  useShortcuts([
    {
      keys: ["ctrl+n", "meta+n"],
      onTrigger: (event) => {
        if (isTypingTarget(event.target) || isModKey(event) === false) return;
        setIsNewBookOpen(true);
      },
      allowInInput: true,
    },
    {
      keys: ["arrowdown", "arrowright", "j"],
      onTrigger: () => {
        setFocusedBookIndex((prev) => Math.min(prev + 1, books.length - 1));
      },
      enabled: !isNewBookOpen && books.length > 0,
    },
    {
      keys: ["arrowup", "arrowleft", "k"],
      onTrigger: () => {
        setFocusedBookIndex((prev) => Math.max(prev - 1, 0));
      },
      enabled: !isNewBookOpen && books.length > 0,
    },
    {
      keys: "enter",
      onTrigger: () => {
        const selected = books[focusedBookIndex];
        if (selected) {
          navigate(`/book/${selected.id}`);
        }
      },
      enabled: !isNewBookOpen && books.length > 0,
    },
    ...Array.from({ length: 9 }, (_, i) => ({
      keys: String(i + 1),
      onTrigger: () => {
        if (i < books.length) {
          setFocusedBookIndex(i);
        }
      },
      enabled: !isNewBookOpen && books.length > 0,
    })),
  ]);

  const handleBookCreated = (bookId: string) => {
    navigate(`/book/${bookId}`);
  };

  if (isLoading && books.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">{t("books.loading")}</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 overflow-auto h-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <h2 className="text-xl sm:text-2xl font-semibold">{t("books.title")}</h2>
        <div className="flex items-center gap-2">
          {IS_WEB && (
            <Button
              variant="secondary"
              onClick={() => window.open(DOWNLOAD_PAGE, "_blank")}
              className="text-sm"
            >
              <Download className="w-5 h-5" />
              <span className="hidden sm:inline">{t("nav.downloadApp")}</span>
            </Button>
          )}
          <Button onClick={() => setIsNewBookOpen(true)} className="text-sm">
            <AddIcon className="w-5 h-5" />
            <span className="hidden sm:inline">{t("books.newBook")}</span>
            <span className="sm:hidden">{t("common.new")}</span>
            <KeyboardShortcut keys={["Ctrl", "N"]} className="hidden lg:inline-flex" />
          </Button>
        </div>
      </div>

      {books.length === 0 ? (
        /* Empty state */
        <div className="empty-state-enter flex flex-col items-center justify-center py-20 sm:py-28 text-center">
          <div className="w-20 h-20 mb-8 text-muted-foreground/60">
            <BookStackIcon className="w-full h-full" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-semibold mb-3 tracking-tight">
            {t("books.noBooks")}
          </h3>
          <p className="text-muted-foreground mb-8 max-w-sm leading-relaxed">
            {t("books.noBooksFull")}
          </p>
          <Button size="lg" onClick={() => setIsNewBookOpen(true)}>
            <AddIcon className="w-5 h-5" />
            {t("books.noBooksButton")}
          </Button>
        </div>
      ) : (
        /* Book grid */
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {books.map((book, index) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => navigate(`/book/${book.id}`)}
              indexHint={index < 9 ? index + 1 : undefined}
              isFocused={books[focusedBookIndex]?.id === book.id}
              index={index}
            />
          ))}
        </div>
      )}

      <NewBookDialog
        isOpen={isNewBookOpen}
        onClose={() => setIsNewBookOpen(false)}
        onSuccess={handleBookCreated}
      />
    </div>
  );
}
