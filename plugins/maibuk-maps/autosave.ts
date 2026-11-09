/**
 * Debounced autosave for one open Map (#745). The editor has no Save button:
 * every edit schedules the latest Map document, and a quiet period after the
 * last edit it is written once. Saves are serialized, so a schedule taken while
 * a save is in flight waits for it instead of overlapping it, and closing the
 * editor can `flush` the pending document before the page goes away.
 *
 * A failed save is handed to `onError`; the document it was saving stays
 * pending, so the next `flush` or edit retries it. This module imports only its
 * own files.
 */

/** The default quiet period before a scheduled Map is written. */
export const AUTOSAVE_DELAY_MS = 600;

export interface AutosaveOptions<Doc> {
  save(doc: Doc): Promise<void>;
  /** Quiet time before a scheduled save; defaults to 600 ms. */
  delayMs?: number;
  /** Receives every save failure; the document stays pending. */
  onError?: (error: unknown) => void;
  /** Injectable for tests; defaults to `setTimeout`. */
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  /** Injectable for tests; defaults to `clearTimeout`. */
  clearTimer?: (handle: unknown) => void;
}

export interface Autosave<Doc> {
  /** Replaces the pending document and restarts the quiet period. */
  schedule(doc: Doc): void;
  /** Writes a pending document now, after any save already in flight. */
  flush(): Promise<void>;
}

export function createAutosave<Doc>(options: AutosaveOptions<Doc>): Autosave<Doc> {
  const delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
  const setTimer =
    options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let timer: unknown = null;
  let hasTimer = false;
  let pending: { doc: Doc } | null = null;
  let queue: Promise<void> = Promise.resolve();

  function stopTimer(): void {
    if (!hasTimer) return;
    clearTimer(timer);
    timer = null;
    hasTimer = false;
  }

  /** Writes the pending document, and any newer one that arrived meanwhile. */
  async function drain(): Promise<void> {
    while (pending !== null && !hasTimer) {
      const doc = pending.doc;
      pending = null;
      try {
        await options.save(doc);
      } catch (error) {
        // A newer edit already replaced this document; keep the newer one.
        if (pending === null) pending = { doc };
        options.onError?.(error);
        return;
      }
    }
  }

  function enqueue(): Promise<void> {
    queue = queue.then(drain).catch(() => {});
    return queue;
  }

  return {
    schedule(doc) {
      pending = { doc };
      stopTimer();
      hasTimer = true;
      timer = setTimer(() => {
        timer = null;
        hasTimer = false;
        void enqueue();
      }, delayMs);
    },

    flush() {
      stopTimer();
      return enqueue();
    },
  };
}
