import { Select as RACSelect, SelectValue } from "react-aria-components";
import { Button } from "react-aria-components/Button";
import { Popover } from "react-aria-components/Popover";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import type { ReactNode } from "react";
import { ChevronIcon } from "@/components/icons";

type SelectKey = string | number;

interface SelectOption<T> {
  value: T;
  label: string;
}

interface SelectProps<T> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  endAdornment?: ReactNode;
  minWidth?: "default" | "none";
  className?: string;
  id?: string;
  ariaLabel?: string;
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  endAdornment,
  minWidth = "default",
  className = "",
  id,
  ariaLabel,
}: SelectProps<T>) {
  const minWidthClass = minWidth === "default" ? "min-w-35" : "";

  return (
    <RACSelect
      selectedKey={value as SelectKey}
      onSelectionChange={(key) => {
        if (key !== null) onChange(key as T);
      }}
      className={`relative ${className}`}
      id={id}
      aria-label={ariaLabel}
    >
      <Button
        className={`relative flex w-full ${minWidthClass} items-center gap-1 px-3 py-1.5 pr-8 text-sm text-left border border-border rounded-lg bg-background text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1`}
      >
        <SelectValue>
          {({ selectedText, isPlaceholder }) => (
            <span className="min-w-0 flex-1 truncate">
              {isPlaceholder ? "" : selectedText}
            </span>
          )}
        </SelectValue>
        {endAdornment && (
          <span className="shrink-0 text-muted-foreground">
            {endAdornment}
          </span>
        )}
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <ChevronIcon className="h-4 w-4 text-muted-foreground" />
        </span>
      </Button>

      <Popover
        placement="bottom end"
        className="z-50 max-h-60 w-(--trigger-width) overflow-auto rounded-lg bg-background border border-border shadow-lg focus:outline-none"
      >
        <ListBox items={options} className="outline-none">
          {(option) => (
            <ListBoxItem
              id={option.value as SelectKey}
              textValue={option.label}
              className="relative cursor-pointer select-none py-1.5 px-3 text-sm text-foreground data-focused:bg-muted data-selected:bg-primary/10 data-selected:text-primary"
            >
              {({ isSelected }) => (
                <span
                  className={`block truncate ${isSelected ? "font-medium" : "font-normal"}`}
                >
                  {option.label}
                </span>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </RACSelect>
  );
}
