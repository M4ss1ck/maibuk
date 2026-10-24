import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SEARCH_SWITCHES_STORAGE_KEY = "maibuk-search-switches";

export interface SearchSwitches {
  /** Match the query's case exactly; off ignores case. Literal queries always ignore accents. */
  matchCase: boolean;
  /** Match whole words only. */
  wholeWord: boolean;
  /** Read the query as a regular expression. */
  regex: boolean;
}

interface SearchSwitchesState extends SearchSwitches {
  toggleMatchCase: () => void;
  toggleWholeWord: () => void;
  toggleRegex: () => void;
}

function normalizeSwitches(raw: unknown): SearchSwitches {
  const record = (raw ?? {}) as Partial<Record<keyof SearchSwitches, unknown>>;
  return {
    matchCase: record.matchCase === true,
    wholeWord: record.wholeWord === true,
    regex: record.regex === true,
  };
}

/**
 * The Library Search and Find and Replace switches as one shared state, kept
 * on this device only like Recent and Custom Shortcuts: toggling in the
 * palette field changes the editor panel's search and vice versa. Never
 * synced, never in Backups.
 */
export const useSearchSwitchesStore = create<SearchSwitchesState>()(
  persist(
    (set) => ({
      matchCase: false,
      wholeWord: false,
      regex: false,
      toggleMatchCase: () => set((state) => ({ matchCase: !state.matchCase })),
      toggleWholeWord: () => set((state) => ({ wholeWord: !state.wholeWord })),
      toggleRegex: () => set((state) => ({ regex: !state.regex })),
    }),
    {
      name: SEARCH_SWITCHES_STORAGE_KEY,
      version: 1,
      partialize: (state) => normalizeSwitches(state),
      merge: (persisted, current) => ({ ...current, ...normalizeSwitches(persisted) }),
    }
  )
);
