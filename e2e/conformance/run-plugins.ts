// `pnpm conformance:plugins`: the Plugin conformance lane (#447, D5). It starts
// the collector, builds the fixture-hostile Plugin, then for each platform
// builds the app with `VITE_PLUGIN_CONFORMANCE=1`, launches it, waits for `/done`
// (or for the app to die), and writes `.bench/plugins-conformance-<platform>.json`.
// Exit 0 all pass, 1 a check failed, 2 it could not measure (no display, no
// device, a build failure, a timeout, an `unmeasured` check). Never in CI: it
// needs a display, a device, or both.
//
// The rules live in `src/test/support/plugin-conformance/` and get unit tests;
// this file is the process and socket shell around them.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CONFORMANCE_COLLECTOR_BASE_URL } from "@/features/plugins/conformance/reporter";
import type { ConformanceEngine } from "@/features/plugins/conformance/types";
import {
  PLUGIN_CONFORMANCE_USAGE,
  PluginConformanceUsageError,
  type PluginConformanceOptions,
  parsePluginConformanceArgs,
  platformsFor,
} from "@/test/support/plugin-conformance/args";
import {
  CONFORMANCE_RESULTS_PATH,
  type ConformanceResultsFile,
  type ConformanceStack,
  type PlatformOutcome,
  type PlatformRun,
  type PlatformSummary,
  buildPlatformRun,
  canRecord,
  finalizeRun,
  formatConformanceTable,
  isHostUnsupportedLanePlatform,
  laneExitCode,
  mergePlatformRun,
  mergeRunEngine,
  stackFromCargoLock,
} from "@/test/support/plugin-conformance/report";
import {
  FIRST_CONTACT_TIMEOUT_MS,
  type WaitOutcome,
  lastLogLines,
  waitOutcome,
} from "@/test/support/plugin-conformance/wait";
import { CARGO_LOCK_PATH, checkConformanceGate } from "../../scripts/plugin-conformance-gate.mjs";
import { PrerequisiteMissing, claimTestInstall, connectDevice } from "../frames/android";
import { buildPluginFixtures } from "../support/plugin-fixtures-build";
import { root, wallClock } from "../run-steps.mjs";
import {
  androidWebViewVersion,
  assertOneAdbDevice,
  buildAndroidApp,
  deviceAndroidTarget,
  findDebugApk,
  installAndroidApp,
  launchAndroidApp,
} from "./android";
import { type ConformanceCollector, startConformanceCollector } from "./collector";
import { assertLinuxPrerequisites, buildLinuxApp, launchLinuxApp } from "./linux";
import type { ConformanceEngineName, RunningApp, RunDir } from "./types";

const POLL_MS = 250;

function refuse(message: string): never {
  console.error(`[conformance] cannot run: ${message}`);
  process.exit(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** Warn — never refuse — when Cargo.lock moved past the recorded results. */
function warnOnGate(cargoLockText: string): void {
  const resultsPath = resolve(root, CONFORMANCE_RESULTS_PATH);
  if (!existsSync(resultsPath)) {
    console.log(`[conformance] no recorded results yet (${CONFORMANCE_RESULTS_PATH}); nothing to gate against`);
    return;
  }
  const results = JSON.parse(readFileSync(resultsPath, "utf8"));
  const { ok, problems } = checkConformanceGate(cargoLockText, results);
  if (ok) return;
  console.warn("[conformance] Cargo.lock differs from the recorded results (a rerun will refresh it):");
  for (const problem of problems) console.warn(`[conformance]   ${problem}`);
}

interface StartedPlatform {
  app: RunningApp;
  device?: string;
  stackExtra: Omit<ConformanceStack, "tauri" | "wry">;
}

async function startPlatform(
  platform: ConformanceEngineName,
  options: PluginConformanceOptions,
  runDir: RunDir
): Promise<StartedPlatform> {
  if (platform === "linux") {
    const { webkitgtk } = assertLinuxPrerequisites();
    if (!options.skipBuild) buildLinuxApp({ root, runDir });
    const app = await launchLinuxApp({ root, runDir });
    return { app, stackExtra: { webkitgtk } };
  }

  const serial = await assertOneAdbDevice();
  if (!options.skipBuild) buildAndroidApp({ root, target: await deviceAndroidTarget(serial) });
  const apk = findDebugApk(root);
  if (!apk) throw new PrerequisiteMissing("no debug APK under the Android build outputs");
  await installAndroidApp(serial, apk);
  const device = await connectDevice();
  await claimTestInstall(device);
  const androidWebView = await androidWebViewVersion(serial);
  const app = await launchAndroidApp({ device, runDir });
  return {
    app,
    device: `${device.model} (${device.abi}, Android ${device.androidVersion})`,
    stackExtra: { androidWebView },
  };
}

interface PlatformResult {
  platform: ConformanceEngineName;
  outcome: PlatformOutcome;
  leaks: number;
  engine: ConformanceEngine;
  run: PlatformRun;
  stack: ConformanceStack;
}

/** The log file a platform's app writes into the run directory. */
function appLogPath(platform: ConformanceEngineName, runDir: RunDir): string {
  return resolve(runDir.dir, platform === "linux" ? "linux.log" : "logcat-android.txt");
}

/** Prints the tail of the app's captured output so a stalled run is diagnosable. */
function printAppLogTail(platform: ConformanceEngineName, runDir: RunDir): void {
  const path = appLogPath(platform, runDir);
  if (!existsSync(path)) return;
  const tail = lastLogLines(readFileSync(path, "utf8"), 20);
  if (tail === "") return;
  console.warn(`[conformance] ${platform}: last app log lines (${path}):`);
  for (const line of tail.split("\n")) console.warn(`[conformance]   ${line}`);
}

async function measurePlatform(
  platform: ConformanceEngineName,
  options: PluginConformanceOptions,
  runDir: RunDir,
  collector: ConformanceCollector,
  cargoLockText: string
): Promise<PlatformResult> {
  collector.reset();
  const started = await startPlatform(platform, options, runDir);
  console.log(`[conformance] ${platform}: launched; waiting for /done`);

  const launchedAt = Date.now();
  const deadlineMs = options.timeoutMinutes * 60_000;
  let stop: WaitOutcome = { kind: "continue" };
  for (;;) {
    const state = collector.state();
    stop = waitOutcome({
      elapsedMs: Date.now() - launchedAt,
      deadlineMs,
      firstContactMs: FIRST_CONTACT_TIMEOUT_MS,
      done: state.done,
      alive: await started.app.isAlive(),
      requests: state.requests,
    });
    if (stop.kind !== "continue") break;
    await sleep(POLL_MS);
  }

  // Print why the wait ended, then the app's own output, before stopping it.
  if (stop.kind === "first-contact-timeout") {
    console.warn(
      `[conformance] ${platform}: app never contacted the collector within ${FIRST_CONTACT_TIMEOUT_MS / 1000} s`
    );
  } else if (stop.kind === "deadline") {
    console.warn(`[conformance] ${platform}: no /done within ${options.timeoutMinutes} min`);
  } else if (stop.kind === "process-died") {
    console.warn(`[conformance] ${platform}: the app process exited before /done`);
  }
  if (stop.kind !== "done") printAppLogTail(platform, runDir);

  await started.app.stop();

  const state = collector.state();
  const outcome = finalizeRun(state, { processDied: stop.kind === "process-died" });
  if (stop.kind === "first-contact-timeout") {
    // Replaces finalizeRun's "no checks arrived": the app produced no request at
    // all, which is a different failure from a run that started and went quiet.
    outcome.note = "app never contacted the collector";
  }
  // The engine records the engine's own version — WebKitGTK on Linux, System
  // WebView `versionName` on Android — never the app version (#447 D1). The name
  // and userAgent come from the run that reported them (the first `/progress` or
  // `/result` that carried one), so an Android run that died before `/result`
  // still records the WebView it ran in.
  const engine = mergeRunEngine({
    run: state.engine,
    platform,
    version: started.stackExtra.webkitgtk ?? started.stackExtra.androidWebView,
    userAgent: state.userAgent,
  });
  const ranAt = new Date().toISOString();
  return {
    platform,
    outcome,
    leaks: state.leaks,
    engine,
    run: buildPlatformRun({
      platform,
      engine,
      checks: outcome.checks,
      ranAt,
      exit: outcome.exitCode,
      device: started.device,
    }),
    stack: stackFromCargoLock(cargoLockText, started.stackExtra),
  };
}

async function main(): Promise<void> {
  let options: PluginConformanceOptions;
  try {
    options = parsePluginConformanceArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof PluginConformanceUsageError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
  if (options.help) {
    console.log(PLUGIN_CONFORMANCE_USAGE);
    return;
  }

  const startedAt = Date.now();
  const outDir = resolve(root, options.out);
  mkdirSync(outDir, { recursive: true });
  const runDir: RunDir = {
    dir: resolve(root, "e2e/.output/conformance", String(startedAt)),
    configPath: resolve(root, "e2e/.output/conformance", String(startedAt), "tauri.conformance.json"),
  };
  mkdirSync(runDir.dir, { recursive: true });

  let collector: ConformanceCollector;
  try {
    collector = await startConformanceCollector();
  } catch (error) {
    refuse(`cannot bind ${CONFORMANCE_COLLECTOR_BASE_URL}: ${(error as Error).message}`);
  }

  const cargoLockText = readFileSync(CARGO_LOCK_PATH, "utf8");
  warnOnGate(cargoLockText);

  // Fail fast (and clearly) for an explicit platform; skip an unavailable one
  // when `all` was asked for.
  const requested = platformsFor(options.platform);
  const platforms: ConformanceEngineName[] = [];
  for (const platform of requested) {
    try {
      if (platform === "linux") assertLinuxPrerequisites();
      else await assertOneAdbDevice();
      platforms.push(platform);
    } catch (error) {
      if (!(error instanceof PrerequisiteMissing)) throw error;
      if (options.platform !== "all") refuse(error.message);
      console.warn(`[conformance] skipping ${platform}: ${error.message}`);
    }
  }
  if (platforms.length === 0) refuse("no platform is available to measure");

  console.log(`[conformance] building the fixture-hostile Plugin for ${CONFORMANCE_COLLECTOR_BASE_URL}`);
  await buildPluginFixtures({ origin: CONFORMANCE_COLLECTOR_BASE_URL });

  const resultsPath = resolve(root, CONFORMANCE_RESULTS_PATH);
  let results: ConformanceResultsFile | null = existsSync(resultsPath)
    ? (JSON.parse(readFileSync(resultsPath, "utf8")) as ConformanceResultsFile)
    : null;

  const summaries: PlatformSummary[] = [];
  for (const platform of platforms) {
    try {
      const result = await measurePlatform(platform, options, runDir, collector, cargoLockText);
      const outPath = resolve(outDir, `plugins-conformance-${platform}.json`);
      writeFileSync(outPath, `${JSON.stringify(result.run, null, 2)}\n`);
      summaries.push({
        platform,
        outcome: result.outcome,
        leaks: result.leaks,
        engine: result.engine,
      });
      console.log(`[conformance] ${platform}: report at ${outPath}`);

      if (options.record) {
        if (canRecord(result.outcome)) {
          results = mergePlatformRun(results, platform, result.run, result.stack, new Date().toISOString());
          writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
          const unsupported = isHostUnsupportedLanePlatform(platform)
            ? " (unsupported-in-v1, follow-up #492)"
            : "";
          console.log(
            `[conformance] recorded ${platform} (exit ${result.outcome.exitCode})${unsupported} into ${CONFORMANCE_RESULTS_PATH}`
          );
        } else {
          console.warn(
            `[conformance] ${platform} could not be measured; not recorded (exit ${result.outcome.exitCode})`
          );
        }
      }
    } catch (error) {
      // A build, install, launch, or wait failure is "cannot measure" (exit 2),
      // not a crash: the platform is skipped under `all`, refused when asked for
      // by name.
      const message = error instanceof Error ? error.message : String(error);
      if (options.platform !== "all") refuse(message);
      console.warn(`[conformance] skipping ${platform}: ${message}`);
    }
  }

  await collector.close();

  console.log(`\n${formatConformanceTable(summaries)}`);
  console.log(`[conformance] repo ${git(["rev-parse", "--short", "HEAD"]) || "unknown"}; app ${readAppVersion()}`);
  wallClock(startedAt);
  process.exit(laneExitCode(summaries));
}

function readAppVersion(): string {
  try {
    return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version as string;
  } catch {
    return "unknown";
  }
}

await main();
