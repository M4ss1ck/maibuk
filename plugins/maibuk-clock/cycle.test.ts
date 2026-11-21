import { describe, expect, it } from "vitest";
import {
  DEFAULT_POMODORO_SETTINGS,
  INITIAL_CYCLE,
  POMODORO_LIMITS,
  addPomodoro,
  advanceCycle,
  dayNumber,
  isValidPomodoroSettings,
  nextPhase,
  pauseCycle,
  phaseLength,
  reconcileCycle,
  remainingCycleMs,
  resetCycle,
  startCycle,
  todayCount,
  type CycleState,
  type PomodoroSettings,
} from "./cycle";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** The author's settings, near the defaults, overridden by the fields a test cares about. */
function settings(overrides: Partial<PomodoroSettings> = {}): PomodoroSettings {
  return { ...DEFAULT_POMODORO_SETTINGS, ...overrides };
}

describe("DEFAULT_POMODORO_SETTINGS", () => {
  it("holds 25, 5, 15 minutes, four Pomodoros, and no auto-start", () => {
    expect(DEFAULT_POMODORO_SETTINGS).toEqual({
      pomodoroMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      autoStartBreaks: false,
      autoStartPomodoros: false,
    });
  });
});

describe("POMODORO_LIMITS", () => {
  it("allows 1 to 99 minutes and 1 to 12 Pomodoros per cycle", () => {
    expect(POMODORO_LIMITS).toEqual({
      minutes: { min: 1, max: 99 },
      longBreakEvery: { min: 1, max: 12 },
    });
  });
});

describe("isValidPomodoroSettings()", () => {
  it("accepts the defaults and the limits' boundary values", () => {
    expect(isValidPomodoroSettings(DEFAULT_POMODORO_SETTINGS)).toBe(true);
    expect(
      isValidPomodoroSettings(
        settings({
          pomodoroMinutes: 1,
          shortBreakMinutes: 99,
          longBreakMinutes: 1,
          longBreakEvery: 12,
          autoStartBreaks: true,
        })
      )
    ).toBe(true);
  });

  it("rejects a value missing a field", () => {
    const missing: Record<string, unknown> = { ...DEFAULT_POMODORO_SETTINGS };
    delete missing.autoStartPomodoros;
    expect(isValidPomodoroSettings(missing)).toBe(false);
  });

  it("rejects a field that is not the right type", () => {
    expect(isValidPomodoroSettings({ ...settings(), pomodoroMinutes: "25" })).toBe(false);
    expect(isValidPomodoroSettings({ ...settings(), shortBreakMinutes: 2.5 })).toBe(false);
    expect(isValidPomodoroSettings({ ...settings(), autoStartBreaks: "true" })).toBe(false);
    expect(isValidPomodoroSettings({ ...settings(), autoStartPomodoros: 1 })).toBe(false);
  });

  it("rejects a value one outside each limit", () => {
    expect(isValidPomodoroSettings({ ...settings(), longBreakMinutes: 0 })).toBe(false);
    expect(isValidPomodoroSettings({ ...settings(), pomodoroMinutes: 100 })).toBe(false);
    expect(isValidPomodoroSettings({ ...settings(), longBreakEvery: 13 })).toBe(false);
  });

  it("rejects a value that is not an object", () => {
    expect(isValidPomodoroSettings(null)).toBe(false);
    expect(isValidPomodoroSettings("settings")).toBe(false);
  });
});

describe("INITIAL_CYCLE", () => {
  it("opens on the first Pomodoro, idle", () => {
    expect(INITIAL_CYCLE).toEqual({ phase: "pomodoro", pomodoro: 1, status: "idle" });
  });
});

describe("phaseLength()", () => {
  it("reads each phase's minutes from the settings", () => {
    expect(phaseLength("pomodoro", settings())).toBe(25 * MINUTE);
    expect(phaseLength("shortBreak", settings())).toBe(5 * MINUTE);
    expect(phaseLength("longBreak", settings())).toBe(15 * MINUTE);
  });

  it("follows the author's own lengths", () => {
    const custom = settings({
      pomodoroMinutes: 50,
      shortBreakMinutes: 10,
      longBreakMinutes: 20,
    });
    expect(phaseLength("pomodoro", custom)).toBe(50 * MINUTE);
    expect(phaseLength("shortBreak", custom)).toBe(10 * MINUTE);
    expect(phaseLength("longBreak", custom)).toBe(20 * MINUTE);
  });
});

describe("nextPhase()", () => {
  it("sends a Pomodoro before the cycle's end to a Short Break, kept numbered", () => {
    expect(nextPhase({ phase: "pomodoro", pomodoro: 2, status: "idle" }, settings())).toEqual({
      phase: "shortBreak",
      pomodoro: 2,
    });
  });

  it("sends the cycle's last Pomodoro to the Long Break", () => {
    expect(nextPhase({ phase: "pomodoro", pomodoro: 4, status: "idle" }, settings())).toEqual({
      phase: "longBreak",
      pomodoro: 4,
    });
  });

  it("ends the cycle when longBreakEvery is lowered below the current Pomodoro", () => {
    expect(
      nextPhase({ phase: "pomodoro", pomodoro: 3, status: "idle" }, settings({ longBreakEvery: 2 }))
    ).toEqual({ phase: "longBreak", pomodoro: 3 });
  });

  it("sends a Short Break to the next Pomodoro", () => {
    expect(
      nextPhase({ phase: "shortBreak", pomodoro: 2, status: "running", endsAt: 1 }, settings())
    ).toEqual({ phase: "pomodoro", pomodoro: 3 });
  });

  it("returns a Long Break to the first Pomodoro", () => {
    expect(nextPhase({ phase: "longBreak", pomodoro: 4, status: "idle" }, settings())).toEqual({
      phase: "pomodoro",
      pomodoro: 1,
    });
  });
});

describe("startCycle()", () => {
  it("runs an idle phase for its full length from now", () => {
    expect(startCycle(INITIAL_CYCLE, settings(), 1_000)).toEqual({
      phase: "pomodoro",
      pomodoro: 1,
      status: "running",
      endsAt: 1_000 + 25 * MINUTE,
    });
  });

  it("uses the phase's own length on an idle break", () => {
    expect(
      startCycle({ phase: "shortBreak", pomodoro: 2, status: "idle" }, settings(), 1_000)
    ).toEqual({ phase: "shortBreak", pomodoro: 2, status: "running", endsAt: 1_000 + 5 * MINUTE });
  });

  it("resumes a paused phase from what remained", () => {
    expect(
      startCycle(
        { phase: "pomodoro", pomodoro: 3, status: "paused", remaining: 15_000 },
        settings(),
        1_000
      )
    ).toEqual({ phase: "pomodoro", pomodoro: 3, status: "running", endsAt: 16_000 });
  });

  it("starts an ended phase's successor from scratch", () => {
    expect(
      startCycle(
        { phase: "shortBreak", pomodoro: 2, status: "ended", endedAt: 42 },
        settings(),
        1_000
      )
    ).toEqual({ phase: "pomodoro", pomodoro: 3, status: "running", endsAt: 1_000 + 25 * MINUTE });
  });

  it("leaves a running phase alone", () => {
    const running: CycleState = {
      phase: "pomodoro",
      pomodoro: 1,
      status: "running",
      endsAt: 61_000,
    };
    expect(startCycle(running, settings(), 90_000)).toBe(running);
  });
});

describe("pauseCycle()", () => {
  it("freezes what is left of a running phase", () => {
    expect(
      pauseCycle({ phase: "pomodoro", pomodoro: 1, status: "running", endsAt: 61_000 }, 31_000)
    ).toEqual({ phase: "pomodoro", pomodoro: 1, status: "paused", remaining: 30_000 });
  });

  it("clamps what is left at zero", () => {
    expect(
      pauseCycle({ phase: "shortBreak", pomodoro: 2, status: "running", endsAt: 61_000 }, 90_000)
    ).toEqual({ phase: "shortBreak", pomodoro: 2, status: "paused", remaining: 0 });
  });

  it("leaves idle, paused and ended phases alone", () => {
    const idle: CycleState = { phase: "pomodoro", pomodoro: 1, status: "idle" };
    const paused: CycleState = {
      phase: "pomodoro",
      pomodoro: 1,
      status: "paused",
      remaining: 5_000,
    };
    const ended: CycleState = { phase: "pomodoro", pomodoro: 1, status: "ended", endedAt: 61_000 };
    expect(pauseCycle(idle, 1_000)).toBe(idle);
    expect(pauseCycle(paused, 1_000)).toBe(paused);
    expect(pauseCycle(ended, 1_000)).toBe(ended);
  });
});

describe("advanceCycle()", () => {
  it("moves to the next phase idle when its auto-start is off", () => {
    expect(
      advanceCycle({ phase: "pomodoro", pomodoro: 2, status: "idle" }, settings(), 1_000)
    ).toEqual({ phase: "shortBreak", pomodoro: 2, status: "idle" });
    expect(
      advanceCycle(
        { phase: "longBreak", pomodoro: 4, status: "ended", endedAt: 42 },
        settings(),
        1_000
      )
    ).toEqual({ phase: "pomodoro", pomodoro: 1, status: "idle" });
  });

  it("runs a break from now when autoStartBreaks is on", () => {
    expect(
      advanceCycle(
        { phase: "pomodoro", pomodoro: 4, status: "running", endsAt: 42 },
        settings({ autoStartBreaks: true }),
        1_000
      )
    ).toEqual({
      phase: "longBreak",
      pomodoro: 4,
      status: "running",
      endsAt: 1_000 + 15 * MINUTE,
    });
  });

  it("runs the next Pomodoro from now when autoStartPomodoros is on", () => {
    expect(
      advanceCycle(
        { phase: "shortBreak", pomodoro: 2, status: "paused", remaining: 3_000 },
        settings({ autoStartPomodoros: true }),
        1_000
      )
    ).toEqual({ phase: "pomodoro", pomodoro: 3, status: "running", endsAt: 1_000 + 25 * MINUTE });
  });
});

describe("reconcileCycle()", () => {
  it("leaves a running phase that has not ended", () => {
    const running: CycleState = {
      phase: "pomodoro",
      pomodoro: 1,
      status: "running",
      endsAt: 61_000,
    };
    expect(reconcileCycle(running, 60_999)).toEqual({ state: running, ended: null });
  });

  it("ends a running phase exactly at its end without advancing", () => {
    const running: CycleState = {
      phase: "shortBreak",
      pomodoro: 2,
      status: "running",
      endsAt: 61_000,
    };
    expect(reconcileCycle(running, 61_000)).toEqual({
      state: { phase: "shortBreak", pomodoro: 2, status: "ended", endedAt: 61_000 },
      ended: { phase: "shortBreak", endedAt: 61_000 },
    });
  });

  it("ends a running phase late and reports the phase's own end", () => {
    const running: CycleState = {
      phase: "pomodoro",
      pomodoro: 3,
      status: "running",
      endsAt: 61_000,
    };
    expect(reconcileCycle(running, 999_000)).toEqual({
      state: { phase: "pomodoro", pomodoro: 3, status: "ended", endedAt: 61_000 },
      ended: { phase: "pomodoro", endedAt: 61_000 },
    });
  });

  it("reports an ending once", () => {
    const running: CycleState = {
      phase: "pomodoro",
      pomodoro: 1,
      status: "running",
      endsAt: 61_000,
    };
    const first = reconcileCycle(running, 999_000);
    expect(first.ended).toEqual({ phase: "pomodoro", endedAt: 61_000 });
    expect(reconcileCycle(first.state, 999_000)).toEqual({ state: first.state, ended: null });
  });

  it("leaves idle, paused and ended phases alone", () => {
    const idle: CycleState = { phase: "pomodoro", pomodoro: 1, status: "idle" };
    const paused: CycleState = {
      phase: "pomodoro",
      pomodoro: 1,
      status: "paused",
      remaining: 5_000,
    };
    const ended: CycleState = { phase: "pomodoro", pomodoro: 1, status: "ended", endedAt: 61_000 };
    expect(reconcileCycle(idle, 999_000)).toEqual({ state: idle, ended: null });
    expect(reconcileCycle(paused, 999_000)).toEqual({ state: paused, ended: null });
    expect(reconcileCycle(ended, 999_000)).toEqual({ state: ended, ended: null });
  });
});

describe("resetCycle()", () => {
  it("returns the first Pomodoro, idle", () => {
    expect(resetCycle()).toEqual(INITIAL_CYCLE);
  });
});

describe("remainingCycleMs()", () => {
  it("counts down a running phase", () => {
    expect(
      remainingCycleMs(
        { phase: "pomodoro", pomodoro: 1, status: "running", endsAt: 61_000 },
        settings(),
        31_000
      )
    ).toBe(30_000);
  });

  it("clamps a running phase at zero", () => {
    expect(
      remainingCycleMs(
        { phase: "pomodoro", pomodoro: 1, status: "running", endsAt: 61_000 },
        settings(),
        999_000
      )
    ).toBe(0);
  });

  it("reads the stored remainder of a paused phase", () => {
    expect(
      remainingCycleMs(
        { phase: "pomodoro", pomodoro: 1, status: "paused", remaining: 15_000 },
        settings(),
        999_000
      )
    ).toBe(15_000);
  });

  it("reads the phase's full length when idle", () => {
    expect(remainingCycleMs(INITIAL_CYCLE, settings(), 999_000)).toBe(25 * MINUTE);
    expect(
      remainingCycleMs({ phase: "longBreak", pomodoro: 4, status: "idle" }, settings(), 999_000)
    ).toBe(15 * MINUTE);
  });

  it("reads zero for an ended phase", () => {
    expect(
      remainingCycleMs(
        { phase: "pomodoro", pomodoro: 1, status: "ended", endedAt: 61_000 },
        settings(),
        999_000
      )
    ).toBe(0);
  });
});

describe("dayNumber()", () => {
  it("counts local calendar days, moving by the offset", () => {
    expect(dayNumber(0, 0)).toBe(0);
    expect(dayNumber(DAY, 0)).toBe(1);
    expect(dayNumber(DAY - 1, 0)).toBe(0);
  });

  it("reads the offset like getTimezoneOffset(), UTC minus local", () => {
    // UTC+2 is -120, so local midnight falls two hours before UTC's.
    expect(dayNumber(DAY - 7_200_000, -120)).toBe(1);
    expect(dayNumber(DAY - 7_200_001, -120)).toBe(0);
  });
});

describe("todayCount()", () => {
  it("reads the count on the same local day", () => {
    const today = { day: 3, count: 2 };
    expect(todayCount(today, 3 * DAY + 12 * 3_600_000, 0)).toBe(2);
  });

  it("reads zero on another local day", () => {
    const today = { day: 3, count: 2 };
    expect(todayCount(today, 4 * DAY, 0)).toBe(0);
    expect(todayCount(today, 2 * DAY, 0)).toBe(0);
  });
});

describe("addPomodoro()", () => {
  it("counts one more on the same local day", () => {
    expect(addPomodoro({ day: 3, count: 2 }, 3 * DAY + 12 * 3_600_000, 0)).toEqual({
      day: 3,
      count: 3,
    });
  });

  it("starts over at local midnight, with a non-zero offset", () => {
    const offset = -120;
    const localBase = Math.floor(1_700_000_000_000 / DAY) * DAY;
    const lateNight = localBase + DAY - MINUTE + offset * MINUTE;
    const nextMidnight = localBase + DAY + offset * MINUTE;

    const before = addPomodoro(
      { day: dayNumber(lateNight, offset) - 1, count: 9 },
      lateNight,
      offset
    );
    const counted = addPomodoro(before, lateNight, offset);
    expect(todayCount(counted, lateNight, offset)).toBe(2);

    const nextDay = addPomodoro(counted, nextMidnight, offset);
    expect(nextDay).toEqual({ day: dayNumber(nextMidnight, offset), count: 1 });
    expect(todayCount(counted, nextMidnight, offset)).toBe(0);
  });
});
