import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { SETTINGS_SECTIONS, type SettingsRowId } from "@/components/settings/settings-sections";
import type { SettingsSectionId } from "@/components/settings/SettingsSection";
import { focusSettingsRow } from "@/features/settings/focus-row";
import {
  INITIAL_OUTLINE_PIN,
  firstStartingInView,
  reduceOutlinePin,
  type OutlinePinEvent,
  type OutlineSelection,
} from "@/features/settings/outline";

// Where a section lands below the visible top after a jump.
const LANDING_GAP = 24;
// A jump's scroll counts as finished after this long without scroll events;
// the first wait is longer because a row jump scrolls a frame or more later.
const JUMP_SETTLE_MS = 150;
const JUMP_START_MS = 400;

function sectionElement(id: string) {
  const heading = document.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
  return { heading, card: heading?.closest<HTMLElement>("section") ?? heading };
}

/**
 * Which Settings section is current, and the jump the outline makes. The
 * current section is the first one starting inside the visible part of
 * `scrollerRef` below `topInset` (a sticky bar), until a click pins an entry;
 * a row is current only after a click.
 */
export function useSettingsOutline(scrollerRef: RefObject<HTMLElement | null>, topInset: number) {
  const [present, setPresent] = useState<SettingsSectionId[]>([]);
  const [selection, setSelection] = useState<OutlineSelection>({ section: null, row: null });
  const [progress, setProgress] = useState(0);
  const pin = useRef(INITIAL_OUTLINE_PIN);
  const settleTimer = useRef(0);

  const dispatch = useCallback((event: OutlinePinEvent) => {
    pin.current = reduceOutlinePin(pin.current, event);
  }, []);

  const settleAfter = useCallback(
    (ms: number) => {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => dispatch({ type: "settled" }), ms);
    },
    [dispatch]
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const ids = SETTINGS_SECTIONS.map((section) => section.id).filter(
      (id) => sectionElement(id).heading
    );
    setPresent(ids);

    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const progress = max > 0 ? Math.min(1, scroller.scrollTop / max) : 0;
      setProgress(progress);
      const pinned = pin.current.pinned;
      if (pinned) {
        setSelection(pinned);
        return;
      }
      const rect = scroller.getBoundingClientRect();
      const section = firstStartingInView(
        ids,
        (id) => sectionElement(id).card?.getBoundingClientRect().top ?? null,
        rect.top + topInset,
        rect.bottom
      );
      setSelection((prev) =>
        prev.section === section && prev.row === null ? prev : { section, row: null }
      );
    };
    const onScroll = () => {
      if (pin.current.jumping) settleAfter(JUMP_SETTLE_MS);
      dispatch({ type: "scroll" });
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer.current);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scrollerRef, topInset, dispatch, settleAfter]);

  /** Selects an entry and moves there: a row through the palette's path, a section to its heading. */
  const jumpTo = useCallback(
    (section: SettingsSectionId, row: SettingsRowId | null = null) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const next = { section, row };
      dispatch({ type: "jump", selection: next });
      settleAfter(JUMP_START_MS);
      setSelection(next);

      if (row) {
        // Opens a collapsed area first when the row lives in one, then
        // scrolls the row into view and focuses its control.
        focusSettingsRow(row);
        return;
      }
      const { heading, card } = sectionElement(section);
      if (!card) return;
      const delta = card.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo?.({
        top: scroller.scrollTop + delta - topInset - LANDING_GAP,
        behavior: smooth ? "smooth" : "auto",
      });
      heading?.focus({ preventScroll: true });
    },
    [scrollerRef, topInset, dispatch, settleAfter]
  );

  return { present, selection, progress, jumpTo };
}
