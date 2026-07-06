import type { CSSProperties, ForwardedRef, KeyboardEvent } from "react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";

interface MultiSelectComboboxProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
  placeholder?: string;
  allowCustom?: boolean;
  customOptionLabel?: (value: string) => string;
  removeLabel?: (value: string) => string;
  closeOnOptionClick?: boolean;
  closeOnCreate?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  chipClassName?: string;
  getChipStyle?: (value: string) => CSSProperties;
  autoFocus?: boolean;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const key = normalize(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }

  return next;
}

export const MultiSelectCombobox = forwardRef<HTMLInputElement, MultiSelectComboboxProps>(
  function MultiSelectCombobox(
    {
      value,
      onChange,
      options,
      placeholder = "",
      allowCustom = false,
      customOptionLabel = (item) => `"${item}"`,
      removeLabel = (item) => `Remove ${item}`,
      closeOnOptionClick = true,
      closeOnCreate = true,
      onOpenChange,
      className = "",
      chipClassName = "",
      getChipStyle,
      autoFocus = false,
    },
    forwardedRef
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selected = new Set(value.map(normalize));
    const trimmedQuery = query.trim();
    const filteredOptions = options.filter((option) =>
      option.toLowerCase().includes(trimmedQuery.toLowerCase())
    );
    const showCustomOption =
      allowCustom &&
      trimmedQuery.length > 0 &&
      !options.some((option) => normalize(option) === normalize(trimmedQuery)) &&
      !selected.has(normalize(trimmedQuery));

    const setOpen = (open: boolean) => {
      setIsOpen(open);
      onOpenChange?.(open);
    };

    const setInputRef = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        assignForwardedRef(forwardedRef, node);
      },
      [forwardedRef]
    );

    useEffect(() => {
      if (autoFocus) {
        inputRef.current?.focus();
        setOpen(true);
      }
    }, [autoFocus]);

    useEffect(() => {
      if (!isOpen) return;

      const handlePointerDown = (event: PointerEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) {
          setOpen(false);
          setQuery("");
        }
      };

      document.addEventListener("pointerdown", handlePointerDown);
      return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [isOpen]);

    const commitValue = (nextValue: string) => {
      const trimmed = nextValue.trim();
      if (!trimmed) return;

      const key = normalize(trimmed);
      if (selected.has(key)) {
        onChange(value.filter((item) => normalize(item) !== key));
        return;
      }

      onChange(uniqueValues([...value, trimmed]));
    };

    const createCustomValue = (shouldClose = closeOnCreate) => {
      if (!allowCustom || !trimmedQuery || selected.has(normalize(trimmedQuery))) return;
      onChange(uniqueValues([...value, trimmedQuery]));
      setQuery("");
      if (shouldClose) setOpen(false);
    };

    const removeValue = (item: string) => {
      const key = normalize(item);
      onChange(value.filter((selectedItem) => normalize(selectedItem) !== key));
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
        return;
      }

      if ((event.key === "Enter" || event.code === "NumpadEnter") && trimmedQuery) {
        event.preventDefault();
        createCustomValue();
      }
    };

    return (
      <div ref={rootRef} className={`relative ${className}`}>
        <div
          onMouseDown={(event) => {
            if (event.target instanceof HTMLElement && event.target.closest("button,input")) {
              return;
            }
            event.preventDefault();
            setOpen(true);
            inputRef.current?.focus();
          }}
          className="flex min-h-9 w-full cursor-text flex-wrap items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
        >
          {value.map((item) => (
            <span
              key={item}
              className={`inline-flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground ${chipClassName}`}
              style={getChipStyle?.(item)}
            >
              <span className="truncate">{item}</span>
              <Tooltip content={removeLabel(item)}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeValue(item);
                  }}
                  className="rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  aria-label={removeLabel(item)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Tooltip>
            </span>
          ))}
          <input
            ref={setInputRef}
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ""}
            className="min-w-24 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(!isOpen);
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-expanded={isOpen}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        {isOpen && (filteredOptions.length > 0 || showCustomOption) && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg">
            {showCustomOption && (
              <OptionRow
                label={customOptionLabel(trimmedQuery)}
                checked={false}
                onCheckboxChange={() => createCustomValue(false)}
                onItemClick={() => createCustomValue(true)}
              />
            )}
            {filteredOptions.map((option) => {
              const checked = selected.has(normalize(option));

              return (
                <OptionRow
                  key={option}
                  label={option}
                  checked={checked}
                  onCheckboxChange={() => commitValue(option)}
                  onItemClick={() => {
                    commitValue(option);
                    setQuery("");
                    if (closeOnOptionClick) setOpen(false);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }
);

MultiSelectCombobox.displayName = "MultiSelectCombobox";

function assignForwardedRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

interface OptionRowProps {
  label: string;
  checked: boolean;
  onCheckboxChange: () => void;
  onItemClick: () => void;
}

function OptionRow({ label, checked, onCheckboxChange, onItemClick }: OptionRowProps) {
  return (
    <div className="flex items-center rounded-md hover:bg-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={onCheckboxChange}
        onClick={(event) => event.stopPropagation()}
        className="ml-2 h-4 w-4 rounded border-border accent-primary"
        aria-label={label}
      />
      <button
        type="button"
        onClick={onItemClick}
        className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm text-foreground"
      >
        <span className="block truncate">{label}</span>
      </button>
    </div>
  );
}
