/**
 * The Clock's open tab: which of the four panels the page shows. It opens on
 * Pomodoro, and the tab the author last picked is written to Plugin storage,
 * which lives in this device's database and is never synced, so each device
 * reopens on its own last tab. Imports only `@/plugin-sdk` types.
 */

import type { PluginClient } from "@/plugin-sdk";

/** The Clock's tabs, in the order the section bar shows them. */
export const CLOCK_TABS = ["pomodoro", "timer", "stopwatch", "alarms"] as const;

export type ClockTab = (typeof CLOCK_TABS)[number];

/** The tab a device with no stored tab opens on. */
export const DEFAULT_CLOCK_TAB: ClockTab = "pomodoro";

/** The Plugin storage key the last tab is kept under. */
const STORAGE_KEY = "tab";

export function isClockTab(value: unknown): value is ClockTab {
  return typeof value === "string" && (CLOCK_TABS as readonly string[]).includes(value);
}

/** The tab the page and the Frames share. */
export interface ClockTabState {
  /** Reads storage once; a missing or unknown value leaves Pomodoro in place. */
  load(): Promise<void>;
  /** The open tab now. */
  snapshot(): ClockTab;
  /** Listens for every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Opens `tab` and writes it to storage; listeners hear only a real change. */
  select(tab: ClockTab): void;
}

export function createClockTab(client: PluginClient): ClockTabState {
  let tab: ClockTab = DEFAULT_CLOCK_TAB;
  let loaded = false;
  /** True once the author picked a tab, so a slow load cannot take it back. */
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
      if (mutated || !isClockTab(stored) || stored === tab) return;
      tab = stored;
      notify();
    },
    snapshot() {
      return tab;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(next) {
      mutated = true;
      // Written even when `next` is already open: before load settles, the
      // stored tab may still differ from the one on screen.
      void client.storage.set({ key: STORAGE_KEY, value: next }).catch(() => {
        // A store that refuses still leaves the tab open for this session.
      });
      if (next === tab) return;
      tab = next;
      notify();
    },
  };
}
