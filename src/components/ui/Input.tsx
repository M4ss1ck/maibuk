import { InputHTMLAttributes, ReactNode, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  endAdornment?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, error, endAdornment, id, ...props }, ref) => {
    const inputId = id || props.name;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            className={`w-full px-3 py-2 border rounded-lg bg-background text-foreground transition-colors
            ${
              error
                ? "border-destructive focus:ring-destructive"
                : "border-border focus:border-primary focus:ring-primary"
            }
            focus:outline-none focus:ring-2 focus:ring-offset-0
            placeholder:text-muted-foreground
            ${endAdornment ? "pr-10" : ""}
            ${className}`}
            {...props}
          />
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
