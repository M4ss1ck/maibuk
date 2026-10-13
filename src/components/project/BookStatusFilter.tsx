import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { BOOK_STATUSES, type BookStatus } from "@/features/books/types";

interface BookStatusFilterProps {
  value: BookStatus[];
  counts: Record<BookStatus, number>;
  onChange: (value: BookStatus[]) => void;
}

export function BookStatusFilter({ value, counts, onChange }: BookStatusFilterProps) {
  const { t } = useTranslation();

  const options = useMemo(
    () => BOOK_STATUSES.map((status) => ({ id: status, label: t(`common.${status}`) })),
    [t]
  );

  return (
    <MultiSelectFilter
      label={t("books.filterByStatus")}
      options={options}
      value={value}
      counts={counts}
      onChange={onChange}
      allLabel={t("books.allStatuses")}
      countLabel={(count) => t("books.statusCount", { count })}
      tutorialAnchor="books.status"
    />
  );
}
