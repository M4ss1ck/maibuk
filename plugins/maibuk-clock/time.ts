/**
 * The Timer's and Stopwatch's arithmetic, pure and clockless. `now` (epoch
 * milliseconds) and the time zone offset are always arguments, so the module
 * never reads the device clock and never reaches for `Intl`, which the Android
 * engine lacks.
 */

/** A countdown from a length the author sets, as the Timer stores it. */
export type TimerState =
  | { status: "idle"; length: number }
  | { status: "running"; length: number; endsAt: number }
  | { status: "paused"; length: number; remaining: number }
  | { status: "ended"; length: number; endedAt: number };

const MS_PER_SECOND = 1_000;
/** A minute in milliseconds, for the page's whole-minute announcement. */
export const MS_PER_MINUTE = 60_000;
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

/** One Lap of a Stopwatch: its own stretch, and the Stopwatch time when it was marked. */
export interface Lap {
  length: number;
  total: number;
}

/**
 * A Stopwatch as the plugin stores it. Time is always worked out from
 * `startedAt` and `banked`, never stored as a count that ticks.
 */
export type StopwatchState =
  | { status: "idle" }
  | { status: "running"; startedAt: number; banked: number; laps: Lap[] }
  | { status: "paused"; banked: number; laps: Lap[] };

/** Starts an idle Stopwatch from zero, and resumes a paused one with its banked time and Laps. */
export function startStopwatch(state: StopwatchState, now: number): StopwatchState {
  if (state.status === "running") return state;
  const banked = state.status === "paused" ? state.banked : 0;
  const laps = state.status === "paused" ? state.laps : [];
  return { status: "running", startedAt: now, banked, laps };
}

/** Banks the running stretch; every other status already holds still. */
export function pauseStopwatch(state: StopwatchState, now: number): StopwatchState {
  if (state.status !== "running") return state;
  return {
    status: "paused",
    banked: state.banked + Math.max(0, now - state.startedAt),
    laps: state.laps,
  };
}

/** Returns a fresh idle Stopwatch, dropping its Laps. */
export function resetStopwatch(): StopwatchState {
  return { status: "idle" };
}

/** How long a Stopwatch has run at `now`; a clock moved backwards never makes it shrink. */
export function elapsedMs(state: StopwatchState, now: number): number {
  switch (state.status) {
    case "running":
      return state.banked + Math.max(0, now - state.startedAt);
    case "paused":
      return state.banked;
    case "idle":
      return 0;
  }
}

/**
 * Records a Lap of a running Stopwatch, counting only the time since the last
 * one; idle and paused Stopwatches hold still. Never mutates the state.
 */
export function markLap(state: StopwatchState, now: number): StopwatchState {
  if (state.status !== "running") return state;
  // A clock moved back since the last Lap must not record a negative stretch.
  const previous = state.laps[state.laps.length - 1]?.total ?? 0;
  const total = Math.max(previous, elapsedMs(state, now));
  return { ...state, laps: [...state.laps, { length: total - previous, total }] };
}

/**
 * "m:ss" under an hour, "h:mm:ss" from an hour, rounded down so a Stopwatch
 * never reads 0:01 while under a second has passed.
 */
export function formatElapsed(ms: number): string {
  return formatWholeSeconds(Math.floor(ms / MS_PER_SECOND));
}

/** Rounds up to the whole second, so a Timer never shows 0:00 while it still runs. */
function ceilSeconds(ms: number): number {
  return Math.ceil(ms / MS_PER_SECOND);
}

/** "m:ss" under an hour, "h:mm:ss" from an hour, from a count of whole seconds. */
function formatWholeSeconds(total: number): string {
  const seconds = total % SECONDS_PER_MINUTE;
  const minutes = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  if (hours === 0) return `${minutes}:${pad2(seconds)}`;
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** "m:ss" under an hour, "h:mm:ss" from an hour. */
export function formatDuration(ms: number): string {
  return formatWholeSeconds(ceilSeconds(ms));
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

/** The longest length the Timer's Duration input can express: 99:59:59. */
export const MAX_TIMER_LENGTH_MS = joinDuration({
  hours: MAX_HOURS,
  minutes: MAX_MINUTES,
  seconds: MAX_SECONDS,
});

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

/** The length just used, first, without duplicates, keeping the last three. */
export function addRecentLength(recent: readonly number[], length: number): number[] {
  const next: number[] = [];
  for (const value of [length, ...recent]) {
    if (next.length < RECENT_LIMIT && !next.includes(value)) next.push(value);
  }
  return next;
}

/** The offset at an instant, read like `new Date(epochMs).getTimezoneOffset()`: UTC minus local. */
export type OffsetAt = (epochMs: number) => number;

/**
 * An Alarm's time of day and the weekdays it repeats on, 0=Sunday through 6.
 * No weekdays means a one-off Alarm, which may fire on any day.
 */
export interface AlarmTime {
  hour: number;
  minute: number;
  weekdays: readonly number[];
}

const MS_PER_DAY = 86_400_000;
/** Local days walked from the local date of `now`; a weekly repeat always lands sooner. */
const ALARM_SEARCH_DAYS = 9;
/** How far apart the offset probes around a wall time sit. */
const PROBE_STEP_MS = 6 * MS_PER_HOUR;
/** Probes either side of a wall time, enough to see every offset within a day of it. */
const PROBE_STEPS = 4;
/** Epoch day zero, 1970-01-01, is a Thursday. */
const EPOCH_WEEKDAY = 4;
const DAYS_PER_WEEK = 7;

/** An offset read at one instant, so a change of offset can be narrowed between two of them. */
interface OffsetProbe {
  at: number;
  offset: number;
}

/** The local wall clock, as epoch-like milliseconds, read only through `offsetAt`. */
function localMsAt(epochMs: number, offsetAt: OffsetAt): number {
  return epochMs - offsetAt(epochMs) * MS_PER_MINUTE;
}

/** The weekday of a local wall clock reading, 0=Sunday through 6. */
function weekdayOf(localMs: number): number {
  const day = Math.floor(localMs / MS_PER_DAY) % DAYS_PER_WEEK;
  return (day + DAYS_PER_WEEK + EPOCH_WEEKDAY) % DAYS_PER_WEEK;
}

/** The offsets in force within a day either side of a wall time, with the instant each was read at. */
function probeOffsets(wallMs: number, offsetAt: OffsetAt): OffsetProbe[] {
  const probes: OffsetProbe[] = [];
  for (let step = -PROBE_STEPS; step <= PROBE_STEPS; step++) {
    const at = wallMs + step * PROBE_STEP_MS;
    probes.push({ at, offset: offsetAt(at) });
  }
  return probes;
}

/** The first instant between two probes that already reads the later probe's offset. */
function jumpAt(before: number, after: number, offsetAt: OffsetAt): number {
  const offset = offsetAt(after);
  let low = before;
  let high = after;
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (offsetAt(middle) === offset) high = middle;
    else low = middle;
  }
  return high;
}

/**
 * The instant the local wall clock reads `wallMs` on the day it names: the
 * earlier one when a fall-back reads it twice, and the jump itself when a
 * spring-forward skips it and lands past it.
 */
function occurrenceOn(wallMs: number, offsetAt: OffsetAt): number | null {
  const probes = probeOffsets(wallMs, offsetAt);
  let earliest: number | null = null;
  for (const { offset } of probes) {
    const instant = wallMs + offset * MS_PER_MINUTE;
    // Only an offset still in force at that instant makes it read the wall time.
    if (offsetAt(instant) !== offset) continue;
    if (earliest === null || instant < earliest) earliest = instant;
  }
  if (earliest !== null) return earliest;
  let previous: OffsetProbe | null = null;
  for (const probe of probes) {
    // A falling offset means local time jumped forward, past the wall times it skips.
    if (previous !== null && probe.offset < previous.offset) {
      const jump = jumpAt(previous.at, probe.at, offsetAt);
      if (localMsAt(jump - 1, offsetAt) < wallMs && localMsAt(jump, offsetAt) >= wallMs)
        return jump;
    }
    previous = probe;
  }
  return null;
}

/** The earliest instant after `now` at which the local clock reads the Alarm's time on one of its weekdays. */
export function nextAlarmAt(alarm: AlarmTime, now: number, offsetAt: OffsetAt): number {
  const todayStartMs = Math.floor(localMsAt(now, offsetAt) / MS_PER_DAY) * MS_PER_DAY;
  const minuteOfDay = alarm.hour * MINUTES_PER_HOUR + alarm.minute;
  for (let day = 0; day < ALARM_SEARCH_DAYS; day++) {
    const wallMs = todayStartMs + day * MS_PER_DAY + minuteOfDay * MS_PER_MINUTE;
    if (alarm.weekdays.length > 0 && !alarm.weekdays.includes(weekdayOf(wallMs))) continue;
    const occurrence = occurrenceOn(wallMs, offsetAt);
    // A day whose one occurrence has gone is spent: a fall-back repeat never fires a second time.
    if (occurrence !== null && occurrence > now) return occurrence;
  }
  throw new Error("nextAlarmAt: no occurrence within the search window");
}

/** The device's own offset, for callers with no zone to pass. */
export const localOffsetAt: OffsetAt = (t) => new Date(t).getTimezoneOffset();
