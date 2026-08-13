import { useTranslation } from "react-i18next";
import { GridListItem } from "react-aria-components/GridList";
import { Button as AriaButton } from "react-aria-components";
import { Archive, ArchiveRestore } from "lucide-react";
import { KeyboardShortcut } from "@/components/ui";
import { MaibukLogo } from "@/components/icons";
import type { Book } from "@/features/books/types";

interface BookCardProps {
  book: Book;
  index?: number;
  onPress: () => void;
  onArchiveToggle: () => void;
}

export function BookCard({ book, index = 0, onPress, onArchiveToggle }: BookCardProps) {
  const { t, i18n } = useTranslation();
  const isArchived = book.status === "archived";

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
    archived: "bg-status-archived-bg text-status-archived-text",
  };

  const indexHint = index < 9 ? index + 1 : undefined;

  return (
    <GridListItem
      id={book.id}
      textValue={book.title}
      onPress={onPress}
      style={{ "--delay": `${index * 60}ms` } as React.CSSProperties}
      className={({ isFocusVisible, isFocused, isHovered, isPressed }) =>
        `book-card-enter group relative flex flex-col bg-card border rounded-xl overflow-hidden transition-all duration-200 text-left w-full ${
          isFocusVisible
            ? "ring-2 ring-primary ring-offset-2"
            : isFocused
              ? "border-primary ring-1 ring-primary/30"
              : "border-border"
        } ${isHovered || isPressed ? "shadow-lg -translate-y-1" : ""}`
      }
    >
      {indexHint ? (
        <KeyboardShortcut
          shortcut={{ groups: [[String(indexHint)]], isSequence: false }}
          className="absolute left-2 top-2 z-10"
        />
      ) : null}

      <AriaButton
        aria-label={
          isArchived
            ? t("books.restoreBook", { title: book.title })
            : t("books.archiveBook", { title: book.title })
        }
        onPress={onArchiveToggle}
        className="absolute right-2 top-2 z-10 rounded-md bg-card/80 p-1.5 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {isArchived ? (
          <ArchiveRestore className="h-4 w-4" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
      </AriaButton>

      <div
        className={`aspect-2/3 bg-linear-to-br from-muted/80 via-muted/40 to-background flex items-center justify-center ${
          isArchived ? "opacity-60" : ""
        }`}
      >
        {book.coverImagePath ? (
          <img src={book.coverImagePath} alt={book.title} className="w-full h-full object-cover" />
        ) : (
          <MaibukLogo className="w-16 h-16 text-primary opacity-85" />
        )}
      </div>

      <div className="p-4">
        <h2 className="font-semibold text-lg truncate text-foreground">{book.title}</h2>
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
    </GridListItem>
  );
}
