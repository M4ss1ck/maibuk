import {
  Button,
  Dialog,
  DialogTrigger,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";
import { Check, ChevronDown, ListFilter } from "lucide-react";

export interface MultiSelectFilterOption<T extends string> {
  id: T;
  label: string;
}

export interface MultiSelectFilterProps<T extends string> {
  /** The control's accessible name, localized by the caller. */
  label: string;
  options: readonly MultiSelectFilterOption<T>[];
  value: readonly T[];
  counts: Record<T, number>;
  onChange: (value: T[]) => void;
  /** The trigger's visible summary when every option is selected; defaults to `label`. */
  allLabel?: string;
  /** The trigger's visible summary for a partial selection of more than one option. */
  countLabel?: (count: number) => string;
  /** `data-tutorial` anchor on the trigger. */
  tutorialAnchor?: string;
  className?: string;
}

const TRIGGER_CLASS =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2";

export function MultiSelectFilter<T extends string>({
  label,
  options,
  value,
  counts,
  onChange,
  allLabel = label,
  countLabel,
  tutorialAnchor,
  className,
}: MultiSelectFilterProps<T>) {
  const selectedLabel =
    value.length === 1 ? options.find((option) => option.id === value[0])?.label : undefined;

  const triggerLabel =
    value.length === options.length
      ? allLabel
      : (selectedLabel ?? countLabel?.(value.length) ?? label);

  return (
    <DialogTrigger>
      <Button
        aria-label={label}
        data-tutorial={tutorialAnchor}
        className={className ? `${TRIGGER_CLASS} ${className}` : TRIGGER_CLASS}
      >
        <ListFilter className="h-4 w-4 shrink-0" />
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Button>

      <Popover
        placement="bottom end"
        className="z-50 mt-1 w-56 overflow-auto rounded-lg border border-border bg-background shadow-lg focus:outline-none"
      >
        <Dialog aria-label={label} className="outline-none">
          <ListBox
            autoFocus
            aria-label={label}
            items={options}
            selectionMode="multiple"
            // Without this the listbox swallows Escape to clear its selection,
            // so the popover never closes and the filter is silently wiped.
            escapeKeyBehavior="none"
            selectedKeys={value}
            onSelectionChange={(keys) =>
              onChange(options.filter((option) => (keys as Set<T>).has(option.id)).map((o) => o.id))
            }
            className="outline-none"
          >
            {(option) => (
              <ListBoxItem
                id={option.id}
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
                      {counts[option.id]}
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
