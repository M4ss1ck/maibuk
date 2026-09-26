import { GripVertical } from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";

interface ReorderHandleProps {
  /** Accessible name of the drag button. */
  label: string;
  /** Size, spacing, hover, and visibility of the grip area. */
  className?: string;
  iconClassName?: string;
  testId?: string;
}

/**
 * The drag button of a React Aria GridList row (`slot="drag"`): Enter lifts
 * the row, arrows move it, Enter drops, Escape cancels.
 *
 * React Aria gives the button `pointer-events: none` so that a pointer drag
 * starts on the row. A touch on the grip therefore lands on what lies beneath
 * it: this wrapper, which carries `data-drag-handle` so `useTouchDragFromHandle`
 * lets a touch drag that starts on the grip through.
 */
export function ReorderHandle({
  label,
  className = "",
  iconClassName,
  testId,
}: ReorderHandleProps) {
  return (
    <span
      data-drag-handle=""
      data-testid={testId}
      className={`inline-flex shrink-0 cursor-grab rounded text-muted-foreground hover:bg-muted active:cursor-grabbing ${className}`}
    >
      <AriaButton
        slot="drag"
        aria-label={label}
        className="inline-flex rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <GripVertical className={iconClassName ?? "h-3.5 w-3.5"} aria-hidden="true" />
      </AriaButton>
    </span>
  );
}
