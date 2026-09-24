import { useCallback, useEffect, useState } from "react";

export interface OverflowResult {
  visibleCount: number;
}

interface UseToolbarOverflowParams {
  rootRef: React.RefObject<HTMLElement>;
  endRef: React.RefObject<HTMLElement>;
  // Hidden lane holding all Start entries, laid out with the same flex gap as the visible Start lane
  measureRef: React.RefObject<HTMLElement>;
  entryCount: number; // number of Start entries to consider
  deps: unknown[]; // recompute triggers (config, locale, visibility)
}

// Absorbs floating-point noise in subpixel layout without admitting a visible overflow.
const EPSILON = 0.01;

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Width the row gives its flex items: border box minus borders and padding. */
function contentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    element.getBoundingClientRect().width -
    px(style.borderLeftWidth) -
    px(style.borderRightWidth) -
    px(style.paddingLeft) -
    px(style.paddingRight)
  );
}

/**
 * Width that the first `count` entries of the measure lane occupy, read from
 * the real layout so gaps, margins, and subpixel widths are all included.
 */
function prefixWidths(lane: HTMLElement, entryCount: number): number[] {
  const laneLeft = lane.getBoundingClientRect().left + px(getComputedStyle(lane).paddingLeft);
  const widths: number[] = [];
  for (let i = 0; i < entryCount; i++) {
    const child = lane.children[i] as HTMLElement | undefined;
    if (!child) break;
    const right = child.getBoundingClientRect().right + px(getComputedStyle(child).marginRight);
    widths.push(right - laneLeft);
  }
  return widths;
}

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
    const root = rootRef.current;
    const lane = measureRef.current;
    if (!root || !lane || root.getBoundingClientRect().width <= 0) {
      setVisibleCount(0);
      return;
    }

    const endWidth = endRef.current?.getBoundingClientRect().width ?? 0;
    // The Start lane and End lane are siblings in the row, so one column gap separates them.
    const laneGap = px(getComputedStyle(root).columnGap);
    const available = contentWidth(root) - endWidth - laneGap;

    let count = 0;
    for (const width of prefixWidths(lane, entryCount)) {
      if (width > available + EPSILON) break;
      count++;
    }
    setVisibleCount(count);
  }, [rootRef, endRef, measureRef, entryCount]);

  useEffect(() => {
    let frame = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    scheduleMeasure();

    const observer = new ResizeObserver(scheduleMeasure);
    for (const element of [rootRef.current, endRef.current, measureRef.current]) {
      if (element) observer.observe(element);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // deps are external recompute triggers, spread intentionally alongside measure
  }, [measure, ...deps]);

  return { visibleCount };
}
