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
