import {
  forwardRef,
  useCallback,
  useRef,
  type KeyboardEventHandler,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useMove } from "react-aria";

/** One keyboard resize press moves the panel this many pixels. */
const KEYBOARD_RESIZE_STEP = 16;

export interface ResizeHandleProps {
  /** The panel edge the handle sits on. "right" for a left panel, "left" for a right panel. */
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  /** Receives the new, clamped width: a positive move widens the panel. */
  onResize: (width: number) => void;
  label: string;
  className?: string;
  /** A wrapper (e.g. Tooltip) may hand the handle its own key handling; ResizeHandle keeps it. */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  [key: `data-${string}`]: string | undefined;
}

function clamp(width: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, width));
}

/**
 * The one keyboard-operable panel resize handle. `side` names the panel edge
 * the handle sits on: a handle on a left panel's right edge widens with
 * ArrowRight, a handle on a right panel's left edge widens with ArrowLeft.
 * React Aria owns the arrow keys; the pointer drag matches the same direction.
 */
export const ResizeHandle = forwardRef<HTMLDivElement, ResizeHandleProps>(function ResizeHandle(
  { side, value, min, max, onResize, label, className, onKeyDown, ...rest },
  ref
) {
  const { t } = useTranslation();
  const isResizing = useRef(false);
  // Track the latest width in a ref so consecutive key presses between renders
  // all count, the way the hand-written handles read their store directly.
  const valueRef = useRef(value);
  valueRef.current = value;
  // A left panel's handle sits on its right edge, so a rightward move widens it.
  // A right panel's handle sits on its left edge, so the direction flips.
  const direction = side === "right" ? 1 : -1;

  // Pointer events, so a finger drags the handle as a mouse does.
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      isResizing.current = true;
      const startX = event.clientX;
      const startWidth = valueRef.current;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!isResizing.current) return;
        onResize(clamp(startWidth + direction * (moveEvent.clientX - startX), min, max));
      };

      const onPointerEnd = () => {
        isResizing.current = false;
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerEnd);
        document.removeEventListener("pointercancel", onPointerEnd);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerEnd);
      document.addEventListener("pointercancel", onPointerEnd);
    },
    [direction, min, max, onResize]
  );

  // React Aria reports ArrowLeft as deltaX -1 and ArrowRight as +1. Ignore the
  // vertical arrows it also reports.
  const { moveProps } = useMove({
    onMove: (event) => {
      if (event.deltaX === 0) return;
      const next = clamp(
        valueRef.current + direction * event.deltaX * KEYBOARD_RESIZE_STEP,
        min,
        max
      );
      valueRef.current = next;
      onResize(next);
    },
  });

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    moveProps.onKeyDown?.(event);
    onKeyDown?.(event);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window-splitter separator; <hr> cannot take focus or a value.
    <div
      {...rest}
      ref={ref}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={t("nav.sidebarWidthValue", { width: value })}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={`absolute top-0 ${
        side === "right" ? "right-0" : "left-0"
      } w-1.5 h-full cursor-col-resize touch-none hover:bg-primary/30 active:bg-primary/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        className ?? ""
      }`}
    />
  );
});
