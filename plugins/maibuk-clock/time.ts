/**
 * The Timer's arithmetic, pure and clockless. `now` (epoch milliseconds) and the
 * time zone offset are always arguments, so the module never reads the device
 * clock and never reaches for `Intl`, which the Android engine lacks.
 */

/** A countdown from a length the author sets, as the Timer stores it. */
export type TimerState =
  | { status: "idle"; length: number }
  | { status: "running"; length: number; endsAt: number }
  | { status: "paused"; length: number; remaining: number }
  | { status: "ended"; length: number; endedAt: number };

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
const MAX_HOURS = 99;
const MAX_MINUTES = 59;
const MAX_SECONDS = 59;
const RECENT_LIMIT = 3;

/** Runs an idle or ended Timer from its full length, and a paused one from what is left. */
export function startTimer(state: TimerState, now: number): TimerState {
  if (state.status === "running") return state;
  const remaining = state.status === "paused" ? state.remaining : state.length;
  return { status: "running", length: state.length, endsAt: now + remaining };
}

/** Freezes what is left of a running Timer; every other status already holds still. */
export function pauseTimer(state: TimerState, now: number): TimerState {
  if (state.status !== "running") return state;
  return { status: "paused", length: state.length, remaining: Math.max(0, state.endsAt - now) };
}

/** Returns a Timer to idle, keeping its length. */
export function resetTimer(state: TimerState): TimerState {
  return { status: "idle", length: state.length };
}

/** Sets a new length, which returns any Timer to idle whatever it was doing. */
export function setTimerLength(_state: TimerState, length: number): TimerState {
  return { status: "idle", length };
}

/** What is left of a Timer at `now`; zero once it has ended. */
export function remainingMs(state: TimerState, now: number): number {
  switch (state.status) {
    case "running":
      return Math.max(0, state.endsAt - now);
    case "paused":
      return state.remaining;
    case "idle":
      return state.length;
    case "ended":
      return 0;
  }
}

export interface ReconcileResult {
  state: TimerState;
  endedAt: number | null;
}

/**
 * Turns a running Timer whose end has passed into an ended one, reporting the
 * end so the caller can raise one Alert. Any other Timer, and an ended one
 * already reconciled, reports nothing.
 */
export function reconcileTimer(state: TimerState, now: number): ReconcileResult {
  if (state.status !== "running" || state.endsAt > now) return { state, endedAt: null };
  return {
    state: { status: "ended", length: state.length, endedAt: state.endsAt },
    endedAt: state.endsAt,
  };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** Rounds up to the whole second, so a Timer never shows 0:00 while it still runs. */
function ceilSeconds(ms: number): number {
  return Math.ceil(ms / MS_PER_SECOND);
}

/** "m:ss" under an hour, "h:mm:ss" from an hour. */
export function formatDuration(ms: number): string {
  const total = ceilSeconds(ms);
  const seconds = total % SECONDS_PER_MINUTE;
  const minutes = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  if (hours === 0) return `${minutes}:${pad2(seconds)}`;
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
}

export interface DurationParts {
  hours: number;
  minutes: number;
  seconds: number;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

/** The three fields of a Duration input, each inside its clamp. */
export function splitDuration(ms: number): DurationParts {
  const total = Math.max(0, ceilSeconds(ms));
  return {
    hours: clamp(Math.floor(total / SECONDS_PER_HOUR), MAX_HOURS),
    minutes: Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR,
    seconds: total % SECONDS_PER_MINUTE,
  };
}

/** Milliseconds from three Duration fields, each clamped like `splitDuration`. */
export function joinDuration(parts: DurationParts): number {
  const hours = clamp(parts.hours, MAX_HOURS);
  const minutes = clamp(parts.minutes, MAX_MINUTES);
  const seconds = clamp(parts.seconds, MAX_SECONDS);
  return Math.round(hours * MS_PER_HOUR + minutes * MS_PER_MINUTE + seconds * MS_PER_SECOND);
}

/**
 * The local time of day, worked out by hand. `offsetMinutes` reads like
 * `Date.prototype.getTimezoneOffset()`: UTC minus local, so UTC+2 is -120.
 */
export function formatClockTime(
  epochMs: number,
  offsetMinutes: number,
  hourCycle: 12 | 24
): string {
  const localMs = epochMs - offsetMinutes * MS_PER_MINUTE;
  const minutesOfDay =
    ((Math.floor(localMs / MS_PER_MINUTE) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(minutesOfDay / MINUTES_PER_HOUR);
  const minutes = minutesOfDay % MINUTES_PER_HOUR;
  if (hourCycle === 24) return `${pad2(hours)}:${pad2(minutes)}`;
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hours12}:${pad2(minutes)} ${hours < 12 ? "AM" : "PM"}`;
}

/** English reads a 12-hour clock; every other language Maibuk ships reads 24. */
export function hourCycleFor(language: string): 12 | 24 {
  return language.startsWith("en") ? 12 : 24;
}

/** The length just used, first, without duplicates, keeping the last three. */
export function addRecentLength(recent: readonly number[], length: number): number[] {
  const next: number[] = [];
  for (const value of [length, ...recent]) {
    if (next.length < RECENT_LIMIT && !next.includes(value)) next.push(value);
  }
  return next;
}
