import type { Book } from "../../features/books/types";
import { useTranslation } from "react-i18next";
import { BookStackIcon } from "../icons";

interface BookCardProps {
  book: Book;
  onClick: () => void;
}

export function BookCard({ book, onClick }: BookCardProps) {
  const { t, i18n } = useTranslation();

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  const statusColors = {
    draft: "bg-muted text-muted-foreground",
    "in-progress": "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    completed: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  };

  return (
    <button
      onClick={onClick}
      className="flex flex-col bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow text-left w-full"
    >
      {/* Cover placeholder */}
      <div className="aspect-2/3 bg-linear-to-br from-muted to-muted/50 flex items-center justify-center">
        {book.coverImagePath ? (
          <img
            src={book.coverImagePath}
            alt={book.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <BookStackIcon className="w-16 h-16 text-muted-foreground" />
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-semibold text-lg truncate text-foreground">{book.title}</h3>
        <p className="text-sm text-muted-foreground truncate">{book.authorName}</p>

        <div className="flex items-center justify-between mt-3">
          <span className={`text-xs px-2 py-1 rounded-full capitalize ${statusColors[book.status]}`}>
            {t(`common.${book.status}`)}
          </span>
          <span className="text-xs text-muted-foreground">
            {book.wordCount.toLocaleString()} {t("common.words")}
          </span>
        </div>

        <p className="text-xs text-muted-foreground mt-2">
          {t("books.updated")} {formatDate(book.updatedAt)}
        </p>
      </div>
    </button>
  );
}
