// The single stream of Changes every synced-entity write goes through
// (ADR 0003). A Change marks one saved edit to a Synced Item with its Origin
// (this device, or another device through a Pull) and its Change Kind
// (content/title, or metadata such as pin, order, and status). Chapter edits
// belong to their containing Book: chapter write paths emit book Changes.
//
// Write paths emit after successful persistence, never before. Auto Sync
// listens to local Changes of both kinds; Galleries and open editors listen
// to remote ones through the view-refresh wiring.
//
// Dependency-free on purpose: data write paths import this without pulling
// the sync stack in.

export type ChangeEntity = "book" | "note" | "canvas";
export type ChangeOrigin = "local" | "remote";
export type ChangeKind = "content" | "metadata";

export interface Change {
  entity: ChangeEntity;
  /** Book id, note id, or canvas id. For chapters, the containing book's id. */
  id: string;
  origin: ChangeOrigin;
  kind: ChangeKind;
}

export type ChangeListener = (change: Change) => void | Promise<void>;

const listeners = new Set<ChangeListener>();

/**
 * Emit a Change to every subscriber in subscription order, awaiting async
 * ones so callers (e.g. snapshot apply) can await the resulting view
 * refresh before returning. A failing listener is reported and skipped: it
 * never turns a persisted save into a failure and never blocks the remaining
 * subscribers. Never rejects.
 */
export async function emitChange(change: Change): Promise<void> {
  for (const listener of [...listeners]) {
    try {
      await listener(change);
    } catch (error) {
      console.error("[change-feed] subscriber failed:", error);
    }
  }
}

export function onChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetChangeFeedForTests(): void {
  listeners.clear();
}
