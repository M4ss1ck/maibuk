import {
  rowOnPlatform,
  type SettingsPlatform,
  type SettingsSectionDef,
} from "@/features/settings/rows";

/** One section of the Settings outline, with the rows it lists. */
export interface OutlineSection {
  id: string;
  label: string;
  rows: { id: string; label: string }[];
  /** Whether its rows are listed: the selected section, or every match while searching. */
  open: boolean;
}

/** What the outline marks as current: a section, and a row only after a click. */
export interface OutlineSelection {
  section: string | null;
  row: string | null;
}

/**
 * The outline's entries: the sections the screen renders, each with its rows
 * on this platform. With a query, only sections whose label matches (with all
 * their rows) or that have a matching row (with only those rows) remain, all
 * open; without one, only `openSection` lists its rows.
 */
export function buildOutline(
  sections: readonly SettingsSectionDef[],
  options: {
    present: readonly string[];
    platform: SettingsPlatform;
    translate: (key: string) => string;
    query: string;
    openSection: string | null;
  }
): OutlineSection[] {
  const query = normalize(options.query);
  return sections
    .filter((section) => options.present.includes(section.id))
    .flatMap((section) => {
      const label = options.translate(section.labelKey);
      const rows = section.rows
        .filter((row) => rowOnPlatform(row, options.platform))
        .map((row) => ({ id: row.id, label: options.translate(row.labelKey) }));
      if (!query)
        return [{ id: section.id, label, rows, open: section.id === options.openSection }];
      if (normalize(label).includes(query)) return [{ id: section.id, label, rows, open: true }];
      const hits = rows.filter((row) => normalize(row.label).includes(query));
      return hits.length > 0 ? [{ id: section.id, label, rows: hits, open: true }] : [];
    });
}

// Case- and accent-insensitive, so "metricas" finds "Métricas".
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

/**
 * The first item whose top is inside [viewTop, viewBottom); when none starts
 * there, the last one that started above viewTop (the one covering the top).
 */
export function firstStartingInView<T>(
  items: readonly T[],
  topOf: (item: T) => number | null,
  viewTop: number,
  viewBottom: number
): T | null {
  let covering: T | null = null;
  for (const item of items) {
    const top = topOf(item);
    if (top === null) continue;
    // A pixel of slack: a jump lands the section exactly at viewTop, and
    // sub-pixel layout can put it a fraction above.
    if (top >= viewTop - 1 && top < viewBottom) return item;
    if (top < viewTop) covering = item;
  }
  return covering;
}

/**
 * Who decides the selection while the page scrolls. A click pins its entry;
 * the scroll its jump causes keeps the pin, and the first scroll after that
 * jump settles is the author's own, which hands control back to the spy.
 */
export interface OutlinePin {
  pinned: OutlineSelection | null;
  jumping: boolean;
}

export type OutlinePinEvent =
  | { type: "jump"; selection: OutlineSelection }
  | { type: "scroll" }
  | { type: "settled" };

export const INITIAL_OUTLINE_PIN: OutlinePin = { pinned: null, jumping: false };

export function reduceOutlinePin(state: OutlinePin, event: OutlinePinEvent): OutlinePin {
  switch (event.type) {
    case "jump":
      return { pinned: event.selection, jumping: true };
    case "settled":
      return state.jumping ? { ...state, jumping: false } : state;
    case "scroll":
      return state.jumping || !state.pinned ? state : INITIAL_OUTLINE_PIN;
  }
}

/**
 * The outline's section-change motion: one phase at a time, never overlapping.
 * `collapsing` folds the shown section's rows away before the highlight moves;
 * `expanding` grows the new section's rows after it. `shown` is the section
 * whose rows are on screen, not necessarily the current selection: the rows
 * remain the old ones through `collapsing`, and the machine rests with the new
 * one.
 */
export type OutlineTransition =
  | { phase: "idle"; shown: string | null }
  | { phase: "collapsing"; shown: string; next: string | null }
  | { phase: "expanding"; shown: string | null };

export type OutlineTransitionEvent =
  | { type: "section"; section: string | null; animate: boolean }
  | { type: "collapsed" }
  | { type: "expanded" };

export const INITIAL_OUTLINE_TRANSITION: OutlineTransition = { phase: "idle", shown: null };

/**
 * The sequential section-change motion. From `idle`, an animated change to a
 * section that has never been shown enters `collapsing`; `collapsed` advances it
 * to `expanding`, and `expanded` rests.
 *
 * A change that arrives mid-phase is a retarget, not a new change to start over
 * from: the phase already running keeps the space it has and the newest target
 * replaces the one it was going to. A collapse takes the new target as its own,
 * a change back to the section it is folding reverses into expanding it, and a
 * change while a section is growing reverses into folding that section away from
 * wherever its rows have got to. There is no queue: the newest target wins.
 *
 * A quiet change (a search, reduced motion) settles at once from anywhere,
 * including when it names the section the phase is already showing, where an
 * equality check placed first would leave the phase running behind it.
 * `collapsed` and `expanded` are ignored outside their phase, so a late finish
 * from a superseded phase changes nothing.
 */
export function reduceOutlineTransition(
  state: OutlineTransition,
  event: OutlineTransitionEvent
): OutlineTransition {
  switch (event.type) {
    case "section": {
      if (!event.animate) return { phase: "idle", shown: event.section };
      if (state.phase === "idle") {
        if (state.shown === event.section) return state;
        // Nothing to fold away: the new section is simply the one shown.
        if (state.shown === null) return { phase: "idle", shown: event.section };
        return { phase: "collapsing", shown: state.shown, next: event.section };
      }
      if (state.phase === "collapsing") {
        if (event.section === state.next) return state;
        // Back to the section being folded: grow it again from where it is.
        if (event.section === state.shown) return { phase: "expanding", shown: state.shown };
        return { phase: "collapsing", shown: state.shown, next: event.section };
      }
      // expanding: the same section is nothing to do, anything else folds it away.
      if (event.section === state.shown) return state;
      // An expanding phase with no section has nothing to fold; it only settles.
      if (state.shown === null) return { phase: "idle", shown: event.section };
      return { phase: "collapsing", shown: state.shown, next: event.section };
    }
    case "collapsed":
      if (state.phase !== "collapsing") return state;
      // Nothing left to show: the fold was the whole of the change.
      if (state.next === null) return { phase: "idle", shown: null };
      return { phase: "expanding", shown: state.next };
    case "expanded":
      if (state.phase !== "expanding") return state;
      return { phase: "idle", shown: state.shown };
  }
}
