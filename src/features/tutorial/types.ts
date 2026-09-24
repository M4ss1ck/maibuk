export const TUTORIAL_SECTION_IDS = [
  "books",
  "book-editor",
  "cover-designer",
  "notes",
  "canvas-gallery",
  "canvas",
  "ephemeral",
  "settings",
] as const;

export type TutorialSectionId = (typeof TUTORIAL_SECTION_IDS)[number];

/** Where a run came from; decides where focus lands when it ends. */
export type TutorialOrigin = "offer" | "settings" | "help" | "shortcut";

/** Why a run ended. Skip covers the Skip button, Escape, and the Android back button. */
export type TutorialExitReason = "finished" | "skipped" | "closed";

export interface TutorialStepLink {
  href: string;
  labelKey: string;
}

export interface TutorialStep {
  /** `section.step`, also the value of the `data-tutorial` anchor it points at. */
  id: string;
  /** Screen the step is shown on; defaults to its section's route. */
  route?: string;
  /** i18n keys; `titleKey` and `bodyKey` live under `tutorial.steps`. */
  titleKey: string;
  bodyKey: string;
  /** Optional image shown above the text (an app asset URL) with its localized alt text. */
  image?: { src: string; altKey: string };
  link?: TutorialStepLink;
  /** Glossary terms (CONTEXT.md) this step teaches; the coverage gate reads them. */
  terms: readonly string[];
}

export interface TutorialSection {
  id: TutorialSectionId;
  route: string;
  nameKey: string;
  steps: readonly TutorialStep[];
}

/** One position in a run: a section and a step inside it. */
export interface TutorialPosition {
  section: TutorialSectionId;
  step: number;
}

export interface TutorialSectionProgress {
  completedAt: number | null;
}

/** Device-local Tutorial state, persisted as `maibuk-tutorial` (never synced or backed up). */
export interface TutorialProgress {
  /** Unix ms of the first dismiss (Skip, Escape, back button, or "Not now"). */
  dismissedAt: number | null;
  /** Unix ms when a full run was finished. */
  completedAt: number | null;
  /** Where the last run stood, for "Continue the Tutorial"; null when it ended. */
  lastSection: TutorialSectionId | null;
  lastStep: number | null;
  /** Where the author skipped, kept for the Tutorial's own outcome trace. */
  skippedAt: TutorialPosition | null;
  sections: Partial<Record<TutorialSectionId, TutorialSectionProgress>>;
}
