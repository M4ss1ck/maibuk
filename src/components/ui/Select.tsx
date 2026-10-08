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
  /**
   * The option's accessible name when it must differ from the visible label,
   * such as a language code shown as "en" but named "English".
   */
  accessibleName?: string;
}

interface SelectProps<T> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  endAdornment?: ReactNode;
  minWidth?: "default" | "none";
  className?: string;
  /** Classes for the trigger button, such as a fixed width or a larger touch target. */
  triggerClassName?: string;
  id?: string;
  ariaLabel?: string;
  /**
   * "chip" is a narrow stacked trigger (the value over a small chevron), the
   * size of the editor toolbar's language button; its list keeps a readable
   * width instead of matching the trigger.
   */
  variant?: "default" | "chip";
}

/**
 * The trigger's classes, shared with a static look-alike (a preview of a
 * control in Settings) so it is drawn at the real size.
 */
export function selectTriggerClassName({
  variant = "default",
  minWidth = "default",
  triggerClassName = "",
}: Pick<SelectProps<string>, "variant" | "minWidth" | "triggerClassName">): string {
  const minWidthClass = minWidth === "default" && variant === "default" ? "min-w-35" : "";
  return `${
    variant === "chip"
      ? "flex flex-col items-center justify-center gap-0 rounded text-[10px] font-medium leading-none text-foreground hover:bg-muted/20 data-pressed:bg-muted/20"
      : `relative flex w-full ${minWidthClass} items-center gap-1 px-3 py-1.5 pr-8 text-sm text-left border border-border rounded-lg bg-background text-foreground`
  } cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${triggerClassName}`;
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  endAdornment,
  minWidth = "default",
  className = "",
  triggerClassName = "",
  id,
  ariaLabel,
  variant = "default",
}: SelectProps<T>) {
  const chip = variant === "chip";

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
      <Button className={selectTriggerClassName({ variant, minWidth, triggerClassName })}>
        <SelectValue>
          {({ selectedItem, selectedText, isPlaceholder }) => {
            const selected = selectedItem as SelectOption<T> | null;
            if (selected?.accessibleName) {
              return (
                <span className={chip ? "" : "min-w-0 flex-1 truncate"}>
                  <span aria-hidden="true">{selected.label}</span>
                  <span className="sr-only">{selected.accessibleName}</span>
                </span>
              );
            }
            return (
              <span className="min-w-0 flex-1 truncate">{isPlaceholder ? "" : selectedText}</span>
            );
          }}
        </SelectValue>
        {endAdornment && <span className="shrink-0 text-muted-foreground">{endAdornment}</span>}
        {chip ? (
          <ChevronIcon className="h-2.5 w-2.5" />
        ) : (
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronIcon className="h-4 w-4 text-muted-foreground" />
          </span>
        )}
      </Button>

      <Popover
        placement="bottom end"
        className={`z-50 max-h-60 ${chip ? "min-w-32" : "w-(--trigger-width)"} overflow-auto rounded-lg bg-background border border-border shadow-lg focus:outline-none`}
      >
        <ListBox items={options} className="outline-none">
          {(option) => (
            <ListBoxItem
              id={option.value as SelectKey}
              textValue={option.accessibleName ?? option.label}
              aria-label={option.accessibleName}
              className="relative cursor-pointer select-none py-1.5 px-3 text-sm text-foreground data-focused:bg-muted data-selected:bg-primary/10 data-selected:text-primary"
            >
              {({ isSelected }) => (
                <span className={`block truncate ${isSelected ? "font-medium" : "font-normal"}`}>
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
