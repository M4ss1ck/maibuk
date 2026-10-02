// `pnpm bench:frames [options]`: the frame-rate lane (issue #372). Checks the
// source's prerequisites, builds and serves the web app (web sources), runs
// the scenarios through Playwright (e2e/playwright.frames.config.ts), writes
// the JSON report under .bench/, prints the budget table, and exits 1 when a
// scenario misses its budget, 2 when the lane could not run. Never in CI:
// frame timing on a shared runner is noise. See e2e/README.md, "Frame-rate lane".

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type FrameBenchEnvironment,
  type FrameBenchReport,
  type FrameBenchScenarioResult,
  checkFrameBench,
  formatFrameBench,
} from "@/test/support/frames/bench-report";
import {
  FRAME_BENCH_USAGE,
  FrameBenchUsageError,
  type FrameBenchOptions,
  parseFrameBenchArgs,
} from "@/test/support/frames/cli";
import { resolveLongFrameSources } from "@/test/support/frames/attribution";
import { FRAME_SCENARIOS } from "@/test/support/frames/scenarios";
import { connectDevice, PrerequisiteMissing } from "./frames/android";
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
import { buildWeb, root, wallClock } from "./run-steps.mjs";

type ScenarioFile = FrameBenchScenarioResult & {
  engineVersion?: string;
  userAgent?: string;
  refreshSource?: string;
  viewport?: { width: number; height: number } | null;
  device?: FrameBenchEnvironment["device"];
  /** The scenario stopped on a setup problem (PrerequisiteMissing), not a measurement. */
  prerequisite?: boolean;
};

const WEB_BUILD = resolve(root, "e2e/.output/web-dist");

function readWebBuild(path: string): string | null {
  const file = resolve(WEB_BUILD, path);
  if (!file.startsWith(`${WEB_BUILD}/`) || !existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

function refuse(message: string): never {
  console.error(`[frames] cannot run: ${message}`);
  process.exit(2);
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function commit(): string {
  const sha = git(["rev-parse", "--short", "HEAD"]) || "unknown";
  return git(["status", "--porcelain", "--untracked-files=no"]) ? `${sha}-dirty` : sha;
}

async function checkPrerequisites(options: FrameBenchOptions): Promise<void> {
  if (options.source === "android") {
    try {
      const device = await connectDevice();
      console.log(`[frames] ${device.model} (${device.abi}, Android ${device.androidVersion})`);
    } catch (error) {
      if (error instanceof PrerequisiteMissing) refuse(error.message);
      throw error;
    }
    return;
  }
  if (!options.headless && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    refuse("no display for a headed browser; pass --headless for the new headless mode");
  }
}

function environment(options: FrameBenchOptions, files: ScenarioFile[]): FrameBenchEnvironment {
  const first = files.find((f) => f.engineVersion);
  const intervals = files
    .flatMap((f) => f.runs.map((r) => r.refreshIntervalMs))
    .filter((v) => v > 0);
  const engine =
    options.source === "android"
      ? "android-webview"
      : options.source === "probe"
        ? options.engine
        : "chromium";
  return {
    source: options.source,
    engine,
    engineVersion: first?.engineVersion ?? "unknown",
    mode:
      options.source === "android"
        ? "device"
        : !options.headless
          ? "headed"
          : engine === "chromium"
            ? "new-headless"
            : "headless",
    platform: `${process.platform}-${process.arch}`,
    ...(first?.device ? { device: first.device } : {}),
    refreshIntervalMs:
      intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null,
    refreshSource: first?.refreshSource ?? "none",
    cpuThrottling: options.cpuThrottling,
    viewport: first?.viewport ?? null,
    appVersion: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version,
    commit: commit(),
  };
}

async function main(): Promise<void> {
  let options: FrameBenchOptions;
  try {
    options = parseFrameBenchArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof FrameBenchUsageError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
  if (options.list) {
    for (const s of FRAME_SCENARIOS) {
      const skips = Object.entries(s.skip ?? {}).map(([src, why]) => `not on ${src}: ${why}`);
      console.log(`${s.id.padEnd(18)} ${s.title} (seed ${s.seed}, ${s.repetitions} runs)`);
      console.log(`${"".padEnd(18)} warm-up: ${s.warmUp}`);
      console.log(`${"".padEnd(18)} measured: ${s.measured}`);
      for (const skip of skips) console.log(`${"".padEnd(18)} ${skip}`);
    }
    console.log(`\n${FRAME_BENCH_USAGE}`);
    return;
  }

  const started = Date.now();
  await checkPrerequisites(options);
  const web = options.source !== "android";
  if (web) {
    if (options.reuseBuild) process.env.E2E_REUSE_BUILD = "1";
    buildWeb({ sourcemap: true });
    if (!existsSync(resolve(root, "e2e/.output/web-dist/index.html"))) {
      refuse("no web build in e2e/.output/web-dist; run without --reuse-build");
    }
  }

  const outDir = resolve(root, "e2e/.output/frames", String(started));
  mkdirSync(outDir, { recursive: true });
  const swept = sweepStalePreviews(root);
  if (swept > 0)
    console.log(`[frames] removed ${swept} web server run(s) a killed run left behind`);
  const runDir = createRunDir(root, PREVIEW_RUNS_DIR);
  let preview: Preview | null = null;
  const stopSync = () => {
    preview?.stopSync();
    killRecordedPreview(runDir);
    rmSync(runDir, { recursive: true, force: true });
  };
  const teardown = ownTeardown(stopSync);
  if (web) {
    try {
      preview = await startPreview(root, runDir);
    } catch (error) {
      stopSync();
      refuse((error as Error).message);
    }
    console.log(`[frames] web build served at ${preview.url}`);
  }

  console.log(
    `[frames] ${options.source}: ${options.scenarios.join(", ")}${options.repeat ? `, ${options.repeat} runs each` : ""}`
  );
  const code = await runPlaywright({
    root,
    label: "frames",
    config: "e2e/playwright.frames.config.ts",
    args: [],
    env: {
      E2E_BASE_URL: preview?.url,
      FRAMES_SOURCE: options.source,
      FRAMES_SCENARIOS: options.scenarios.join(","),
      FRAMES_REPEAT: options.repeat ? String(options.repeat) : undefined,
      FRAMES_CPU_THROTTLE: String(options.cpuThrottling),
      FRAMES_HEADLESS: options.headless ? "1" : "0",
      FRAMES_ENGINE: options.source === "probe" ? options.engine : "chromium",
      FRAMES_OUT: outDir,
      FRAMES_RAW: options.raw ? resolve(root, ".bench/frames-raw", options.source) : undefined,
    },
    teardown,
  });
  await preview?.stop();
  rmSync(runDir, { recursive: true, force: true });

  const files: ScenarioFile[] = readdirSync(outDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(resolve(outDir, name), "utf8")));
  rmSync(outDir, { recursive: true, force: true });
  const setupProblem = files.find((f) => f.prerequisite);
  const report: FrameBenchReport = {
    version: 1,
    createdAt: new Date(started).toISOString(),
    environment: environment(options, files),
    requested: options.scenarios,
    scenarios: options.scenarios.flatMap((id) => {
      const file = files.find((f) => f.id === id);
      if (!file) return [];
      // Name the code behind each long animation frame through the build's
      // source maps (web sources; the Android app's bundle is not served here).
      const runs = web
        ? file.runs.map((run) => ({
            ...run,
            longAnimationFrames: resolveLongFrameSources(run.longAnimationFrames, readWebBuild),
          }))
        : file.runs;
      return [{ id, runs, ...(file.refused ? { refused: file.refused } : {}) }];
    }),
  };
  const out = resolve(root, options.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 1));

  const check = checkFrameBench(report);
  console.log(`\n${formatFrameBench(report, check)}`);
  console.log(`\n[frames] report: ${options.out}`);
  if (code !== 0)
    console.error(`[frames] playwright exited ${code}; failed scenarios are listed above`);
  wallClock(started);
  if (setupProblem) {
    console.error(`[frames] cannot run: ${setupProblem.refused}`);
    process.exit(2);
  }
  process.exit(check.ok ? 0 : 1);
}

await main();
