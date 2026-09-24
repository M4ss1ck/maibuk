// The Tutorial's public interface: start a run (optionally one section),
// move through it, end it with a reason, and decide whether the first-launch
// offer shows. The runner component drives screens and focus; everything
// that touches the Library or the device-local state happens here.

// The app's i18next instance, initialised by @/i18n at startup.
import i18n from "i18next";
import { getAuthorDatabase } from "@/lib/db";
import { enterTutorialLibrary, exitTutorialLibrary } from "@/features/tutorial/tutorial-library";
import { setTutorialRunInProgress } from "@/features/tutorial/library-switch";
import { isTutorialProgressEmpty, useTutorialStore } from "@/features/tutorial/store";
import {
  getSection,
  nextPosition,
  previousPosition,
  sectionsForRun,
} from "@/features/tutorial/sections";
import type { SampleText } from "@/features/tutorial/sample-library";
import type {
  TutorialExitReason,
  TutorialOrigin,
  TutorialPosition,
  TutorialSectionId,
} from "@/features/tutorial/types";

export interface StartTutorialOptions {
  /** Run a single section instead of the whole Tutorial. */
  section?: TutorialSectionId | null;
  origin: TutorialOrigin;
  /** Route to come back to when the run ends. */
  returnTo: string;
  /** Resume the whole Tutorial at this position ("Continue the Tutorial"). */
  resumeAt?: TutorialPosition | null;
}

/** `tutorial.sample.*` strings in the author's current language. */
export function sampleTextFor(language: string): SampleText {
  // Sample keys are composed at runtime, so they bypass the typed key union;
  // the locale parity test proves each one exists in both languages.
  const translate = i18n.t as unknown as (key: string, options: { lng: string }) => string;
  return (key) => translate(`tutorial.sample.${key}`, { lng: language });
}

function currentLanguage(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? "en";
}

/**
 * Claims the run and marks it in progress before any screen changes, so
 * nothing the Tutorial does is recorded as where the author was. Returns
 * false when a run is already under way.
 */
export function requestTutorial(options: StartTutorialOptions): boolean {
  const store = useTutorialStore.getState();
  if (store.status !== "idle") return false;
  const only = options.section ?? null;
  const first = sectionsForRun(only)[0];
  const position = options.resumeAt ?? { section: first.id, step: 0 };
  setTutorialRunInProgress(true);
  store.beginRun({ only, position, origin: options.origin, returnTo: options.returnTo });
  store.setStatus("entering");
  return true;
}

/** Drops a requested run that never entered the Tutorial Library (its Flush failed). */
export function cancelTutorialRequest(): void {
  if (useTutorialStore.getState().status !== "entering") return;
  useTutorialStore.setState({ status: "idle", run: null });
  setTutorialRunInProgress(false);
}

/**
 * Switches to the Tutorial Library for the requested run. Rejects, and
 * leaves the author's Library and the run state as they were, when an open
 * editor cannot save what it holds.
 */
export async function enterRequestedTutorial(): Promise<void> {
  const store = useTutorialStore.getState();
  const run = store.run;
  if (store.status !== "entering" || !run) return;
  try {
    const language = currentLanguage();
    await enterTutorialLibrary({ text: sampleTextFor(language), language });
  } catch (error) {
    cancelTutorialRequest();
    throw error;
  }
  const running = useTutorialStore.getState();
  running.setPosition(run.position);
  running.setStatus("running");
}

/** Requests and enters in one call. */
export async function startTutorial(options: StartTutorialOptions): Promise<boolean> {
  if (!requestTutorial(options)) return false;
  await enterRequestedTutorial();
  return true;
}

/** Moves to the next step; "finished" means the current step was the run's last. */
export function goToNextStep(): "moved" | "finished" {
  const { run, setPosition, markSectionCompleted } = useTutorialStore.getState();
  if (!run) return "finished";
  const next = nextPosition(run.position, run.only);
  if (!next || next.section !== run.position.section) {
    markSectionCompleted(run.position.section);
  }
  if (!next) return "finished";
  setPosition(next);
  return "moved";
}

/** Moves back one step, into the previous section's last step when needed. */
export function goToPreviousStep(): void {
  const { run, setPosition } = useTutorialStore.getState();
  if (!run) return;
  const previous = previousPosition(run.position, run.only);
  if (previous) setPosition(previous);
}

/**
 * Ends the run and switches back to the author's Library. Resolves with the
 * route the run started from; the caller shows it, then calls
 * `releaseTutorialRun()`.
 */
export async function exitTutorial(reason: TutorialExitReason): Promise<string | null> {
  const store = useTutorialStore.getState();
  const run = store.run;
  if (!run || store.status === "exiting" || store.status === "idle") return null;
  store.setStatus("exiting");
  store.endRun(reason);
  try {
    await exitTutorialLibrary();
  } finally {
    useTutorialStore.getState().setStatus("idle");
  }
  return run.returnTo;
}

/** The author is back where they started: location tracking resumes. */
export function releaseTutorialRun(): void {
  setTutorialRunInProgress(false);
}

/** Whether the author's own Library holds any Book, Note, or Canvas. */
export async function authorLibraryIsEmpty(): Promise<boolean> {
  const db = await getAuthorDatabase();
  const rows = await db.select<{ total: number }[]>(
    `SELECT (SELECT COUNT(*) FROM books) + (SELECT COUNT(*) FROM notes) +
            (SELECT COUNT(*) FROM canvases) AS total`
  );
  return Number(rows[0]?.total ?? 0) === 0;
}

export type TutorialOffer =
  | { kind: "start" }
  | { kind: "continue"; position: TutorialPosition };

/**
 * What the first-launch offer shows, from the device-local state alone plus
 * whether the author's Library is empty. A run left open by a closed app is
 * offered again; otherwise only a new author with an empty Library and no
 * recorded Tutorial state gets the offer.
 */
export function decideTutorialOffer(libraryEmpty: boolean): TutorialOffer | null {
  const { progress, status } = useTutorialStore.getState();
  if (status !== "idle" || progress.dismissedAt !== null) return null;
  if (progress.lastSection !== null) {
    const section = getSection(progress.lastSection);
    return { kind: "continue", position: { section: section.id, step: 0 } };
  }
  if (libraryEmpty && isTutorialProgressEmpty(progress)) return { kind: "start" };
  return null;
}
