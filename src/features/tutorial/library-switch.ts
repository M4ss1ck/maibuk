// The Tutorial Library switch (ADR 0008). While it is on, `getDatabase()`
// hands out an in-memory Library holding only sample content, so nothing the
// Tutorial shows can reach disk, Sync, Backups, or Metrics by construction.
//
// Dependency-free on purpose: the database module, write paths, and every
// background job import this without pulling the Tutorial in. Every job that
// touches the Library checks `isTutorialLibraryActive()` and does nothing
// while it is on.

import type { DatabaseAdapter } from "@/lib/platform/types";

/** Every sample id starts with this, so a leak into the author's Library is detectable. */
export const TUTORIAL_ID_PREFIX = "tutorial-";

let tutorialDatabase: DatabaseAdapter | null = null;
let runInProgress = false;
const authorLibraryWork = new Set<Promise<unknown>>();

export function isTutorialLibraryActive(): boolean {
  return tutorialDatabase !== null;
}

/**
 * True from the moment a run is requested until the author is back where
 * they were, including the screen changes around the switch itself. Where
 * the Tutorial goes is never recorded as where the author was.
 */
export function isTutorialRunInProgress(): boolean {
  return runInProgress || tutorialDatabase !== null;
}

export function setTutorialRunInProgress(value: boolean): void {
  runInProgress = value;
}

/** The in-memory Library while the Tutorial runs, otherwise null. */
export function getTutorialDatabase(): DatabaseAdapter | null {
  return tutorialDatabase;
}

export function activateTutorialDatabase(database: DatabaseAdapter): void {
  tutorialDatabase = database;
}

/** Switches back to the author's Library and returns the in-memory one so it can be closed. */
export function deactivateTutorialDatabase(): DatabaseAdapter | null {
  const previous = tutorialDatabase;
  tutorialDatabase = null;
  return previous;
}

export function isTutorialId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(TUTORIAL_ID_PREFIX);
}

/** Thrown when a write path is asked to store sample content in the author's Library. */
export class TutorialIdLeakError extends Error {
  constructor(id: string) {
    super(`Refusing to write Tutorial content (${id}) to the author's Library`);
    this.name = "TutorialIdLeakError";
  }
}

/**
 * Second defence behind the switch: the per-entity write paths call this with
 * every id they are about to write. Sample ids are refused while the author's
 * Library is active.
 */
export function assertWritableId(id: string | null | undefined): void {
  if (!isTutorialLibraryActive() && typeof id === "string" && isTutorialId(id)) {
    throw new TutorialIdLeakError(id);
  }
}

/**
 * Registers fire-and-forget work against the author's Library that started
 * before a switch (an editor's close Checkpoint). The switch waits for it, so
 * work that began in one Library never finishes in the other.
 */
export function trackAuthorLibraryWork<T>(work: Promise<T>): Promise<T> {
  authorLibraryWork.add(work);
  const release = () => {
    authorLibraryWork.delete(work);
  };
  work.then(release, release);
  return work;
}

export async function settleAuthorLibraryWork(): Promise<void> {
  while (authorLibraryWork.size > 0) {
    await Promise.allSettled([...authorLibraryWork]);
  }
}

export function resetLibrarySwitchForTests(): void {
  tutorialDatabase = null;
  runInProgress = false;
  authorLibraryWork.clear();
}
