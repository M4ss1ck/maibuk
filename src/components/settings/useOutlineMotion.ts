import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { OutlineTransition, OutlineTransitionEvent } from "@/features/settings/outline";
import { cubicBezier, edgeKeyframes } from "@/features/settings/outline-edge";

// One duration and curve for the current-section marker and the outline's own
// scroll, so they arrive together. The rows travel on their own curves below.
export const OUTLINE_MOTION_MS = 220;
export const OUTLINE_EASING = "cubic-bezier(0.2, 0, 0, 1)";
// The edge's curve follows the direction it travels. A fold leaves at speed,
// so the space it gives up is gone the frame it ends instead of crawling over
// its last pixel for several frames while the marker waits; a grow starts at
// that same speed and settles gently into place.
export const OUTLINE_FOLD_EASING = "cubic-bezier(0.4, 0, 1, 1)";
export const OUTLINE_GROW_EASING = "cubic-bezier(0, 0, 0.2, 1)";
// The same curves as the strings above, applied to the one edge sweeping a
// section's rows rather than to each row on its own.
const FOLD_CURVE = cubicBezier(0.4, 0, 1, 1);
const GROW_CURVE = cubicBezier(0, 0, 0.2, 1);
// A section change runs one phase at a time: the old rows fold to nothing, then
// the new rows grow into the space they left. A full phase is slow and even
// rather than quick, so the entries below it travel instead of jumping.
export const OUTLINE_PHASE_MS = 320;
// A fold that has little distance left is shorter, so a reversal that is already
// close to where it is going arrives instead of crawling over the last pixels.
export const OUTLINE_REVERSAL_MIN_MS = 90;
// Room kept around the current entry when the outline scrolls to show it.
const SCROLL_MARGIN = 8;

/** The rows the outline shows under a section: `row:<section>:<row>`. */
const rowsOf = (scroller: HTMLElement, section: string) => [
  ...scroller.querySelectorAll<HTMLElement>(`[role="row"][data-key^="row:${section}:"]`),
];

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

/**
 * The space the row's own box occupies right now, a height animation included.
 * Read before anything is cancelled: cancelling puts the row back to its natural
 * height in the same tick, and a fold that follows has to start where the row
 * paints, not where it would settle.
 */
function boxHeight(row: HTMLElement): number {
  const rect = row.getBoundingClientRect().height;
  return rect > 0 ? rect : row.offsetHeight;
}

/** One phase's length for a fold of `distance`, measured against `natural`. */
function phaseMs(distance: number, natural: number) {
  if (natural <= 0 || distance < 1) return 0;
  return Math.max(OUTLINE_REVERSAL_MIN_MS, Math.round((OUTLINE_PHASE_MS * distance) / natural));
}

/**
 * The Settings outline changes section in sequence instead of all at once. The
 * old rows fold to nothing, the marker moves to the new header, the new rows
 * grow into the space they left: each phase owns the outline, and the entries
 * below a moving row travel with it.
 *
 * Only the space a section's rows occupy is animated, and they move together
 * behind one clip edge (`edgeKeyframes()`): the rows above the edge keep their
 * full height, the ones below it are nothing, and at most the one row the edge
 * crosses is cut. The row clips its contents and the label inside keeps its own
 * size and padding, so nothing is ever scaled, stretched or faded: a row that
 * shrinks is clipped, and a row that vanishes leaves no room behind. Neither
 * opacity nor a transform is ever animated.
 *
 * A change that arrives mid-phase is intercepted rather than started over. The
 * fold already running keeps the space it has taken and takes the newest target
 * as its own; a change to the section being folded, or to another one while a
 * section is growing, reverses the motion from the height the rows paint at, so
 * nothing jumps to a height it was never at. A search and reduced motion change
 * the outline with no motion at all, as does a section the keyboard opens while
 * the tree adds its rows in a commit of its own.
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
  // The phase the outline is in, and which run of animations owns it: a finish
  // that belongs to a run a later phase has replaced must not advance it.
  const phaseRef = useRef(transition);
  const generation = useRef(0);
  const runs = useRef(new Map<"collapsing" | "expanding", Animation[]>());
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
  // The rows this grow has already started, so a late commit animates only the
  // rows it added.
  const grown = useRef(new Set<HTMLElement>());
  // How many frames an expand has waited for its rows.
  const waited = useRef(0);
  // Frames this hook has waiting, so unmounting leaves none behind.
  const frames = useRef(new Set<number>());

  const cancelAll = useCallback(() => {
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
  }, []);

  const cancelRow = useCallback((row: HTMLElement) => {
    const running = animations.current.get(row);
    if (!running) return;
    animations.current.delete(row);
    running.cancel();
  }, []);

  // Every animation in `list`, settled: a `finished` the environment does not
  // provide counts as done, never as stuck.
  const whenSettled = useCallback(
    (list: readonly Animation[]) =>
      Promise.all(
        list.map(
          (animation) =>
            new Promise<void>((resolve) => {
              const promise: Promise<unknown> | undefined = animation.finished;
              if (!promise) resolve();
              else
                promise.then(
                  () => resolve(),
                  () => resolve()
                );
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
    return animation;
  }, []);

  const nextFrame = useCallback((step: () => void) => {
    const outer = requestAnimationFrame(() => {
      frames.current.delete(outer);
      const inner = requestAnimationFrame(() => {
        frames.current.delete(inner);
        step();
      });
      frames.current.add(inner);
    });
    frames.current.add(outer);
  }, []);

  // Takes the outline over for a phase that is starting, or restarting in the
  // other direction: anything the previous run was promised is now stale.
  const beginPhase = useCallback((phase: "collapsing" | "expanding") => {
    generation.current += 1;
    runs.current.set(phase, []);
  }, []);

  // Ends the phase once the animations it started are done, unless a newer run
  // has taken over, the phase is already over, or a late commit added rows that
  // are moving now.
  const settle = useCallback(
    function settleRun(phase: "collapsing" | "expanding", event: OutlineTransitionEvent) {
      const mine = generation.current;
      const list = [...(runs.current.get(phase) ?? [])];
      void whenSettled(list).then(() => {
        if (generation.current !== mine) return;
        if (phaseRef.current.phase !== phase) return;
        if ((runs.current.get(phase)?.length ?? 0) > list.length) {
          settleRun(phase, event);
          return;
        }
        runs.current.delete(phase);
        dispatch(event);
      });
    },
    [dispatch, whenSettled]
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

  /**
   * Moves a section's rows as one: a single clip edge sweeps the stack from
   * `from` to the phase's target. Each row gets its own height keyframes, but
   * they all describe the same edge, so the rows above it are full height, the
   * rows below it are 0, and only the row the edge crosses is cut. `painted` is
   * the space each row occupies now, read before anything is cancelled.
   *
   * A fold with no distance left still has to leave the rows clipped: no
   * animation would put the cancelled row back at its natural height until
   * React removes it. A grow to the height it already paints needs nothing.
   */
  const sweepRows = useCallback(
    (
      rows: readonly HTMLElement[],
      painted: readonly number[],
      to: "fold" | "grow",
      fill: FillMode
    ) => {
      for (const row of rows) cancelRow(row);
      // Cancelling put every row back at its natural height in the same tick.
      const naturals = rows.map((row) => boxHeight(row));
      const from = painted.reduce((total, height) => total + height, 0);
      const target = to === "fold" ? 0 : naturals.reduce((total, height) => total + height, 0);
      const natural = naturals.reduce((total, height) => total + height, 0);
      const duration = phaseMs(Math.abs(target - from), natural);
      const created: Animation[] = [];
      if (duration <= 0) {
        if (to === "grow") return created;
        for (const row of rows) {
          if (!row.animate) continue;
          created.push(
            track(
              row,
              row.animate([{ height: "0px" }, { height: "0px" }], {
                duration: 0,
                fill: "forwards",
              })
            )
          );
        }
        return created;
      }
      const frames = edgeKeyframes(naturals, from, target, to === "fold" ? FOLD_CURVE : GROW_CURVE);
      for (const [index, row] of rows.entries()) {
        if (!row.animate) continue;
        const keyframes: Keyframe[] = frames.map((frame) => ({
          offset: frame.offset,
          height: `${frame.heights[index]}px`,
        }));
        created.push(track(row, row.animate(keyframes, { duration, easing: "linear", fill })));
      }
      return created;
    },
    [cancelRow, track]
  );

  /**
   * Folds a section's rows away to nothing behind one edge. Every row's height
   * is read before the first cancellation, so a row a running fold had already
   * taken part of carries on from the height it paints at.
   */
  const foldSection = useCallback(
    (section: string) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const rows = rowsOf(scroller, section).filter((row) => row.isConnected);
      const painted = rows.map((row) => boxHeight(row));
      const run = runs.current.get("collapsing") ?? [];
      run.push(...sweepRows(rows, painted, "fold", "forwards"));
      runs.current.set("collapsing", run);
      if (run.length === 0) {
        runs.current.delete("collapsing");
        dispatch({ type: "collapsed" });
        return;
      }
      settle("collapsing", { type: "collapsed" });
    },
    [dispatch, settle, sweepRows]
  );

  /**
   * Grows a section's rows to their natural height behind one edge. A row the
   * fold is still taking away reverses from the height it paints at; a row the
   * tree has just committed grows from nothing. A commit that adds rows calls
   * back in and only moves the ones it added.
   */
  const growSection = useCallback(
    function grow(section: string) {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const rows = rowsOf(scroller, section).filter((row) => row.isConnected);
      const fresh = rows.filter((row) => !grown.current.has(row));
      const run = runs.current.get("expanding") ?? [];
      if (fresh.length === 0) {
        // Rows already growing: their own settle ends the phase when they are
        // done. Nothing at all yet: the Tree commits rows a render later.
        if (rows.length > 0) return;
        if (waited.current < 1) {
          waited.current += 1;
          const mine = generation.current;
          nextFrame(() => {
            if (generation.current === mine && phaseRef.current.phase === "expanding") {
              grow(section);
            }
          });
          return;
        }
        waited.current = 0;
        waitingFor.current = null;
        runs.current.delete("expanding");
        dispatch({ type: "expanded" });
        return;
      }
      waited.current = 0;
      const painted = fresh.map((row) => (animations.current.has(row) ? boxHeight(row) : 0));
      for (const row of fresh) grown.current.add(row);
      run.push(...sweepRows(fresh, painted, "grow", "backwards"));
      runs.current.set("expanding", run);
      settle("expanding", { type: "expanded" });
    },
    [dispatch, nextFrame, settle, sweepRows]
  );

  // Grows one row the tree has added for itself: a section the keyboard opened.
  const growRow = useCallback(
    (row: HTMLElement) => {
      const created = sweepRows([row], [0], "grow", "backwards");
      if (created.length === 0) return;
      void whenSettled(created);
    },
    [sweepRows, whenSettled]
  );

  const runTransition = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const current = transition;
    const previous = phaseRef.current;
    phaseRef.current = current;

    // Nothing to arrive at: a search, reduced motion, or a section that has gone.
    // Whatever was running is superseded, cancelled, and the rows React commits
    // for this one are left alone.
    if (current.phase === "idle") {
      if (previous.phase !== "idle") {
        generation.current += 1;
        runs.current.delete("collapsing");
        runs.current.delete("expanding");
        waitingFor.current = null;
        grown.current.clear();
        waited.current = 0;
        cancelAll();
        quiet.current = true;
        nextFrame(() => {
          quiet.current = false;
        });
      }
      placeMarker(previous.phase !== "idle");
      scrollToVisible();
      return;
    }

    if (current.phase === "collapsing") {
      // The same fold still running under a newer target: it carries on and
      // arrives at that target. Nothing restarts, so nothing moves twice.
      if (previous.phase === "collapsing" && previous.shown === current.shown) {
        placeMarker(true);
        scrollToVisible();
        return;
      }
      // Entering the phase, or reversing into it: rows a grow is part way
      // through are folded from where they paint, not from their natural height.
      beginPhase("collapsing");
      waitingFor.current = null;
      grown.current.clear();
      waited.current = 0;
      foldSection(current.shown);
      placeMarker(true);
      scrollToVisible();
      return;
    }

    // `expanding` always names the section to show; there is nothing to drive if
    // a state without one ever reaches here.
    const section = current.shown;
    if (section === null) {
      placeMarker(true);
      scrollToVisible();
      return;
    }

    // Entering the expand, or reversing into it: rows the fold had already taken
    // part of grow from the height they paint at, not from nothing.
    if (previous.phase !== "expanding" || previous.shown !== section) {
      beginPhase("expanding");
      grown.current.clear();
      waited.current = 0;
    }
    waitingFor.current = section;
    growSection(section);
    placeMarker(true);
    scrollToVisible();
  }, [
    beginPhase,
    cancelAll,
    foldSection,
    growSection,
    nextFrame,
    placeMarker,
    scrollToVisible,
    transition,
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
          // them, so a change arriving mid-phase is what redirects them.
          if (waitingFor.current !== null) {
            growSection(waitingFor.current);
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
      for (const frame of frames.current) cancelAnimationFrame(frame);
      frames.current.clear();
      cancelAll();
    },
    [cancelAll]
  );
}
