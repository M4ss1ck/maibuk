/**
 * The Stopwatch as the Plugin holds it: the elapsed state from `time.ts` and the
 * Laps it marked. One Stopwatch lives for the Plugin's lifetime, in memory, and
 * every change is written to Plugin storage under one key so a restart finds it.
 * The pure arithmetic stays in `time.ts`; this module only decides when to call
 * it and what to tell the host.
 *
 * A Stopwatch never ends on its own, so nothing is held here and no Alert is
 * raised. There is no interval either: the page owns its own per-second redraw
 * while it is mounted.
 */

import type { PluginClient } from "@/plugin-sdk";
import {
  markLap,
  pauseStopwatch,
  resetStopwatch,
  startStopwatch,
  type Lap,
  type StopwatchState,
} from "./time";

/** The Plugin storage key the Stopwatch is kept under. */
const STORAGE_KEY = "stopwatch";

/** The Stopwatch the page and the Commands share. */
export interface ClockStopwatch {
  /** Reads storage once; a malformed value leaves the idle Stopwatch in place. */
  load(): Promise<void>;
  /** The Stopwatch now, as a copy. */
  snapshot(): StopwatchState;
  /** Listens for every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Runs the Stopwatch from zero, or resumes a paused one with its Laps. */
  start(): void;
  /** Freezes a running Stopwatch, banking the stretch it ran. */
  pause(): void;
  /** Pauses a running Stopwatch, otherwise starts it. */
  toggle(): void;
  /** Marks a Lap of a running Stopwatch. */
  lap(): void;
  /** Returns a fresh idle Stopwatch, dropping its Laps. */
  reset(): void;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** One stored Lap, or null when it is not the shape `time.ts` writes. */
function parseLap(value: unknown): Lap | null {
  if (typeof value !== "object" || value === null) return null;
  const lap = value as Record<string, unknown>;
  if (!isTime(lap.length) || !isTime(lap.total)) return null;
  return { length: lap.length, total: lap.total };
}

/** The stored Laps, or null when any of them is malformed. */
function parseLaps(value: unknown): Lap[] | null {
  if (!Array.isArray(value)) return null;
  const laps: Lap[] = [];
  for (const entry of value) {
    const lap = parseLap(entry);
    if (lap === null) return null;
    laps.push(lap);
  }
  return laps;
}

/** One stored Stopwatch, or the idle one when any field is not the shape `time.ts` writes. */
function parseState(value: unknown): StopwatchState {
  if (typeof value !== "object" || value === null) return { status: "idle" };
  const state = value as Record<string, unknown>;
  if (state.status === "idle") return { status: "idle" };
  const laps = parseLaps(state.laps);
  if (laps === null) return { status: "idle" };
  if (state.status === "paused") {
    return isTime(state.banked)
      ? { status: "paused", banked: state.banked, laps }
      : { status: "idle" };
  }
  if (state.status === "running") {
    if (!isTime(state.startedAt) || !isTime(state.banked)) return { status: "idle" };
    return { status: "running", startedAt: state.startedAt, banked: state.banked, laps };
  }
  return { status: "idle" };
}

/** Creates the Stopwatch, holding the state in memory and persisting every change. */
export function createStopwatch(client: PluginClient): ClockStopwatch {
  let state: StopwatchState = { status: "idle" };
  let loaded = false;
  /** True once the page or a Command changed the Stopwatch, so a slow load cannot clobber it. */
  let mutated = false;
  const listeners = new Set<() => void>();

  async function persist(): Promise<void> {
    try {
      await client.storage.set({ key: STORAGE_KEY, value: state });
    } catch {
      // A store that refuses still leaves the Stopwatch usable in memory.
    }
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function changed(): void {
    void persist();
    notify();
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
      if (mutated) return;
      state = parseState(stored);
      notify();
    },
    snapshot() {
      return state.status === "idle" ? { status: "idle" } : { ...state, laps: [...state.laps] };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (state.status === "running") return;
      mutated = true;
      state = startStopwatch(state, Date.now());
      changed();
    },
    pause() {
      if (state.status !== "running") return;
      mutated = true;
      state = pauseStopwatch(state, Date.now());
      changed();
    },
    toggle() {
      if (state.status === "running") this.pause();
      else this.start();
    },
    lap() {
      if (state.status !== "running") return;
      mutated = true;
      state = markLap(state, Date.now());
      changed();
    },
    reset() {
      mutated = true;
      state = resetStopwatch();
      changed();
    },
  };
}
