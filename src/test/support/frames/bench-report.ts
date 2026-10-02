// The frame-rate lane's JSON report and its budget check (issue #372).
//
// A run writes one report per source under .bench/ (frames-<source>.json):
// its environment, the scenarios it was asked for, and every repetition's
// normalized samples. The check re-judges the samples against today's budget
// table rather than trusting verdicts stored in the file, so an old report
// can be re-checked and two reports are compared by the same rules. It fails
// on any `fail`, any `not-measured`, any refused scenario, and any scenario
// that was asked for but is missing.

import { budgetFor, FRAME_BUDGETS } from "@/test/support/frames/budget";
import {
  aggregateSamples,
  type FrameReport,
  FrameReportRefused,
  type FrameSampleSet,
  frameReport,
} from "@/test/support/frames/frame-report";
import type { FrameSource } from "@/test/support/frames/scenarios";

export interface FrameBenchEnvironment {
  source: FrameSource;
  /** chromium, webkit, or android-webview. */
  engine: string;
  engineVersion: string;
  /** headed, new-headless, or device. */
  mode: string;
  platform: string;
  device?: { model: string; abi: string; androidVersion: string; serial: string };
  refreshIntervalMs: number | null;
  /** Where the refresh interval came from: trace, raf-cadence, or surfaceflinger. */
  refreshSource: string;
  cpuThrottling: number;
  viewport: { width: number; height: number } | null;
  appVersion: string;
  commit: string;
}

export interface FrameBenchScenarioResult {
  id: string;
  runs: FrameSampleSet[];
  /** Set when the scenario could not be measured at all. */
  refused?: string;
}

export interface FrameBenchReport {
  version: 1;
  createdAt: string;
  environment: FrameBenchEnvironment;
  /** Every scenario this run was asked for; a missing one fails the check. */
  requested: string[];
  scenarios: FrameBenchScenarioResult[];
}

export interface ScenarioCheck {
  id: string;
  verdict: "pass" | "fail" | "not-measured" | "refused" | "missing";
  aggregate: FrameReport | null;
  runs: FrameReport[];
  reason?: string;
}

export interface BenchCheck {
  ok: boolean;
  scenarios: ScenarioCheck[];
}

function checkScenario(id: string, result: FrameBenchScenarioResult | undefined): ScenarioCheck {
  if (!result) return { id, verdict: "missing", aggregate: null, runs: [], reason: "did not run" };
  if (result.refused) {
    return { id, verdict: "refused", aggregate: null, runs: [], reason: result.refused };
  }
  if (!FRAME_BUDGETS[id]) {
    return { id, verdict: "refused", aggregate: null, runs: [], reason: "no budget entry" };
  }
  try {
    const budget = budgetFor(id);
    const runs = result.runs.map((samples) => frameReport(samples, budget));
    const aggregate = frameReport(aggregateSamples(result.runs), budget);
    return { id, verdict: aggregate.verdict, aggregate, runs };
  } catch (error) {
    if (!(error instanceof FrameReportRefused)) throw error;
    return { id, verdict: "refused", aggregate: null, runs: [], reason: error.message };
  }
}

export function checkFrameBench(report: FrameBenchReport): BenchCheck {
  const ids = [...new Set([...(report.requested ?? []), ...report.scenarios.map((s) => s.id)])];
  const scenarios = ids.map((id) => checkScenario(id, report.scenarios.find((s) => s.id === id)));
  return { ok: scenarios.length > 0 && scenarios.every((s) => s.verdict === "pass"), scenarios };
}

const ms = (value: number) => value.toFixed(1);

function row(label: string, report: FrameReport, verdict: string): string {
  const s = report.stats;
  const input = report.lines.some((l) => l.id === "input-to-next-frame") ? ms(s.inputP95Ms) : "–";
  return `| ${label} | ${s.frames} | ${ms(s.p50Ms)} | ${ms(s.p95Ms)} | ${ms(s.p99Ms)} | ${s.droppedPct.toFixed(2)}% (${s.missedVsyncs}) | ${ms(s.worstMs)} | ${s.longAnimationFrames} | ${input} | ${verdict} |`;
}

/** The markdown budget table, failing lines, and top long-frame scripts. */
export function formatFrameBench(
  report: FrameBenchReport,
  check = checkFrameBench(report)
): string {
  const env = report.environment;
  const refresh = env.refreshIntervalMs
    ? `${env.refreshIntervalMs.toFixed(2)} ms (${(1000 / env.refreshIntervalMs).toFixed(1)} Hz, ${env.refreshSource})`
    : "unknown";
  const device = env.device
    ? ` on ${env.device.model} (${env.device.abi}, Android ${env.device.androidVersion})`
    : "";
  const out: string[] = [
    `Frame budget (issue #372): ${env.source} via ${env.engine} ${env.engineVersion}, ${env.mode}${device}`,
    `Refresh ${refresh}; CPU throttling ${env.cpuThrottling}x; app ${env.appVersion} @ ${env.commit}`,
    "",
    "| scenario | frames | p50 ms | p95 ms | p99 ms | dropped (missed vsyncs) | worst ms | LoAF > 50 ms | key→frame p95 ms | verdict |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const scenario of check.scenarios) {
    if (!scenario.aggregate) {
      out.push(
        `| ${scenario.id} | – | – | – | – | – | – | – | – | ${scenario.verdict.toUpperCase()}: ${scenario.reason} |`
      );
      continue;
    }
    const verdict = scenario.verdict === "pass" ? "pass" : scenario.verdict.toUpperCase();
    out.push(row(`${scenario.id} (${scenario.runs.length} runs)`, scenario.aggregate, verdict));
    scenario.runs.forEach((run, i) => {
      out.push(row(`  run ${i + 1}`, run, run.verdict));
    });
  }
  for (const scenario of check.scenarios) {
    if (!scenario.aggregate || scenario.verdict === "pass") continue;
    const failing = scenario.aggregate.lines.filter((line) => line.verdict !== "pass");
    out.push("", `${scenario.id}: ${failing.map((l) => `${l.id} ${l.verdict}`).join(", ")}`);
    for (const frame of scenario.aggregate.longAnimationFrames.slice(0, 3)) {
      const scripts = [...frame.scripts].sort((a, b) => b.durationMs - a.durationMs).slice(0, 3);
      const where = scripts.length
        ? scripts
            .map(
              (s) =>
                `${s.source ?? `${s.sourceFunctionName || "(anonymous)"} ${s.sourceURL}`} via ${s.invoker} ${ms(s.durationMs)} ms`
            )
            .join("; ")
        : "no attribution from this engine";
      out.push(`  long frame ${ms(frame.durationMs)} ms: ${where}`);
    }
  }
  out.push("", check.ok ? "Every scenario holds its budget." : "Frame budget missed.");
  return out.join("\n");
}
