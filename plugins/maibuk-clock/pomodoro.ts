/**
 * The Pomodoro Cycle as the Plugin holds it: the deadline-based state and
 * arithmetic from `cycle.ts`, the settings it runs with, the Pomodoros finished
 * today, and the Alert that ends each phase. One Cycle lives for the Plugin's
 * lifetime, in memory, and every change is written to Plugin storage under one
 * key so a restart finds it. The pure arithmetic stays in `cycle.ts`; this
 * module only decides when to call it and what to tell the host.
 *
 * Only the phase end's `setTimeout` is held here, and only while running, so the
 * stored state never reads "running" past its deadline. There is no interval:
 * the page owns its own per-second redraw while it is mounted.
 */

import type { PluginClient } from "@/plugin-sdk";
import {
  addPomodoro,
  advanceCycle,
  DEFAULT_POMODORO_SETTINGS,
  INITIAL_CYCLE,
  pauseCycle,
  reconcileCycle,
  resetCycle,
  startCycle,
  type CycleState,
  type Phase,
  type PomodoroSettings,
  type TodayCount,
} from "./cycle";
import { translate } from "./i18n";

/** The System Notification id each phase's end is scheduled under. */
export const POMODORO_NOTIFICATION_ID = "pomodoro";

/** The Plugin storage key the Cycle is kept under. */
const STORAGE_KEY = "pomodoro";

/** What the Cycle keeps: where it stands, how it runs, and today's Pomodoros. */
export interface PomodoroSnapshot {
  state: CycleState;
  settings: PomodoroSettings;
  today: TodayCount;
}

/** The Cycle the page and the Commands share. */
export interface ClockPomodoro {
  /** Reads storage once; a passed deadline is reported and left ended. */
  load(): Promise<{ phase: Phase; endedAt: number } | null>;
  /** The Cycle now, as a copy. */
  snapshot(): PomodoroSnapshot;
  /** Listens for every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Runs the phase from its full length, or from what is left when paused. */
  start(): void;
  /** Freezes a running phase. */
  pause(): void;
  /** Pauses a running phase, otherwise starts it. */
  toggle(): void;
  /** Moves to the next phase, counting no Pomodoro. */
  skip(): void;
  /** Returns the Cycle to its first Pomodoro, idle. */
  reset(): void;
  /** Merges settings into the ones the Cycle runs with. */
  setSettings(patch: Partial<PomodoroSettings>): void;
  /** The language the Alert's title and body are written in. */
  setLanguage(language: string): void;
}

const DEFAULT_TODAY: TodayCount = { day: 0, count: 0 };

const DEFAULT_SNAPSHOT: PomodoroSnapshot = {
  state: INITIAL_CYCLE,
  settings: DEFAULT_POMODORO_SETTINGS,
  today: DEFAULT_TODAY,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPhase(value: unknown): value is Phase {
  return value === "pomodoro" || value === "shortBreak" || value === "longBreak";
}

function isPomodoroNumber(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

function isMinutes(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

/** One stored phase state, or null when any field is not the shape `cycle.ts` writes. */
function parseState(value: unknown): CycleState | null {
  if (typeof value !== "object" || value === null) return null;
  const state = value as Record<string, unknown>;
  const { phase, pomodoro } = state;
  if (!isPhase(phase) || !isPomodoroNumber(pomodoro)) return null;
  const base = { phase, pomodoro };
  if (state.status === "idle") return { ...base, status: "idle" };
  if (state.status === "running") {
    return isFiniteNumber(state.endsAt) && state.endsAt >= 0
      ? { ...base, status: "running", endsAt: state.endsAt }
      : null;
  }
  if (state.status === "paused") {
    return isFiniteNumber(state.remaining) && state.remaining >= 0
      ? { ...base, status: "paused", remaining: state.remaining }
      : null;
  }
  if (state.status === "ended") {
    return isFiniteNumber(state.endedAt)
      ? { ...base, status: "ended", endedAt: state.endedAt }
      : null;
  }
  return null;
}

/** The stored settings, each malformed field taking its default on its own. */
function parseSettings(value: unknown): PomodoroSettings {
  const stored =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    pomodoroMinutes: isMinutes(stored.pomodoroMinutes)
      ? stored.pomodoroMinutes
      : DEFAULT_POMODORO_SETTINGS.pomodoroMinutes,
    shortBreakMinutes: isMinutes(stored.shortBreakMinutes)
      ? stored.shortBreakMinutes
      : DEFAULT_POMODORO_SETTINGS.shortBreakMinutes,
    longBreakMinutes: isMinutes(stored.longBreakMinutes)
      ? stored.longBreakMinutes
      : DEFAULT_POMODORO_SETTINGS.longBreakMinutes,
    longBreakEvery: isMinutes(stored.longBreakEvery)
      ? stored.longBreakEvery
      : DEFAULT_POMODORO_SETTINGS.longBreakEvery,
    autoStartBreaks:
      typeof stored.autoStartBreaks === "boolean"
        ? stored.autoStartBreaks
        : DEFAULT_POMODORO_SETTINGS.autoStartBreaks,
    autoStartPomodoros:
      typeof stored.autoStartPomodoros === "boolean"
        ? stored.autoStartPomodoros
        : DEFAULT_POMODORO_SETTINGS.autoStartPomodoros,
  };
}

/** Today's count, each malformed field taking zero on its own. */
function parseToday(value: unknown): TodayCount {
  const stored =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const day = isFiniteNumber(stored.day) && Number.isInteger(stored.day) ? stored.day : 0;
  const count =
    isFiniteNumber(stored.count) && Number.isInteger(stored.count) && stored.count >= 0
      ? stored.count
      : 0;
  return { day, count };
}

/** What storage held, or the default Cycle when it is malformed or empty. */
function parseStored(value: unknown): PomodoroSnapshot {
  if (typeof value !== "object" || value === null) {
    return {
      state: INITIAL_CYCLE,
      settings: { ...DEFAULT_POMODORO_SETTINGS },
      today: DEFAULT_TODAY,
    };
  }
  const stored = value as Record<string, unknown>;
  return {
    state: parseState(stored.state) ?? INITIAL_CYCLE,
    settings: parseSettings(stored.settings),
    today: parseToday(stored.today),
  };
}

/** The phase-end sentence the Alert says after `phase`. */
function endBodyKey(phase: Phase): "pomodoroEnded" | "breakEnded" {
  return phase === "pomodoro" ? "pomodoroEnded" : "breakEnded";
}

/** Creates the Cycle, holding it in memory and persisting every change. */
export function createPomodoro(client: PluginClient): ClockPomodoro {
  let snapshot: PomodoroSnapshot = DEFAULT_SNAPSHOT;
  let language = "en";
  let loaded = false;
  /** True once the page or a Command changed the Cycle, so a slow load cannot clobber it. */
  let mutated = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  async function persist(): Promise<void> {
    try {
      await client.storage.set({ key: STORAGE_KEY, value: snapshot });
    } catch {
      // A store that refuses still leaves the Cycle usable in memory.
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

  function scheduleAlert(state: CycleState): void {
    if (state.status !== "running") return;
    void client.notifications
      .system({
        id: POMODORO_NOTIFICATION_ID,
        title: translate(language, state.phase),
        body: translate(language, endBodyKey(state.phase)),
        at: state.endsAt,
      })
      .catch(() => {});
  }

  function cancelAlert(): void {
    void client.notifications.cancel({ id: POMODORO_NOTIFICATION_ID }).catch(() => {});
  }

  /**
   * Advances the Cycle when the held timeout says the phase ended, counting the
   * Pomodoro first. A timeout that fires early (a late clock adjustment left the
   * deadline ahead) is held again: the state stays "running" until it is really
   * reached.
   */
  function holdEnd(endsAt: number): void {
    clearTimeoutForEnd();
    timeout = setTimeout(
      () => {
        timeout = null;
        const now = Date.now();
        const result = reconcileCycle(snapshot.state, now);
        if (result.ended === null) {
          if (snapshot.state.status === "running") holdEnd(snapshot.state.endsAt);
          return;
        }
        const today =
          result.ended.phase === "pomodoro"
            ? addPomodoro(snapshot.today, now, new Date(now).getTimezoneOffset())
            : snapshot.today;
        const state = advanceCycle(result.state, snapshot.settings, now);
        snapshot = { ...snapshot, state, today };
        if (state.status === "running") {
          scheduleAlert(state);
          holdEnd(state.endsAt);
        } else {
          cancelAlert();
        }
        changed();
      },
      Math.max(0, endsAt - Date.now())
    );
  }

  /** Holds the end of a phase that runs now, and its Alert. */
  function followRunningPhase(): void {
    if (snapshot.state.status !== "running") return;
    scheduleAlert(snapshot.state);
    holdEnd(snapshot.state.endsAt);
  }

  return {
    async load() {
      if (loaded) return null;
      loaded = true;
      let stored: unknown;
      try {
        stored = await client.storage.get({ key: STORAGE_KEY });
      } catch {
        return null;
      }
      if (mutated) return null;
      snapshot = parseStored(stored);
      const result = reconcileCycle(snapshot.state, Date.now());
      if (result.ended !== null) {
        const { phase, endedAt } = result.ended;
        const today =
          phase === "pomodoro"
            ? addPomodoro(snapshot.today, endedAt, new Date(endedAt).getTimezoneOffset())
            : snapshot.today;
        snapshot = { ...snapshot, state: result.state, today };
        await persist();
        notify();
        return { phase, endedAt };
      }
      followRunningPhase();
      notify();
      return null;
    },
    snapshot() {
      return {
        state: { ...snapshot.state },
        settings: { ...snapshot.settings },
        today: { ...snapshot.today },
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      mutated = true;
      snapshot = {
        ...snapshot,
        state: startCycle(snapshot.state, snapshot.settings, Date.now()),
      };
      followRunningPhase();
      changed();
    },
    pause() {
      if (snapshot.state.status !== "running") return;
      mutated = true;
      snapshot = { ...snapshot, state: pauseCycle(snapshot.state, Date.now()) };
      clearTimeoutForEnd();
      cancelAlert();
      changed();
    },
    toggle() {
      if (snapshot.state.status === "running") this.pause();
      else this.start();
    },
    skip() {
      mutated = true;
      clearTimeoutForEnd();
      snapshot = {
        ...snapshot,
        state: advanceCycle(snapshot.state, snapshot.settings, Date.now()),
      };
      if (snapshot.state.status === "running") followRunningPhase();
      else cancelAlert();
      changed();
    },
    reset() {
      mutated = true;
      clearTimeoutForEnd();
      cancelAlert();
      snapshot = { ...snapshot, state: resetCycle() };
      changed();
    },
    setSettings(patch) {
      mutated = true;
      snapshot = { ...snapshot, settings: { ...snapshot.settings, ...patch } };
      changed();
    },
    setLanguage(next) {
      language = next;
    },
  };
}
