import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { OUTLINE_EASING, OUTLINE_MOTION_MS } from "@/components/settings/useOutlineMotion";

const DEFAULT_SELECTOR = "[data-key]";
const MIN_MOVE_PX = 0.5;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The attribute a selector like `[data-flip-key]` names, or null if it is not a bare attribute selector. */
const keyAttributeOf = (selector: string): string | null =>
  /^\[([^\]=]+)\]$/.exec(selector)?.[1] ?? null;

/**
 * The vertical offset a running glide adds to the row's box. Layout tops leave
 * it out, so a re-sort mid-glide starts from where the row shows.
 */
function glideOffset(row: HTMLElement): number {
  const transform = getComputedStyle(row).transform;
  const values = /^matrix(3d)?\((.+)\)$/.exec(transform)?.[2]?.split(",").map(Number);
  if (!values) return 0;
  const offset = transform.startsWith("matrix3d") ? values[13] : values[5];
  return Number.isFinite(offset) ? offset : 0;
}

const signatureOf = (order: readonly string[]) => order.join("\u0000");
const SCOPE_SEPARATOR = "\u0001";

/**
 * FLIP-animates rows that change place when `order` changes. Each row is an
 * element inside `containerRef` matching `selector` (default `[data-key]`),
 * keyed by the attribute the selector names. A row whose top moved glides from
 * its old offset to its new place over the outline motion curve. Only measures
 * the container; it never sets its scroll position. `skipKey` names a row that
 * should snap instead of gliding. A change of `scope` (another view, or a
 * search) moves rows without gliding: only a reorder within one scope glides. Reduced motion and environments without
 * `Element.animate` skip the animation.
 */
export function useFlipReorder(
  containerRef: RefObject<HTMLElement | null>,
  order: readonly string[],
  options?: { selector?: string; skipKey?: string | null; scope?: string }
): void {
  const topsRef = useRef<Map<string, number> | null>(null);
  const signatureRef = useRef<string | null>(null);
  const animationsRef = useRef<Map<string, Animation>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const selector = options?.selector ?? DEFAULT_SELECTOR;
    const skipKey = options?.skipKey ?? null;
    const attribute = keyAttributeOf(selector);
    if (!attribute) return;

    const containerTop = container.getBoundingClientRect().top;
    const tops = new Map<string, number>();
    const offsets = new Map<string, number>();
    for (const row of container.querySelectorAll<HTMLElement>(selector)) {
      const key = row.getAttribute(attribute);
      if (key === null) continue;
      const offset = animationsRef.current.has(key) ? glideOffset(row) : 0;
      offsets.set(key, offset);
      tops.set(key, row.getBoundingClientRect().top - offset - containerTop + container.scrollTop);
    }

    const scope = options?.scope ?? "";
    const signature = `${scope}${SCOPE_SEPARATOR}${signatureOf(order)}`;
    const previous = signatureRef.current;
    const previousTops = topsRef.current;
    const sameScope = previous?.startsWith(`${scope}${SCOPE_SEPARATOR}`) ?? false;
    const orderChanged = previous !== null && sameScope && previous !== signature;
    topsRef.current = tops;
    signatureRef.current = signature;

    if (!orderChanged || !previousTops) return;
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) return;

    for (const row of container.querySelectorAll<HTMLElement>(selector)) {
      const key = row.getAttribute(attribute);
      if (key === null || key === skipKey) continue;
      const previousTop = previousTops.get(key);
      const currentTop = tops.get(key);
      if (previousTop === undefined || currentTop === undefined) continue;
      const delta = previousTop + (offsets.get(key) ?? 0) - currentTop;
      if (Math.abs(delta) < MIN_MOVE_PX) continue;
      if (typeof row.animate !== "function") continue;

      animationsRef.current.get(key)?.cancel();
      const animation = row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
        { duration: OUTLINE_MOTION_MS, easing: OUTLINE_EASING }
      );
      animationsRef.current.set(key, animation);
      animation.onfinish = () => {
        if (animationsRef.current.get(key) === animation) animationsRef.current.delete(key);
      };
    }
  });
}
