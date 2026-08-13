import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GridListItem } from "react-aria-components/GridList";
import {
  Button,
  Dialog,
  DialogTrigger,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";
import { Archive, Check, ChevronDown, CircleCheck, Loader, PencilLine } from "lucide-react";
import { KeyboardShortcut } from "@/components/ui";
import { MaibukLogo } from "@/components/icons";
import { BOOK_STATUSES, type Book, type BookStatus } from "@/features/books/types";

interface BookCardProps {
  book: Book;
  index?: number;
  onPress: () => void;
  onStatusChange: (status: BookStatus) => void;
}

const statusIcons = {
  draft: PencilLine,
  "in-progress": Loader,
  completed: CircleCheck,
  archived: Archive,
};

export function BookCard({ book, index = 0, onPress, onStatusChange }: BookCardProps) {
  const { t, i18n } = useTranslation();
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const isArchived = book.status === "archived";
  const StatusIcon = statusIcons[book.status];

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
      // The grid row's press/focus handling otherwise closes the popover before an option renders.
      isDisabled={isStatusOpen}
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

      <DialogTrigger isOpen={isStatusOpen} onOpenChange={setIsStatusOpen}>
        <Button
          aria-label={t("books.changeStatus", { title: book.title })}
          className={`absolute right-2 top-2 z-10 inline-flex items-center gap-0.5 rounded-md bg-card/80 p-1.5 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 group-focus-within:opacity-100 ${isStatusOpen ? "opacity-100" : ""}`}
        >
          <StatusIcon className="h-4 w-4" />
          <ChevronDown className="h-3 w-3" />
        </Button>

        <Popover
          placement="bottom end"
          className="z-50 mt-1 w-44 overflow-auto rounded-lg border border-border bg-background shadow-lg focus:outline-none"
        >
          <Dialog
            aria-label={t("books.changeStatus", { title: book.title })}
            className="outline-none"
          >
            <ListBox
              autoFocus
              aria-label={t("books.changeStatus", { title: book.title })}
              items={BOOK_STATUSES.map((status) => ({
                status,
                label: t(`common.${status}`),
              }))}
              selectionMode="single"
              escapeKeyBehavior="none"
              selectedKeys={[book.status]}
              onSelectionChange={(keys) => {
                const status = [...keys][0] as BookStatus | undefined;
                if (status && status !== book.status) onStatusChange(status);
                setIsStatusOpen(false);
              }}
              className="outline-none"
            >
              {(option) => (
                <ListBoxItem
                  id={option.status}
                  textValue={option.label}
                  className="relative flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted data-selected:text-primary"
                >
                  {({ isSelected }) => (
                    <>
                      <Check
                        className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`}
                      />
                      <span
                        className={`flex-1 truncate ${isSelected ? "font-medium" : "font-normal"}`}
                      >
                        {option.label}
                      </span>
                    </>
                  )}
                </ListBoxItem>
              )}
            </ListBox>
          </Dialog>
        </Popover>
      </DialogTrigger>

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
