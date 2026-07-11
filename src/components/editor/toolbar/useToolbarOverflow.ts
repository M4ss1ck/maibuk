import { useCallback, useEffect, useState } from "react";

export interface OverflowResult {
  visibleCount: number;
}

interface UseToolbarOverflowParams {
  rootRef: React.RefObject<HTMLElement>;
  endRef: React.RefObject<HTMLElement>;
  measureRef: React.RefObject<HTMLElement>; // hidden container holding all Start entries
  entryCount: number; // number of Start entries to consider
  deps: unknown[]; // recompute triggers (config, locale, visibility)
}

/** Gap between adjacent entries and reserved edge padding, in pixels. */
const GAP = 8;
const PADDING = 8;

/**
 * Measures how many Start entries fit alongside the End group within the
 * toolbar's available width, recomputing on resize and on `deps` changes.
 */
export function useToolbarOverflow({
  rootRef,
  endRef,
  measureRef,
  entryCount,
  deps,
}: UseToolbarOverflowParams): OverflowResult {
  const [visibleCount, setVisibleCount] = useState(0);

  const measure = useCallback(() => {
    const rootWidth = rootRef.current?.getBoundingClientRect().width ?? 0;
    if (rootWidth <= 0) {
      setVisibleCount(0);
      return;
    }

    const endWidth = endRef.current?.getBoundingClientRect().width ?? 0;
    const available = rootWidth - endWidth - PADDING;
    const children = measureRef.current?.children;

    let used = 0;
    let count = 0;
    for (let i = 0; i < entryCount; i++) {
      const child = children?.[i] as HTMLElement | undefined;
      const width = child?.offsetWidth ?? 0;
      const next = used + (count > 0 ? GAP : 0) + width;
      if (next > available) break;
      used = next;
      count++;
    }
    setVisibleCount(count);
  }, [rootRef, endRef, measureRef, entryCount]);

  useEffect(() => {
    const scheduleMeasure = () => requestAnimationFrame(measure);
    scheduleMeasure();

    const observer = new ResizeObserver(scheduleMeasure);
    const root = rootRef.current;
    const end = endRef.current;
    if (root) observer.observe(root);
    if (end) observer.observe(end);

    return () => observer.disconnect();
    // deps are external recompute triggers, spread intentionally alongside measure
  }, [measure, ...deps]);

  return { visibleCount };
}
