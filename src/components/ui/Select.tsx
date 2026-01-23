import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { ChevronIcon } from "../icons";

interface SelectOption<T> {
  value: T;
  label: string;
}

interface SelectProps<T> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  className?: string;
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  className = "",
}: SelectProps<T>) {
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <Listbox value={value} onChange={onChange}>
      <div className={`relative ${className}`}>
        <ListboxButton className="relative w-full min-w-35 px-3 py-1.5 text-sm text-left border border-border rounded-lg bg-background text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1">
          <span className="block truncate">{selectedOption?.label}</span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronIcon className="h-4 w-4 text-muted-foreground" />
          </span>
        </ListboxButton>

        <ListboxOptions
          anchor="bottom end"
          className="absolute z-50 mt-1 max-h-60 w-(--button-width) overflow-auto rounded-lg bg-background border border-border shadow-lg focus:outline-none"
        >
          {options.map((option) => (
            <ListboxOption
              key={String(option.value)}
              value={option.value}
              className="relative cursor-pointer select-none py-1.5 px-3 text-sm text-foreground data-focus:bg-muted data-selected:bg-primary/10 data-selected:text-primary"
            >
              {({ selected }) => (
                <span className={`block truncate ${selected ? "font-medium" : "font-normal"}`}>
                  {option.label}
                </span>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
