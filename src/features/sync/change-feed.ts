// The single stream of Changes every synced-entity write goes through
// (ADR 0003). A Change marks one saved edit to a Synced Item with its Origin
// (this device, or another device through a Pull) and its Change Kind
// (content/title, or metadata such as pin, order, and status). Chapter edits
// belong to their containing Book: chapter write paths emit book Changes.
// The same stream also carries the logical Library signals: a completed bulk
// operation (Backup Restore, Reset Library, loading a Database File) and
// Library availability around the Tutorial. Consumers decide their own
// reactions.
//
// Write paths emit after successful persistence, never before. Auto Sync
// listens to local Changes of both kinds; Galleries and open editors listen
// to entity Changes through the view-refresh wiring.
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

/** The bulk operation a `BulkSignal` announces once it completed. */
export type BulkReason = "restore" | "resetLibrary" | "databaseLoad";

/**
 * A bulk Library operation that replaced or cleared content (ADR 0023). Only
 * the operation that completed emits it; a failed or partially applied bulk
 * write never announces completion.
 */
export interface BulkSignal {
  scope: "all";
  reason: BulkReason;
}

/** Whether the Library is available to consumers; the Tutorial makes it unavailable while it runs. */
export interface LibraryAvailability {
  available: boolean;
  reason: "tutorial";
}

export type ChangeFeedSignal = Change | BulkSignal | LibraryAvailability;

/**
 * Per-emission context for listeners. A store's own write updates its own
 * view before returning, so `viewUpdated` tells view refresh it can skip the
 * Change; an outside writer (a Plugin, an import, a Restore) leaves views
 * stale and emits without it.
 */
export interface ChangeFeedMeta {
  viewUpdated?: true;
}

/** Meta for a store's own write, which already re-read its view. */
export const STORE_VIEW: ChangeFeedMeta = Object.freeze({ viewUpdated: true });

export type ChangeListener = (signal: ChangeFeedSignal, meta?: ChangeFeedMeta) => void | Promise<void>;

export function isEntityChange(signal: ChangeFeedSignal): signal is Change {
  return "entity" in signal;
}

export function isBulkSignal(signal: ChangeFeedSignal): signal is BulkSignal {
  return "scope" in signal;
}

export function isLibraryAvailability(signal: ChangeFeedSignal): signal is LibraryAvailability {
  return "available" in signal;
}

const listeners = new Set<ChangeListener>();

/**
 * Emit a signal to every subscriber in subscription order, awaiting async
 * ones so callers (e.g. snapshot apply) can await the resulting view
 * refresh before returning. A failing listener is reported and skipped: it
 * never turns a persisted save into a failure and never blocks the remaining
 * subscribers. Never rejects.
 */
export async function emitChange(
  signal: ChangeFeedSignal,
  meta?: ChangeFeedMeta
): Promise<void> {
  for (const listener of [...listeners]) {
    try {
      await listener(signal, meta);
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

/**
 * A handler that runs before (or on the abandonment of) a bulk Library
 * replacement: Backup Restore, Reset Library, or a Database File load. It
 * receives the replacement's reason so it can react per operation.
 */
export type BeforeBulkReplaceHandler = (reason: BulkReason) => void | Promise<void>;

const beforeBulkReplaceHandlers = new Set<BeforeBulkReplaceHandler>();
const bulkReplaceCancelledHandlers = new Set<BeforeBulkReplaceHandler>();

/**
 * Register work to run before a bulk Library replacement. The write path
 * awaits `prepareBulkReplace` before it replaces data, so a handler can stop
 * consumers (running Plugins) ahead of the replacement and remember to restart
 * them once the completion `BulkSignal` lands. A failing handler is reported
 * and skipped: it never blocks the replacement. Returns an unsubscribe
 * function.
 */
export function onBeforeBulkReplace(handler: BeforeBulkReplaceHandler): () => void {
  beforeBulkReplaceHandlers.add(handler);
  return () => {
    beforeBulkReplaceHandlers.delete(handler);
  };
}

/**
 * Register work to run when a bulk replacement is abandoned after
 * `prepareBulkReplace` and before its completion `BulkSignal` (a Restore, a
 * Reset, or a load that failed). It lets a handler that stopped consumers
 * restart them anyway, under a plain restart. Returns an unsubscribe function.
 */
export function onBulkReplaceCancelled(handler: BeforeBulkReplaceHandler): () => void {
  bulkReplaceCancelledHandlers.add(handler);
  return () => {
    bulkReplaceCancelledHandlers.delete(handler);
  };
}

/**
 * Runs every handler in one seam, in subscription order, awaiting each before
 * the next. A throwing handler is reported under `label` and skipped: it never
 * blocks the remaining handlers. The two seams (`prepareBulkReplace` and
 * `cancelBulkReplace`) differ only in their handler set and their log label.
 * Never rejects.
 */
async function runBulkReplaceHandlers(
  handlers: Set<BeforeBulkReplaceHandler>,
  reason: BulkReason,
  label: string
): Promise<void> {
  for (const handler of [...handlers]) {
    try {
      await handler(reason);
    } catch (error) {
      console.error(`[change-feed] ${label} handler failed:`, error);
    }
  }
}

/**
 * Announce a bulk Library replacement, in subscription order, awaiting every
 * handler before returning. The write path calls it before replacing data, so
 * by the time the replacement begins every handler has settled. Never rejects.
 */
export async function prepareBulkReplace(reason: BulkReason): Promise<void> {
  await runBulkReplaceHandlers(beforeBulkReplaceHandlers, reason, "before-bulk-replace");
}

/**
 * Announce that a prepared bulk replacement was abandoned before its
 * completion signal, awaiting every cancel handler like `prepareBulkReplace`.
 * Never rejects.
 */
export async function cancelBulkReplace(reason: BulkReason): Promise<void> {
  await runBulkReplaceHandlers(bulkReplaceCancelledHandlers, reason, "bulk-replace-cancelled");
}

export function resetChangeFeedForTests(): void {
  listeners.clear();
  beforeBulkReplaceHandlers.clear();
  bulkReplaceCancelledHandlers.clear();
}
