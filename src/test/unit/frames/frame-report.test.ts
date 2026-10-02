import { describe, expect, it } from "vitest";
import {
  aggregateSamples,
  type FrameBudget,
  FrameReportRefused,
  type FrameSampleSet,
  frameReport,
} from "@/test/support/frames/frame-report";

const HZ60 = 1000 / 60;
const HZ120 = 1000 / 120;

const BUDGET: FrameBudget = {
  p95FrameIntervals: 1,
  maxDroppedPct: 1,
  maxLongAnimationFrameMs: 50,
  minFrames: 60,
  jitterMs: 0.5,
};

/** `count` frames back to back, each `durations[i % durations.length]` long. */
function frames(count: number, durations: number[] = [HZ60]): FrameSampleSet["frames"] {
  const out: FrameSampleSet["frames"] = [];
  let at = 1000;
  for (let i = 0; i < count; i++) {
    const durationMs = durations[i % durations.length];
    out.push({ startMs: at, durationMs });
    at += durationMs;
  }
  return out;
}

function verdicts(report: ReturnType<typeof frameReport>) {
  return Object.fromEntries(report.lines.map((line) => [line.id, line.verdict]));
}

describe("frameReport()", () => {
  it("passes a steady 60 Hz run and reports its numbers", () => {
    const report = frameReport(
      { refreshIntervalMs: HZ60, frames: frames(120), longAnimationFrames: [] },
      BUDGET
    );
    expect(report.verdict).toBe("pass");
    expect(verdicts(report)).toEqual({
      "frame-count": "pass",
      "p95-frame-time": "pass",
      "dropped-frames": "pass",
      "long-animation-frames": "pass",
    });
    expect(report.stats).toMatchObject({
      frames: 120,
      droppedFrames: 0,
      droppedPct: 0,
      missedVsyncs: 0,
      longAnimationFrames: 0,
    });
    expect(report.stats.p50Ms).toBeCloseTo(16.667, 3);
    expect(report.stats.p95Ms).toBeCloseTo(16.667, 3);
    expect(report.stats.p99Ms).toBeCloseTo(16.667, 3);
    expect(report.stats.worstMs).toBeCloseTo(16.667, 3);
  });

  it("uses nearest-rank percentiles", () => {
    // 100 frames: 1..100 ms. Nearest rank: p50 = 50, p95 = 95, p99 = 99.
    const set: FrameSampleSet = {
      refreshIntervalMs: HZ60,
      frames: Array.from({ length: 100 }, (_, i) => ({ startMs: i * 200, durationMs: 100 - i })),
      longAnimationFrames: [],
    };
    const { stats } = frameReport(set, BUDGET);
    expect([stats.p50Ms, stats.p95Ms, stats.p99Ms, stats.worstMs]).toEqual([50, 95, 99, 100]);
  });

  it("forgives vsync timestamp jitter up to jitterMs and no further", () => {
    const jittery = frameReport(
      { refreshIntervalMs: HZ60, frames: frames(100, [17.1]), longAnimationFrames: [] },
      BUDGET
    );
    expect(verdicts(jittery)["p95-frame-time"]).toBe("pass");
    const slow = frameReport(
      { refreshIntervalMs: HZ60, frames: frames(100, [17.2]), longAnimationFrames: [] },
      BUDGET
    );
    expect(verdicts(slow)["p95-frame-time"]).toBe("fail");
  });

  it("fails the long-animation-frame line on a single frame over 50 ms", () => {
    const report = frameReport(
      {
        refreshIntervalMs: HZ60,
        frames: frames(200),
        longAnimationFrames: [
          {
            startMs: 1500,
            durationMs: 64,
            blockingDurationMs: 14,
            scripts: [
              {
                invoker: "Window.requestAnimationFrame",
                sourceURL: "http://127.0.0.1/assets/index.js",
                sourceFunctionName: "flushSync",
                durationMs: 60,
              },
            ],
          },
        ],
      },
      BUDGET
    );
    expect(verdicts(report)["long-animation-frames"]).toBe("fail");
    expect(report.verdict).toBe("fail");
    expect(report.stats.longAnimationFrames).toBe(1);
    expect(report.stats.worstLongAnimationFrameMs).toBe(64);
    expect(report.longAnimationFrames[0].scripts[0].sourceFunctionName).toBe("flushSync");
  });

  it("does not count a long animation frame of exactly 50 ms", () => {
    const report = frameReport(
      {
        refreshIntervalMs: HZ60,
        frames: frames(100),
        longAnimationFrames: [{ startMs: 1, durationMs: 50, scripts: [] }],
      },
      BUDGET
    );
    expect(verdicts(report)["long-animation-frames"]).toBe("pass");
  });

  it("counts a frame over 1.5 refresh intervals as dropped, with its missed vsyncs", () => {
    // 1.5 intervals exactly is not dropped; 2 intervals misses 1 vsync, 4 miss 3.
    const set: FrameSampleSet = {
      refreshIntervalMs: HZ60,
      frames: frames(100, [HZ60]).concat([
        { startMs: 9000, durationMs: HZ60 * 1.5 },
        { startMs: 9100, durationMs: HZ60 * 2 },
        { startMs: 9200, durationMs: HZ60 * 4 },
      ]),
      longAnimationFrames: [],
    };
    const { stats } = frameReport(set, BUDGET);
    expect(stats.droppedFrames).toBe(2);
    expect(stats.missedVsyncs).toBe(4);
  });

  it("passes dropped frames just under 1% and fails at 1%", () => {
    const dropped = { startMs: 99_999, durationMs: HZ60 * 2 };
    // 1 of 101 frames = 0.99%.
    const under = frameReport(
      { refreshIntervalMs: HZ60, frames: [...frames(100), dropped], longAnimationFrames: [] },
      BUDGET
    );
    expect(under.stats.droppedPct).toBeCloseTo(0.99, 3);
    expect(verdicts(under)["dropped-frames"]).toBe("pass");
    // 1 of 100 frames = 1%: the budget is "under 1%".
    const at = frameReport(
      { refreshIntervalMs: HZ60, frames: [...frames(99), dropped], longAnimationFrames: [] },
      BUDGET
    );
    expect(at.stats.droppedPct).toBe(1);
    expect(verdicts(at)["dropped-frames"]).toBe("fail");
  });

  it("judges a 120 Hz display against 8.3 ms, so half rate fails", () => {
    const halfRate = frameReport(
      { refreshIntervalMs: HZ120, frames: frames(120, [HZ60]), longAnimationFrames: [] },
      BUDGET
    );
    expect(halfRate.lines.find((l) => l.id === "p95-frame-time")?.limitMs).toBeCloseTo(8.833, 3);
    expect(verdicts(halfRate)["p95-frame-time"]).toBe("fail");
    // 16.7 ms is 2 intervals at 120 Hz: every frame is dropped.
    expect(halfRate.stats.droppedPct).toBe(100);
    const fullRate = frameReport(
      { refreshIntervalMs: HZ120, frames: frames(120, [HZ120]), longAnimationFrames: [] },
      BUDGET
    );
    expect(fullRate.verdict).toBe("pass");
  });

  it("gives not-measured, which is not a pass, when too few frames were drawn", () => {
    const report = frameReport(
      { refreshIntervalMs: HZ60, frames: frames(59), longAnimationFrames: [] },
      BUDGET
    );
    expect(report.verdict).toBe("not-measured");
    expect(new Set(report.lines.map((line) => line.verdict))).toEqual(new Set(["not-measured"]));
    expect(report.lines.find((l) => l.id === "frame-count")).toMatchObject({
      actual: 59,
      limit: 60,
    });
  });

  it("refuses a sample set without a usable refresh interval", () => {
    for (const refreshIntervalMs of [undefined, 0, -16, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        frameReport(
          { refreshIntervalMs, frames: frames(100), longAnimationFrames: [] } as FrameSampleSet,
          BUDGET
        )
      ).toThrow(FrameReportRefused);
    }
  });

  it("refuses frames out of presentation order or with a negative duration", () => {
    const backwards = [...frames(100)];
    backwards.push({ startMs: 0, durationMs: HZ60 });
    expect(() =>
      frameReport({ refreshIntervalMs: HZ60, frames: backwards, longAnimationFrames: [] }, BUDGET)
    ).toThrow(/presentation order/);
    expect(() =>
      frameReport(
        {
          refreshIntervalMs: HZ60,
          frames: [...frames(100), { startMs: 99999, durationMs: -1 }],
          longAnimationFrames: [],
        },
        BUDGET
      )
    ).toThrow(/duration/);
  });

  describe("keystroke to next frame", () => {
    const TYPING: FrameBudget = { ...BUDGET, inputP95Intervals: 1, minInputs: 20 };

    function inputs(delays: number[]) {
      return delays.map((delay, i) => ({ atMs: i * 100, nextFrameMs: i * 100 + delay }));
    }

    it("passes when the next frame starts within one refresh interval", () => {
      const report = frameReport(
        {
          refreshIntervalMs: HZ60,
          frames: frames(100),
          longAnimationFrames: [],
          inputs: inputs(Array.from({ length: 40 }, (_, i) => (i % 16) + 0.5)),
        },
        TYPING
      );
      expect(verdicts(report)["input-to-next-frame"]).toBe("pass");
      expect(report.stats.inputs).toBe(40);
      // 0.5..7.5 three times each, 8.5..15.5 twice: the 38th of 40 is 14.5.
      expect(report.stats.inputP95Ms).toBe(14.5);
    });

    it("fails when a slow key handler pushes the next frame past one interval", () => {
      const delays = Array.from({ length: 40 }, (_, i) => (i < 35 ? 4 : 30));
      const report = frameReport(
        {
          refreshIntervalMs: HZ60,
          frames: frames(100),
          longAnimationFrames: [],
          inputs: inputs(delays),
        },
        TYPING
      );
      expect(verdicts(report)["input-to-next-frame"]).toBe("fail");
      expect(report.verdict).toBe("fail");
    });

    it("is not-measured when too few keystrokes were recorded", () => {
      const report = frameReport(
        {
          refreshIntervalMs: HZ60,
          frames: frames(100),
          longAnimationFrames: [],
          inputs: inputs([4]),
        },
        TYPING
      );
      expect(verdicts(report)["input-to-next-frame"]).toBe("not-measured");
      expect(report.verdict).toBe("not-measured");
    });

    it("leaves the line out of scenarios that do not budget input", () => {
      const report = frameReport(
        {
          refreshIntervalMs: HZ60,
          frames: frames(100),
          longAnimationFrames: [],
          inputs: inputs([4]),
        },
        BUDGET
      );
      expect(report.lines.map((line) => line.id)).not.toContain("input-to-next-frame");
    });
  });
});

describe("aggregateSamples()", () => {
  it("pools every run's frames, inputs, and long animation frames in run order", () => {
    const run = (offset: number): FrameSampleSet => ({
      refreshIntervalMs: HZ60,
      frames: [{ startMs: offset, durationMs: HZ60 }],
      longAnimationFrames: [{ startMs: offset, durationMs: 60, scripts: [] }],
      inputs: [{ atMs: offset, nextFrameMs: offset + 4 }],
    });
    // Each run has its own clock: the second run's times may be earlier.
    const pooled = aggregateSamples([run(5000), run(100)]);
    expect(pooled.frames.map((f) => f.durationMs)).toEqual([HZ60, HZ60]);
    expect(pooled.longAnimationFrames).toHaveLength(2);
    expect(pooled.inputs).toHaveLength(2);
    // Pooled frames stay in presentation order, so the report accepts them.
    expect(frameReport(pooled, { ...BUDGET, minFrames: 1 }).stats.frames).toBe(2);
  });

  it("averages refresh intervals within 1% and refuses runs on different displays", () => {
    const at = (refreshIntervalMs: number): FrameSampleSet => ({
      refreshIntervalMs,
      frames: [],
      longAnimationFrames: [],
    });
    expect(aggregateSamples([at(16.6), at(16.7)]).refreshIntervalMs).toBeCloseTo(16.65, 5);
    expect(() => aggregateSamples([at(HZ60), at(HZ120)])).toThrow(FrameReportRefused);
    expect(() => aggregateSamples([])).toThrow(FrameReportRefused);
  });
});
