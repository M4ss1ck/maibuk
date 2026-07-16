import { create } from "zustand";

interface EphemeralState {
  content: string;
  wordCount: number;
  setContent: (html: string) => void;
  setWordCount: (n: number) => void;
  reset: () => void;
}

// Intentionally NOT persisted: the ephemeral buffer lives only in memory for the
// current session and is discarded on reboot.
export const useEphemeralStore = create<EphemeralState>((set) => ({
  content: "",
  wordCount: 0,
  setContent: (content) => set({ content }),
  setWordCount: (wordCount) => set({ wordCount }),
  reset: () => set({ content: "", wordCount: 0 }),
}));
