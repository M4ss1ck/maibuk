import { useEffect, useRef } from "react";
import { dragStartedByKeyboard, inertEditorOutside } from "@/lib/drag-inert";
import { parkInertSelection } from "@/lib/park-selection";

interface DragHandlers<Start, End> {
  onDragStart?: (event: Start) => void;
  onDragEnd?: (event: End) => void;
  /**
   * The list being reordered. While a keyboard drag runs, the editor's outside
   * is made inert here, before React Aria hides the page (see drag-inert.ts).
   */
  shieldEditorFrom?: () => Element | null;
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
): Required<Pick<DragHandlers<Start, End>, "onDragStart" | "onDragEnd">> {
  const latest = useRef(handlers);
  latest.current = handlers;
  const drag = useRef({
    active: false,
    frame: 0,
    restore: null as (() => void) | null,
    release: null as (() => void) | null,
  });
  const wrapped = useRef<Required<
    Pick<DragHandlers<Start, End>, "onDragStart" | "onDragEnd">
  > | null>(null);
  const finish = useRef(() => {
    const current = drag.current;
    current.active = false;
    cancelAnimationFrame(current.frame);
    current.restore?.();
    current.restore = null;
    current.release?.();
    current.release = null;
  }).current;

  useEffect(() => finish, [finish]);

  if (!wrapped.current) {
    wrapped.current = {
      onDragStart: (event) => {
        finish();
        drag.current.active = true;
        // Synchronous: React Aria's session (beginDragging) queues its first
        // frame after this, so the shield is in place before it hides the page.
        // A native pointer drag starts no session and is left alone.
        const list = latest.current.shieldEditorFrom?.();
        if (list && dragStartedByKeyboard()) {
          drag.current.release = inertEditorOutside(list);
        }
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
