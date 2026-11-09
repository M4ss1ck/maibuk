/**
 * Debounced autosave (#745): the editor never waits for a Save button, yet a
 * burst of edits saves once and two saves never overlap.
 */

import { describe, expect, it, vi } from "vitest";
import { createAutosave } from "./autosave";

/** Timer controls the test advances by hand. */
function manualTimers() {
  let next = 0;
  const timers = new Map<number, () => void>();
  return {
    setTimer(callback: () => void): number {
      const handle = ++next;
      timers.set(handle, callback);
      return handle;
    },
    clearTimer(handle: unknown): void {
      timers.delete(handle as number);
    },
    runAll(): void {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
    size(): number {
      return timers.size;
    },
  };
}

describe("createAutosave", () => {
  it("debounces a burst of edits and saves only the last document", async () => {
    const saves: string[] = [];
    const timers = manualTimers();
    const autosave = createAutosave<string>({
      save: async (doc) => {
        saves.push(doc);
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    autosave.schedule("a");
    autosave.schedule("b");
    autosave.schedule("c");
    expect(timers.size()).toBe(1);

    timers.runAll();
    await autosave.flush();
    expect(saves).toEqual(["c"]);
  });

  it("saves a pending document immediately on flush and clears its timer", async () => {
    const saves: string[] = [];
    const timers = manualTimers();
    const autosave = createAutosave<string>({
      save: async (doc) => {
        saves.push(doc);
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    autosave.schedule("closing");
    expect(timers.size()).toBe(1);

    await autosave.flush();

    expect(saves).toEqual(["closing"]);
    expect(timers.size()).toBe(0);
    timers.runAll();
    expect(saves).toEqual(["closing"]);
  });

  it("never overlaps saves: a schedule during a save waits for it", async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const saves: string[] = [];
    const timers = manualTimers();
    const autosave = createAutosave<string>({
      save: async (doc) => {
        saves.push(doc);
        if (doc === "first") await first;
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    autosave.schedule("first");
    timers.runAll();
    await vi.waitFor(() => expect(saves).toEqual(["first"]));

    autosave.schedule("second");
    timers.runAll();
    await Promise.resolve();
    await Promise.resolve();
    expect(saves).toEqual(["first"]);

    releaseFirst();
    await autosave.flush();
    expect(saves).toEqual(["first", "second"]);
  });

  it("gives a schedule during a save its own quiet period", async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstDone = false;
    const saves: string[] = [];
    const timers = manualTimers();
    const autosave = createAutosave<string>({
      save: async (doc) => {
        saves.push(doc);
        if (doc === "first") {
          await first;
          firstDone = true;
        }
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    autosave.schedule("first");
    timers.runAll();
    await vi.waitFor(() => expect(saves).toEqual(["first"]));

    autosave.schedule("second");
    releaseFirst();
    await vi.waitFor(() => expect(firstDone).toBe(true));
    await Promise.resolve();
    await Promise.resolve();
    expect(saves).toEqual(["first"]);
    expect(timers.size()).toBe(1);

    timers.runAll();
    await autosave.flush();
    expect(saves).toEqual(["first", "second"]);
  });

  it("reports a failed save and keeps the document pending for the next flush", async () => {
    let attempts = 0;
    const errors: unknown[] = [];
    const timers = manualTimers();
    const autosave = createAutosave<string>({
      save: async () => {
        attempts++;
        if (attempts === 1) throw new Error("storage-full");
      },
      onError: (error) => errors.push(error),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    autosave.schedule("kept");
    timers.runAll();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBeInstanceOf(Error);
    expect(attempts).toBe(1);

    await autosave.flush();
    expect(attempts).toBe(2);
  });

  it("uses a 600 ms timer when none is injected", async () => {
    vi.useFakeTimers();
    try {
      const saves: string[] = [];
      const autosave = createAutosave<string>({
        save: async (doc) => {
          saves.push(doc);
        },
      });

      autosave.schedule("later");
      await vi.advanceTimersByTimeAsync(599);
      expect(saves).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(saves).toEqual(["later"]));
    } finally {
      vi.useRealTimers();
    }
  });
});
