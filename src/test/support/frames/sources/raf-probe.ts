// Probe source (issue #372): the in-page rAF recorder's dump to the
// normalized sample set, for engines with no tracing protocol (WebKit). Also the shared reader for the probe's
// keystroke and long-animation-frame records, which every source attaches.

import {
  FrameReportRefused,
  type FrameSample,
  type FrameSampleSet,
  type InputSample,
  type LongAnimationFrame,
  percentile,
} from "@/test/support/frames/frame-report";
import type { ProbeDump } from "@/test/support/frames/probe";

/** Fewer quiet-page deltas than this cannot establish the refresh interval. */
const MIN_CALIBRATION_FRAMES = 30;
/** Share of quiet-page deltas that must sit within 10% of their median. */
const MIN_STEADY_SHARE = 0.8;
/** A frame this long is a long animation frame, the LoAF API's own threshold. */
const LONG_FRAME_MS = 50;

/**
 * The refresh interval from a quiet page's rAF cadence, accepted only when the
 * cadence is steady; a busy or throttled page refuses. It is the mean of the
 * deltas near the median, not the median itself: WebKit rounds its clock to
 * whole milliseconds, so a 60 Hz cadence reads 16, 17, 17, 16... and its
 * median would be a whole number that real frames overrun.
 */
export function refreshIntervalFromCadence(deltas: number[]): number {
  const valid = deltas.filter((delta) => Number.isFinite(delta) && delta > 0);
  if (valid.length < MIN_CALIBRATION_FRAMES) {
    throw new FrameReportRefused(
      `rAF calibration drew ${valid.length} frames; the refresh interval needs ${MIN_CALIBRATION_FRAMES}`
    );
  }
  const median = percentile(valid, 50);
  const steady = valid.filter((delta) => Math.abs(delta - median) <= median * 0.1);
  if (steady.length / valid.length < MIN_STEADY_SHARE) {
    throw new FrameReportRefused(
      `rAF cadence is unsteady (${steady.length} of ${valid.length} frames near ${median.toFixed(2)} ms); refresh rate unknown`
    );
  }
  return steady.reduce((sum, delta) => sum + delta, 0) / steady.length;
}

function isDump(dump: unknown): dump is ProbeDump {
  const d = dump as ProbeDump | null;
  return (
    typeof d === "object" &&
    d !== null &&
    Array.isArray(d.rafTimestamps) &&
    Array.isArray(d.inputs) &&
    Array.isArray(d.longAnimationFrames)
  );
}

/** The probe's keystroke and long-animation-frame records, as samples. */
export function probeInputsAndLongFrames(dump: ProbeDump): {
  inputs: InputSample[];
  longAnimationFrames: LongAnimationFrame[];
} {
  if (!isDump(dump)) throw new FrameReportRefused("probe dump is malformed");
  return {
    inputs: dump.inputs
      .filter((input) => Number.isFinite(input.atMs) && Number.isFinite(input.nextFrameMs))
      .map(({ atMs, nextFrameMs }) => ({ atMs, nextFrameMs })),
    longAnimationFrames: dump.longAnimationFrames.map((entry) => ({
      startMs: entry.startTime,
      durationMs: entry.duration,
      blockingDurationMs: entry.blockingDuration,
      scripts: entry.scripts.map((script) => ({
        invoker: script.invoker,
        sourceURL: script.sourceURL,
        sourceFunctionName: script.sourceFunctionName,
        ...(typeof script.sourceCharPosition === "number" && script.sourceCharPosition >= 0
          ? { sourceCharPosition: script.sourceCharPosition }
          : {}),
        durationMs: script.duration,
      })),
    })),
  };
}

/**
 * Frames from consecutive rAF timestamps: each frame lasts until the next one
 * starts. Where the engine has no Long Animation Frames API, every frame over
 * 50 ms stands in for one, without script attribution.
 */
export function parseProbeDump(dump: ProbeDump, refreshIntervalMs: number): FrameSampleSet {
  const { inputs, longAnimationFrames } = probeInputsAndLongFrames(dump);
  const stamps = dump.rafTimestamps;
  const frames: FrameSample[] = [];
  for (let i = 1; i < stamps.length; i++) {
    frames.push({ startMs: stamps[i - 1], durationMs: stamps[i] - stamps[i - 1] });
  }
  return {
    refreshIntervalMs,
    frames,
    inputs,
    longAnimationFrames: dump.loafSupported
      ? longAnimationFrames
      : frames
          .filter((frame) => frame.durationMs > LONG_FRAME_MS)
          .map((frame) => ({ ...frame, scripts: [] })),
  };
}
