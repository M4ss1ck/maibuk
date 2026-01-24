import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBookStore } from "../features/books/store";
import { BookCard } from "../components/project/BookCard";
import { NewBookDialog } from "../components/project/NewBookDialog";
import { Button } from "../components/ui/Button";
import { useTranslation } from "react-i18next";
import { AddIcon } from "../components/icons";
import { Download } from "lucide-react";
import { IS_WEB } from "../lib/platform";
import logo from "../../src-tauri/icons/icon.png";

export function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isNewBookOpen, setIsNewBookOpen] = useState(false);

  const { books, isLoading, loadBooks } = useBookStore();

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

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
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-semibold">{t("books.title")}</h2>
        <div className="flex items-center gap-2">
          {IS_WEB && (
            <Button
              variant="secondary"
              onClick={() => window.open("https://github.com/M4ss1ck/maibuk", "_blank")}
            >
              <Download className="w-5 h-5" />
              {t("nav.downloadApp")}
            </Button>
          )}
          <Button onClick={() => setIsNewBookOpen(true)}>
            <AddIcon className="w-5 h-5" />
            {t("books.newBook")}
          </Button>
        </div>
      </div>

      {books.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-24 h-24 mb-6 flex items-center justify-center">
            <img src={logo} alt="Logo" className="w-24" />
          </div>
          <h3 className="text-xl font-medium mb-2">{t("books.noBooks")}</h3>
          <p className="text-muted-foreground mb-6 max-w-md">
            {t("books.noBooksFull")}
          </p>
          <Button size="lg" onClick={() => setIsNewBookOpen(true)}>
            {t("books.noBooksButton")}
          </Button>
        </div>
      ) : (
        /* Book grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => navigate(`/book/${book.id}`)}
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
