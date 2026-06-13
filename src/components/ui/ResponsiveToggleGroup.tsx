import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface ResponsiveToggleOption<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
  labelTestId: string;
}

interface ResponsiveToggleGroupProps<T extends string> {
  value: T;
  options: ResponsiveToggleOption<T>[];
  onChange: (value: T) => void;
  testId: string;
  className?: string;
}

const toggleButtonBaseClass =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors";

function ToggleButton<T extends string>({
  option,
  isActive,
  onClick,
  showLabel,
  measureOnly = false,
}: {
  option: ResponsiveToggleOption<T>;
  isActive: boolean;
  onClick: () => void;
  showLabel: boolean;
  measureOnly?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      aria-label={option.label}
      tabIndex={measureOnly ? -1 : undefined}
      className={`${toggleButtonBaseClass} ${isActive
        ? "bg-primary text-white"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
    >
      {option.icon}
      <span
        data-testid={measureOnly ? undefined : option.labelTestId}
        className={showLabel ? undefined : "sr-only"}
      >
        {option.label}
      </span>
    </button>
  );
}

export function ResponsiveToggleGroup<T extends string>({
  value,
  options,
  onChange,
  testId,
  className = "",
}: ResponsiveToggleGroupProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [showLabels, setShowLabels] = useState(true);

  const updateLabelMode = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;

    if (!container || !measure) return;

    const availableWidth = container.clientWidth;
    const requiredWidth = measure.scrollWidth;

    if (availableWidth <= 0 || requiredWidth <= 0) {
      setShowLabels(true);
      return;
    }

    setShowLabels((current) => {
      const next = requiredWidth <= availableWidth;
      return current === next ? current : next;
    });
  }, []);

  useLayoutEffect(() => {
    updateLabelMode();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateLabelMode);
      return () => window.removeEventListener("resize", updateLabelMode);
    }

    const observer = new ResizeObserver(updateLabelMode);
    if (containerRef.current) observer.observe(containerRef.current);
    if (measureRef.current) observer.observe(measureRef.current);
    window.addEventListener("resize", updateLabelMode);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateLabelMode);
    };
  }, [options, updateLabelMode]);

  return (
    <div
      ref={containerRef}
      data-testid={`${testId}-toggle-group`}
      data-label-mode={showLabels ? "full" : "icon"}
      className={`relative min-w-0 overflow-hidden ${className}`}
    >
      <div className="inline-flex max-w-full rounded-lg bg-muted/60 p-0.5">
        {options.map((option) => (
          <ToggleButton
            key={option.value}
            option={option}
            isActive={value === option.value}
            onClick={() => onChange(option.value)}
            showLabel={showLabels}
          />
        ))}
      </div>
      <div
        ref={measureRef}
        data-testid={`${testId}-toggle-measure`}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 flex w-max rounded-lg bg-muted/60 p-0.5"
      >
        {options.map((option) => (
          <ToggleButton
            key={option.value}
            option={option}
            isActive={value === option.value}
            onClick={() => {}}
            showLabel
            measureOnly
          />
        ))}
      </div>
    </div>
  );
}
