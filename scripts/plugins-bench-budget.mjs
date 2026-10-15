#!/usr/bin/env node
// Checks the Plugins bench (issue #448) against its frozen budgets.
// Reads the JSON the Plugins bench runner wrote and exits 0 (every budget
// holds), 1 (a budget missed) or 2 (the report could not measure). The budget
// check is pure; the report path is argv[2].
//
//   node scripts/plugins-bench-budget.mjs <plugins-bench.json>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Frozen budgets for the Plugins bench (issue #448). Not configurable. */
export const BUDGETS = Object.freeze({
  /** Launch/persistent delta allowance: max(5% of the baseline median, 20 ms). */
  launchDeltaFraction: 0.05,
  launchDeltaFloorMs: 20,
  /** Per-Plugin-id startToReady p95, in ms. */
  startToReadyP95Ms: 150,
  /** Command-to-effect p95, in ms. */
  commandToEffectP95Ms: 100,
  /** Remote UI echo p95, in ms (1,000 rows). */
  remoteUiEchoP95Ms: 16,
  /** Remote UI burst p95, in ms. */
  remoteUiBurstP95Ms: 50,
  /** Echoes highlight update p95, in ms (#451): the host's setHighlights dispatch and decoration build. */
  echoHighlightUpdateP95Ms: 10,
  /** Echoes Worker recompute p95, in ms (#451): findEchoes + buildEchoList + echoHighlightSets. */
  echoWorkerRecomputeP95Ms: 50,
  /** Echoes refresh latency p95, in ms (#451): spell check's 300 ms debounce plus the 50 ms Worker budget. */
  echoRefreshLatencyP95Ms: 350,
});

/** Nearest-rank percentile: sort ascending, take index ceil(p/100 * n) - 1. */
export function percentile(samples, p) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

/** Median: the middle value, or the average of the two middle values for even n. */
export function median(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function row(name, value, budget) {
  return { name, value, budget, unit: "ms", pass: value === null ? null : value <= budget };
}

/** A row that holds only when the flag is false: value 1 (lost) against budget 0. */
function flagRow(name, lost) {
  const value = lost ? 1 : 0;
  return { name, value, budget: 0, unit: "bool", pass: value <= 0 };
}

function delta(installed, baseline) {
  const installedMedian = median(installed);
  const baselineMedian = median(baseline);
  return installedMedian === null || baselineMedian === null
    ? null
    : installedMedian - baselineMedian;
}

export function checkBudgets(report) {
  const launch = report.launch ?? {};
  const baseline = launch.baseline ?? [];
  const installed20 = launch.installed20 ?? [];
  const persistent3 = launch.persistent3 ?? [];
  const startToReady = report.startToReady ?? {};
  const commandToEffect = report.commandToEffect ?? [];
  const remoteUiEcho = report.remoteUiEcho ?? [];
  const remoteUiBurst = report.remoteUiBurst ?? [];
  // The Echoes highlight rows (#451) are measured on the Chromium lane; the
  // WebKitGTK lane drives the native binary and does not produce them, so they
  // are required (and reported) only for `chromium`.
  const echoes = report.engine === "chromium";
  const echoHighlightUpdate = report.echoHighlightUpdate ?? [];
  const echoWorkerRecompute = report.echoWorkerRecompute ?? [];
  const echoRefreshLatency = report.echoRefreshLatency ?? [];

  const baselineMedian = median(baseline);
  const allowance = Math.max(
    BUDGETS.launchDeltaFraction * (baselineMedian ?? 0),
    BUDGETS.launchDeltaFloorMs
  );

  const rows = [
    row("launch delta", delta(installed20, baseline), allowance),
    row("persistent delta", delta(persistent3, baseline), allowance),
  ];
  for (const id of Object.keys(startToReady)) {
    rows.push(
      row(`startToReady ${id}`, percentile(startToReady[id], 95), BUDGETS.startToReadyP95Ms)
    );
  }
  rows.push(row("commandToEffect", percentile(commandToEffect, 95), BUDGETS.commandToEffectP95Ms));
  rows.push(row("remoteUiEcho", percentile(remoteUiEcho, 95), BUDGETS.remoteUiEchoP95Ms));
  rows.push(row("remoteUiBurst", percentile(remoteUiBurst, 95), BUDGETS.remoteUiBurstP95Ms));
  if (echoes) {
    rows.push(
      row("echoHighlightUpdate", percentile(echoHighlightUpdate, 95), BUDGETS.echoHighlightUpdateP95Ms)
    );
    rows.push(
      row("echoWorkerRecompute", percentile(echoWorkerRecompute, 95), BUDGETS.echoWorkerRecomputeP95Ms)
    );
    rows.push(
      row("echoRefreshLatency", percentile(echoRefreshLatency, 95), BUDGETS.echoRefreshLatencyP95Ms)
    );
  }
  // A lost echo/burst text is a miss, not "cannot measure": the final typed
  // text never showed, so the lane cannot claim the hold it measured.
  rows.push(flagRow("remoteUiEcho text kept", report.remoteUiEchoTextLost === true));
  rows.push(flagRow("remoteUiBurst text kept", report.remoteUiBurstTextLost === true));

  const required = { baseline, installed20, persistent3, commandToEffect, remoteUiEcho, remoteUiBurst };
  if (echoes) {
    required.echoHighlightUpdate = echoHighlightUpdate;
    required.echoWorkerRecompute = echoWorkerRecompute;
    required.echoRefreshLatency = echoRefreshLatency;
  }
  for (const [id, samples] of Object.entries(startToReady)) required[`startToReady ${id}`] = samples;
  const empty = Object.keys(required).filter((name) => required[name].length === 0);

  // "Cannot measure" takes precedence over a miss, so an incomplete report
  // never reads as a pass or a fail. Each reason names what is missing.
  const reasons = [...(report.unmeasured ?? [])];
  if (empty.length > 0) reasons.push(`no samples: ${empty.join(", ")}`);
  if (Object.keys(startToReady).length === 0) reasons.push("no on-demand Plugin to start");
  const missed = rows.some((r) => r.pass === false);
  const exitCode = reasons.length > 0 ? 2 : missed ? 1 : 0;
  return { rows, exitCode, reasons };
}

/** Prints the budget table to stdout; returns the exit code. */
export function printBudgetReport(result, heading = "") {
  console.log(`\nPlugins bench budget (issue #448)${heading}, times in ms`);
  const width = Math.max("name".length, ...result.rows.map((r) => r.name.length));
  const cell = (value) => (value === null ? "n/a" : value.toFixed(2));
  console.log(
    `${"name".padEnd(width)} | ${"value".padStart(8)} | ${"budget".padStart(8)} | unit | result`
  );
  console.log(`${"-".repeat(width)}-+-${"-".repeat(8)}-+-${"-".repeat(8)}-+------+-------`);
  for (const r of result.rows) {
    const verdict = r.pass === null ? "n/a" : r.pass ? "pass" : "FAIL";
    console.log(
      `${r.name.padEnd(width)} | ${cell(r.value).padStart(8)} | ${cell(r.budget).padStart(8)} | ${r.unit.padEnd(4)} | ${verdict}`
    );
  }
  if (result.exitCode === 2) {
    for (const reason of result.reasons) console.error(`cannot measure: ${reason}`);
  }
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/plugins-bench-budget.mjs <plugins-bench.json>");
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`cannot read ${path}: ${error.message}`);
    process.exit(2);
  }
  process.exit(printBudgetReport(checkBudgets(report)));
}
