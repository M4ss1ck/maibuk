import type { CSSProperties, ForwardedRef, KeyboardEvent } from "react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  /** The control's accessible name, when no visible `<label>` points at it. */
  ariaLabel?: string;
  /** The input's id, so a visible `<label htmlFor>` can name it. */
  id?: string;
  /** Disables the field: it is not focusable and keyboard cannot change it. */
  isDisabled?: boolean;
  /** Ids of the elements describing the field, for `aria-describedby`. */
  ariaDescribedBy?: string;
  /** Marks the field invalid, for `aria-invalid`. */
  isInvalid?: boolean;
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
      ariaLabel,
      id,
      isDisabled = false,
      ariaDescribedBy,
      isInvalid = false,
    },
    forwardedRef
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    // Escape in the list hands focus back to the input, whose focus would
    // otherwise reopen the list it just closed.
    const keepClosedOnFocusRef = useRef(false);
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
      if (isDisabled) return;
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
      if (autoFocus && !isDisabled) {
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
      if (isDisabled) return;
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
      if (isDisabled || !allowCustom || !trimmedQuery || selected.has(normalize(trimmedQuery)))
        return;
      onChange(uniqueValues([...value, trimmedQuery]));
      setQuery("");
      if (shouldClose) setOpen(false);
    };

    const removeValue = (item: string) => {
      if (isDisabled) return;
      const key = normalize(item);
      onChange(value.filter((selectedItem) => normalize(selectedItem) !== key));
    };

    const closeList = () => {
      setOpen(false);
      setQuery("");
    };

    const focusOption = (from: Element | null, step: 1 | -1) => {
      const boxes = [
        ...(listRef.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? []),
      ];
      const index = from ? boxes.indexOf(from as HTMLInputElement) : -1;
      boxes[Math.min(Math.max(index + step, 0), boxes.length - 1)]?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (isDisabled) return;
      // An open list is the innermost layer: Escape closes it alone, so a
      // Dialog or Popover around the field stays open for a second Escape.
      if (event.key === "Escape") {
        if (!isOpen && !query) return;
        event.stopPropagation();
        closeList();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        flushSync(() => setOpen(true));
        focusOption(null, 1);
        return;
      }

      if ((event.key === "Enter" || event.code === "NumpadEnter") && trimmedQuery) {
        event.preventDefault();
        createCustomValue();
      }
    };

    return (
      <div
        ref={rootRef}
        className={`relative ${className} ${isDisabled ? "opacity-50" : ""}`}
        aria-disabled={isDisabled || undefined}
        // Tabbing past the list closes it, so it never covers the next field.
        // A pointer press has no relatedTarget and is left to the pointerdown
        // listener, which knows whether it landed inside.
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!isOpen || !next || rootRef.current?.contains(next as Node)) return;
          setOpen(false);
          setQuery("");
        }}
      >
        <div
          onMouseDown={(event) => {
            if (isDisabled) return;
            if (event.target instanceof HTMLElement && event.target.closest("button,input")) {
              return;
            }
            event.preventDefault();
            setOpen(true);
            inputRef.current?.focus();
          }}
          className={`flex min-h-9 w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${isDisabled ? "cursor-not-allowed" : "cursor-text"}`}
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
                  disabled={isDisabled}
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
            id={id}
            type="text"
            role="combobox"
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            aria-invalid={isInvalid || undefined}
            aria-expanded={isOpen}
            disabled={isDisabled}
            value={query}
            onFocus={() => {
              if (keepClosedOnFocusRef.current) {
                keepClosedOnFocusRef.current = false;
                return;
              }
              setOpen(true);
            }}
            onChange={(event) => {
              if (isDisabled) return;
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ""}
            className="min-w-24 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(!isOpen);
              inputRef.current?.focus();
            }}
            disabled={isDisabled}
            // A pointer affordance: the keyboard opens the list from the input.
            tabIndex={-1}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
            aria-expanded={isOpen}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        {isOpen && (filteredOptions.length > 0 || showCustomOption) && (
          <div
            ref={listRef}
            // The list walks its own options; the app's arrow navigation
            // would otherwise move focus to the next region.
            data-owns-arrows
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                focusOption(document.activeElement, event.key === "ArrowDown" ? 1 : -1);
              } else if (event.key === "Escape") {
                event.stopPropagation();
                closeList();
                keepClosedOnFocusRef.current = true;
                inputRef.current?.focus();
              }
            }}
            className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg"
          >
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
    <div className="flex items-center rounded-md hover:bg-muted focus-within:bg-muted">
      {/* Out of the tab order: ArrowDown reaches the options, so Tab leaves the
          field and its list closes behind it. */}
      <input
        type="checkbox"
        tabIndex={-1}
        checked={checked}
        onChange={onCheckboxChange}
        onClick={(event) => event.stopPropagation()}
        className="ml-2 h-4 w-4 rounded border-border accent-primary"
        aria-label={label}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={onItemClick}
        className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm text-foreground"
      >
        <span className="block truncate">{label}</span>
      </button>
    </div>
  );
}
