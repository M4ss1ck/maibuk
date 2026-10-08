// The frame report (issue #372): judges a normalized frame sample set against
// a frame budget. Pure and framework-free; it never knows which source (CDP
// trace, Android gfxinfo, rAF probe) produced the samples.
//
// Every source produces the same shape: frames in presentation order, times
// in milliseconds (frames on one clock; keystrokes and long animation frames
// may be on the page's), and the display's refresh interval. A frame's
// duration is how long it took to reach the screen, so a smooth run reads one
// refresh interval per frame and a frame that missed a vsync reads two. Each
// source measures that its own platform's way: vsync slots since the previous
// presentation (Chromium), rAF cadence (probe), or IntendedVsync to
// FrameCompleted, Android's own jank accounting (android).

export interface FrameSample {
  startMs: number;
  durationMs: number;
}

/** A keystroke and the start of the first frame that ran after its handler. */
export interface InputSample {
  atMs: number;
  nextFrameMs: number;
}

export interface LongAnimationFrameScript {
  invoker: string;
  sourceURL: string;
  sourceFunctionName: string;
  /** Where the script's function starts in its bundle, when the engine says. */
  sourceCharPosition?: number;
  durationMs: number;
  /** The original "file:line (name)", resolved through the build's source map. */
  source?: string;
}

/** A frame over 50 ms; `scripts` is empty where the engine gives no attribution. */
export interface LongAnimationFrame {
  startMs: number;
  durationMs: number;
  blockingDurationMs?: number;
  scripts: LongAnimationFrameScript[];
}

export interface FrameSampleSet {
  refreshIntervalMs: number;
  frames: FrameSample[];
  longAnimationFrames: LongAnimationFrame[];
  inputs?: InputSample[];
  /** Durations, in ms, of a keyboard handler's work measured inside the page. */
  handlerMs?: number[];
}

export interface FrameBudget {
  /** p95 frame time limit, in refresh intervals. */
  p95FrameIntervals: number;
  /** Dropped frames must stay under this percentage of frames. */
  maxDroppedPct: number;
  /** No long animation frame may last longer than this. */
  maxLongAnimationFrameMs: number;
  /** Below this many frames the run is `not-measured`. */
  minFrames: number;
  /** Vsync timestamp jitter forgiven on interval-based limits. */
  jitterMs: number;
  /** Keystroke-to-next-frame p95 limit, in refresh intervals (typing only). */
  inputP95Intervals?: number;
  /** Below this many keystrokes the input line is `not-measured`. */
  minInputs?: number;
  /** p95 limit, in ms, on the page-side handler durations in `handlerMs`. */
  handlerP95Ms?: number;
  /** Below this many handler samples the handler line is `not-measured`. */
  minHandlerSamples?: number;
}

export type Verdict = "pass" | "fail" | "not-measured";

export type BudgetLineId =
  | "frame-count"
  | "p95-frame-time"
  | "dropped-frames"
  | "long-animation-frames"
  | "input-to-next-frame"
  | "handler-time";

export interface BudgetLine {
  id: BudgetLineId;
  verdict: Verdict;
  /** The measured value, in the line's unit. */
  actual: number;
  /** The limit, in the line's unit. */
  limit: number;
  /** For lines judged in milliseconds, the limit with jitter included. */
  limitMs?: number;
}

export interface FrameStats {
  refreshIntervalMs: number;
  frames: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  worstMs: number;
  droppedFrames: number;
  droppedPct: number;
  missedVsyncs: number;
  longAnimationFrames: number;
  worstLongAnimationFrameMs: number;
  inputs: number;
  inputP95Ms: number;
  handlerSamples: number;
  handlerP95Ms: number;
}

export interface FrameReport {
  verdict: Verdict;
  stats: FrameStats;
  lines: BudgetLine[];
  /** The long animation frames over the budget, longest first. */
  longAnimationFrames: LongAnimationFrame[];
}

/** Thrown when a sample set cannot be judged at all (never a pass or a fail). */
export class FrameReportRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameReportRefused";
  }
}

/** A frame longer than this many refresh intervals is a dropped frame. */
export const DROPPED_FRAME_INTERVALS = 1.5;

/** Nearest-rank percentile of an ascending list; 0 for an empty one. */
function percentileOfSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Nearest-rank percentile of any list (it is copied, never sorted in place); 0 for an empty one. */
export function percentile(values: number[], p: number): number {
  return percentileOfSorted(
    [...values].sort((a, b) => a - b),
    p
  );
}

function validate(samples: FrameSampleSet): void {
  const interval = samples.refreshIntervalMs;
  if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) {
    throw new FrameReportRefused(
      `refresh interval unknown (${String(interval)}): a source must measure it, never guess`
    );
  }
  let previous = Number.NEGATIVE_INFINITY;
  for (const [index, frame] of samples.frames.entries()) {
    if (!Number.isFinite(frame.durationMs) || frame.durationMs < 0) {
      throw new FrameReportRefused(`frame ${index} has an invalid duration (${frame.durationMs})`);
    }
    if (!Number.isFinite(frame.startMs) || frame.startMs < previous) {
      throw new FrameReportRefused(`frame ${index} is out of presentation order`);
    }
    previous = frame.startMs;
  }
}

function worstVerdict(verdicts: Verdict[]): Verdict {
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("not-measured")) return "not-measured";
  return "pass";
}

export function frameReport(samples: FrameSampleSet, budget: FrameBudget): FrameReport {
  validate(samples);
  const interval = samples.refreshIntervalMs;
  const durations = samples.frames.map((frame) => frame.durationMs).sort((a, b) => a - b);
  const droppedLimit = interval * DROPPED_FRAME_INTERVALS;
  let droppedFrames = 0;
  let missedVsyncs = 0;
  for (const duration of durations) {
    if (duration <= droppedLimit) continue;
    droppedFrames++;
    missedVsyncs += Math.max(1, Math.round(duration / interval) - 1);
  }
  const longFrames = samples.longAnimationFrames
    .filter((frame) => frame.durationMs > budget.maxLongAnimationFrameMs)
    .sort((a, b) => b.durationMs - a.durationMs);
  const inputDelays = (samples.inputs ?? [])
    .map((input) => input.nextFrameMs - input.atMs)
    .sort((a, b) => a - b);
  const handlerDurations = [...(samples.handlerMs ?? [])].sort((a, b) => a - b);

  const stats: FrameStats = {
    refreshIntervalMs: interval,
    frames: durations.length,
    p50Ms: percentileOfSorted(durations, 50),
    p95Ms: percentileOfSorted(durations, 95),
    p99Ms: percentileOfSorted(durations, 99),
    worstMs: durations.at(-1) ?? 0,
    droppedFrames,
    droppedPct: durations.length === 0 ? 0 : (droppedFrames / durations.length) * 100,
    missedVsyncs,
    longAnimationFrames: longFrames.length,
    worstLongAnimationFrameMs: longFrames[0]?.durationMs ?? 0,
    inputs: inputDelays.length,
    inputP95Ms: percentileOfSorted(inputDelays, 95),
    handlerSamples: handlerDurations.length,
    handlerP95Ms: percentileOfSorted(handlerDurations, 95),
  };

  const measured = stats.frames >= budget.minFrames;
  const judge = (ok: boolean): Verdict => (measured ? (ok ? "pass" : "fail") : "not-measured");
  const p95LimitMs = budget.p95FrameIntervals * interval + budget.jitterMs;
  const lines: BudgetLine[] = [
    {
      id: "frame-count",
      verdict: measured ? "pass" : "not-measured",
      actual: stats.frames,
      limit: budget.minFrames,
    },
    {
      id: "p95-frame-time",
      verdict: judge(stats.p95Ms <= p95LimitMs),
      actual: stats.p95Ms,
      limit: budget.p95FrameIntervals,
      limitMs: p95LimitMs,
    },
    {
      id: "dropped-frames",
      verdict: judge(stats.droppedPct < budget.maxDroppedPct),
      actual: stats.droppedPct,
      limit: budget.maxDroppedPct,
    },
    {
      id: "long-animation-frames",
      verdict: judge(longFrames.length === 0),
      actual: longFrames.length,
      limit: 0,
      limitMs: budget.maxLongAnimationFrameMs,
    },
  ];
  if (budget.inputP95Intervals !== undefined) {
    const inputLimitMs = budget.inputP95Intervals * interval + budget.jitterMs;
    const enough = measured && stats.inputs >= (budget.minInputs ?? 1);
    lines.push({
      id: "input-to-next-frame",
      verdict: enough ? (stats.inputP95Ms <= inputLimitMs ? "pass" : "fail") : "not-measured",
      actual: stats.inputP95Ms,
      limit: budget.inputP95Intervals,
      limitMs: inputLimitMs,
    });
  }
  if (budget.handlerP95Ms !== undefined) {
    const enough = measured && stats.handlerSamples >= (budget.minHandlerSamples ?? 1);
    lines.push({
      id: "handler-time",
      verdict: enough
        ? stats.handlerP95Ms <= budget.handlerP95Ms
          ? "pass"
          : "fail"
        : "not-measured",
      actual: stats.handlerP95Ms,
      limit: budget.handlerP95Ms,
      limitMs: budget.handlerP95Ms,
    });
  }

  return {
    verdict: worstVerdict(lines.map((line) => line.verdict)),
    stats,
    lines,
    longAnimationFrames: longFrames,
  };
}

/** Runs measured on displays whose refresh intervals differ more than this cannot pool. */
const SAME_DISPLAY_TOLERANCE = 0.01;

/**
 * Pools the repetitions of one scenario into one sample set. Each run has its
 * own clock, so every run is shifted to start after the previous one ends:
 * presentation order holds and no frame changes length.
 */
export function aggregateSamples(runs: FrameSampleSet[]): FrameSampleSet {
  if (runs.length === 0) throw new FrameReportRefused("no runs to aggregate");
  const intervals = runs.map((run) => run.refreshIntervalMs);
  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  if (intervals.some((value) => Math.abs(value - mean) / mean > SAME_DISPLAY_TOLERANCE)) {
    throw new FrameReportRefused(
      `runs disagree on the refresh interval (${intervals.map((v) => v.toFixed(2)).join(", ")} ms)`
    );
  }
  const pooled: FrameSampleSet = {
    refreshIntervalMs: mean,
    frames: [],
    longAnimationFrames: [],
    inputs: [],
  };
  if (runs.some((run) => run.handlerMs !== undefined)) pooled.handlerMs = [];
  let cursor = 0;
  for (const run of runs) {
    const first = Math.min(
      ...run.frames.map((f) => f.startMs),
      ...run.longAnimationFrames.map((f) => f.startMs),
      ...(run.inputs ?? []).map((i) => i.atMs)
    );
    const shift = Number.isFinite(first) ? cursor - first : 0;
    for (const f of run.frames) pooled.frames.push({ ...f, startMs: f.startMs + shift });
    for (const f of run.longAnimationFrames) {
      pooled.longAnimationFrames.push({ ...f, startMs: f.startMs + shift });
    }
    for (const i of run.inputs ?? []) {
      pooled.inputs?.push({ atMs: i.atMs + shift, nextFrameMs: i.nextFrameMs + shift });
    }
    for (const duration of run.handlerMs ?? []) pooled.handlerMs?.push(duration);
    const last = Math.max(
      cursor,
      ...run.frames.map((f) => f.startMs + f.durationMs + shift),
      ...run.longAnimationFrames.map((f) => f.startMs + f.durationMs + shift),
      ...(run.inputs ?? []).map((i) => i.nextFrameMs + shift)
    );
    cursor = last + mean;
  }
  return pooled;
}
