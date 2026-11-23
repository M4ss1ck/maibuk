// `pnpm bench:android-lane [options]`: the Android emulator lane (issue #925).
// It measures, on both AVDs `scripts/android-avds.sh` creates, the Plugin
// engine's own start-up and QuickJS call latency (the Plugin conformance run),
// Reader's start-up measure, and how long Reader takes to open a large EPUB, a
// ~50 MB PDF, and a large CBZ from its Shelf, with the host's heartbeat misses
// for each fixture. It writes e2e/.output/android-lane/<started>/report.json and
// prints one table row per AVD.
//
// Never in CI: it boots emulators. It needs `scripts/android-avds.sh create`
// once first, so both AVDs exist, and a working `adb` on PATH.

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AndroidDevice, type Page, expect } from "@playwright/test";
import {
  buildImageEpub,
  buildLargeComicBook,
  buildLargePdf,
} from "../plugins/maibuk-reader/scripts/generate-fixtures.mjs";
import { pluginStartMeasure } from "@/features/plugins/bench/measure";
import { pluginHeartbeatMissMarkName } from "@/lib/bench-marks";
import { buildAndroidApp, findDebugApk } from "./conformance/android";
import {
  PrerequisiteMissing,
  attachWebView,
  claimTestInstall,
  connectDevice,
} from "./frames/android";
import { nowIn, pageIndicator } from "./reader-bench/support";
import { root } from "./run-steps.mjs";

const LANE_DIR = "e2e/.output/android-lane";
const CONFORMANCE_APK = `${LANE_DIR}/conformance.apk`;
const BENCH_APK = `${LANE_DIR}/bench.apk`;

/** The AVDs `scripts/android-avds.sh create` makes. */
const AVDS = ["maibuk_api26", "maibuk_api36"] as const;
type AvdName = (typeof AVDS)[number];

const USAGE = `usage: pnpm bench:android-lane [--avd ${AVDS.join("|")}|all] [--opens N] [--skip-build]`;

/** The target both APKs build for; the AVDs' images are x86_64. */
const BUILD_TARGET = "x86_64";

/** How long one Document may take to show its first page, in ms. */
const OPEN_TIMEOUT_MS = 120_000;

/** The Reader Plugin's User Timing names, as the host emits them. */
const READER_START = pluginStartMeasure("maibuk-reader");
const READER_HEARTBEAT_MISS = pluginHeartbeatMissMarkName("maibuk-reader");

interface Options {
  avd: AvdName | "all";
  opens: number;
  skipBuild: boolean;
}

/** A bad invocation: the runner prints the usage and exits 2. */
class UsageError extends Error {}

/** One bench fixture, copied to the device's Downloads and opened from the Shelf. */
interface Fixture {
  id: "epub" | "pdf" | "cbz";
  file: string;
  /** The title Reader shows on the Shelf card: the file's metadata title where
   * Reader applies one (the EPUB's `dc:title`), else the file name's stem. */
  title: string;
  path: string;
}

/** The QuickJS timings the conformance run recorded, null when it recorded none. */
interface QuickJs {
  startMs: number | null;
  callLatencyMs: number | null;
}

/** One fixture's open samples on one AVD. */
interface FixtureSamples {
  id: Fixture["id"];
  file: string;
  title: string;
  samples: number[];
  medianMs: number | null;
  heartbeatMisses: number;
}

/** One AVD's numbers, as the report and the table carry them. */
interface AvdReport {
  name: AvdName;
  webViewVersion: string;
  quickjs: QuickJs;
  readerStartMs: number | null;
  fixtures: FixtureSamples[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = { avd: "all", opens: 5, skipBuild: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--avd") {
      const value = argv[++index];
      if (value !== "all" && !(AVDS as readonly string[]).includes(value ?? "")) {
        throw new UsageError(`--avd takes ${AVDS.join(", ")}, or all`);
      }
      options.avd = value as Options["avd"];
    } else if (arg === "--opens") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) {
        throw new UsageError("--opens takes an integer of 1 or more");
      }
      options.opens = value;
    } else {
      throw new UsageError(`unknown option ${arg}`);
    }
  }
  return options;
}

/** Builds the two APKs the lane installs, and keeps them under the lane's output. */
function buildApks(): void {
  mkdirSync(resolve(root, LANE_DIR), { recursive: true });
  console.log("[android-lane] building the conformance APK");
  buildAndroidApp({ root, target: BUILD_TARGET, env: { VITE_PLUGIN_CONFORMANCE: "1" } });
  copyDebugApk(resolve(root, CONFORMANCE_APK));
  console.log("[android-lane] building the bench APK");
  buildAndroidApp({ root, target: BUILD_TARGET, env: { VITE_PLUGIN_BENCH: "1" } });
  copyDebugApk(resolve(root, BENCH_APK));
}

/** Copies the newest debug APK to `destination`, refusing when the build wrote none. */
function copyDebugApk(destination: string): void {
  const apk = findDebugApk(root);
  if (!apk) throw new PrerequisiteMissing("no debug APK under the Android build outputs");
  copyFileSync(apk, destination);
}

/** Writes the three fixtures into `dir`, the same generators the Reader bench uses. */
function writeFixtures(dir: string): Fixture[] {
  const fixtures = [
    { id: "epub", file: "images.epub", title: "Plates, large", bytes: buildImageEpub() },
    { id: "pdf", file: "large.pdf", title: "large", bytes: buildLargePdf() },
    { id: "cbz", file: "pages.cbz", title: "pages", bytes: buildLargeComicBook() },
  ] as const;
  return fixtures.map(({ id, file, title, bytes }) => {
    const path = join(dir, file);
    writeFileSync(path, bytes);
    return { id, file, title, path };
  });
}

/** Boots one AVD headless and returns the serial `scripts/android-avds.sh` prints. */
function bootAvd(name: AvdName): string {
  const serial = execFileSync("bash", ["scripts/android-avds.sh", "boot", name], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (serial === "")
    throw new PrerequisiteMissing(`scripts/android-avds.sh boot ${name} printed no serial`);
  return serial;
}

/** Shuts one AVD down; a failure here never replaces the measurement's own error. */
function stopAvd(serial: string): void {
  try {
    execFileSync("bash", ["scripts/android-avds.sh", "stop", serial], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    console.warn(`[android-lane] could not stop ${serial}; stop it by hand`);
  }
}

/**
 * Runs the Plugin conformance lane against the booted AVD and reads the QuickJS
 * timings it wrote. Android's T2-frame-ipc fails by design, so the exit code is
 * not the result: the JSON is.
 */
function runConformance(outPath: string): QuickJs {
  const apk = resolve(root, CONFORMANCE_APK);
  if (!existsSync(apk))
    throw new PrerequisiteMissing(`${CONFORMANCE_APK} is missing; run without --skip-build`);
  spawnSync(
    "pnpm",
    ["conformance:plugins", "--platform", "android", "--apk", apk, "--out", outPath],
    { cwd: root, stdio: "inherit" }
  );
  const file = join(outPath, "plugins-conformance-android.json");
  if (!existsSync(file)) throw new PrerequisiteMissing(`conformance wrote no ${file}`);
  const run = JSON.parse(readFileSync(file, "utf8")) as {
    quickjs?: { startMs: number; callLatencyMs: number };
  };
  return {
    startMs: run.quickjs?.startMs ?? null,
    callLatencyMs: run.quickjs?.callLatencyMs ?? null,
  };
}

/** The Shelf card for `title`, found by its title text rather than its position. */
function shelfCard(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
}

/** Waits for the Document's page indicator, the sign the first page is drawn. */
async function waitForFirstPage(page: Page): Promise<void> {
  await expect(pageIndicator(page)).toContainText(/\d+ of \d+/, { timeout: OPEN_TIMEOUT_MS });
}

/** The Shelf, by its heading: Reader's landing page. */
async function waitForShelf(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Shelf", level: 2 })).toBeVisible({
    timeout: OPEN_TIMEOUT_MS,
  });
}

/**
 * Returns from a Document to the Shelf by history, an in-app navigation that
 * works at phone width, where the palette and sidebar the web bench uses differ.
 */
async function backToShelf(page: Page): Promise<void> {
  await page.goBack();
  await waitForShelf(page);
}

/** A Built-in Plugin starts disabled on first sight (approveBuiltInCopy): turn Reader on once per install. */
async function enableReader(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/settings#plugins`);
  // A fresh install offers the Tutorial first; the offer comes once, so it may be absent.
  await page
    .getByRole("button", { name: "Not now", exact: true })
    .click({ timeout: 5_000 })
    .catch(() => {});
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Reader/ }).click();
  const toggle = main.getByRole("switch", { name: "Enable Reader" });
  // React Aria's switch input is visually hidden, so it takes keys, not a pointer click.
  if (!(await toggle.isChecked())) {
    await toggle.focus();
    await page.keyboard.press("Space");
  }
  await expect(toggle).toBeChecked();
}

/**
 * Taps a system UI element. The picker redraws while it loads, so a node found
 * a moment ago can go stale before the tap lands; a stale one is found again.
 */
async function tapSystemUi(
  pw: AndroidDevice,
  selector: Parameters<AndroidDevice["tap"]>[0]
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pw.wait(selector, { timeout: 30_000 });
      await pw.tap(selector);
      return;
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("StaleObjectException")) throw error;
    }
  }
}

/** Shelves one fixture once, through the Android system file picker, and returns to the Shelf. */
async function shelve(page: Page, pw: AndroidDevice, fixture: Fixture): Promise<void> {
  await page.getByRole("button", { name: "Open file…", exact: true }).click();
  // The picker reopens where it was last, so after the first pick the file is
  // already in view. Only otherwise go through the roots drawer, and pick its
  // Downloads row by id: the toolbar title also reads "Downloads" by then.
  const file = { text: fixture.file };
  const inView = await pw
    .wait(file, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!inView) {
    await tapSystemUi(pw, { desc: "Show roots" });
    await tapSystemUi(pw, { text: "Downloads", res: "android:id/title" });
  }
  await tapSystemUi(pw, file);
  await waitForFirstPage(page);
  await backToShelf(page);
}

/** Installs the bench APK, shelves every fixture, and times `opens` opens of each. */
async function measureReader(
  failureDir: string,
  options: Options,
  fixtures: Fixture[],
  benchApk: string
): Promise<Pick<AvdReport, "webViewVersion" | "readerStartMs" | "fixtures">> {
  const serial = process.env.ANDROID_SERIAL;
  if (serial === undefined) throw new PrerequisiteMissing("ANDROID_SERIAL is not set");
  execFileSync("adb", ["-s", serial, "install", "-r", "-t", benchApk], {
    cwd: root,
    stdio: "inherit",
  });
  const device = await connectDevice();
  await claimTestInstall(device);
  execFileSync(
    "adb",
    ["-s", serial, "push", ...fixtures.map((fixture) => fixture.path), "/sdcard/Download/"],
    { cwd: root, stdio: "inherit" }
  );

  const session = await attachWebView(device);
  try {
    const page = session.page;
    await enableReader(page, session.origin);
    await page.goto(`${session.origin}/plugin/maibuk-reader/reader`);
    await waitForShelf(page);
    const readerStartMs = await page.evaluate((name) => {
      const [entry] = performance.getEntriesByName(name);
      return entry ? entry.duration : null;
    }, READER_START);

    const results: FixtureSamples[] = [];
    for (const fixture of fixtures) {
      await shelve(page, session.pw, fixture);
      const samples: number[] = [];
      let heartbeatMisses = 0;
      for (let open = 0; open < options.opens; open++) {
        await page.evaluate(() => performance.clearMarks());
        const started = await nowIn(page);
        await shelfCard(page, fixture.title)
          .getByRole("button", { name: "Open", exact: true })
          .click();
        await waitForFirstPage(page);
        const ended = await nowIn(page);
        samples.push(ended - started);
        heartbeatMisses += await page.evaluate(
          (name) => performance.getEntriesByName(name, "mark").length,
          READER_HEARTBEAT_MISS
        );
        await backToShelf(page);
      }
      results.push({
        id: fixture.id,
        file: fixture.file,
        title: fixture.title,
        samples,
        medianMs: median(samples),
        heartbeatMisses,
      });
    }
    return { webViewVersion: session.version, readerStartMs, fixtures: results };
  } catch (error) {
    // What the screen showed when a step failed, for the next run's fix. The
    // device's screenshot, not the page's: a system picker left open covers
    // the WebView, and the page's screenshot then never returns.
    mkdirSync(failureDir, { recursive: true });
    await session.pw.screenshot({ path: join(failureDir, "failure.png") }).catch(() => {});
    const tree = await session.page
      .locator("body")
      .ariaSnapshot()
      .catch(() => "");
    writeFileSync(join(failureDir, "failure-aria.txt"), `${session.page.url()}\n${tree}\n`);
    throw error;
  } finally {
    await session.close();
  }
}

/** The middle value of `samples`, or null when there are none. */
function median(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Boots one AVD, measures both lanes on it, and always stops it. */
async function measureAvd(
  name: AvdName,
  options: Options,
  runDir: string,
  fixtures: Fixture[]
): Promise<AvdReport> {
  console.log(`[android-lane] booting ${name}`);
  const serial = bootAvd(name);
  process.env.ANDROID_SERIAL = serial;
  console.log(`[android-lane] ${name} is ${serial}`);
  try {
    const quickjs = runConformance(join(runDir, name));
    const benchApk = resolve(root, BENCH_APK);
    if (!existsSync(benchApk)) {
      throw new PrerequisiteMissing(`${BENCH_APK} is missing; run without --skip-build`);
    }
    const reader = await measureReader(join(runDir, name), options, fixtures, benchApk);
    return { name, ...reader, quickjs };
  } finally {
    stopAvd(serial);
  }
}

/** A number in ms, rounded for the table; a missing one is a dash. */
function ms(value: number | null): string {
  return value === null ? "-" : String(Math.round(value));
}

/** Prints the per-AVD table: medians, Reader start, and heartbeat misses. */
function printTable(reports: AvdReport[]): void {
  const fixtureMedian = (report: AvdReport, id: Fixture["id"]): number | null =>
    report.fixtures.find((fixture) => fixture.id === id)?.medianMs ?? null;
  const rows = reports.map((report) => [
    report.name,
    report.webViewVersion,
    ms(report.quickjs.startMs),
    ms(report.quickjs.callLatencyMs),
    ms(report.readerStartMs),
    ms(fixtureMedian(report, "epub")),
    ms(fixtureMedian(report, "pdf")),
    ms(fixtureMedian(report, "cbz")),
    String(report.fixtures.reduce((total, fixture) => total + fixture.heartbeatMisses, 0)),
  ]);
  const header = [
    "AVD",
    "WebView",
    "quickjs start",
    "quickjs call",
    "reader start",
    "epub open",
    "pdf open",
    "cbz open",
    "misses",
  ];
  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((row) => row[index].length))
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]))
      .join("  ")
      .trimEnd();
  console.log("\nAndroid emulator lane (issue #925), ms");
  console.log(line(header));
  for (const row of rows) console.log(line(row));
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const runDir = resolve(root, LANE_DIR, String(startedAt));

  if (!options.skipBuild) buildApks();

  const fixtureDir = mkdtempSync(join(tmpdir(), "maibuk-android-lane-"));
  try {
    const fixtures = writeFixtures(fixtureDir);
    const names = options.avd === "all" ? [...AVDS] : [options.avd];
    const reports: AvdReport[] = [];
    for (const name of names) {
      reports.push(await measureAvd(name, options, runDir, fixtures));
    }
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "report.json"),
      `${JSON.stringify({ createdAt: new Date(startedAt).toISOString(), avds: reports }, null, 2)}\n`
    );
    printTable(reports);
    console.log(`\n[android-lane] report at ${LANE_DIR}/${startedAt}/report.json`);
    return 0;
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      process.exit(2);
    }
    if (error instanceof PrerequisiteMissing) {
      console.error(`[android-lane] cannot run: ${error.message}`);
      process.exit(2);
    }
    console.error(
      `[android-lane] could not measure: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(2);
  }
);
