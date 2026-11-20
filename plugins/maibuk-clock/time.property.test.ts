import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatClockTime,
  joinDuration,
  nextAlarmAt,
  pauseTimer,
  reconcileTimer,
  remainingMs,
  setTimerLength,
  splitDuration,
  startTimer,
  type AlarmTime,
  type OffsetAt,
  type TimerState,
} from "./time";

/**
 * A length, a start, and stretches of running and resting time. The stretches
 * are the pause/resume cycle as the author would drive it: run, pause, run,
 * pause, always forward in time.
 */
const stretchArbitrary = fc.record({
  length: fc.integer({ min: 0, max: 3_600_000 }),
  startNow: fc.integer({ min: -1_000_000, max: 1_000_000 }),
  stretches: fc.array(
    fc.tuple(fc.integer({ min: 0, max: 120_000 }), fc.integer({ min: 0, max: 120_000 })),
    { minLength: 1, maxLength: 8 }
  ),
});

/** A run whose end the `now` values are certain to cross, however late. */
const reconcileArbitrary = fc.record({
  length: fc.integer({ min: 1, max: 3_600_000 }),
  startNow: fc.integer({ min: -1_000_000, max: 1_000_000 }),
  offsets: fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 8 }),
  overshoot: fc.integer({ min: 0, max: 5_000_000 }),
});

const MOST = 359_999_000;

describe("timer properties", () => {
  it("counts down the length minus the running time, exactly", () => {
    fc.assert(
      fc.property(stretchArbitrary, ({ length, startNow, stretches }) => {
        let state = setTimerLength({ status: "idle", length: 0 }, length);
        let now = startNow;
        let left = length;
        state = startTimer(state, now);
        expect(remainingMs(state, now)).toBe(left);

        for (const [runMs, restMs] of stretches) {
          now += runMs;
          left = Math.max(0, left - runMs);
          expect(remainingMs(state, now)).toBe(left);

          state = pauseTimer(state, now);
          expect(remainingMs(state, now)).toBe(left);

          now += restMs;
          expect(remainingMs(state, now)).toBe(left);

          state = startTimer(state, now);
          expect(remainingMs(state, now)).toBe(left);
        }
      }),
      { seed: 871, numRuns: 300 }
    );
  });

  it("reports an ending once, at the timer's own end", () => {
    fc.assert(
      fc.property(reconcileArbitrary, ({ length, startNow, offsets, overshoot }) => {
        const endsAt = startNow + length;
        const times = [...offsets, length + overshoot].sort((left, right) => left - right);
        let state: TimerState = startTimer({ status: "idle", length }, startNow);
        let now = startNow;
        const reported: number[] = [];

        for (const offset of times) {
          now += offset;
          const result = reconcileTimer(state, now);
          state = result.state;
          if (result.endedAt !== null) {
            reported.push(result.endedAt);
            expect(result.state.status).toBe("ended");
            if (result.state.status === "ended") expect(result.state.endedAt).toBe(endsAt);
          }
        }

        expect(reported).toEqual([endsAt]);
      }),
      { seed: 871, numRuns: 300 }
    );
  });
});

describe("duration properties", () => {
  it("round-trips split parts back to whole seconds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MOST }), (ms) => {
        expect(joinDuration(splitDuration(ms))).toBe(Math.ceil(ms / 1_000) * 1_000);
      }),
      { seed: 871, numRuns: 300 }
    );
  });

  it("keeps every part inside its clamp", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MOST }), (ms) => {
        const parts = splitDuration(ms);
        expect(parts.hours).toBeGreaterThanOrEqual(0);
        expect(parts.hours).toBeLessThanOrEqual(99);
        expect(parts.minutes).toBeGreaterThanOrEqual(0);
        expect(parts.minutes).toBeLessThanOrEqual(59);
        expect(parts.seconds).toBeGreaterThanOrEqual(0);
        expect(parts.seconds).toBeLessThanOrEqual(59);
      }),
      { seed: 871, numRuns: 300 }
    );
  });
});

describe("clock time properties", () => {
  it("always renders a well-formed time of day", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -8_640_000_000_000, max: 8_640_000_000_000 }),
        fc.integer({ min: -1_440, max: 1_440 }),
        (epochMs, offsetMinutes) => {
          expect(formatClockTime(epochMs, offsetMinutes, 24)).toMatch(/^\d\d:\d\d$/);
          expect(formatClockTime(epochMs, offsetMinutes, 12)).toMatch(
            /^(1[0-2]|[1-9]):\d\d (AM|PM)$/
          );
        }
      ),
      { seed: 871, numRuns: 300 }
    );
  });

  it("reads the same hour in both cycles", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -8_640_000_000_000, max: 8_640_000_000_000 }),
        fc.integer({ min: -1_440, max: 1_440 }),
        (epochMs, offsetMinutes) => {
          const long = formatClockTime(epochMs, offsetMinutes, 24);
          const short = formatClockTime(epochMs, offsetMinutes, 12);
          const [longHour, longMinute] = long.split(":");
          const [, shortHour, shortMinute, suffix] = /^(\d+):(\d\d) (AM|PM)$/.exec(short)!;
          const hour12 = Number(shortHour) % 12;
          const hour24 = suffix === "AM" ? hour12 : hour12 + 12;
          expect(shortMinute).toBe(longMinute);
          expect(hour24).toBe(Number(longHour));
        }
      ),
      { seed: 871, numRuns: 300 }
    );
  });
});

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const EARLIEST_NOW_MS = Date.UTC(2023, 0, 1);
const LATEST_NOW_MS = Date.UTC(2026, 0, 1);

/** A zone's offset at an instant, read like `getTimezoneOffset()` out of `Intl`. */
function zoneOffsetAt(timeZone: string): OffsetAt {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (epochMs) => {
    const second = Math.floor(epochMs / 1_000) * 1_000;
    const fields: Record<string, number> = {};
    for (const part of format.formatToParts(new Date(second))) {
      if (part.type !== "literal") fields[part.type] = Number(part.value);
    }
    const wallMs = Date.UTC(
      fields.year,
      fields.month - 1,
      fields.day,
      fields.hour,
      fields.minute,
      fields.second
    );
    return (second - wallMs) / MS_PER_MINUTE;
  };
}

const newYorkOffsetAt = zoneOffsetAt("America/New_York");

/** A zone that never steps. */
function fixedOffset(offset: number): OffsetAt {
  return () => offset;
}

/** A fixed offset, or a real zone whose DST steps the Alarm has to survive. */
const zoneArbitrary: fc.Arbitrary<OffsetAt> = fc.oneof(
  fc.integer({ min: -1_440, max: 1_440 }).map(fixedOffset),
  fc.constant(newYorkOffsetAt)
);

const alarmArbitrary = fc.record({
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
  weekdays: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { maxLength: 7 }),
});

const alarmNowArbitrary = fc.record({
  now: fc.integer({ min: EARLIEST_NOW_MS, max: LATEST_NOW_MS }),
  alarm: alarmArbitrary,
  zone: zoneArbitrary,
});

/** Minutes from local midnight to the Alarm's time. */
function alarmMinuteOfDay(alarm: AlarmTime): number {
  return alarm.hour * 60 + alarm.minute;
}

/** The local weekdays and minutes-of-day the same offset works out. */
function localWeekday(zone: OffsetAt, epochMs: number): number {
  const local = epochMs - zone(epochMs) * MS_PER_MINUTE;
  const day = Math.floor(local / MS_PER_DAY);
  return ((day % 7) + 7 + 4) % 7;
}

function localMinuteOfDay(zone: OffsetAt, epochMs: number): number {
  const local = epochMs - zone(epochMs) * MS_PER_MINUTE;
  const inDay = ((local % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return Math.floor(inDay / MS_PER_MINUTE);
}

describe("alarm properties", () => {
  it("fires after now, within eight days, at the Alarm's own time", () => {
    fc.assert(
      fc.property(alarmNowArbitrary, ({ now, alarm, zone }) => {
        const result = nextAlarmAt(alarm, now, zone);
        expect(result).toBeGreaterThan(now);
        expect(result - now).toBeLessThanOrEqual(8 * MS_PER_DAY);

        if (alarm.weekdays.length > 0) expect(alarm.weekdays).toContain(localWeekday(zone, result));

        const target = alarmMinuteOfDay(alarm);
        const actual = localMinuteOfDay(zone, result);
        if (actual !== target) {
          // Only a spring-forward gap explains another time: the Alarm fires at the gap's end.
          expect(actual).toBeGreaterThan(target);
          expect(localMinuteOfDay(zone, result - 1)).toBeLessThan(target);
        }
      }),
      { seed: 871, numRuns: 300 }
    );
  });

  it("leaves no valid instant between now and its answer", () => {
    fc.assert(
      fc.property(alarmNowArbitrary, ({ now, alarm, zone }) => {
        const result = nextAlarmAt(alarm, now, zone);
        expect(nextAlarmAt(alarm, result - 1, zone)).toBe(result);
      }),
      { seed: 871, numRuns: 300 }
    );
  });
});
