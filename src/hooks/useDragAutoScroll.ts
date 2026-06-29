import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

const EDGE_SIZE = 48;
const MAX_SPEED = 14;

/**
 * Auto-scrolls a container while a drag pointer hovers near its top/bottom edge.
 * Reusable across native-DnD lists. Call `onDragOver(clientY)` from a dragover
 * handler and `stop()` from drop/dragend.
 */
export function useDragAutoScroll(containerRef: RefObject<HTMLElement | null>) {
  const frameRef = useRef<number | null>(null);
  const speedRef = useRef(0);
  const runningRef = useRef(false);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    speedRef.current = 0;
  }, []);

  const tick = useCallback(() => {
    // Guard against re-entrancy: a requestAnimationFrame implementation that
    // invokes its callback synchronously (e.g. in tests) would otherwise
    // recurse infinitely. Each tick scrolls at most once per call.
    if (runningRef.current) return;
    runningRef.current = true;
    frameRef.current = null;
    const el = containerRef.current;
    if (el && speedRef.current !== 0) {
      el.scrollTop += speedRef.current;
      frameRef.current = requestAnimationFrame(tick);
    }
    runningRef.current = false;
  }, [containerRef]);

  const onDragOver = useCallback(
    (clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const distTop = clientY - rect.top;
      const distBottom = rect.bottom - clientY;
      let speed = 0;
      if (distTop < EDGE_SIZE) {
        speed = -MAX_SPEED * (1 - Math.max(distTop, 0) / EDGE_SIZE);
      } else if (distBottom < EDGE_SIZE) {
        speed = MAX_SPEED * (1 - Math.max(distBottom, 0) / EDGE_SIZE);
      }
      speedRef.current = speed;
      if (speed !== 0 && frameRef.current === null) {
        frameRef.current = requestAnimationFrame(tick);
      }
    },
    [containerRef, tick]
  );

  useEffect(() => stop, [stop]);

  return { onDragOver, stop };
}
