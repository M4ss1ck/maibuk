/**
 * The Timer as the Plugin holds it: the deadline-based state from `time.ts`,
 * the last lengths it ran, and the Alert that ends it. One Timer lives for the
 * Plugin's lifetime, in memory, and every change is written to Plugin storage
 * under one key so a restart finds it. The pure arithmetic stays in `time.ts`;
 * this module only decides when to call it and what to tell the host.
 *
 * Only the end's `setTimeout` is held here, and only while running, so the
 * stored state never reads "running" past its deadline. There is no interval:
 * the page owns its own per-second redraw while it is mounted.
 */

import type { PluginClient } from "@/plugin-sdk";
import { translate } from "./i18n";
import {
  addRecentLength,
  formatClockTime,
  formatDuration,
  hourCycleFor,
  pauseTimer,
  reconcileTimer,
  resetTimer,
  setTimerLength,
  startTimer,
  type TimerState,
} from "./time";

/** The System Notification id the Timer's end is scheduled under. */
export const TIMER_NOTIFICATION_ID = "timer";

/** The Plugin storage key the Timer is kept under. */
const STORAGE_KEY = "timer";

/** A new Timer runs for 25 minutes, the glossary's default. */
const DEFAULT_LENGTH = 1_500_000;

/** What the Timer keeps: its state and the lengths it ran most recently. */
export interface TimerSnapshot {
  state: TimerState;
  recent: number[];
}

/** The Timer the page and the Command share. */
export interface ClockTimer {
  /** Reads storage once; a malformed value leaves the default Timer in place. */
  load(): Promise<void>;
  /** The Timer now, as a copy. */
  snapshot(): TimerSnapshot;
  /** Listens for every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Runs from the full length (idle or ended) or from what is left (paused). */
  start(): void;
  /** Freezes a running Timer. */
  pause(): void;
  /** Pauses a running Timer, otherwise starts it. */
  toggle(): void;
  /** Returns to idle, keeping the length. */
  reset(): void;
  /** Sets a new length, returning the Timer to idle. */
  setLength(ms: number): void;
  /** The language the Alert's title and body are written in. */
  setLanguage(language: string): void;
}

const DEFAULT_SNAPSHOT: TimerSnapshot = {
  state: { status: "idle", length: DEFAULT_LENGTH },
  recent: [],
};

function isLength(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** One stored state, or null when any field is not the shape `time.ts` writes. */
function parseState(value: unknown): TimerState | null {
  if (typeof value !== "object" || value === null) return null;
  const state = value as Record<string, unknown>;
  const { status, length } = state;
  if (!isLength(length)) return null;
  if (status === "idle") return { status, length };
  if (status === "running") {
    return isLength(state.endsAt) ? { status, length, endsAt: state.endsAt } : null;
  }
  if (status === "paused") {
    return isLength(state.remaining) ? { status, length, remaining: state.remaining } : null;
  }
  if (status === "ended") {
    return isLength(state.endedAt) ? { status, length, endedAt: state.endedAt } : null;
  }
  return null;
}

/** What storage held, or the default Timer when it is malformed or empty. */
function parseStored(value: unknown): TimerSnapshot {
  if (typeof value !== "object" || value === null) return DEFAULT_SNAPSHOT;
  const stored = value as Record<string, unknown>;
  const state = parseState(stored.state);
  if (state === null) return DEFAULT_SNAPSHOT;
  const recent =
    Array.isArray(stored.recent) && stored.recent.every(isLength) ? [...stored.recent] : [];
  return { state, recent };
}

/** Creates the Timer, holding the state in memory and persisting every change. */
export function createTimer(client: PluginClient): ClockTimer {
  let snapshot: TimerSnapshot = DEFAULT_SNAPSHOT;
  let language = "en";
  let loaded = false;
  /** True once the page or a Command changed the Timer, so a slow load cannot clobber it. */
  let mutated = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  async function persist(): Promise<void> {
    try {
      await client.storage.set({ key: STORAGE_KEY, value: snapshot });
    } catch {
      // A store that refuses still leaves the Timer usable in memory.
    }
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function changed(): void {
    void persist();
    notify();
  }

  function clearTimeoutForEnd(): void {
    if (timeout === null) return;
    clearTimeout(timeout);
    timeout = null;
  }

  /**
   * Holds the one timeout that reconciles the state at the deadline, and holds
   * it again when it fires early (a late clock adjustment left the deadline
   * ahead): the state stays "running" until the deadline is really reached.
   */
  function holdEnd(endsAt: number): void {
    clearTimeoutForEnd();
    timeout = setTimeout(
      () => {
        timeout = null;
        const result = reconcileTimer(snapshot.state, Date.now());
        if (result.endedAt === null) {
          if (snapshot.state.status === "running") holdEnd(snapshot.state.endsAt);
          return;
        }
        snapshot = { ...snapshot, state: result.state };
        changed();
      },
      Math.max(0, endsAt - Date.now())
    );
  }

  function scheduleAlert(endsAt: number): void {
    void client.notifications
      .system({
        id: TIMER_NOTIFICATION_ID,
        title: translate(language, "timer"),
        body: translate(language, "timerEnded").replace(
          "{length}",
          formatDuration(snapshot.state.length)
        ),
        at: endsAt,
      })
      .catch(() => {});
  }

  function cancelAlert(): void {
    void client.notifications.cancel({ id: TIMER_NOTIFICATION_ID }).catch(() => {});
  }

  /**
   * Tells the author, once, that a Timer ended while Maibuk was closed. Only a
   * device that granted the permission and fires a scheduled Alert while closed
   * (Android) already told them; one that was refused never posted it, and one
   * that cannot answer or show an Alert leaves them without a toast.
   */
  async function reportEndedWhileClosed(endedAt: number): Promise<void> {
    const status = await client.notifications.systemStatus();
    if (status.permission === "granted" && status.canScheduleWhileClosed) return;
    const time = formatClockTime(
      endedAt,
      new Date(endedAt).getTimezoneOffset(),
      hourCycleFor(language)
    );
    await client.notifications.show({
      variant: "info",
      message: translate(language, "timerEndedWhileClosed").replace("{time}", time),
    });
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
      snapshot = parseStored(stored);
      const result = reconcileTimer(snapshot.state, Date.now());
      if (result.endedAt !== null) {
        snapshot = { ...snapshot, state: result.state };
        await persist();
        notify();
        try {
          await reportEndedWhileClosed(result.endedAt);
        } catch {
          // A device that cannot say or show it leaves the author without a toast.
        }
        return;
      }
      if (snapshot.state.status === "running") {
        // Desktop and the web forget a scheduled Alert when Maibuk closes, so it
        // is sent again, and the end deadline is held again.
        scheduleAlert(snapshot.state.endsAt);
        holdEnd(snapshot.state.endsAt);
      }
      notify();
    },
    snapshot() {
      return { state: snapshot.state, recent: [...snapshot.recent] };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (snapshot.state.length === 0) return;
      mutated = true;
      const now = Date.now();
      if (snapshot.state.status === "idle" || snapshot.state.status === "ended") {
        snapshot = {
          ...snapshot,
          recent: addRecentLength(snapshot.recent, snapshot.state.length),
        };
      }
      snapshot = { ...snapshot, state: startTimer(snapshot.state, now) };
      if (snapshot.state.status !== "running") return;
      scheduleAlert(snapshot.state.endsAt);
      holdEnd(snapshot.state.endsAt);
      changed();
    },
    pause() {
      if (snapshot.state.status !== "running") return;
      mutated = true;
      snapshot = { ...snapshot, state: pauseTimer(snapshot.state, Date.now()) };
      clearTimeoutForEnd();
      cancelAlert();
      changed();
    },
    toggle() {
      if (snapshot.state.status === "running") this.pause();
      else this.start();
    },
    reset() {
      mutated = true;
      snapshot = { ...snapshot, state: resetTimer(snapshot.state) };
      clearTimeoutForEnd();
      cancelAlert();
      changed();
    },
    setLength(ms) {
      mutated = true;
      snapshot = { ...snapshot, state: setTimerLength(snapshot.state, ms) };
      clearTimeoutForEnd();
      cancelAlert();
      changed();
    },
    setLanguage(next) {
      language = next;
    },
  };
}
