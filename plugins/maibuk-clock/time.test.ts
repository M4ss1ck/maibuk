import { describe, expect, it } from "vitest";
import {
  addRecentLength,
  elapsedMs,
  formatClockTime,
  formatDuration,
  formatElapsed,
  hourCycleFor,
  joinDuration,
  markLap,
  nextAlarmAt,
  type OffsetAt,
  pauseStopwatch,
  pauseTimer,
  reconcileTimer,
  remainingMs,
  resetStopwatch,
  resetTimer,
  setTimerLength,
  splitDuration,
  startStopwatch,
  startTimer,
  type StopwatchState,
  type TimerState,
} from "./time";

const MINUTE = 60_000;

describe("startTimer()", () => {
  it("starts an idle timer at now + length", () => {
    expect(startTimer({ status: "idle", length: 5 * MINUTE }, 1_000)).toEqual({
      status: "running",
      length: 5 * MINUTE,
      endsAt: 301_000,
    });
  });

  it("restarts an ended timer from its full length", () => {
    expect(startTimer({ status: "ended", length: MINUTE, endedAt: 42 }, 1_000)).toEqual({
      status: "running",
      length: MINUTE,
      endsAt: 61_000,
    });
  });

  it("resumes a paused timer from what is left", () => {
    expect(startTimer({ status: "paused", length: MINUTE, remaining: 15_000 }, 1_000)).toEqual({
      status: "running",
      length: MINUTE,
      endsAt: 16_000,
    });
  });

  it("leaves a running timer alone", () => {
    const running: TimerState = { status: "running", length: MINUTE, endsAt: 61_000 };
    expect(startTimer(running, 90_000)).toBe(running);
  });
});

describe("pauseTimer()", () => {
  it("freezes what is left of a running timer", () => {
    expect(pauseTimer({ status: "running", length: MINUTE, endsAt: 61_000 }, 31_000)).toEqual({
      status: "paused",
      length: MINUTE,
      remaining: 30_000,
    });
  });

  it("clamps what is left at zero", () => {
    expect(pauseTimer({ status: "running", length: MINUTE, endsAt: 61_000 }, 90_000)).toEqual({
      status: "paused",
      length: MINUTE,
      remaining: 0,
    });
  });

  it("leaves idle, paused and ended timers alone", () => {
    const idle: TimerState = { status: "idle", length: MINUTE };
    const paused: TimerState = { status: "paused", length: MINUTE, remaining: 5_000 };
    const ended: TimerState = { status: "ended", length: MINUTE, endedAt: 61_000 };
    expect(pauseTimer(idle, 1_000)).toBe(idle);
    expect(pauseTimer(paused, 1_000)).toBe(paused);
    expect(pauseTimer(ended, 1_000)).toBe(ended);
  });
});

describe("resetTimer()", () => {
  it("returns to idle with the same length from every status", () => {
    const states: TimerState[] = [
      { status: "idle", length: MINUTE },
      { status: "running", length: MINUTE, endsAt: 61_000 },
      { status: "paused", length: MINUTE, remaining: 5_000 },
      { status: "ended", length: MINUTE, endedAt: 61_000 },
    ];
    for (const state of states) {
      expect(resetTimer(state)).toEqual({ status: "idle", length: MINUTE });
    }
  });
});

describe("setTimerLength()", () => {
  it("returns to idle with the new length from every status", () => {
    const states: TimerState[] = [
      { status: "idle", length: MINUTE },
      { status: "running", length: MINUTE, endsAt: 61_000 },
      { status: "paused", length: MINUTE, remaining: 5_000 },
      { status: "ended", length: MINUTE, endedAt: 61_000 },
    ];
    for (const state of states) {
      expect(setTimerLength(state, 25 * MINUTE)).toEqual({
        status: "idle",
        length: 25 * MINUTE,
      });
    }
  });
});

describe("remainingMs()", () => {
  it("counts down a running timer", () => {
    expect(remainingMs({ status: "running", length: MINUTE, endsAt: 61_000 }, 31_000)).toBe(30_000);
  });

  it("clamps a running timer at zero", () => {
    expect(remainingMs({ status: "running", length: MINUTE, endsAt: 61_000 }, 999_000)).toBe(0);
  });

  it("reads the stored remainder of a paused timer", () => {
    expect(remainingMs({ status: "paused", length: MINUTE, remaining: 15_000 }, 999_000)).toBe(
      15_000
    );
  });

  it("reads the full length of an idle timer", () => {
    expect(remainingMs({ status: "idle", length: MINUTE }, 999_000)).toBe(MINUTE);
  });

  it("reads zero for an ended timer", () => {
    expect(remainingMs({ status: "ended", length: MINUTE, endedAt: 61_000 }, 999_000)).toBe(0);
  });
});

describe("reconcileTimer()", () => {
  it("leaves a running timer that has not ended", () => {
    const running: TimerState = { status: "running", length: MINUTE, endsAt: 61_000 };
    expect(reconcileTimer(running, 60_999)).toEqual({ state: running, endedAt: null });
  });

  it("ends a running timer exactly at its end", () => {
    const running: TimerState = { status: "running", length: MINUTE, endsAt: 61_000 };
    expect(reconcileTimer(running, 61_000)).toEqual({
      state: { status: "ended", length: MINUTE, endedAt: 61_000 },
      endedAt: 61_000,
    });
  });

  it("ends a running timer late and keeps its end as endedAt", () => {
    const running: TimerState = { status: "running", length: MINUTE, endsAt: 61_000 };
    expect(reconcileTimer(running, 999_000)).toEqual({
      state: { status: "ended", length: MINUTE, endedAt: 61_000 },
      endedAt: 61_000,
    });
  });

  it("finds an ending once", () => {
    const running: TimerState = { status: "running", length: MINUTE, endsAt: 61_000 };
    const first = reconcileTimer(running, 999_000);
    expect(first.endedAt).toBe(61_000);
    expect(reconcileTimer(first.state, 999_000)).toEqual({ state: first.state, endedAt: null });
  });

  it("leaves idle, paused and ended timers alone", () => {
    const idle: TimerState = { status: "idle", length: MINUTE };
    const paused: TimerState = { status: "paused", length: MINUTE, remaining: 5_000 };
    const ended: TimerState = { status: "ended", length: MINUTE, endedAt: 61_000 };
    expect(reconcileTimer(idle, 999_000)).toEqual({ state: idle, endedAt: null });
    expect(reconcileTimer(paused, 999_000)).toEqual({ state: paused, endedAt: null });
    expect(reconcileTimer(ended, 999_000)).toEqual({ state: ended, endedAt: null });
  });
});

describe("formatDuration()", () => {
  it("formats under an hour as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(61_000)).toBe("1:01");
    expect(formatDuration(59_000)).toBe("0:59");
  });

  it("formats from an hour as h:mm:ss", () => {
    expect(formatDuration(3_661_000)).toBe("1:01:01");
    expect(formatDuration(3_600_000)).toBe("1:00:00");
  });

  it("rounds up to the whole second", () => {
    expect(formatDuration(1)).toBe("0:01");
    expect(formatDuration(59_001)).toBe("1:00");
    expect(formatDuration(3_599_999)).toBe("1:00:00");
  });
});

describe("splitDuration()", () => {
  it("splits whole minutes and hours", () => {
    expect(splitDuration(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(splitDuration(61_000)).toEqual({ hours: 0, minutes: 1, seconds: 1 });
    expect(splitDuration(3_661_000)).toEqual({ hours: 1, minutes: 1, seconds: 1 });
  });

  it("rounds seconds up, then carries", () => {
    expect(splitDuration(1_500)).toEqual({ hours: 0, minutes: 0, seconds: 2 });
    expect(splitDuration(59_001)).toEqual({ hours: 0, minutes: 1, seconds: 0 });
  });

  it("clamps negative input to zero and hours to 99", () => {
    expect(splitDuration(-5)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(splitDuration(400 * 3_600_000)).toEqual({ hours: 99, minutes: 0, seconds: 0 });
    expect(splitDuration(359_999_000)).toEqual({ hours: 99, minutes: 59, seconds: 59 });
  });
});

describe("joinDuration()", () => {
  it("joins parts into milliseconds", () => {
    expect(joinDuration({ hours: 0, minutes: 0, seconds: 0 })).toBe(0);
    expect(joinDuration({ hours: 0, minutes: 1, seconds: 1 })).toBe(61_000);
    expect(joinDuration({ hours: 1, minutes: 1, seconds: 1 })).toBe(3_661_000);
  });

  it("clamps each part", () => {
    expect(joinDuration({ hours: -1, minutes: -1, seconds: -1 })).toBe(0);
    expect(joinDuration({ hours: 100, minutes: 90, seconds: 90 })).toBe(359_999_000);
    expect(joinDuration({ hours: 99, minutes: 59, seconds: 59 })).toBe(359_999_000);
  });

  it("round-trips with splitDuration()", () => {
    for (const ms of [0, 1_500, 61_000, 3_661_000, 359_999_000]) {
      expect(joinDuration(splitDuration(ms))).toBe(Math.ceil(ms / 1_000) * 1_000);
    }
  });
});

describe("formatClockTime()", () => {
  it("formats midnight in both cycles", () => {
    expect(formatClockTime(0, 0, 24)).toBe("00:00");
    expect(formatClockTime(0, 0, 12)).toBe("12:00 AM");
  });

  it("formats noon in both cycles", () => {
    expect(formatClockTime(12 * 3_600_000, 0, 24)).toBe("12:00");
    expect(formatClockTime(12 * 3_600_000, 0, 12)).toBe("12:00 PM");
  });

  it("zero-pads the 24-hour clock and not the 12-hour one", () => {
    expect(formatClockTime(9 * 3_600_000 + 5 * MINUTE, 0, 24)).toBe("09:05");
    expect(formatClockTime(9 * 3_600_000 + 5 * MINUTE, 0, 12)).toBe("9:05 AM");
    expect(formatClockTime(21 * 3_600_000 + 30 * MINUTE, 0, 24)).toBe("21:30");
    expect(formatClockTime(21 * 3_600_000 + 30 * MINUTE, 0, 12)).toBe("9:30 PM");
  });

  it("moves to local time by the offset, which reads like getTimezoneOffset()", () => {
    expect(formatClockTime(7 * 3_600_000 + 5 * MINUTE, -120, 24)).toBe("09:05");
    expect(formatClockTime(7 * 3_600_000 + 5 * MINUTE, -120, 12)).toBe("9:05 AM");
    expect(formatClockTime(3 * 3_600_000 + 30 * MINUTE, 300, 24)).toBe("22:30");
    expect(formatClockTime(3 * 3_600_000 + 30 * MINUTE, 300, 12)).toBe("10:30 PM");
  });

  it("wraps backwards across midnight", () => {
    expect(formatClockTime(-MINUTE, 0, 24)).toBe("23:59");
    expect(formatClockTime(-MINUTE, 0, 12)).toBe("11:59 PM");
  });
});

describe("hourCycleFor()", () => {
  it("picks 12 for English and 24 for everything else", () => {
    expect(hourCycleFor("en")).toBe(12);
    expect(hourCycleFor("en-US")).toBe(12);
    expect(hourCycleFor("es")).toBe(24);
    expect(hourCycleFor("fr-FR")).toBe(24);
    expect(hourCycleFor("")).toBe(24);
  });
});

describe("addRecentLength()", () => {
  it("puts the newest length first", () => {
    expect(addRecentLength([], 5 * MINUTE)).toEqual([5 * MINUTE]);
    expect(addRecentLength([5 * MINUTE], 10 * MINUTE)).toEqual([10 * MINUTE, 5 * MINUTE]);
  });

  it("moves a repeated length to the front", () => {
    expect(addRecentLength([10 * MINUTE, 5 * MINUTE], 5 * MINUTE)).toEqual([
      5 * MINUTE,
      10 * MINUTE,
    ]);
  });

  it("keeps at most three", () => {
    expect(addRecentLength([10 * MINUTE, 5 * MINUTE, MINUTE], 25 * MINUTE)).toEqual([
      25 * MINUTE,
      10 * MINUTE,
      5 * MINUTE,
    ]);
  });

  it("drops duplicates it is handed", () => {
    expect(addRecentLength([5 * MINUTE, 5 * MINUTE, MINUTE], 25 * MINUTE)).toEqual([
      25 * MINUTE,
      5 * MINUTE,
      MINUTE,
    ]);
  });
});

describe("startStopwatch()", () => {
  it("starts an idle stopwatch from zero", () => {
    expect(startStopwatch({ status: "idle" }, 1_000)).toEqual({
      status: "running",
      startedAt: 1_000,
      banked: 0,
      laps: [],
    });
  });

  it("resumes a paused stopwatch with its banked time and laps", () => {
    const laps = [{ length: 10_000, total: 10_000 }];
    expect(startStopwatch({ status: "paused", banked: 10_000, laps }, 60_000)).toEqual({
      status: "running",
      startedAt: 60_000,
      banked: 10_000,
      laps,
    });
  });

  it("leaves a running stopwatch alone", () => {
    const running: StopwatchState = { status: "running", startedAt: 1_000, banked: 0, laps: [] };
    expect(startStopwatch(running, 90_000)).toBe(running);
  });
});

describe("pauseStopwatch()", () => {
  it("banks the running stretch", () => {
    expect(
      pauseStopwatch({ status: "running", startedAt: 1_000, banked: 5_000, laps: [] }, 11_000)
    ).toEqual({ status: "paused", banked: 15_000, laps: [] });
  });

  it("keeps banked time exact across a pause and a resume", () => {
    const running = startStopwatch({ status: "idle" }, 0);
    const paused = pauseStopwatch(running, 10_000);
    const resumed = startStopwatch(paused, MINUTE);
    expect(elapsedMs(resumed, 65_000)).toBe(15_000);
  });

  it("never banks a backwards stretch", () => {
    expect(
      pauseStopwatch({ status: "running", startedAt: 10_000, banked: 5_000, laps: [] }, 5_000)
    ).toEqual({ status: "paused", banked: 5_000, laps: [] });
  });

  it("leaves idle and paused stopwatches alone", () => {
    const idle: StopwatchState = { status: "idle" };
    const paused: StopwatchState = { status: "paused", banked: 5_000, laps: [] };
    expect(pauseStopwatch(idle, 1_000)).toBe(idle);
    expect(pauseStopwatch(paused, 1_000)).toBe(paused);
  });
});

describe("resetStopwatch()", () => {
  it("returns a fresh idle stopwatch with no laps", () => {
    expect(resetStopwatch()).toEqual({ status: "idle" });
  });
});

describe("elapsedMs()", () => {
  it("reads zero for an idle stopwatch", () => {
    expect(elapsedMs({ status: "idle" }, 999_000)).toBe(0);
  });

  it("reads the banked time of a paused stopwatch", () => {
    expect(elapsedMs({ status: "paused", banked: 15_000, laps: [] }, 999_000)).toBe(15_000);
  });

  it("adds the running stretch to the banked time", () => {
    expect(
      elapsedMs({ status: "running", startedAt: 60_000, banked: 10_000, laps: [] }, 65_000)
    ).toBe(15_000);
  });

  it("never falls below banked when the clock moves backwards", () => {
    expect(
      elapsedMs({ status: "running", startedAt: 10_000, banked: 5_000, laps: [] }, 5_000)
    ).toBe(5_000);
  });
});

describe("markLap()", () => {
  it("never records a negative Lap when the clock moves back between Laps", () => {
    const lapped = markLap(startStopwatch({ status: "idle" }, 0), 5_000);
    expect(markLap(lapped, 2_000)).toMatchObject({
      laps: [
        { length: 5_000, total: 5_000 },
        { length: 0, total: 5_000 },
      ],
    });
  });

  it("records each lap's length and total", () => {
    const started = startStopwatch({ status: "idle" }, 0);
    const first = markLap(started, 10_000);
    const second = markLap(first, 25_000);
    expect(second).toMatchObject({
      laps: [
        { length: 10_000, total: 10_000 },
        { length: 15_000, total: 25_000 },
      ],
    });
  });

  it("counts only running time after a pause and a resume", () => {
    const started = startStopwatch({ status: "idle" }, 0);
    const lapped = markLap(started, 10_000);
    const paused = pauseStopwatch(lapped, 10_000);
    const resumed = startStopwatch(paused, MINUTE);
    expect(markLap(resumed, 65_000)).toMatchObject({
      laps: [
        { length: 10_000, total: 10_000 },
        { length: 5_000, total: 15_000 },
      ],
    });
  });

  it("is ignored when idle or paused", () => {
    const idle: StopwatchState = { status: "idle" };
    const paused: StopwatchState = { status: "paused", banked: 5_000, laps: [] };
    expect(markLap(idle, 1_000)).toBe(idle);
    expect(markLap(paused, 1_000)).toBe(paused);
  });

  it("does not mutate its input", () => {
    const running: StopwatchState = { status: "running", startedAt: 0, banked: 0, laps: [] };
    const lapped = markLap(running, 10_000);
    expect(running.laps).toEqual([]);
    expect(lapped).not.toBe(running);
  });
});

describe("formatElapsed()", () => {
  it("floors to the whole second", () => {
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(1_000)).toBe("0:01");
    expect(formatElapsed(59_999)).toBe("0:59");
  });

  it("formats under an hour as m:ss", () => {
    expect(formatElapsed(61_000)).toBe("1:01");
  });

  it("formats from an hour as h:mm:ss", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
  });
});

describe("nextAlarmAt()", () => {
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  /** 2024-01-01, a Monday. */
  const MONDAY = Date.UTC(2024, 0, 1);
  const utc: OffsetAt = () => 0;
  const utcPlusTwo: OffsetAt = () => -120;

  /** New York's spring-forward: 02:00 EST reads as 03:00 EDT. */
  const SPRING_JUMP = Date.UTC(2024, 2, 10, 7, 0);
  const springForward: OffsetAt = (epochMs) => (epochMs < SPRING_JUMP ? 300 : 240);
  /** New York's fall-back: 02:00 EDT reads again as 01:00 EST. */
  const FALL_JUMP = Date.UTC(2024, 10, 3, 6, 0);
  const fallBack: OffsetAt = (epochMs) => (epochMs < FALL_JUMP ? 240 : 300);

  it("fires later today", () => {
    expect(nextAlarmAt({ hour: 9, minute: 0, weekdays: [] }, MONDAY + 8 * HOUR, utc)).toBe(
      MONDAY + 9 * HOUR
    );
  });

  it("reads the wall clock through the offset", () => {
    // 06:00 UTC is 08:00 at UTC+2, so the ninth hour is still to come.
    expect(nextAlarmAt({ hour: 9, minute: 0, weekdays: [] }, MONDAY + 6 * HOUR, utcPlusTwo)).toBe(
      MONDAY + 7 * HOUR
    );
  });

  it("waits for tomorrow when the time has passed", () => {
    expect(nextAlarmAt({ hour: 9, minute: 0, weekdays: [] }, MONDAY + 10 * HOUR, utc)).toBe(
      MONDAY + DAY + 9 * HOUR
    );
  });

  it("treats exactly now as gone", () => {
    expect(nextAlarmAt({ hour: 9, minute: 0, weekdays: [] }, MONDAY + 9 * HOUR, utc)).toBe(
      MONDAY + DAY + 9 * HOUR
    );
  });

  it("skips ahead to the next enabled weekday", () => {
    // 5 is Friday, and 2024-01-05 is the first one after that Monday.
    expect(nextAlarmAt({ hour: 9, minute: 0, weekdays: [5] }, MONDAY + 8 * HOUR, utc)).toBe(
      Date.UTC(2024, 0, 5, 9, 0)
    );
    // Today is enabled but its time has gone, so the next Monday is a week out.
    expect(nextAlarmAt({ hour: 9, minute: 0, weekdays: [1] }, MONDAY + 10 * HOUR, utc)).toBe(
      MONDAY + 7 * DAY + 9 * HOUR
    );
  });

  it("fires at the end of the gap when spring-forward skips the time", () => {
    const alarm = { hour: 2, minute: 30, weekdays: [] };
    expect(nextAlarmAt(alarm, Date.UTC(2024, 2, 9, 12, 0), springForward)).toBe(SPRING_JUMP);
    // 2024-03-10 is a Sunday: the skipped half hour fires on that day, at 03:00 local.
    expect(
      nextAlarmAt({ ...alarm, weekdays: [0] }, Date.UTC(2024, 2, 9, 12, 0), springForward)
    ).toBe(SPRING_JUMP);
    // Not a Sunday, so the Alarm waits for Monday's 02:30, which exists again.
    expect(
      nextAlarmAt({ ...alarm, weekdays: [1] }, Date.UTC(2024, 2, 9, 12, 0), springForward)
    ).toBe(Date.UTC(2024, 2, 11, 6, 30));
  });

  it("fires once, at the earlier instant, when fall-back repeats the time", () => {
    const alarm = { hour: 1, minute: 30, weekdays: [] };
    const earlier = Date.UTC(2024, 10, 3, 5, 30);
    expect(nextAlarmAt(alarm, Date.UTC(2024, 10, 2, 12, 0), fallBack)).toBe(earlier);
    // The repeat at 01:30 EST is not an occurrence of its own.
    expect(nextAlarmAt(alarm, earlier, fallBack)).toBe(Date.UTC(2024, 10, 4, 6, 30));
  });
});
