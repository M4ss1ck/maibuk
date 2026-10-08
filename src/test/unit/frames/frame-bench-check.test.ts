import { describe, expect, it } from "vitest";
import {
  type FrameBenchReport,
  checkFrameBench,
  formatFrameBench,
} from "@/test/support/frames/bench-report";
import { DEFAULT_FRAME_BUDGET, FRAME_BUDGETS, budgetFor } from "@/test/support/frames/budget";
import type { FrameSampleSet } from "@/test/support/frames/frame-report";

const HZ60 = 1000 / 60;

function steady(count = 120, extra: Partial<FrameSampleSet> = {}): FrameSampleSet {
  return {
    refreshIntervalMs: HZ60,
    frames: Array.from({ length: count }, (_, i) => ({ startMs: i * HZ60, durationMs: HZ60 })),
    longAnimationFrames: [],
    ...extra,
  };
}

function report(scenarios: FrameBenchReport["scenarios"], requested?: string[]): FrameBenchReport {
  return {
    version: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    environment: {
      source: "chromium",
      engine: "chromium",
      engineVersion: "140.0",
      mode: "headed",
      platform: "linux",
      refreshIntervalMs: HZ60,
      refreshSource: "trace",
      cpuThrottling: 1,
      viewport: { width: 1280, height: 800 },
      appVersion: "0.10.1",
      commit: "abc1234",
    },
    requested: requested ?? scenarios.map((s) => s.id),
    scenarios,
  };
}

describe("the frozen frame budget", () => {
  it("holds the issue #372 defaults", () => {
    expect(DEFAULT_FRAME_BUDGET).toEqual({
      p95FrameIntervals: 1,
      maxDroppedPct: 1,
      maxLongAnimationFrameMs: 50,
      minFrames: 60,
      jitterMs: 1,
    });
  });

  it("gives every override a written reason, and no reason without an override", () => {
    for (const [id, entry] of Object.entries(FRAME_BUDGETS)) {
      const overridden = Object.keys(entry.overrides).sort();
      expect(Object.keys(entry.reasons).sort(), id).toEqual(overridden);
      for (const reason of Object.values(entry.reasons)) {
        expect(reason?.trim().length, id).toBeGreaterThan(20);
      }
    }
  });

  it("never loosens a default line", () => {
    for (const id of Object.keys(FRAME_BUDGETS)) {
      const budget = budgetFor(id);
      expect(budget.p95FrameIntervals, id).toBeLessThanOrEqual(1);
      expect(budget.maxDroppedPct, id).toBeLessThanOrEqual(1);
      expect(budget.maxLongAnimationFrameMs, id).toBeLessThanOrEqual(50);
      expect(budget.minFrames, id).toBeGreaterThanOrEqual(60);
      expect(budget.jitterMs, id).toBeLessThanOrEqual(1);
    }
  });

  it("judges typing keystroke to next frame within one refresh interval", () => {
    expect(budgetFor("typing")).toMatchObject({ inputP95Intervals: 1 });
  });
});

describe("checkFrameBench()", () => {
  it("passes a report whose every requested scenario holds its budget", () => {
    const check = checkFrameBench(
      report([
        { id: "scroll", runs: [steady(), steady()] },
        { id: "canvas", runs: [steady()] },
      ])
    );
    expect(check.ok).toBe(true);
    expect(check.scenarios.map((s) => [s.id, s.verdict, s.runs.length])).toEqual([
      ["scroll", "pass", 2],
      ["canvas", "pass", 1],
    ]);
    expect(check.scenarios[0].aggregate?.stats.frames).toBe(240);
  });

  it("fails a scenario that misses a line, judged on its pooled runs", () => {
    const janky = steady(100, {
      frames: Array.from({ length: 100 }, (_, i) => ({
        startMs: i * 40,
        durationMs: i < 95 ? HZ60 : HZ60 * 3,
      })),
    });
    const check = checkFrameBench(report([{ id: "scroll", runs: [janky, steady()] }]));
    expect(check.ok).toBe(false);
    expect(check.scenarios[0].verdict).toBe("fail");
    // 5 dropped of 220 pooled frames is 2.3%.
    expect(check.scenarios[0].aggregate?.stats.droppedPct).toBeCloseTo(2.27, 2);
  });

  it("fails a scenario that was asked for and did not run", () => {
    const check = checkFrameBench(
      report([{ id: "scroll", runs: [steady()] }], ["scroll", "canvas"])
    );
    expect(check.ok).toBe(false);
    expect(check.scenarios.find((s) => s.id === "canvas")).toMatchObject({ verdict: "missing" });
  });

  it("fails a not-measured scenario, a refused one, and one with no budget", () => {
    const check = checkFrameBench(
      report([
        { id: "scroll", runs: [steady(10)] },
        { id: "canvas", runs: [], refused: "no adb device" },
        { id: "palette", runs: [{ ...steady(), refreshIntervalMs: 0 }] },
        { id: "unbudgeted", runs: [steady()] },
      ])
    );
    expect(check.ok).toBe(false);
    expect(check.scenarios.map((s) => [s.id, s.verdict])).toEqual([
      ["scroll", "not-measured"],
      ["canvas", "refused"],
      ["palette", "refused"],
      ["unbudgeted", "refused"],
    ]);
  });

  it("fails an empty report", () => {
    expect(checkFrameBench(report([], [])).ok).toBe(false);
  });
});

describe("formatFrameBench()", () => {
  it("prints the per-scenario table with every run, and names a failure's long frames", () => {
    const withLoaf = steady(120, {
      longAnimationFrames: [
        {
          startMs: 5,
          durationMs: 72,
          scripts: [
            {
              invoker: "TimerHandler:setTimeout",
              sourceURL: "http://127.0.0.1/assets/index.js",
              sourceFunctionName: "emitUpdate",
              durationMs: 68,
            },
          ],
        },
      ],
    });
    const text = formatFrameBench(
      report([
        { id: "scroll", runs: [steady(), steady()] },
        { id: "typing", runs: [withLoaf] },
      ])
    );
    expect(text).toContain(
      "| scroll (2 runs) | 240 | 16.7 | 16.7 | 16.7 | 0.00% (0) | 16.7 | 0 | – | – | pass |"
    );
    expect(text).toContain("handler time (p95)");
    expect(text).toContain("|   run 2 | 120 |");
    expect(text).toContain("typing: long-animation-frames fail");
    expect(text).toContain(
      "long frame 72.0 ms: emitUpdate http://127.0.0.1/assets/index.js via TimerHandler:setTimeout 68.0 ms"
    );
    expect(text).toContain("Refresh 16.67 ms (60.0 Hz, trace)");
    const resolved = formatFrameBench(
      report([
        {
          id: "typing",
          runs: [
            {
              ...withLoaf,
              longAnimationFrames: withLoaf.longAnimationFrames.map((f) => ({
                ...f,
                scripts: f.scripts.map((s) => ({ ...s, source: "src/components/editor/Editor.tsx:120 (emit)" })),
              })),
            },
          ],
        },
      ])
    );
    expect(resolved).toContain(
      "long frame 72.0 ms: src/components/editor/Editor.tsx:120 (emit) via TimerHandler:setTimeout 68.0 ms"
    );
    expect(text.trim().endsWith("Frame budget missed.")).toBe(true);
  });
});
