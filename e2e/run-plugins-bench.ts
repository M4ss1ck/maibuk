// `pnpm bench:plugins [options]`: the Plugins bench (issue #448). Builds the
// web app with VITE_PLUGIN_BENCH=1 into a directory of its own (so the flag
// never leaks into the E2E build), serves it, runs the bench specs
// (e2e/plugins-bench/) through Playwright, assembles a PluginsBenchReport from
// the per-measurement JSON they write, prints the budget table, and exits with
// the worst code across lanes (2 > 1 > 0). Any harness error or missing
// prerequisite is an `unmeasured` reason and exit 2, never a crash. Never in
// CI: browser timing on a shared runner is noise.
//
// Unit 4a measures Chromium. Unit 4b measures the real Tauri Linux binary
// (`webkitgtk`), because Playwright's WebKit has no OPFS and cannot seed
// Plugins there; its plan lives in `e2e/plugins-bench/webkitgtk-plan.ts` and its
// process shell in `e2e/plugins-bench/webkitgtk.ts`.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type PluginsBenchReport,
  checkBudgets,
  printBudgetReport,
} from "../scripts/plugins-bench-budget.mjs";
import {
  type MeasurementFile,
  type PluginsBenchEngine,
  type PluginsBenchOptions,
  PluginsBenchUsageError,
  assembleReport,
  combineExitCodes,
  parsePluginsBenchArgs,
  unmeasuredReport,
} from "./plugins-bench/report";
import {
  PREVIEW_RUNS_DIR,
  type Preview,
  createRunDir,
  killRecordedPreview,
  ownTeardown,
  runPlaywright,
  startPreview,
  sweepStalePreviews,
} from "./preview-server.mjs";
import { measureWebKitGtk } from "./plugins-bench/webkitgtk";
import { buildWeb, root, wallClock } from "./run-steps.mjs";

/** The `VITE_PLUGIN_BENCH=1` build, kept apart from the E2E build. */
const PLUGINS_BENCH_WEB = "e2e/.output/plugins-bench-web";
/** Where the specs write their per-measurement JSON, one run dir per run. */
const MEASUREMENTS_ROOT = "e2e/.output/plugins-bench";

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/**
 * Measures the Chromium lane: build, serve, run the bench specs, assemble the
 * report from what they wrote. Throws (the caller records it as unmeasured and
 * exits 2) on a missing display, a missing build, or a failed server.
 */
async function measureChromium(
  options: PluginsBenchOptions,
  started: number
): Promise<PluginsBenchReport> {
  if (!options.headless && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error("no display for a headed browser; pass --headless for the new headless mode");
  }
  if (options.reuseBuild) process.env.E2E_REUSE_BUILD = "1";
  buildWeb({ outDir: PLUGINS_BENCH_WEB, env: { VITE_PLUGIN_BENCH: "1" } });
  if (!existsSync(resolve(root, PLUGINS_BENCH_WEB, "index.html"))) {
    throw new Error(`no web build in ${PLUGINS_BENCH_WEB}; run without --reuse-build`);
  }

  const measurementsDir = resolve(root, MEASUREMENTS_ROOT, String(started));
  rmSync(measurementsDir, { recursive: true, force: true });
  mkdirSync(measurementsDir, { recursive: true });

  const swept = sweepStalePreviews(root);
  if (swept > 0) {
    console.log(`[plugins-bench] removed ${swept} web server run(s) a killed run left behind`);
  }
  const runDir = createRunDir(root, PREVIEW_RUNS_DIR);
  let preview: Preview | null = null;
  const stopSync = () => {
    preview?.stopSync();
    killRecordedPreview(runDir);
    rmSync(runDir, { recursive: true, force: true });
  };
  const teardown = ownTeardown(stopSync);
  try {
    preview = await startPreview(root, runDir, PLUGINS_BENCH_WEB);
  } catch (error) {
    stopSync();
    throw error;
  }
  console.log(`[plugins-bench] web build served at ${preview.url}`);

  const code = await runPlaywright({
    root,
    label: "plugins-bench",
    config: "e2e/playwright.plugins-bench.config.ts",
    args: [],
    env: {
      E2E_BASE_URL: preview.url,
      PLUGINS_BENCH_OUT: measurementsDir,
      PLUGINS_BENCH_SAMPLES: String(options.samples),
      PLUGINS_BENCH_HEADLESS: options.headless ? "1" : "0",
    },
    teardown,
  });
  await preview.stop();
  rmSync(runDir, { recursive: true, force: true });

  const files: MeasurementFile[] = existsSync(measurementsDir)
    ? readdirSync(measurementsDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => ({
          name: name.slice(0, -".json".length),
          text: readFileSync(resolve(measurementsDir, name), "utf8"),
        }))
    : [];
  rmSync(measurementsDir, { recursive: true, force: true });

  const report = assembleReport("chromium", files);
  if (code !== 0) {
    // A Playwright failure is a harness problem, never a measurement.
    report.unmeasured = [...(report.unmeasured ?? []), `playwright exited ${code}`];
  }
  return report;
}

/** Writes `.bench/plugins-<engine>.json`, prints the budget table, returns its code. */
function writeAndPrint(engine: PluginsBenchEngine, report: PluginsBenchReport): number {
  const out = resolve(root, `.bench/plugins-${engine}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
  const code = printBudgetReport(checkBudgets(report), ` (${engine})`);
  console.log(`[plugins-bench] ${engine}: report at .bench/plugins-${engine}.json`);
  return code;
}

async function main(): Promise<void> {
  let options: PluginsBenchOptions;
  try {
    options = parsePluginsBenchArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof PluginsBenchUsageError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }

  const started = Date.now();
  const codes: number[] = [];
  for (const engine of options.engines) {
    let report: PluginsBenchReport;
    try {
      report =
        engine === "webkitgtk"
          ? await measureWebKitGtk(root, options, started)
          : await measureChromium(options, started);
    } catch (error) {
      // A missing prerequisite or a harness failure is "cannot measure" (exit
      // 2), with the reason in `unmeasured`, never a crash.
      const reason = error instanceof Error ? error.message : String(error);
      report = unmeasuredReport(engine, [reason]);
    }
    codes.push(writeAndPrint(engine, report));
  }

  console.log(`[plugins-bench] repo ${git(["rev-parse", "--short", "HEAD"]) || "unknown"}`);
  wallClock(started);
  process.exit(combineExitCodes(codes));
}

await main();
