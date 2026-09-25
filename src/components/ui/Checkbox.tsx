import type { RefObject } from "react";
import { Check, Minus } from "lucide-react";
import { Checkbox as AriaCheckbox } from "react-aria-components/Checkbox";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; the box renders no visible text. */
  label: string;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate = false,
  disabled = false,
  className = "",
  inputRef,
}: CheckboxProps) {
  return (
    <AriaCheckbox
      inputRef={inputRef}
      isSelected={checked}
      isIndeterminate={indeterminate}
      onChange={onChange}
      isDisabled={disabled}
      aria-label={label}
      className={({ isDisabled }) =>
        `inline-flex items-center justify-center align-middle ${
          isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } ${className}`
      }
    >
      {({ isSelected, isIndeterminate, isFocusVisible }) => {
        const filled = isSelected || isIndeterminate;
        return (
          <span
            aria-hidden="true"
            className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors pointer-coarse:size-5 ${
              filled
                ? "border-primary bg-primary text-white"
                : "border-muted-foreground bg-card"
            } ${isFocusVisible ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
          >
            {isIndeterminate ? (
              <Minus className="size-3" strokeWidth={3} />
            ) : isSelected ? (
              <Check className="size-3" strokeWidth={3} />
            ) : null}
          </span>
        );
      }}
    </AriaCheckbox>
  );
}
