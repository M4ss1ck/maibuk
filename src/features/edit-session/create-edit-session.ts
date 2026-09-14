import { createAsyncQueue, type AsyncQueue } from "@/lib/async-queue";

export type EditSessionStatus = "idle" | "saving" | "saved" | "error";

export interface EditSessionClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EditSessionOptions<T> {
  /** The content as stored when the editor opened. */
  initial: T;
  /** Writes the content and resolves with it exactly as stored (ADR 0002). */
  save: (content: T) => Promise<T>;
  /** Content changed outside this editor (a Pull, a Restore): show it. */
  onExternal?: (content: T) => void;
  /** Hands over input the editor still holds, synchronously, before a Flush. */
  beforeFlush?: () => void;
  /** Serializes these saves with other writes to the same item. */
  queue?: AsyncQueue;
  clock?: EditSessionClock;
  equals?: (a: T, b: T) => boolean;
  saveDelayMs?: number;
  savedStatusMs?: number;
}

export interface EditSession<T> {
  /** The author changed the content; it is saved once they pause. */
  update(content: T): void;
  /**
   * Content arrived from the store. The session's own save coming back is
   * ignored; anything else replaces what the editor holds.
   */
  externalContent(content: T): void;
  /** Save now, including held input, whether or not anything changed. Rejects when it fails. */
  save(): Promise<void>;
  /** Save what is unsaved, or wait for the save already running. Rejects when it fails. */
  flush(): Promise<void>;
  /** Flush and close. Content updated after this is saved at once. */
  dispose(): Promise<void>;
  getContent(): T;
  getStatus(): EditSessionStatus;
  hasUnsavedChanges(): boolean;
  isDisposed(): boolean;
  subscribe(listener: (status: EditSessionStatus) => void): () => void;
}

const SAVE_DELAY_MS = 1000;
const SAVED_STATUS_MS = 2000;

const systemClock: EditSessionClock = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const ignore = () => {};

export function createEditSession<T>(options: EditSessionOptions<T>): EditSession<T> {
  const clock = options.clock ?? systemClock;
  const queue = options.queue ?? createAsyncQueue();
  const equals = options.equals ?? Object.is;
  const saveDelayMs = options.saveDelayMs ?? SAVE_DELAY_MS;
  const savedStatusMs = options.savedStatusMs ?? SAVED_STATUS_MS;
  const listeners = new Set<(status: EditSessionStatus) => void>();

  let content = options.initial;
  // What the store holds as far as this session knows: its last save's result,
  // or the outside content it adopted. Its own echo matches this exactly.
  let stored = options.initial;
  // Edits are counted so a save that started before a newer keystroke does not
  // mark that keystroke as saved.
  let edits = 0;
  let savedEdits = 0;
  let status: EditSessionStatus = "idle";
  let saveTimer: unknown = null;
  let statusTimer: unknown = null;
  let savesInFlight = 0;
  let pendingIncoming: { content: T } | null = null;
  let disposed = false;
  let disposal: Promise<void> | null = null;

  function setStatus(next: EditSessionStatus) {
    if (statusTimer !== null) {
      clock.clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (next !== status) {
      status = next;
      for (const listener of listeners) listener(status);
    }
    // A closed editor shows nothing, so it leaves no timer behind.
    if (next === "saved" && !disposed) {
      statusTimer = clock.setTimeout(() => {
        statusTimer = null;
        setStatus("idle");
      }, savedStatusMs);
    }
  }

  function cancelScheduledSave() {
    if (saveTimer !== null) {
      clock.clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  function runSave(): Promise<void> {
    savesInFlight += 1;
    const task = queue.enqueue(async () => {
      // Read at run time: a save queued behind another carries the newest text.
      const editsAtStart = edits;
      const text = content;
      setStatus("saving");
      let result: T;
      try {
        result = await options.save(text);
      } catch (error) {
        setStatus("error");
        throw error;
      }
      stored = result;
      if (savedEdits < editsAtStart) savedEdits = editsAtStart;
      setStatus("saved");
    });
    const settle = () => {
      savesInFlight -= 1;
      decidePendingIncoming();
    };
    task.then(settle, settle);
    return task;
  }

  // The store publishes a save before the save resolves, so content arriving
  // mid-save cannot be judged until the stored result is known.
  function decidePendingIncoming() {
    if (pendingIncoming === null) return;
    // Its own save's echo, possibly still waiting while a newer save runs.
    if (equals(pendingIncoming.content, stored)) {
      pendingIncoming = null;
      return;
    }
    if (savesInFlight > 0) return;
    const incoming = pendingIncoming.content;
    pendingIncoming = null;
    adoptIfOutside(incoming);
  }

  function adoptIfOutside(incoming: T) {
    if (disposed || equals(incoming, stored)) return;
    stored = incoming;
    if (equals(incoming, content)) return;
    cancelScheduledSave();
    content = incoming;
    savedEdits = edits;
    if (status === "error") setStatus("idle");
    options.onExternal?.(incoming);
  }

  async function flush(): Promise<void> {
    options.beforeFlush?.();
    cancelScheduledSave();
    if (savesInFlight > 0) {
      await queue.enqueue(async () => {});
    }
    if (edits !== savedEdits) await runSave();
  }

  return {
    update(next) {
      content = next;
      edits += 1;
      if (disposed) {
        // The editor drains its last keystrokes while it unmounts, after the
        // session closed; a timer scheduled now would never be waited for.
        void runSave().catch(ignore);
        return;
      }
      cancelScheduledSave();
      saveTimer = clock.setTimeout(() => {
        saveTimer = null;
        void runSave().catch(ignore);
      }, saveDelayMs);
    },

    externalContent(incoming) {
      if (disposed) return;
      if (savesInFlight > 0) {
        // An echo of a save that already landed can arrive after a newer save
        // began; only an outside change waits for the running saves to settle.
        pendingIncoming = equals(incoming, stored) ? null : { content: incoming };
        return;
      }
      adoptIfOutside(incoming);
    },

    save() {
      options.beforeFlush?.();
      cancelScheduledSave();
      return runSave();
    },

    flush,

    dispose() {
      if (disposal) return disposal;
      disposed = true;
      pendingIncoming = null;
      if (statusTimer !== null) {
        clock.clearTimeout(statusTimer);
        statusTimer = null;
      }
      disposal = flush();
      return disposal;
    },

    getContent: () => content,
    getStatus: () => status,
    hasUnsavedChanges: () => edits !== savedEdits,
    isDisposed: () => disposed,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
