import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { OutlineTransition, OutlineTransitionEvent } from "@/features/settings/outline";

// One duration and curve for entries, the current-section marker, and the
// outline's own scroll, so they arrive together.
export const OUTLINE_MOTION_MS = 220;
export const OUTLINE_EASING = "cubic-bezier(0.2, 0, 0, 1)";
// A section change runs one phase at a time: the old rows fold away, the new
// rows grow once they are there.
const COLLAPSE_MS = 90;
const EXPAND_MS = 130;
// Room kept around the current entry when the outline scrolls to show it.
const SCROLL_MARGIN = 8;

/** The rows the outline shows under a section: `row:<section>:<row>`. */
const rowsOf = (scroller: HTMLElement, section: string) =>
  [...scroller.querySelectorAll<HTMLElement>(`[role="row"][data-key^="row:${section}:"]`)];

/** The section a sub-row belongs to, or null for an entry that is a header. */
function sectionOf(row: HTMLElement): string | null {
  const key = row.dataset.key;
  if (!key?.startsWith("row:")) return null;
  const end = key.indexOf(":", "row:".length);
  return end < 0 ? null : key.slice("row:".length, end);
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function measure(element: HTMLElement) {
  const style = getComputedStyle(element);
  return {
    height: `${element.offsetHeight}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
  };
}

/**
 * The Settings outline changes section in sequence instead of all at once.
 * While the transition collapses the old section's rows, then moves the marker
 * to the new header, then expands the new rows, each step owns the outline; a
 * change that arrives mid-phase cancels every running animation and shows the
 * current section immediately, with no motion. Rows a keyboard opens or the
 * tree commits outside a transition expand in place with the same animation,
 * while a search or reduced motion changes the outline with none at all. The
 * marker keeps its own placement, and the outline still glides to keep the
 * current entry in view.
 *
 * `scrollerRef` is the outline's positioned scroll box holding the tree;
 * `markerRef` is an absolutely positioned child of it.
 */
export function useOutlineMotion({
  scrollerRef,
  markerRef,
  transition,
  dispatch,
  currentKey,
  visibleKey,
  query,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  markerRef: RefObject<HTMLElement | null>;
  transition: OutlineTransition;
  dispatch: (event: OutlineTransitionEvent) => void;
  /** The entry the marker sits beside: the section whose rows are shown. */
  currentKey: string | null;
  /** The entry kept in view: the current row, or else the current section. */
  visibleKey: string | null;
  query: string;
}) {
  const animations = useRef(new Map<HTMLElement, Animation>());
  const phaseRef = useRef(transition);
  const currentKeyRef = useRef<string | null>(currentKey);
  const visibleKeyRef = useRef<string | null>(visibleKey);
  const shownRef = useRef(transition.shown);
  const previousQuery = useRef(query);
  // Rows already seen, so a commit's observer animates only what it added.
  const seen = useRef(new Set<HTMLElement>());
  // The expanding phase still waiting for its rows, and the entry a late commit
  // would bring back into view.
  const waitingFor = useRef<string | null>(null);
  const pendingVisible = useRef(false);
  // A change that lands without motion (a search, a snap): the rows React
  // commits a render later must not animate either.
  const quiet = useRef(false);
  const observed = useRef<{ element: HTMLElement; observer: MutationObserver } | null>(null);

  const cancelAll = useCallback(() => {
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
  }, []);

  // Every animation this hook started, settled: a `finished` the environment
  // does not provide counts as done, never as stuck.
  const whenSettled = useCallback(
    () =>
      Promise.all(
        [...animations.current.values()].map(
          (animation) =>
            new Promise<void>((resolve) => {
              const promise: Promise<unknown> | undefined = animation.finished;
              if (!promise) resolve();
              else promise.then(() => resolve(), () => resolve());
            })
        )
      ),
    []
  );

  const track = useCallback((element: HTMLElement, animation: Animation) => {
    animations.current.set(element, animation);
    const forget = () => {
      if (animations.current.get(element) === animation) animations.current.delete(element);
    };
    animation.onfinish = forget;
    animation.oncancel = forget;
  }, []);

  const nextFrame = useCallback(
    (step: () => void) => {
      requestAnimationFrame(() => requestAnimationFrame(() => step()));
    },
    []
  );

  // Puts the marker beside the shown header; `animate` false snaps it there.
  const placeMarker = useCallback(
    (animate: boolean) => {
      const scroller = scrollerRef.current;
      const marker = markerRef.current;
      if (!scroller || !marker) return;
      const key = currentKeyRef.current;
      const row = key
        ? scroller.querySelector<HTMLElement>(`[role="row"][data-key="${key}"]`)
        : null;
      if (!animate) marker.style.transitionProperty = "none";
      marker.style.opacity = row ? "1" : "0";
      if (row) {
        marker.style.transform = `translateY(${row.offsetTop}px)`;
        marker.style.height = `${row.offsetHeight}px`;
      }
      if (!animate) {
        void marker.offsetHeight;
        marker.style.transitionProperty = "";
      }
    },
    [markerRef, scrollerRef]
  );

  // Keeps the current entry (a row after a click, else the header) inside the
  // outline's fold. The tree may add that entry a render later, so a miss is
  // remembered and retried on the next commit.
  const scrollToVisible = useCallback(() => {
    const scroller = scrollerRef.current;
    const key = visibleKeyRef.current;
    if (!scroller || !key) {
      pendingVisible.current = false;
      return;
    }
    const row = scroller.querySelector<HTMLElement>(`[role="row"][data-key="${key}"]`);
    if (!row) {
      pendingVisible.current = true;
      return;
    }
    pendingVisible.current = false;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    let target: number | null = null;
    if (top < scroller.scrollTop) target = top - SCROLL_MARGIN;
    else if (bottom > scroller.scrollTop + scroller.clientHeight)
      target = bottom - scroller.clientHeight + SCROLL_MARGIN;
    if (target === null) return;
    if (scroller.scrollTo)
      scroller.scrollTo({ top: target, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    else scroller.scrollTop = target;
  }, [scrollerRef]);

  // Grows one row from nothing to its measured size.
  const growRow = useCallback(
    (row: HTMLElement) => {
      if (!row.animate) return;
      const natural = measure(row);
      row.style.overflow = "hidden";
      track(
        row,
        row.animate(
          [
            { height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 },
            {
              height: natural.height,
              paddingTop: natural.paddingTop,
              paddingBottom: natural.paddingBottom,
              opacity: 1,
            },
          ],
          { duration: EXPAND_MS, easing: OUTLINE_EASING, fill: "forwards" }
        )
      );
    },
    [track]
  );

  // The expanding phase, once its rows are in the DOM: grow them, and end the
  // phase when they are done, so a change arriving before then interrupts it.
  const finishExpanding = useCallback(() => {
    const section = waitingFor.current;
    if (phaseRef.current.phase !== "expanding" || section === null) return;
    const scroller = scrollerRef.current;
    const rows = scroller ? rowsOf(scroller, section).filter((row) => row.isConnected) : [];
    if (rows.length > 0) {
      waitingFor.current = null;
      cancelAll();
      for (const row of rows) growRow(row);
      void whenSettled().then(() => {
        if (phaseRef.current.phase !== "expanding") return;
        dispatch({ type: "expanded" });
      });
      return;
    }
    // Nothing arrived to grow: the phase is over either way.
    waitingFor.current = null;
    dispatch({ type: "expanded" });
  }, [cancelAll, dispatch, growRow, whenSettled]);

  const runTransition = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const current = transition;
    const previous = phaseRef.current;
    phaseRef.current = current;

    // A change that interrupted a phase: everything running is cancelled and the
    // current section is already shown, so the marker is placed and the rows
    // React commits for it are left alone.
    if (previous.phase !== "idle" && current.phase === "idle") {
      waitingFor.current = null;
      cancelAll();
      for (const row of scroller.querySelectorAll<HTMLElement>('[role="row"][data-key]'))
        row.style.overflow = "";
      quiet.current = true;
      nextFrame(() => {
        quiet.current = false;
      });
      placeMarker(false);
      scrollToVisible();
      return;
    }

    if (current.phase === "collapsing") {
      cancelAll();
      waitingFor.current = null;
      const rows = rowsOf(scroller, current.shown);
      let started = 0;
      for (const row of rows) {
        if (!row.animate) continue;
        const natural = measure(row);
        row.style.overflow = "hidden";
        track(
          row,
          row.animate(
            [
              {
                height: natural.height,
                paddingTop: natural.paddingTop,
                paddingBottom: natural.paddingBottom,
                opacity: 1,
              },
              { height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 },
            ],
            { duration: COLLAPSE_MS, easing: OUTLINE_EASING, fill: "forwards" }
          )
        );
        started++;
      }
      if (started === 0) dispatch({ type: "collapsed" });
      else {
        void whenSettled().then(() => {
          // A newer phase moved on while these ran: this finish is stale.
          if (phaseRef.current.phase !== "collapsing") return;
          for (const row of animations.current.keys()) row.style.overflow = "";
          dispatch({ type: "collapsed" });
        });
      }
      placeMarker(true);
      scrollToVisible();
      return;
    }

    if (current.phase === "expanding") {
      cancelAll();
      // The Tree commits the new rows a render late; the observer grows them
      // when they arrive, and two frames without them end the phase anyway.
      waitingFor.current = current.shown;
      finishExpanding();
      if (waitingFor.current !== null)
        nextFrame(() => {
          if (phaseRef.current.phase === "expanding") finishExpanding();
        });
      placeMarker(true);
      scrollToVisible();
      return;
    }

    // idle: a keyboard-opened row grows where the tree adds it, through the
    // observer below. Everything else is placed and kept in view.
    placeMarker(previous.phase !== "idle");
    scrollToVisible();
  }, [
    cancelAll,
    currentKeyRef,
    dispatch,
    finishExpanding,
    growRow,
    markerRef,
    nextFrame,
    placeMarker,
    query,
    scrollerRef,
    scrollToVisible,
    track,
    transition,
    whenSettled,
  ]);

  // Every outline commit, and every row React Aria's Tree adds or removes in a
  // commit of its own (the observer runs before that frame paints).
  useLayoutEffect(() => {
    currentKeyRef.current = currentKey;
    visibleKeyRef.current = visibleKey;
    shownRef.current = transition.shown;
    if (previousQuery.current !== query) {
      previousQuery.current = query;
      quiet.current = true;
      nextFrame(() => {
        quiet.current = false;
      });
    }
    const scroller = scrollerRef.current;
    if (observed.current?.element !== scroller) {
      observed.current?.observer.disconnect();
      observed.current = null;
      if (scroller && typeof MutationObserver !== "undefined") {
        const observer = new MutationObserver(() => {
          const rows = [...scroller.querySelectorAll<HTMLElement>('[role="row"][data-key]')];
          const added = rows.filter((row) => !seen.current.has(row));
          for (const row of rows) seen.current.add(row);
          for (const row of [...seen.current]) if (!row.isConnected) seen.current.delete(row);
          if (pendingVisible.current) scrollToVisible();
          // The transition's own phases drive their rows; nothing else touches
          // them, so a change arriving mid-phase is what interrupts it.
          if (waitingFor.current !== null) {
            finishExpanding();
            return;
          }
          if (phaseRef.current.phase !== "idle") return;
          if (quiet.current || prefersReducedMotion()) return;
          // A row of the shown section was rendered by a transition that has
          // already decided its motion; only a row the author opened from the
          // keyboard arrives with no phase to own it.
          for (const row of added) {
            const section = sectionOf(row);
            if (section !== null && section !== shownRef.current) growRow(row);
          }
        });
        observer.observe(scroller, { childList: true, subtree: true });
        observed.current = { element: scroller, observer };
      }
    }
    runTransition();
  });

  useLayoutEffect(
    () => () => {
      observed.current?.observer.disconnect();
      observed.current = null;
      cancelAll();
    },
    [cancelAll]
  );
}