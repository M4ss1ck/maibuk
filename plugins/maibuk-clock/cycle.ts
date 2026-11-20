/**
 * The Pomodoro Cycle's arithmetic, pure and clockless, in the style of
 * `./time`: `now` (epoch milliseconds) and the time zone offset are always
 * arguments, so the module never reads the device clock and never reaches for
 * `Intl`, which the Android engine lacks.
 */

import { MS_PER_MINUTE } from "./time";

const MS_PER_DAY = 86_400_000;

/** One phase of a Pomodoro Cycle. */
export type Phase = "pomodoro" | "shortBreak" | "longBreak";

/** The lengths and auto-start choices the author keeps for the Pomodoro Cycle. */
export interface PomodoroSettings {
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Pomodoros per Pomodoro Cycle: the last one is followed by the Long Break. */
  longBreakEvery: number;
  autoStartBreaks: boolean;
  autoStartPomodoros: boolean;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  pomodoroMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoStartBreaks: false,
  autoStartPomodoros: false,
};

/** Where the Cycle stands: its phase, its Pomodoro number (1-based), and how it runs. */
export type CycleState = { phase: Phase; pomodoro: number } & (
  | { status: "idle" }
  | { status: "running"; endsAt: number }
  | { status: "paused"; remaining: number }
  | { status: "ended"; endedAt: number }
);

export const INITIAL_CYCLE: CycleState = { phase: "pomodoro", pomodoro: 1, status: "idle" };

/** The length of a phase in milliseconds, from the author's settings. */
export function phaseLength(phase: Phase, settings: PomodoroSettings): number {
  switch (phase) {
    case "pomodoro":
      return settings.pomodoroMinutes * MS_PER_MINUTE;
    case "shortBreak":
      return settings.shortBreakMinutes * MS_PER_MINUTE;
    case "longBreak":
      return settings.longBreakMinutes * MS_PER_MINUTE;
  }
}

/** The phase after this one, numbered. A Pomodoro at or past the cycle's end meets the Long Break. */
export function nextPhase(
  state: CycleState,
  settings: PomodoroSettings
): { phase: Phase; pomodoro: number } {
  switch (state.phase) {
    case "pomodoro":
      return state.pomodoro >= settings.longBreakEvery
        ? { phase: "longBreak", pomodoro: state.pomodoro }
        : { phase: "shortBreak", pomodoro: state.pomodoro };
    case "shortBreak":
      return { phase: "pomodoro", pomodoro: state.pomodoro + 1 };
    case "longBreak":
      return { phase: "pomodoro", pomodoro: 1 };
  }
}

/** Runs an idle or ended Cycle from its full length, a paused one from what is left. */
export function startCycle(state: CycleState, settings: PomodoroSettings, now: number): CycleState {
  if (state.status === "running") return state;
  if (state.status === "paused") {
    return {
      phase: state.phase,
      pomodoro: state.pomodoro,
      status: "running",
      endsAt: now + state.remaining,
    };
  }
  if (state.status === "ended") {
    const { phase, pomodoro } = nextPhase(state, settings);
    return { phase, pomodoro, status: "running", endsAt: now + phaseLength(phase, settings) };
  }
  return {
    phase: state.phase,
    pomodoro: state.pomodoro,
    status: "running",
    endsAt: now + phaseLength(state.phase, settings),
  };
}

/** Freezes what is left of a running phase; every other status already holds still. */
export function pauseCycle(state: CycleState, now: number): CycleState {
  if (state.status !== "running") return state;
  return {
    phase: state.phase,
    pomodoro: state.pomodoro,
    status: "paused",
    remaining: Math.max(0, state.endsAt - now),
  };
}

/**
 * Moves to the next phase, as Skip does and as an in-app phase end does. The
 * new phase runs from `now` only when the author's auto-start for it is on.
 */
export function advanceCycle(
  state: CycleState,
  settings: PomodoroSettings,
  now: number
): CycleState {
  const { phase, pomodoro } = nextPhase(state, settings);
  const autoStart = phase === "pomodoro" ? settings.autoStartPomodoros : settings.autoStartBreaks;
  if (!autoStart) return { phase, pomodoro, status: "idle" };
  return { phase, pomodoro, status: "running", endsAt: now + phaseLength(phase, settings) };
}

/**
 * Turns a running phase whose end has passed into an ended one at its own end,
 * without advancing, so a phase that ended while Maibuk was closed is reported
 * once at startup. Any other state reports nothing.
 */
export function reconcileCycle(
  state: CycleState,
  now: number
): { state: CycleState; ended: { phase: Phase; endedAt: number } | null } {
  if (state.status !== "running" || state.endsAt > now) return { state, ended: null };
  return {
    state: {
      phase: state.phase,
      pomodoro: state.pomodoro,
      status: "ended",
      endedAt: state.endsAt,
    },
    ended: { phase: state.phase, endedAt: state.endsAt },
  };
}

/** Returns the Cycle to its first Pomodoro, idle. */
export function resetCycle(): CycleState {
  return INITIAL_CYCLE;
}

/** What is left of a phase at `now`; the full length when idle, zero once ended. */
export function remainingCycleMs(
  state: CycleState,
  settings: PomodoroSettings,
  now: number
): number {
  switch (state.status) {
    case "idle":
      return phaseLength(state.phase, settings);
    case "running":
      return Math.max(0, state.endsAt - now);
    case "paused":
      return state.remaining;
    case "ended":
      return 0;
  }
}

/** Pomodoros finished on one local day. */
export interface TodayCount {
  /** The local calendar day index, as `dayNumber` reads it. */
  day: number;
  count: number;
}

/** The local calendar day index, with the offset read like `getTimezoneOffset()`: UTC minus local. */
export function dayNumber(now: number, offsetMinutes: number): number {
  return Math.floor((now - offsetMinutes * MS_PER_MINUTE) / MS_PER_DAY);
}

/** Today's count, or zero once the stored day is no longer the local day. */
export function todayCount(today: TodayCount, now: number, offsetMinutes: number): number {
  return today.day === dayNumber(now, offsetMinutes) ? today.count : 0;
}

/** One more Pomodoro today, starting over at one when the local day has turned. */
export function addPomodoro(today: TodayCount, now: number, offsetMinutes: number): TodayCount {
  const day = dayNumber(now, offsetMinutes);
  return { day, count: today.day === day ? today.count + 1 : 1 };
}
