import type { Book } from "@/features/books/types";
import { useTranslation } from "react-i18next";
import { KeyboardShortcut } from "@/components/ui";
import { MaibukLogo } from "@/components/icons";

interface BookCardProps {
  book: Book;
  onClick: () => void;
  indexHint?: number;
  isFocused?: boolean;
  index?: number;
}

export function BookCard({
  book,
  onClick,
  indexHint,
  isFocused = false,
  index = 0,
}: BookCardProps) {
  const { t, i18n } = useTranslation();

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  const statusColors = {
    draft: "bg-status-draft-bg text-status-draft-text",
    "in-progress": "bg-status-progress-bg text-status-progress-text",
    completed: "bg-status-complete-bg text-status-complete-text",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ "--delay": `${index * 60}ms` } as React.CSSProperties}
      className={`book-card-enter relative flex flex-col bg-card border rounded-xl overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-200 text-left w-full ${isFocused ? "border-primary ring-1 ring-primary/30" : "border-border"}`}
    >
      {indexHint ? (
        <KeyboardShortcut keys={[String(indexHint)]} className="absolute left-2 top-2 z-10" />
      ) : null}

      {/* Cover */}
      <div className="aspect-2/3 bg-linear-to-br from-muted/80 via-muted/40 to-background flex items-center justify-center">
        {book.coverImagePath ? (
          <img src={book.coverImagePath} alt={book.title} className="w-full h-full object-cover" />
        ) : (
          <MaibukLogo className="w-16 h-16 text-primary opacity-85" />
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-semibold text-lg truncate text-foreground">{book.title}</h3>
        <p className="text-sm text-muted-foreground truncate">{book.authorName}</p>

        <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
          <span
            className={`text-xs px-2 py-1 rounded-full capitalize ${statusColors[book.status]}`}
          >
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
