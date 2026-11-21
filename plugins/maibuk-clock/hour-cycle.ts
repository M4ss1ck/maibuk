/**
 * The Clock's 24-Hour Clock setting: whether every time of day reads from
 * 00:00 to 23:59 or in 12-hour form with AM and PM. It is on by default, and the
 * author's choice is written to Plugin storage, which lives in this device's
 * database and is never synced, so each device keeps its own hour cycle.
 * Imports only `@/plugin-sdk` types.
 */

import type { PluginClient } from "@/plugin-sdk";

/** The hour cycles a device can show. */
export type HourCycle = 12 | 24;

/** The hour cycle a device with no stored value shows: the 24-Hour Clock is on. */
export const DEFAULT_HOUR_CYCLE: HourCycle = 24;

/** The Plugin storage key the 24-Hour Clock setting is kept under. */
const STORAGE_KEY = "hourCycle";

export function isHourCycle(value: unknown): value is HourCycle {
  return value === 12 || value === 24;
}

/** The hour cycle the page and the Frames share. */
export interface ClockHourCycle {
  /** Reads storage once; a missing or unknown value leaves 24 in place. */
  load(): Promise<void>;
  /** The hour cycle now. */
  snapshot(): HourCycle;
  /** Listens for every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Sets the hour cycle and writes it to storage; listeners hear only a real change. */
  set(next: HourCycle): void;
}

export function createHourCycle(client: PluginClient): ClockHourCycle {
  let hourCycle: HourCycle = DEFAULT_HOUR_CYCLE;
  let loaded = false;
  /** True once the author picked an hour cycle, so a slow load cannot take it back. */
  let mutated = false;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  return {
    async load() {
      if (loaded) return;
      loaded = true;
      let stored: unknown;
      try {
        stored = await client.storage.get({ key: STORAGE_KEY });
      } catch {
        return;
      }
      if (mutated || !isHourCycle(stored) || stored === hourCycle) return;
      hourCycle = stored;
      notify();
    },
    snapshot() {
      return hourCycle;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      mutated = true;
      // Written even when `next` is already shown: before load settles, the
      // stored hour cycle may still differ from the one on screen.
      void client.storage.set({ key: STORAGE_KEY, value: next }).catch(() => {
        // A store that refuses still leaves the hour cycle for this session.
      });
      if (next === hourCycle) return;
      hourCycle = next;
      notify();
    },
  };
}
