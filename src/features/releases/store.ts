import { create } from "zustand";
import type { ReleaseNotes } from "@/features/releases/release-notes";

interface ReleaseState {
  /** Published Releases newer than the installed one, newest first, in English. */
  newerReleases: ReleaseNotes[];
  /**
   * Each app locale's newer Release Notes, keyed by Release number. A locale
   * joins it once its changelog file at the newest tag has been read.
   */
  localizedNewerReleases: Map<string, Map<string, ReleaseNotes>>;
  isNotesOpen: boolean;
  setNewerReleases: (releases: ReleaseNotes[]) => void;
  setLocalizedNewerReleases: (locale: string, notes: Map<string, ReleaseNotes>) => void;
  openNotes: () => void;
  closeNotes: () => void;
}

export const useReleaseStore = create<ReleaseState>()((set) => ({
  newerReleases: [],
  localizedNewerReleases: new Map(),
  isNotesOpen: false,
  // A new list is new notes: what a language answered for the old one is not
  // this list's notes, and the check reads them again for the current language.
  setNewerReleases: (newerReleases) =>
    set({ newerReleases, localizedNewerReleases: new Map() }),
  setLocalizedNewerReleases: (locale, notes) =>
    set((state) => {
      const localizedNewerReleases = new Map(state.localizedNewerReleases);
      localizedNewerReleases.set(locale, notes);
      return { localizedNewerReleases };
    }),
  openNotes: () => set({ isNotesOpen: true }),
  closeNotes: () => set({ isNotesOpen: false }),
}));

/**
 * The newer Releases with their notes in `localized` where that language's
 * changelog lists the same Release, and their English body otherwise. The
 * Release's page stays the one GitHub reported, whatever the language.
 */
export function newerReleasesIn(
  releases: readonly ReleaseNotes[],
  localized: ReadonlyMap<string, ReleaseNotes> | undefined
): ReleaseNotes[] {
  if (!localized || localized.size === 0) return [...releases];
  return releases.map((release) => {
    const translated = localized.get(release.number);
    return translated ? { ...release, sections: translated.sections } : release;
  });
}
