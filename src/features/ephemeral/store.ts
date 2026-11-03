import { create } from "zustand";

import type { Language } from "@/features/settings/types";

interface EphemeralState {
  content: string;
  wordCount: number;
  /** The Spell Check language the author picked; until then, the app language's. */
  language: Language | undefined;
  setContent: (html: string) => void;
  setWordCount: (n: number) => void;
  setLanguage: (language: Language) => void;
  reset: () => void;
}

// Intentionally NOT persisted: the ephemeral buffer lives only in memory for the
// current session and is discarded on reboot.
export const useEphemeralStore = create<EphemeralState>((set) => ({
  content: "",
  wordCount: 0,
  language: undefined,
  setContent: (content) => set({ content }),
  setWordCount: (wordCount) => set({ wordCount }),
  setLanguage: (language) => set({ language }),
  // The language stays: clearing the text does not change what the author writes in.
  reset: () => set({ content: "", wordCount: 0 }),
}));
