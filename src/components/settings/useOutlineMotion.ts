import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { planOutlineMotion } from "@/features/settings/outline";

// One duration and curve for entries, the current-section marker, and the
// outline's own scroll, so they arrive together.
export const OUTLINE_MOTION_MS = 220;
export const OUTLINE_EASING = "cubic-bezier(0.2, 0, 0, 1)";
// Closing rows fade before the entries sliding over them arrive, and new rows
// fade in once the entries sliding past them have mostly cleared.
const EXIT_MS = 90;
const ENTER_DELAY_MS = 110;
const ENTER_MS = 170;
// Room kept around the current entry when the outline scrolls to show it.
const SCROLL_MARGIN = 8;

interface Snapshot {
  order: string[];
  tops: Map<string, number>;
  lefts: Map<string, number>;
  widths: Map<string, number>;
  elements: Map<string, HTMLElement>;
}

function sameLayout(a: Snapshot, b: Snapshot) {
  return (
    a.order.length === b.order.length &&
    a.order.every((key, index) => key === b.order[index] && a.tops.get(key) === b.tops.get(key))
  );
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function snapshot(scroller: HTMLElement): Snapshot {
  const shot: Snapshot = {
    order: [],
    tops: new Map(),
    lefts: new Map(),
    widths: new Map(),
    elements: new Map(),
  };
  for (const element of scroller.querySelectorAll<HTMLElement>('[role="row"][data-key]')) {
    const key = element.dataset.key as string;
    shot.order.push(key);
    // Layout positions: offsetTop ignores the transforms a move applies.
    shot.tops.set(key, element.offsetTop);
    shot.lefts.set(key, element.offsetLeft);
    shot.widths.set(key, element.offsetWidth);
    shot.elements.set(key, element);
  }
  return shot;
}

/**
 * Moves the Settings outline instead of snapping it. When the current section
 * changes, the closing section's rows fade away, every kept entry slides to
 * its new place (FLIP, through the Web Animations API), and the new section's
 * rows fade in once that slide clears; the marker beside the current section
 * slides with them, and the outline scrolls smoothly to keep the current
 * entry visible.
 * A search rebuilds the entries without motion, and so does reduced motion.
 *
 * `scrollerRef` is the outline's positioned scroll box holding the tree;
 * `markerRef` and `ghostsRef` are absolutely positioned children of it.
 */
export function useOutlineMotion({
  scrollerRef,
  markerRef,
  ghostsRef,
  currentKey,
  visibleKey,
  query,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  markerRef: RefObject<HTMLElement | null>;
  ghostsRef: RefObject<HTMLElement | null>;
  /** The entry the marker sits beside: the current section. */
  currentKey: string | null;
  /** The entry kept in view: the current row, or else the current section. */
  visibleKey: string | null;
  query: string;
}) {
  const previous = useRef<Snapshot | null>(null);
  const previousQuery = useRef(query);
  const previousVisibleKey = useRef<string | null>(null);
  // Rows a search adds or removes change without motion, also when React
  // Aria commits them a render after the query.
  const quiet = useRef(false);
  const keys = useRef({ currentKey, visibleKey });
  const observed = useRef<{ element: HTMLElement; observer: MutationObserver } | null>(null);

  const sync = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      previous.current = null;
      return;
    }
    const { currentKey, visibleKey } = keys.current;
    // The first rows to appear are placed, not animated: React Aria's Tree
    // renders them a commit after the outline mounts.
    const animate =
      (previous.current?.order.length ?? 0) > 0 && !quiet.current && !prefersReducedMotion();

    const next = snapshot(scroller);
    // A ghost came or went, or only the selection changed: running
    // animations are left alone rather than restarted.
    if (animate && previous.current && !sameLayout(previous.current, next)) {
      // Where an interrupted animation holds each entry right now: read every
      // position with its transform, cancel, then read again, in two passes
      // so the page lays out twice, not once per entry.
      const rows = [...scroller.querySelectorAll<HTMLElement>('[role="row"][data-key]')];
      const offsets = new Map<string, number>();
      const running = rows.filter((row) => (row.getAnimations?.() ?? []).length > 0);
      const held = running.map((row) => row.getBoundingClientRect().top);
      for (const row of running) for (const animation of row.getAnimations()) animation.cancel();
      running.forEach((row, index) => {
        offsets.set(row.dataset.key as string, held[index] - row.getBoundingClientRect().top);
      });

      const { moves, enters, exits } = planOutlineMotion(previous.current, next, offsets);
      for (const move of moves) {
        next.elements
          .get(move.key)
          ?.animate?.([{ transform: `translateY(${move.dy}px)` }, { transform: "none" }], {
            duration: OUTLINE_MOTION_MS,
            easing: OUTLINE_EASING,
          });
      }
      for (const key of enters) {
        next.elements.get(key)?.animate?.(
          [
            { opacity: 0, transform: "translateY(-4px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: ENTER_MS, delay: ENTER_DELAY_MS, easing: "ease-out", fill: "backwards" }
        );
      }
      const ghosts = ghostsRef.current;
      for (const exit of ghosts ? exits : []) {
        const gone = previous.current.elements.get(exit.key);
        if (!gone || !ghosts) continue;
        // React has detached the entry; a copy of it fades out where it was.
        const ghost = gone.cloneNode(true) as HTMLElement;
        for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
          node.removeAttribute("id");
          node.removeAttribute("data-key");
          node.removeAttribute("tabindex");
        }
        Object.assign(ghost.style, {
          position: "absolute",
          margin: "0",
          top: `${exit.top}px`,
          left: `${previous.current.lefts.get(exit.key) ?? 0}px`,
          width: `${previous.current.widths.get(exit.key) ?? 0}px`,
        });
        ghosts.append(ghost);
        if (!ghost.animate) {
          ghost.remove();
          continue;
        }
        ghost.animate(
          [
            { transform: "none", opacity: 1 },
            { transform: `translateY(${exit.dy}px)`, opacity: 0 },
          ],
          { duration: EXIT_MS, easing: "ease-out", fill: "forwards" }
        ).onfinish = () => ghost.remove();
      }
    }
    previous.current = next;

    const marker = markerRef.current;
    if (marker) {
      const top = currentKey ? next.tops.get(currentKey) : undefined;
      const current = currentKey ? next.elements.get(currentKey) : undefined;
      // The first placement, a search, or reduced motion: no slide.
      if (!animate) marker.style.transitionProperty = "none";
      marker.style.opacity = top === undefined ? "0" : "1";
      if (top !== undefined && current) {
        marker.style.transform = `translateY(${top}px)`;
        marker.style.height = `${current.offsetHeight}px`;
      }
      if (!animate) {
        void marker.offsetHeight;
        marker.style.transitionProperty = "";
      }
    }

    if (visibleKey !== previousVisibleKey.current) {
      const top = visibleKey ? next.tops.get(visibleKey) : undefined;
      const element = visibleKey ? next.elements.get(visibleKey) : undefined;
      // Handled once its entry exists: the tree may add it a render later.
      if (!visibleKey || element) previousVisibleKey.current = visibleKey;
      if (top !== undefined && element) {
        const bottom = top + element.offsetHeight;
        let target: number | null = null;
        if (top < scroller.scrollTop) target = top - SCROLL_MARGIN;
        else if (bottom > scroller.scrollTop + scroller.clientHeight)
          target = bottom - scroller.clientHeight + SCROLL_MARGIN;
        if (target !== null) {
          if (scroller.scrollTo)
            scroller.scrollTo({
              top: target,
              behavior: prefersReducedMotion() ? "auto" : "smooth",
            });
          else scroller.scrollTop = target;
        }
      }
    }
  }, [scrollerRef, markerRef, ghostsRef]);

  // Every outline commit (it is memoized, so it commits only when its entries
  // or the selection change), and every row React Aria's Tree adds or removes
  // in a commit of its own: the observer runs before that frame paints.
  useLayoutEffect(() => {
    keys.current = { currentKey, visibleKey };
    if (previousQuery.current !== query) {
      previousQuery.current = query;
      quiet.current = true;
      requestAnimationFrame(() => {
        quiet.current = false;
      });
    }
    const scroller = scrollerRef.current;
    if (observed.current?.element !== scroller) {
      observed.current?.observer.disconnect();
      observed.current = null;
      if (scroller && typeof MutationObserver !== "undefined") {
        const observer = new MutationObserver(sync);
        observer.observe(scroller, { childList: true, subtree: true });
        observed.current = { element: scroller, observer };
      }
    }
    sync();
  });

  useLayoutEffect(
    () => () => {
      observed.current?.observer.disconnect();
      observed.current = null;
    },
    []
  );
}
