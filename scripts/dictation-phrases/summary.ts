// One run of the phrase lane in numbers (issue #274): what the context biasing
// spike compares across runs. Pure, so the gate lane tests it.
import type { ModelScore } from "@/test/support/dictation-phrase-score";

/** The middle value, or the mean of the two middle ones; null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface RunClip {
  latencies?: (number | null)[];
  ms?: number;
}

export interface RunSummary {
  model: string;
  hitRate: number;
  proseTriggers: number;
  misheardProseTriggers: number;
  nameHitRate: number | null;
  /** Median engine latency of every finished line, in ms. */
  lineLatencyP50: number | null;
  /** Median time to transcribe one clip, fed faster than real time, in ms. */
  clipMsP50: number | null;
  setContextMs: number | null;
  vocabularyEntries: number;
}

export function runSummary(input: {
  model: string;
  score: ModelScore;
  clips: readonly RunClip[];
  setContextMs?: number | null;
  vocabularyEntries: number;
}): RunSummary {
  const { model, score, clips } = input;
  const latencies = clips.flatMap((clip) =>
    (clip.latencies ?? []).filter((value): value is number => typeof value === "number")
  );
  const clipMs = clips.flatMap((clip) => (typeof clip.ms === "number" ? [clip.ms] : []));
  return {
    model,
    hitRate: score.hitRate,
    proseTriggers: score.proseTriggers,
    misheardProseTriggers: score.misheardProseTriggers,
    nameHitRate: score.nameHitRate,
    lineLatencyP50: median(latencies),
    clipMsP50: median(clipMs),
    setContextMs: input.setContextMs ?? null,
    vocabularyEntries: input.vocabularyEntries,
  };
}
