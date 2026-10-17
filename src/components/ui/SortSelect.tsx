import { Button, ListBox, ListBoxItem, Popover, Select } from "react-aria-components";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";

export interface SortSelectOption<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

export interface SortSelectProps<T extends string> {
  value: T;
  options: readonly SortSelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name and tooltip of the trigger, naming the current option, e.g. "Sort notes: A to Z". */
  triggerLabel: string;
  /**
   * "icon": a square button the search field's height showing only the current option's icon.
   * "labeled": the current option's icon, its label, and a chevron.
   */
  look: "icon" | "labeled";
}

const TRIGGER_BASE =
  "transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2";

const TRIGGER_LOOK: Record<SortSelectProps<string>["look"], string> = {
  icon: `inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground pointer-coarse:h-11 pointer-coarse:w-11 ${TRIGGER_BASE}`,
  labeled: `inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground ${TRIGGER_BASE}`,
};

/** A Select that shows the current option as a Sort control: an icon or a labeled button. */
export function SortSelect<T extends string>({
  value,
  options,
  onChange,
  triggerLabel,
  look,
}: SortSelectProps<T>) {
  const current = options.find((option) => option.value === value) ?? options[0];
  const CurrentIcon = current.icon;

  return (
    <Select
      aria-label={triggerLabel}
      selectedKey={value}
      onSelectionChange={(key) => {
        const option = options.find((item) => item.value === key);
        if (option && option.value !== value) onChange(option.value);
      }}
    >
      <div className="relative">
        <Tooltip content={triggerLabel}>
          <Button aria-label={triggerLabel} className={TRIGGER_LOOK[look]}>
            <CurrentIcon className="h-4 w-4 shrink-0" />
            {look === "labeled" && (
              <>
                <span className="truncate">{current.label}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </>
            )}
          </Button>
        </Tooltip>

        <Popover
          placement="bottom end"
          className="z-50 mt-1 w-52 overflow-auto rounded-lg border border-border bg-background shadow-lg focus:outline-none"
        >
          <ListBox items={options}>
            {(option) => (
              <ListBoxItem
                id={option.value}
                textValue={option.label}
                className="relative flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-sm text-foreground outline-none data-focused:bg-muted data-selected:text-primary"
              >
                {({ isSelected }) => {
                  const OptionIcon = option.icon;
                  return (
                    <>
                      <Check
                        className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`}
                      />
                      <OptionIcon className="h-4 w-4 shrink-0" />
                      <span className={`truncate ${isSelected ? "font-medium" : "font-normal"}`}>
                        {option.label}
                      </span>
                    </>
                  );
                }}
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </div>
    </Select>
  );
}
