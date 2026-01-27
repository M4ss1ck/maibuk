import { useState } from "react";
import {
  Combobox as HeadlessCombobox,
  ComboboxInput,
  ComboboxButton,
  ComboboxOptions,
  ComboboxOption,
} from "@headlessui/react";
import { ChevronDownIcon } from "../icons";

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  inputClasses?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "",
  className = "",
  inputClasses = "w-17.5",
}: ComboboxProps) {
  const [query, setQuery] = useState("");

  const filteredOptions =
    query === ""
      ? options
      : options.filter((option) =>
        option.toLowerCase().includes(query.toLowerCase())
      );

  // Check if query is a valid custom value (not in options)
  const isCustomValue = query !== "" && !options.includes(query);

  const handleChange = (newValue: string | null) => {
    if (newValue !== null) {
      onChange(newValue);
      setQuery("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && query) {
      e.preventDefault();
      onChange(query);
      setQuery("");
    }
  };

  return (
    <HeadlessCombobox value={value} onChange={handleChange} onClose={() => setQuery("")}>
      <div className={`relative ${className}`}>
        <div className="relative">
          <ComboboxInput
            className={`${inputClasses} pl-2 pr-6 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 line-clamp-1`}
            displayValue={(val: string) => val}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
          />
          <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-1.5">
            <ChevronIcon className="h-4 w-4 text-muted-foreground" />
          </ComboboxButton>
        </div>

        <ComboboxOptions
          anchor="bottom start"
          className="absolute z-50 mt-1 max-h-48 min-w-25 overflow-auto rounded-lg bg-background border border-border shadow-lg focus:outline-none"
        >
          {isCustomValue && (
            <ComboboxOption
              value={query}
              className="relative cursor-pointer select-none py-1.5 px-3 text-sm text-foreground data-focus:bg-muted data-selected:bg-primary/10 data-selected:text-primary"
            >
              "{query}"
            </ComboboxOption>
          )}
          {filteredOptions.map((option, i) => {
            if (option === "divider") {
              return (
                <hr
                  key={option + i}
                  className="my-1 border-t border-border"
                />
              );
            }
            return (
              <ComboboxOption
                key={option}
                value={option}
                className="relative cursor-pointer select-none py-1.5 px-3 text-sm text-foreground data-focus:bg-muted data-selected:bg-primary/10 data-selected:text-primary"
              >
                {option}
              </ComboboxOption>
            )
          })}
        </ComboboxOptions>
      </div>
    </HeadlessCombobox>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return <ChevronDownIcon className={className} />;
}
