import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MAX_RECENT_SYMBOLS = 20;

interface SymbolsState {
  recentGlyphs: string[];
  addRecentGlyph: (glyph: string) => void;
}

export const useSymbolsStore = create<SymbolsState>()(
  persist(
    (set) => ({
      recentGlyphs: [],
      addRecentGlyph: (glyph) =>
        set((state) => ({
          recentGlyphs: [glyph, ...state.recentGlyphs.filter((g) => g !== glyph)].slice(
            0,
            MAX_RECENT_SYMBOLS
          ),
        })),
    }),
    { name: "maibuk-symbols" }
  )
);
