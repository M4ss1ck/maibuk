import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Check, ChevronDown } from "lucide-react";
import type { NotesSortOption } from "./notes-list-model";

interface NotesSortMenuProps {
  value: NotesSortOption;
  onChange: (value: NotesSortOption) => void;
}

export function NotesSortMenu({ value, onChange }: NotesSortMenuProps) {
  const { t } = useTranslation();

  const options = useMemo(
    () => [
      { value: "date-desc" as const, label: t("notes.sortDateNewest") },
      { value: "date-asc" as const, label: t("notes.sortDateOldest") },
      { value: "title-asc" as const, label: t("notes.sortTitleAsc") },
      { value: "title-desc" as const, label: t("notes.sortTitleDesc") },
    ],
    [t],
  );

  const activeLabel =
    options.find((option) => option.value === value)?.label ?? options[0].label;

  return (
    <Listbox value={value} onChange={onChange}>
      <div className="relative">
        <ListboxButton
          aria-label={t("notes.sortBy")}
          title={t("notes.sortBy")}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          <ArrowUpDown className="h-4 w-4 shrink-0" />
          <span className="truncate">{activeLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </ListboxButton>

        <ListboxOptions
          anchor="bottom end"
          className="z-50 mt-1 w-52 overflow-auto rounded-lg border border-border bg-background shadow-lg focus:outline-none"
        >
          {options.map((option) => (
            <ListboxOption
              key={option.value}
              value={option.value}
              className="relative flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-sm text-foreground data-focus:bg-muted data-selected:text-primary"
            >
              {({ selected }) => (
                <>
                  <Check
                    className={`h-3.5 w-3.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className={`truncate ${selected ? "font-medium" : "font-normal"}`}>
                    {option.label}
                  </span>
                </>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
