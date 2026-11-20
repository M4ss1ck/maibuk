import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  INITIAL_CYCLE,
  advanceCycle,
  pauseCycle,
  phaseLength,
  remainingCycleMs,
  startCycle,
  type CycleState,
  type Phase,
  type PomodoroSettings,
} from "./cycle";

/** An author's settings, wide enough to catch a numbering or auto-start mistake. */
const settingsArbitrary: fc.Arbitrary<PomodoroSettings> = fc.record({
  pomodoroMinutes: fc.integer({ min: 1, max: 60 }),
  shortBreakMinutes: fc.integer({ min: 1, max: 30 }),
  longBreakMinutes: fc.integer({ min: 1, max: 60 }),
  longBreakEvery: fc.integer({ min: 1, max: 8 }),
  autoStartBreaks: fc.boolean(),
  autoStartPomodoros: fc.boolean(),
});

/** P1, S1, P2, S2, ..., Pk, L, then P1 again. */
function cyclePhases(longBreakEvery: number): Array<{ phase: Phase; pomodoro: number }> {
  const sequence: Array<{ phase: Phase; pomodoro: number }> = [];
  for (let pomodoro = 1; pomodoro <= longBreakEvery; pomodoro++) {
    sequence.push({ phase: "pomodoro", pomodoro });
    sequence.push({
      phase: pomodoro === longBreakEvery ? "longBreak" : "shortBreak",
      pomodoro,
    });
  }
  sequence.push({ phase: "pomodoro", pomodoro: 1 });
  return sequence;
}

/** Whether the author asked the phase to run by itself when it begins. */
function autoStarts(phase: Phase, settings: PomodoroSettings): boolean {
  return phase === "pomodoro" ? settings.autoStartPomodoros : settings.autoStartBreaks;
}

describe("cycle properties", () => {
  it("walks one Cycle through its phases and back to the first Pomodoro", () => {
    fc.assert(
      fc.property(
        settingsArbitrary,
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 60_000 }),
        (settings, startNow, stepMs) => {
          const expected = cyclePhases(settings.longBreakEvery);
          let state: CycleState = INITIAL_CYCLE;
          let now = startNow;
          const visited: Array<{ state: CycleState; now: number }> = [];

          for (let step = 1; step < expected.length; step++) {
            state = advanceCycle(state, settings, now);
            visited.push({ state, now });
            now += stepMs;
          }

          const walked = visited.map(({ state: next }) => ({
            phase: next.phase,
            pomodoro: next.pomodoro,
          }));
          expect(walked).toEqual(expected.slice(1));

          const pomodoros = expected.slice(0, -1).filter((phase) => phase.phase === "pomodoro");
          expect(pomodoros).toHaveLength(settings.longBreakEvery);

          for (const { state: next, now: beganAt } of visited) {
            expect(next.status).toBe(autoStarts(next.phase, settings) ? "running" : "idle");
            if (next.status === "running") {
              expect(next.endsAt).toBe(beganAt + phaseLength(next.phase, settings));
            }
          }
        }
      ),
      { seed: 871, numRuns: 300 }
    );
  });

  it("pauses and starts again with the remainder exact", () => {
    fc.assert(
      fc.property(
        settingsArbitrary,
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 3_600_000 }),
        fc.integer({ min: 0, max: 3_600_000 }),
        (settings, startNow, rawElapsed, restMs) => {
          const length = phaseLength("pomodoro", settings);
          const elapsed = Math.min(rawElapsed, length);
          const running = startCycle(INITIAL_CYCLE, settings, startNow);

          const paused = pauseCycle(running, startNow + elapsed);
          expect(paused).toEqual({
            phase: "pomodoro",
            pomodoro: 1,
            status: "paused",
            remaining: length - elapsed,
          });

          const resumesAt = startNow + elapsed + restMs;
          const resumed = startCycle(paused, settings, resumesAt);
          expect(resumed).toEqual({
            phase: "pomodoro",
            pomodoro: 1,
            status: "running",
            endsAt: resumesAt + (length - elapsed),
          });
          expect(remainingCycleMs(resumed, settings, resumesAt)).toBe(length - elapsed);
        }
      ),
      { seed: 871, numRuns: 300 }
    );
  });
});
