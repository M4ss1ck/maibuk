import { useMemo } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ListFilter } from "lucide-react";
import { BOOK_STATUSES, type BookStatus } from "@/features/books/types";

interface BookStatusFilterProps {
  value: BookStatus[];
  counts: Record<BookStatus, number>;
  onChange: (value: BookStatus[]) => void;
}

export function BookStatusFilter({ value, counts, onChange }: BookStatusFilterProps) {
  const { t } = useTranslation();

  const options = useMemo(
    () => BOOK_STATUSES.map((status) => ({ status, label: t(`common.${status}`) })),
    [t]
  );

  const triggerLabel =
    value.length === BOOK_STATUSES.length
      ? t("books.allStatuses")
      : value.length === 1
        ? t(`common.${value[0]}`)
        : t("books.statusCount", { count: value.length });

  return (
    <DialogTrigger>
      <Button
        aria-label={t("books.filterByStatus")}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        <ListFilter className="h-4 w-4 shrink-0" />
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Button>

      <Popover
        placement="bottom end"
        className="z-50 mt-1 w-56 overflow-auto rounded-lg border border-border bg-background shadow-lg focus:outline-none"
      >
        <Dialog aria-label={t("books.filterByStatus")} className="outline-none">
          <ListBox
            autoFocus
            aria-label={t("books.filterByStatus")}
            items={options}
            selectionMode="multiple"
            // Without this the listbox swallows Escape to clear its selection,
            // so the popover never closes and the filter is silently wiped.
            escapeKeyBehavior="none"
            selectedKeys={value}
            onSelectionChange={(keys) =>
              onChange(BOOK_STATUSES.filter((status) => (keys as Set<BookStatus>).has(status)))
            }
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
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {counts[option.status]}
                    </span>
                  </>
                )}
              </ListBoxItem>
            )}
          </ListBox>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
