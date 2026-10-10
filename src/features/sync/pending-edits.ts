// Editors hold keystrokes in a debounced save for about a second. Before a sync
// reads the database, before it applies a pulled change, and before a local
// write from outside a store, those pending saves must land; otherwise the
// write would replace text that never reached the database. Editors register a
// flush while mounted.

import type { ChangeFeedMeta, ChangeOrigin } from "@/features/sync/change-feed";

type Flush = () => unknown;

const flushes = new Set<Flush>();

/** Some open editor could not save what it holds, so the Library is missing edits. */
export class PendingEditsFlushError extends Error {
  readonly causes: unknown[];

  constructor(causes: unknown[]) {
    super("Unsaved edits could not be saved; sync stopped");
    this.name = "PendingEditsFlushError";
    this.causes = causes;
  }
}

export function registerPendingEditsFlush(flush: Flush): () => void {
  flushes.add(flush);
  return () => {
    flushes.delete(flush);
  };
}

/**
 * Run every registered flush and wait for the saves. A failed save does not
 * stop the others from landing, but the whole flush rejects afterwards: reading
 * the Library now would treat the unsaved text as if it never existed.
 */
export async function flushPendingEdits(): Promise<void> {
  const results = await Promise.allSettled([...flushes].map(async (flush) => flush()));
  const causes = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (causes.length > 0) throw new PendingEditsFlushError(causes);
}

/**
 * A local write from outside a store flushes open editors before it touches
 * the database: outside content would otherwise replace keystrokes the editor
 * still holds (ADR 0002). A store's own write runs inside that flush itself
 * (STORE_VIEW), and a remote write was preceded by one, so neither flushes
 * here. Rejects with PendingEditsFlushError before anything is written when an
 * open editor cannot save what it holds.
 */
export async function flushForOutsideWrite(
  origin: ChangeOrigin,
  viewMeta?: ChangeFeedMeta
): Promise<void> {
  if (origin !== "local" || viewMeta?.viewUpdated) return;
  await flushPendingEdits();
}

export function resetPendingEditsForTests(): void {
  flushes.clear();
}
