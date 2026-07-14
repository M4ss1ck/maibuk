import { InputHTMLAttributes, ReactNode, forwardRef, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  endAdornment?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, error, endAdornment, id, type, disabled, readOnly, ...props }, ref) => {
    const { t } = useTranslation();
    const inputId = id || props.name;
    const inputRef = useRef<HTMLInputElement | null>(null);
    const showNumberControls = type === "number" && !endAdornment;

    const setInputRef = (node: HTMLInputElement | null) => {
      inputRef.current = node;

      if (typeof ref === "function") {
        ref(node);
        return;
      }

      if (ref) {
        ref.current = node;
      }
    };

    const stepValue = (direction: "up" | "down") => {
      const input = inputRef.current;
      if (!input || disabled || readOnly) return;

      input.focus();
      try {
        if (direction === "up") {
          input.stepUp();
        } else {
          input.stepDown();
        }
      } catch {
        const currentValue = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
        const min = input.min === "" ? -Infinity : Number(input.min);
        const max = input.max === "" ? Infinity : Number(input.max);
        const nextValue = direction === "up" ? currentValue + 1 : currentValue - 1;
        const boundedValue = Math.min(Math.max(nextValue, min), max);
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;

        valueSetter?.call(input, String(boundedValue));
      }

      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={setInputRef}
            id={inputId}
            type={type}
            disabled={disabled}
            readOnly={readOnly}
            className={`w-full px-3 py-2 border rounded-lg bg-background text-foreground transition-colors
            ${
              error
                ? "border-destructive focus:ring-destructive"
                : "border-border focus:border-primary focus:ring-primary"
            }
            focus:outline-none focus:ring-2 focus:ring-offset-0
            placeholder:text-muted-foreground
            ${endAdornment ? "pr-10" : ""}
            ${
              showNumberControls
                ? "pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                : ""
            }
            ${className}`}
            {...props}
          />
          {showNumberControls && (
            <div className="absolute inset-y-1 right-1 flex w-6 flex-col overflow-hidden rounded-md border border-border bg-card">
              <button
                type="button"
                aria-label={t("common.increaseValue")}
                disabled={disabled || readOnly}
                onClick={() => stepValue("up")}
                className="flex h-1/2 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:bg-muted focus:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("common.decreaseValue")}
                disabled={disabled || readOnly}
                onClick={() => stepValue("down")}
                className="flex h-1/2 items-center justify-center border-t border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:bg-muted focus:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          )}
          {endAdornment && (
            <div className="absolute inset-y-0 right-2 flex items-center">{endAdornment}</div>
          )}
        </div>
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
