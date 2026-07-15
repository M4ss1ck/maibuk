import { type Key, useState } from "react";
import { ComboBox as RACComboBox } from "react-aria-components";
import { Input } from "react-aria-components/Input";
import { Button } from "react-aria-components/Button";
import { Popover } from "react-aria-components/Popover";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Separator } from "react-aria-components/Separator";
import { ChevronDownIcon } from "@/components/icons";

const CUSTOM_VALUE_KEY = "__custom_value__";

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  inputClasses?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "",
  className = "",
  inputClasses = "w-17.5",
  autoFocus = false,
  ariaLabel,
}: ComboboxProps) {
  const [query, setQuery] = useState("");

  const filteredOptions =
    query === ""
      ? options
      : options.filter((option) =>
          option.toLowerCase().includes(query.toLowerCase()),
        );

  const isCustomValue = query !== "" && !options.includes(query);

  const handleSelectionChange = (newValue: Key | null) => {
    if (newValue === CUSTOM_VALUE_KEY) {
      onChange(query);
      setQuery("");
      return;
    }
    if (newValue !== null) {
      onChange(String(newValue));
      setQuery("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "NumpadEnter") && query) {
      e.preventDefault();
      e.stopPropagation();
      onChange(query);
      setQuery("");
    }
  };

  const displayValue = query !== "" ? query : value;

  return (
    <RACComboBox
      value={value}
      inputValue={displayValue}
      onInputChange={setQuery}
      onSelectionChange={handleSelectionChange}
      defaultFilter={() => true}
      aria-label={ariaLabel}
      className={`relative ${className}`}
    >
      <div className="relative">
        <Input
          className={`${inputClasses} pl-2 pr-6 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 line-clamp-1`}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onKeyDown={handleKeyDown}
        />
        <Button className="absolute inset-y-0 right-0 flex items-center pr-1.5">
          <ChevronIcon className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      <Popover
        placement="bottom start"
        className="z-50 mt-1 max-h-48 min-w-25 overflow-auto rounded-lg bg-background border border-border shadow-lg focus:outline-none"
      >
        <ListBox className="outline-none">
          {isCustomValue && (
            <ListBoxItem
              id={CUSTOM_VALUE_KEY}
              textValue={query}
              className="relative cursor-pointer select-none py-1.5 px-3 text-sm text-foreground data-focused:bg-muted data-selected:bg-primary/10 data-selected:text-primary"
            >
              {`"${query}"`}
            </ListBoxItem>
          )}
          {filteredOptions.map((option, index) =>
            option === "divider" ? (
              <Separator
                key={`divider-${index}`}
                className="my-1 border-t border-border"
              />
            ) : (
              <ListBoxItem
                key={option}
                id={option}
                textValue={option}
                className="relative cursor-pointer select-none py-1.5 px-3 text-sm text-foreground data-focused:bg-muted data-selected:bg-primary/10 data-selected:text-primary"
              >
                {option}
              </ListBoxItem>
            ),
          )}
        </ListBox>
      </Popover>
    </RACComboBox>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return <ChevronDownIcon className={className} />;
}
