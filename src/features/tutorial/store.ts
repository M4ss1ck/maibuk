import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  TutorialExitReason,
  TutorialOrigin,
  TutorialPosition,
  TutorialProgress,
  TutorialSectionId,
} from "@/features/tutorial/types";

export type TutorialStatus = "idle" | "entering" | "running" | "exiting";

export interface TutorialRun {
  /** Set when the run covers a single section (Settings row, help dialog). */
  only: TutorialSectionId | null;
  position: TutorialPosition;
  origin: TutorialOrigin;
  /** Route the author was on; the run ends there. */
  returnTo: string;
}

export const EMPTY_TUTORIAL_PROGRESS: TutorialProgress = {
  dismissedAt: null,
  completedAt: null,
  lastSection: null,
  lastStep: null,
  skippedAt: null,
  sections: {},
};

interface TutorialStore {
  /** Device-local and persisted; never synced, backed up, or cleared by Reset (ADR 0004). */
  progress: TutorialProgress;
  status: TutorialStatus;
  run: TutorialRun | null;
  setStatus: (status: TutorialStatus) => void;
  beginRun: (run: TutorialRun) => void;
  /** Moves the run and records the position for "Continue the Tutorial". */
  setPosition: (position: TutorialPosition) => void;
  markSectionCompleted: (section: TutorialSectionId, at?: number) => void;
  /** Ends the run: finishing, skipping, or closing records what that means for the device. */
  endRun: (reason: TutorialExitReason, at?: number) => void;
  /** "Not now" on the first-launch offer. */
  dismiss: (at?: number) => void;
  resetProgress: () => void;
}

export const useTutorialStore = create<TutorialStore>()(
  persist(
    (set) => ({
      progress: EMPTY_TUTORIAL_PROGRESS,
      status: "idle",
      run: null,

      setStatus: (status) => set({ status }),

      beginRun: (run) => set({ run }),

      setPosition: (position) =>
        set((state) => ({
          run: state.run ? { ...state.run, position } : state.run,
          // Only a whole run is continued on the next launch; an interrupted
          // single-section run leaves nothing to offer.
          progress:
            state.run?.only === null
              ? { ...state.progress, lastSection: position.section, lastStep: position.step }
              : state.progress,
        })),

      markSectionCompleted: (section, at = Date.now()) =>
        set((state) => ({
          progress: {
            ...state.progress,
            sections: { ...state.progress.sections, [section]: { completedAt: at } },
          },
        })),

      endRun: (reason, at = Date.now()) =>
        set((state) => {
          const run = state.run;
          if (!run) return state;
          const progress = { ...state.progress };
          if (reason === "finished") {
            if (run.only === null) progress.completedAt = at;
            progress.lastSection = null;
            progress.lastStep = null;
          } else if (reason === "skipped") {
            progress.skippedAt = run.position;
            progress.lastSection = null;
            progress.lastStep = null;
            // Only a run the Tutorial offered on its own counts as a dismiss;
            // skipping a relaunch ends that run and changes nothing else.
            if (run.origin === "offer" && progress.dismissedAt === null) {
              progress.dismissedAt = at;
            }
          }
          // "closed" keeps lastSection so the next launch offers to continue.
          return { progress, run: null };
        }),

      dismiss: (at = Date.now()) =>
        set((state) => ({
          progress: {
            ...state.progress,
            dismissedAt: state.progress.dismissedAt ?? at,
            lastSection: null,
            lastStep: null,
          },
        })),

      resetProgress: () => set({ progress: EMPTY_TUTORIAL_PROGRESS }),
    }),
    {
      name: "maibuk-tutorial",
      version: 1,
      partialize: (state) => ({ progress: state.progress }),
    }
  )
);

/** Nothing recorded on this device: no dismiss, no finished run, no section done, no run left open. */
export function isTutorialProgressEmpty(progress: TutorialProgress): boolean {
  return (
    progress.dismissedAt === null &&
    progress.completedAt === null &&
    progress.lastSection === null &&
    Object.keys(progress.sections).length === 0
  );
}
