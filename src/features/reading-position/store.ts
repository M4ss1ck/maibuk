import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ReadingPosition {
  /** ProseMirror document position of the caret (selection.from). */
  caret: number;
  /** ProseMirror document position of the block at the top of the viewport. */
  top: number;
  updatedAt: number;
}

/** Cap on stored entries; oldest are evicted. Stale entries are harmless. */
export const MAX_READING_POSITIONS = 200;

interface ReadingPositionStore {
  positions: Record<string, ReadingPosition>;
  getPosition: (key: string) => ReadingPosition | undefined;
  savePosition: (key: string, position: { caret: number; top: number }) => void;
}

export const useReadingPositionStore = create<ReadingPositionStore>()(
  persist(
    (set, get) => ({
      positions: {},
      getPosition: (key) => get().positions[key],
      savePosition: (key, position) => {
        set((state) => {
          const next: Record<string, ReadingPosition> = {
            ...state.positions,
            [key]: {
              caret: position.caret,
              top: position.top,
              updatedAt: Date.now(),
            },
          };
          const keys = Object.keys(next);
          if (keys.length > MAX_READING_POSITIONS) {
            const oldestFirst = keys.sort((a, b) => next[a].updatedAt - next[b].updatedAt);
            for (const staleKey of oldestFirst.slice(0, keys.length - MAX_READING_POSITIONS)) {
              delete next[staleKey];
            }
          }
          return { positions: next };
        });
      },
    }),
    { name: "maibuk-reading-position" }
  )
);
