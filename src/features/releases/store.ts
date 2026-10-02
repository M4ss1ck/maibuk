import { create } from "zustand";
import type { ReleaseNotes } from "@/features/releases/release-notes";

interface ReleaseState {
  /** Published Releases newer than the installed one, newest first. */
  newerReleases: ReleaseNotes[];
  isNotesOpen: boolean;
  setNewerReleases: (releases: ReleaseNotes[]) => void;
  openNotes: () => void;
  closeNotes: () => void;
}

export const useReleaseStore = create<ReleaseState>()((set) => ({
  newerReleases: [],
  isNotesOpen: false,
  setNewerReleases: (newerReleases) => set({ newerReleases }),
  openNotes: () => set({ isNotesOpen: true }),
  closeNotes: () => set({ isNotesOpen: false }),
}));
