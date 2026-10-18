// The frame-rate lane's scenarios as Playwright tests (issue #372). Run only
// through `pnpm bench:frames` (e2e/run-frames.ts), which picks the source,
// builds and serves the web app, and turns the results into the Frame Report.
// Each test prepares a fresh device with its seed Library, warms up, then
// measures its repetitions back to back and writes their samples to
// FRAMES_OUT/<scenario>.json. A refusal is written there too, never thrown
// away: a scenario that could not be measured must not look like a pass.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, chromium, type Page, test, webkit } from "@playwright/test";
import type { FrameBenchScenarioResult } from "@/test/support/frames/bench-report";
import { FrameReportRefused } from "@/test/support/frames/frame-report";
import { frameProbeScript } from "@/test/support/frames/probe";
import { isUnsupportedAction } from "@/test/support/frames/webdriver";
import {
  type FrameScenario,
  type FrameSource,
  scenariosFor,
} from "@/test/support/frames/scenarios";
import { SEED_DIR } from "../support/seed/seeds";
import { resetDeviceAndOpen, prepareDevice } from "../support/storage";
import { makeHermetic } from "../support/test";
import {
  attachWebView,
  claimTestInstall,
  connectDevice,
  installSeed,
  PrerequisiteMissing,
  type AndroidDevice,
} from "./android";
import {
  androidCollector,
  chromiumCollector,
  type FrameCollector,
  probeCollector,
} from "./collect";
import { FRAME_DRIVERS, type FrameDriverContext } from "./drivers";
import { type FramePage, playwrightFramePage } from "./frame-page";
import { launchDesktop } from "./desktop";

/** The repo root: the desktop source builds and launches the binary from here. */
const root = resolve(import.meta.dirname, "../..");

const source = (process.env.FRAMES_SOURCE ?? "chromium") as FrameSource;
const only = process.env.FRAMES_SCENARIOS ? process.env.FRAMES_SCENARIOS.split(",") : undefined;
const repeat = process.env.FRAMES_REPEAT ? Number(process.env.FRAMES_REPEAT) : undefined;
const cpuThrottling = Number(process.env.FRAMES_CPU_THROTTLE ?? 1);
const headless = process.env.FRAMES_HEADLESS === "1";
const engine = process.env.FRAMES_ENGINE ?? (source === "probe" ? "webkit" : "chromium");
const baseURL = process.env.E2E_BASE_URL;
const rawDir = process.env.FRAMES_RAW;
const outDir = process.env.FRAMES_OUT;
if (!outDir) throw new Error("FRAMES_OUT is not set: run the lane with `pnpm bench:frames`");
mkdirSync(outDir, { recursive: true });

interface ScenarioPage {
  /** The Playwright page; absent for the desktop source, which has none. */
  page?: Page;
  framePage: FramePage;
  ctx: FrameDriverContext;
  engineVersion: string;
  close(): Promise<void>;
}

let device: AndroidDevice | null = null;
let library: string | null = null;
let launched: Browser | null = null;

/** Headed by default; headless Chromium runs the new headless mode, never the old shell. */
async function webBrowser(): Promise<Browser> {
  if (launched) return launched;
  try {
    launched =
      engine === "webkit"
        ? await webkit.launch({ headless })
        : await chromium.launch(
            headless ? { channel: "chromium", headless: true } : { headless: false }
          );
  } catch (error) {
    const missingLib = /error while loading shared libraries: (\S+?):/.exec(String(error))?.[1];
    throw new PrerequisiteMissing(
      `cannot launch ${headless ? "headless" : "headed"} ${engine}` +
        `${missingLib ? ` (${missingLib} is missing)` : ""}: install its system libraries ` +
        `(sudo pnpm exec playwright install-deps ${engine})${headless ? "" : " or pass --headless"}`
    );
  }
  return launched;
}

test.afterAll(async () => {
  await launched?.close();
});

async function webPage(
  browser: Browser,
  scenario: FrameScenario,
  baseURL: string
): Promise<ScenarioPage> {
  const context = await browser.newContext({
    baseURL,
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 800 },
  });
  await makeHermetic(context);
  const page = await context.newPage();
  await prepareDevice(page, {
    library: scenario.seed as never,
    tutorial: "dismissed",
    // A scenario that seeds a Plugin skips the probe and android sources, where
    // the OPFS Plugin Directory does not exist (scenarios.ts `skip`).
    plugins: (scenario.plugins ?? []).map((plugin) => plugin.id) as never,
    pluginApprovals: (scenario.plugins ?? []).map((plugin) => ({
      pluginId: plugin.id,
      granted: [...plugin.granted],
    })),
    // A `maibuk-` id only parses under the Built-in manifest schema, and the
    // E2E/bench build compiles the Built-in seed seam in.
    builtInPlugins: (scenario.plugins ?? [])
      .filter((plugin) => plugin.builtIn === true)
      .map((plugin) => ({ id: plugin.id })) as never,
  });
  await page.addInitScript({ content: frameProbeScript() });
  const open = async (path: string) => void (await page.goto(path));
  const framePage = playwrightFramePage(page, open);
  return {
    page,
    framePage,
    ctx: { page: framePage, open },
    engineVersion: browser.version(),
    close: () => context.close(),
  };
}

async function androidPage(seed: string): Promise<ScenarioPage> {
  device ??= await connectDevice();
  library ??= await claimTestInstall(device);
  await installSeed(device, library, resolve(SEED_DIR, `${seed}.sqlite`));
  const session = await attachWebView(device);
  const { page, origin } = session;
  await page.context().addInitScript({ content: frameProbeScript() });
  await resetDeviceAndOpen(page, new URL("/", origin).href);
  const open = async (path: string) => void (await page.goto(new URL(path, origin).href));
  const framePage = playwrightFramePage(page, open);
  return {
    page,
    framePage,
    ctx: { page: framePage, open },
    engineVersion: session.version,
    close: () => session.close(),
  };
}

/** The desktop app over WebDriver: no Playwright page, so only the FramePage. */
async function desktopPage(seed: string): Promise<ScenarioPage> {
  const session = await launchDesktop(root, seed);
  const framePage = session.page;
  const open = (path: string) => framePage.goto(path);
  return {
    framePage,
    ctx: { page: framePage, open },
    engineVersion: session.engineVersion,
    close: session.close,
  };
}

function collectorFor(): FrameCollector {
  if (source === "chromium") return chromiumCollector(cpuThrottling);
  if (source === "probe") return probeCollector();
  if (source === "desktop") return probeCollector();
  return androidCollector(device!);
}

for (const scenario of scenariosFor(source, only)) {
  test(scenario.id, async () => {
    const result: FrameBenchScenarioResult & {
      engineVersion?: string;
      userAgent?: string;
      refreshSource?: string;
      viewport?: { width: number; height: number } | null;
      device?: Omit<AndroidDevice, "shell" | "packageName">;
      prerequisite?: boolean;
    } = { id: scenario.id, runs: [] };
    const write = () =>
      writeFileSync(resolve(outDir, `${scenario.id}.json`), JSON.stringify(result));
    let target: ScenarioPage | null = null;
    try {
      if (scenario.seed === "empty" && source === "android") {
        throw new Error("the Android source needs a seed file; give the scenario a named seed");
      }
      target =
        source === "android"
          ? await androidPage(scenario.seed)
          : source === "desktop"
            ? await desktopPage(scenario.seed)
            : await webPage(await webBrowser(), scenario, baseURL!);
      // Set before the driver runs, so a refused scenario still names its engine.
      result.engineVersion = target.engineVersion;
      const driver = FRAME_DRIVERS[scenario.id];
      const collector = collectorFor();
      await driver.prepare(target.ctx);
      try {
        await collector.prepare(target.framePage, target.page);
      } catch (error) {
        // An unknown refresh rate is a setup problem, never a perf result.
        if (error instanceof FrameReportRefused) {
          throw new PrerequisiteMissing(`display refresh rate unknown: ${error.message}`);
        }
        throw error;
      }
      result.userAgent = await target.framePage.evaluate(() => navigator.userAgent);
      result.refreshSource = collector.refreshSource;
      result.viewport = await target.framePage.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      if (device) {
        const { serial, model, abi, androidVersion } = device;
        result.device = { serial, model, abi, androidVersion };
      }
      for (let i = 0; i < (repeat ?? scenario.repetitions); i++) {
        await driver.arrange?.(target.ctx);
        await collector.begin(target.framePage);
        await driver.measure(target.ctx);
        const run = await collector.end(target.framePage);
        if (driver.handlerSamples) run.handlerMs = await driver.handlerSamples(target.ctx);
        result.runs.push(run);
        if (rawDir) {
          mkdirSync(rawDir, { recursive: true });
          writeFileSync(
            resolve(rawDir, `${scenario.id}-${i + 1}.json`),
            JSON.stringify(collector.raw())
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Playwright colors its messages; the report is plain text.
      const plain = message.replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0];
      result.refused = isUnsupportedAction(error)
        ? `unmeasured: WebKitWebDriver cannot perform this scenario's input (${plain}); it is never faked with DOM events`
        : plain;
      result.prerequisite = error instanceof PrerequisiteMissing;
      write();
      throw error;
    } finally {
      await target?.close();
    }
    write();
  });
}
