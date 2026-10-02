import { useEffect, useRef } from "react";
import { parkInertSelection } from "@/lib/park-selection";

interface DragHandlers<Start, End> {
  onDragStart?: (event: Start) => void;
  onDragEnd?: (event: End) => void;
}

/**
 * Wraps a `useDragAndDrop` list's `onDragStart`/`onDragEnd` so a selection a
 * keyboard drag leaves in inert content is parked until the drag ends (see
 * `parkInertSelection`). React Aria makes the page inert in the frame after
 * the drag starts, so the check runs then; a pointer drag makes nothing inert
 * and leaves the selection alone.
 */
export function useParkSelectionWhileDragging<Start, End>(
  handlers: DragHandlers<Start, End> = {}
): Required<DragHandlers<Start, End>> {
  const latest = useRef(handlers);
  latest.current = handlers;
  const drag = useRef({ active: false, frame: 0, restore: null as (() => void) | null });
  const wrapped = useRef<Required<DragHandlers<Start, End>> | null>(null);
  const finish = useRef(() => {
    const current = drag.current;
    current.active = false;
    cancelAnimationFrame(current.frame);
    current.restore?.();
    current.restore = null;
  }).current;

  useEffect(() => finish, [finish]);

  if (!wrapped.current) {
    wrapped.current = {
      onDragStart: (event) => {
        finish();
        drag.current.active = true;
        // Queued after React Aria's own frame callback, which applies inert.
        queueMicrotask(() => {
          if (!drag.current.active) return;
          drag.current.frame = requestAnimationFrame(() => {
            if (drag.current.active) drag.current.restore = parkInertSelection();
          });
        });
        latest.current.onDragStart?.(event);
      },
      onDragEnd: (event) => {
        finish();
        latest.current.onDragEnd?.(event);
      },
    };
  }

  return wrapped.current;
}
