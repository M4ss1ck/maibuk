// The conformance lane's report: the per-platform run, the committed results
// file, the exit-code mapping, and the table (#447, D1/D5). Pure, so every rule
// — what makes a platform pass, what may be recorded, what the lane exits with —
// is tested without a build or a device.
//
// D1 recording rule: a MEASURED run (exit 0 or 1) is recorded; an exit-2 run is
// never. A run on a host-unsupported platform (v1 Android) records exit 1 with
// `support: "unsupported-in-v1"` and `followUp: "#492"`, and the engine records
// the engine's own version (`mergeRunEngine`), never the app version.

import { RENDERER_DIED_DETAIL, T7_CHECK_ID, T8_CHECK_ID } from "@/features/plugins/conformance/checks";
import {
  PLUGIN_HOST_UNSUPPORTED_PLATFORMS,
  type PluginHostPlatform,
} from "@/features/plugins/host-platform";
import type {
  ConformanceCheck,
  ConformanceEngine,
} from "@/features/plugins/conformance/types";
import { readCargoLockVersions } from "../../../../scripts/plugin-conformance-gate.mjs";
import type { CollectorState } from "@/test/support/plugin-conformance/collector-state";

/** The results schema id (D1), shared with the #407 file. */
export const CONFORMANCE_RESULTS_SCHEMA = "maibuk-plugin-conformance/1";

/** The committed results the lane records into, relative to the repo root. */
export const CONFORMANCE_RESULTS_PATH = "docs/research/plugins-conformance.results.json";

/** The engines the lane measures and the results file keys platforms by. */
export type ConformancePlatformName = "linux" | "android";

/** The host platform each lane platform measures (the lane's own naming). */
const HOST_PLATFORM_BY_LANE: Record<ConformancePlatformName, PluginHostPlatform> = {
  linux: "desktop",
  android: "android",
};

/** The `support` marker a run on a host-unsupported platform records (#447, D1). */
export const CONFORMANCE_UNSUPPORTED_SUPPORT = "unsupported-in-v1" as const;

/** The issue that lifts the marker, when present (#492). */
export const CONFORMANCE_UNSUPPORTED_FOLLOW_UP = "#492";

/**
 * True when the host runs no Plugin on the platform a lane platform measures
 * (`PLUGIN_HOST_UNSUPPORTED_PLATFORMS`, v1 Android, #447): the run is recorded
 * with `support: "unsupported-in-v1"` and its follow-up, #492.
 */
export function isHostUnsupportedLanePlatform(platform: ConformancePlatformName): boolean {
  return PLUGIN_HOST_UNSUPPORTED_PLATFORMS.includes(HOST_PLATFORM_BY_LANE[platform]);
}

/** The Tauri/wry versions the results pin, plus the WebView the run saw (D1). */
export interface ConformanceStack {
  tauri: string | null;
  wry: string | null;
  /** WebKitGTK version, measured on Linux. */
  webkitgtk?: string;
  /** Android System WebView package version, measured on Android. */
  androidWebView?: string;
}

/** One platform's run, as the results file records it (D1). */
export interface PlatformRun {
  ranAt: string;
  engine: ConformanceEngine;
  device?: string;
  /** The lane exit code this run recorded (0 or 1; only a measured run records). */
  exit: ExitCode;
  /** `"unsupported-in-v1"` when the host runs no Plugin on this platform (#447, #492). */
  support?: "unsupported-in-v1";
  /** The issue that lifts `support`, when present. */
  followUp?: string;
  checks: ConformanceCheck[];
}

/** The committed results file (D1). */
export interface ConformanceResultsFile {
  schema: string;
  recordedAt: string;
  stack: ConformanceStack;
  platforms: Partial<Record<ConformancePlatformName, PlatformRun>>;
}

/** The lane's exit code: 0 all pass, 1 a check failed, 2 cannot measure (D5). */
export type ExitCode = 0 | 1 | 2;

/** A platform's outcome, after the runner has waited (or given up). */
export interface PlatformOutcome {
  checks: ConformanceCheck[];
  exitCode: ExitCode;
  /** A short human note, e.g. "renderer died during T8". */
  note: string;
}

/**
 * The exit code a platform's checks map to (D5):
 *   - 2 when no check arrived, or any check is `unmeasured`: the run could not
 *     tell, so it must be rerun, and `--record` must not touch the results.
 *   - 1 when any check is `fail`.
 *   - 0 when every check passed.
 */
export function exitCodeForChecks(checks: ConformanceCheck[]): ExitCode {
  if (checks.length === 0) return 2;
  if (checks.some((check) => check.status === "unmeasured")) return 2;
  if (checks.some((check) => check.status === "fail")) return 1;
  return 0;
}

/** What the collector saw when the runner stopped waiting (D4/D5). */
export type RunCompletion =
  | { kind: "done"; checks: ConformanceCheck[] }
  | { kind: "renderer-died"; checks: ConformanceCheck[] }
  | { kind: "incomplete" };

/**
 * Turns the collector's final state into a completion. `/result` is the whole
 * run, so it wins when it arrived. A process that died before `/result` while T8
 * was in flight (T7 settled, T8 did not) is a T8 fail `renderer-died`; dying
 * anywhere earlier is not a measurement (D4/D5).
 */
export function classifyRun(
  state: CollectorState,
  options: { processDied: boolean }
): RunCompletion {
  if (state.result) return { kind: "done", checks: state.result.checks };
  const settled = new Set(state.progress.map((check) => check.id));
  if (options.processDied && settled.has(T7_CHECK_ID) && !settled.has(T8_CHECK_ID)) {
    return {
      kind: "renderer-died",
      checks: [...state.progress, { id: T8_CHECK_ID, status: "fail", detail: RENDERER_DIED_DETAIL }],
    };
  }
  return { kind: "incomplete" };
}

/** The platform's outcome from the collector's state and whether the app died. */
export function finalizeRun(
  state: CollectorState,
  options: { processDied: boolean }
): PlatformOutcome {
  const completion = classifyRun(state, options);
  if (completion.kind === "incomplete") {
    return {
      checks: state.progress,
      exitCode: 2,
      note: state.progress.length === 0 ? "no checks arrived" : "run did not finish before /done",
    };
  }
  const exitCode = exitCodeForChecks(completion.checks);
  if (completion.kind === "renderer-died") {
    return { checks: completion.checks, exitCode, note: `renderer died during ${T8_CHECK_ID}` };
  }
  return { checks: completion.checks, exitCode, note: exitCode === 0 ? "all checks passed" : "check failed" };
}

/**
 * Whether a platform may be recorded (D1): a MEASURED run — exit 0 or 1 — is
 * recorded; an exit-2 run (no check arrived, any `unmeasured`, a build or device
 * the lane could not reach) is never recorded, because the lane could not tell.
 * The gate is about versions, not pass/fail: a genuine failure while the host is
 * supported still records, keeping exit 1, so the file shows it. An Android run
 * records exit 1 with `support: "unsupported-in-v1"` because the host runs no
 * Plugin there (#447, #492).
 */
export function canRecord(outcome: PlatformOutcome): boolean {
  return outcome.exitCode === 0 || outcome.exitCode === 1;
}

/** The stack versions from `Cargo.lock`, plus whatever a platform measured. */
export function stackFromCargoLock(
  cargoLockText: string,
  extra: Omit<ConformanceStack, "tauri" | "wry"> = {}
): ConformanceStack {
  const { tauri, wry } = readCargoLockVersions(cargoLockText);
  return { tauri, wry, ...extra };
}

/** The engine name a platform falls back to when no `/result` arrived (D1). */
export function defaultEngineName(platform: ConformancePlatformName): string {
  return platform === "linux" ? "tauri-webkitgtk" : "android-webview";
}

/**
 * The engine the recorded run carries: **the engine version, never the app
 * version** (#447 D1 follow-up). The measured WebKitGTK version (Linux,
 * `pkg-config`) or System WebView `versionName` (Android) wins; the engine name
 * comes from the run that reported it or the platform's fallback, and the
 * userAgent comes from the first `/progress` or `/result` that carried one (a
 * run that died before either records `"unknown"`).
 */
export function mergeRunEngine(input: {
  run: ConformanceEngine | null;
  platform: ConformancePlatformName;
  /** The measured engine version: `stack.webkitgtk` or `stack.androidWebView`. */
  version?: string;
  /** The userAgent the collector saw first, from any request that carried one. */
  userAgent?: string | null;
}): ConformanceEngine {
  return {
    name: input.run?.name ?? defaultEngineName(input.platform),
    version: input.version ?? input.run?.version ?? "unknown",
    userAgent: input.userAgent ?? input.run?.userAgent ?? "unknown",
  };
}

/** The run a platform writes to `.bench/` and, on a measured run, merges in. */
export function buildPlatformRun(input: {
  platform: ConformancePlatformName;
  engine: ConformanceEngine;
  checks: ConformanceCheck[];
  ranAt: string;
  /** The lane exit code the run settled on (0 or 1). */
  exit: ExitCode;
  device?: string;
}): PlatformRun {
  const unsupported = isHostUnsupportedLanePlatform(input.platform);
  return {
    ranAt: input.ranAt,
    engine: input.engine,
    ...(input.device === undefined ? {} : { device: input.device }),
    exit: input.exit,
    ...(unsupported
      ? { support: CONFORMANCE_UNSUPPORTED_SUPPORT, followUp: CONFORMANCE_UNSUPPORTED_FOLLOW_UP }
      : {}),
    checks: input.checks,
  };
}

/** A fresh results file with no platforms recorded yet. */
export function emptyResultsFile(recordedAt: string, stack: ConformanceStack): ConformanceResultsFile {
  return { schema: CONFORMANCE_RESULTS_SCHEMA, recordedAt, stack, platforms: {} };
}

/**
 * Merges one platform's run into the results, keeping the other platform and the
 * stack keys it measured. The stack's tauri/wry always come from the current
 * `Cargo.lock`; a platform's WebView version only overwrites its own key.
 */
export function mergePlatformRun(
  file: ConformanceResultsFile | null,
  platform: ConformancePlatformName,
  run: PlatformRun,
  stack: ConformanceStack,
  recordedAt: string
): ConformanceResultsFile {
  const base = file ?? emptyResultsFile(recordedAt, stack);
  return {
    schema: CONFORMANCE_RESULTS_SCHEMA,
    recordedAt,
    stack: { ...base.stack, ...stack },
    platforms: { ...base.platforms, [platform]: run },
  };
}

/** One row of the runner's closing table. */
export interface PlatformSummary {
  platform: ConformancePlatformName;
  outcome: PlatformOutcome;
  leaks: number;
  engine: ConformanceEngine | null;
}

function counts(checks: ConformanceCheck[]): { pass: number; fail: number; unmeasured: number } {
  return {
    pass: checks.filter((check) => check.status === "pass").length,
    fail: checks.filter((check) => check.status === "fail").length,
    unmeasured: checks.filter((check) => check.status === "unmeasured").length,
  };
}

/** The lane's exit code across platforms: the worst one, 2 when none ran. */
export function laneExitCode(summaries: PlatformSummary[]): ExitCode {
  if (summaries.length === 0) return 2;
  return summaries.reduce<ExitCode>(
    (worst, summary) => (summary.outcome.exitCode > worst ? summary.outcome.exitCode : worst),
    0
  );
}

/** The closing table: one line per platform plus the failing checks. */
export function formatConformanceTable(summaries: PlatformSummary[]): string {
  if (summaries.length === 0) return "Plugin conformance: no platform ran.";
  const out = [
    "Plugin conformance (#447)",
    "| platform | exit | pass | fail | unmeasured | leaks | engine | note |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  for (const summary of summaries) {
    const { pass, fail, unmeasured } = counts(summary.outcome.checks);
    const engine = summary.engine
      ? `${summary.engine.name} ${summary.engine.version}`
      : "unknown engine";
    out.push(
      `| ${summary.platform} | ${summary.outcome.exitCode} | ${pass} | ${fail} | ${unmeasured} | ${summary.leaks} | ${engine} | ${summary.outcome.note} |`
    );
  }
  for (const summary of summaries) {
    for (const check of summary.outcome.checks) {
      if (check.status !== "pass") {
        out.push(`${summary.platform}: ${check.id} ${check.status}: ${check.detail}`);
      }
    }
  }
  return out.join("\n");
}
