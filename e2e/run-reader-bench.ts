// `pnpm bench:reader [options]`: the Reader performance lane (issue #653). It
// generates the bench's large PDF and EPUB into a temporary folder (never
// committed), builds the E2E web app, runs the typing scenario of bench:frames,
// runs the Reader specs (e2e/reader-bench/) through Playwright, runs the typing
// scenario again after the reading session, judges the four performance gates
// (scripts/reader-bench-budget.mjs), writes .bench/reader.json, and prints the
// tables. Exit codes: 0 every gate holds, 1 a gate fails, 2 a measurement or
// the harness could not run. `--spike` runs the threading spike instead
// (e2e/reader-bench/spike.bench.ts, the nested-versus-inline pdf.js core).
// Never in CI: timing on a shared runner is noise.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkFrameBench } from "../src/test/support/frames/bench-report";
import {
  buildLargeEpub,
  buildLargePdf,
} from "../plugins/maibuk-reader/scripts/generate-fixtures.mjs";
import {
  checkReaderBench,
  printReaderBench,
  type ReaderBenchReport,
} from "../scripts/reader-bench-budget.mjs";
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

const MEASUREMENTS_ROOT = "e2e/.output/reader-bench";
const REPORT = resolve(root, ".bench/reader.json");
const SPIKE_REPORT = resolve(root, ".bench/reader-spike.json");
const FRAMES_REPORT = resolve(root, ".bench/frames-chromium.json");

interface Options {
  headless: boolean;
  reuseBuild: boolean;
  spike: boolean;
  samples: number;
}

/** The default start-up sample count: the enabled-versus-disabled delta is noisy at fewer. */
const DEFAULT_SAMPLES = 20;

class UsageError extends Error {}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    headless: true,
    reuseBuild: false,
    spike: false,
    samples: DEFAULT_SAMPLES,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--headed") options.headless = false;
    else if (arg === "--reuse-build") options.reuseBuild = true;
    else if (arg === "--spike") options.spike = true;
    else if (arg === "--samples") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 3)
        throw new UsageError("--samples takes an integer of 3 or more");
      options.samples = value;
    } else {
      throw new UsageError(
        `unknown option ${arg}; usage: pnpm bench:reader [--headed] [--reuse-build] [--samples N] [--spike]`
      );
    }
  }
  return options;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** The machine the numbers came from, for the vendor README and the report. */
function machine(): { nproc: number; cpu: string; loadavg: number[] } {
  return {
    nproc: cpus().length,
    cpu: cpus()[0]?.model ?? "unknown",
    loadavg: loadavg().map((value) => Number(value.toFixed(2))),
  };
}

/** Runs one bench:frames typing pass; returns its typing numbers, or null when it wrote no report. */
function runTyping(
  label: string
): { ok: boolean; p95Ms: number; refreshIntervalMs: number } | null {
  console.log(`\n[reader-bench] editor typing (bench:frames), ${label}`);
  // Headless on both sides of the reading session, so the two runs compare.
  const args = ["run", "bench:frames", "--", "--scenario", "typing", "--reuse-build", "--headless"];
  const run = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
  if (!existsSync(FRAMES_REPORT)) {
    console.error(`[reader-bench] bench:frames wrote no report (exit ${run.status})`);
    return null;
  }
  const check = checkFrameBench(JSON.parse(readFileSync(FRAMES_REPORT, "utf8")));
  const typing = check.scenarios.find((scenario) => scenario.id === "typing");
  const aggregate = typing?.aggregate;
  if (!aggregate) return null;
  return {
    ok: typing?.verdict === "pass",
    p95Ms: aggregate.stats.p95Ms,
    refreshIntervalMs: aggregate.stats.refreshIntervalMs,
  };
}

/** Serves the E2E web build, runs Playwright on the given specs, and returns its exit code. */
async function runSpecs(
  options: Options,
  measurementsDir: string,
  specs: string[],
  env: Record<string, string>,
  config: string
): Promise<number> {
  const runDir = createRunDir(root, PREVIEW_RUNS_DIR);
  let preview: Preview | null = null;
  const stopSync = () => {
    preview?.stopSync();
    killRecordedPreview(runDir);
    rmSync(runDir, { recursive: true, force: true });
  };
  const teardown = ownTeardown(stopSync);
  try {
    preview = await startPreview(root, runDir);
  } catch (error) {
    stopSync();
    throw error;
  }
  console.log(`[reader-bench] web build served at ${preview.url}`);
  const code = await runPlaywright({
    root,
    label: "reader-bench",
    config,
    args: specs,
    env: {
      E2E_BASE_URL: preview.url,
      READER_BENCH_OUT: measurementsDir,
      READER_BENCH_HEADLESS: options.headless ? "1" : "0",
      READER_BENCH_SAMPLES: String(options.samples),
      ...env,
    },
    teardown,
  });
  await preview.stop();
  rmSync(runDir, { recursive: true, force: true });
  return code;
}

function readJson<T>(dir: string, name: string): T | null {
  const file = join(dir, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

/** The threading spike: nested Worker versus inline, parsing the same 50 MB PDF. */
async function runSpike(options: Options, fixtures: { pdf: string }): Promise<number> {
  const runs: Record<string, unknown>[] = [];
  for (const mode of ["nested", "inline"]) {
    const dir = resolve(root, MEASUREMENTS_ROOT, `spike-${mode}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const code = await runSpecs(
      options,
      dir,
      ["reader-bench/spike.bench.ts"],
      { READER_BENCH_PDF: fixtures.pdf, READER_BENCH_SPIKE_MODE: mode },
      "e2e/playwright.reader-bench.config.ts"
    );
    const result = readJson<{
      mode: string;
      firstPageMs: number;
      lagMs: number[];
      blobWorkers: string[];
    }>(dir, `spike-${mode}.json`);
    rmSync(dir, { recursive: true, force: true });
    if (code !== 0 || result === null) {
      console.error(`[reader-bench] spike ${mode} did not measure (playwright exit ${code})`);
      return 2;
    }
    const sorted = [...result.lagMs].sort((a, b) => a - b);
    const max = sorted.at(-1) ?? Number.NaN;
    const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? Number.NaN;
    runs.push({
      mode,
      firstPageMs: result.firstPageMs,
      samples: sorted.length,
      maxLagMs: max,
      p95LagMs: p95,
      blobWorkers: result.blobWorkers.length,
    });
  }
  const report = {
    createdAt: new Date().toISOString(),
    repo: git(["rev-parse", "--short", "HEAD"]),
    machine: machine(),
    runs,
  };
  mkdirSync(dirname(SPIKE_REPORT), { recursive: true });
  writeFileSync(SPIKE_REPORT, `${JSON.stringify(report, null, 1)}\n`);
  console.log("\nThreading spike (issue #653): Plugin Worker stall during a 50 MB PDF open, ms");
  console.log("| mode | first page | samples | max stall | p95 stall | blob workers |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const run of runs as {
    mode: string;
    firstPageMs: number;
    samples: number;
    maxLagMs: number;
    p95LagMs: number;
    blobWorkers: number;
  }[]) {
    console.log(
      `| ${run.mode} | ${run.firstPageMs.toFixed(0)} | ${run.samples} | ${run.maxLagMs.toFixed(1)} | ${run.p95LagMs.toFixed(1)} | ${run.blobWorkers} |`
    );
  }
  console.log(`[reader-bench] spike report at .bench/reader-spike.json`);
  return 0;
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  const started = Date.now();
  console.log(
    `[reader-bench] load ${machine().loadavg.join(" ")} on ${machine().nproc} CPUs; run one bench at a time`
  );
  if (options.reuseBuild) process.env.E2E_REUSE_BUILD = "1";

  // The fixtures are generated fresh each run into a temporary folder, the
  // same generators the committed small fixtures come from, and removed after.
  const fixtureDir = mkdtempSync(join(tmpdir(), "maibuk-reader-bench-"));
  const fixtures = {
    pdf: join(fixtureDir, "large-document.pdf"),
    epub: join(fixtureDir, "large-book.epub"),
  };
  writeFileSync(fixtures.pdf, buildLargePdf());
  writeFileSync(fixtures.epub, buildLargeEpub());
  console.log(`[reader-bench] fixtures generated in ${fixtureDir}`);

  try {
    buildWeb();
    const swept = sweepStalePreviews(root);
    if (swept > 0)
      console.log(`[reader-bench] removed ${swept} web server run(s) a killed run left behind`);

    if (options.spike) return await runSpike(options, fixtures);

    const typingBefore = runTyping("before reading");
    const dir = resolve(root, MEASUREMENTS_ROOT, String(started));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const code = await runSpecs(
      options,
      dir,
      [
        "reader-bench/startup.bench.ts",
        "reader-bench/control.bench.ts",
        "reader-bench/document.bench.ts",
      ],
      { READER_BENCH_PDF: fixtures.pdf, READER_BENCH_EPUB: fixtures.epub },
      "e2e/playwright.reader-bench.config.ts"
    );
    const typingAfter = runTyping("after reading");

    const idleDisabled = readJson<{ startupMs: number[]; heapBytes: number[] }>(
      dir,
      "idle-disabled.json"
    );
    const idleEnabled = readJson<{ startupMs: number[]; heapBytes: number[] }>(
      dir,
      "idle-enabled.json"
    );
    const document = readJson<ReaderBenchReport["document"]>(dir, "document.json");
    const control = readJson<{ baselineHeapBytes: number; afterLeaveHeapBytes: number }>(
      dir,
      "control.json"
    );
    rmSync(dir, { recursive: true, force: true });

    if (code !== 0)
      console.error(
        `[reader-bench] playwright exited ${code}; a missing measurement is unmeasured`
      );
    const report: ReaderBenchReport & Record<string, unknown> = {
      version: 1,
      createdAt: new Date().toISOString(),
      repo: git(["rev-parse", "--short", "HEAD"]),
      machine: machine(),
      idle: { disabled: idleDisabled, enabled: idleEnabled },
      control: control ?? null,
      document: document ?? null,
      typing: { before: typingBefore, after: typingAfter },
    };
    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, `${JSON.stringify(report, null, 1)}\n`);
    const result = checkReaderBench(report);
    const exit = printReaderBench(result, " (chromium)");
    console.log(`[reader-bench] report at .bench/reader.json`);
    wallClock(started);
    return code !== 0 && exit === 0 ? 2 : exit;
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // A harness failure is "could not measure" (exit 2), never a crash.
    console.error(
      `[reader-bench] could not measure: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(2);
  }
);
