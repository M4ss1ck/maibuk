// PROTOTYPE. Drives the built spike page in Chromium: for each model, plays a
// WAV through the real AudioWorklet -> Worker path in real time while typing
// into the page, then writes the page's summary to results/.
//   node spike/dictation/measure.mjs [model ...]
// Needs `vite preview --config spike/dictation/vite.config.ts` on :5198.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "results");
mkdirSync(out, { recursive: true });
const BASE = process.env.SPIKE_URL ?? "http://localhost:5198/";
const RUNS = {
  "tiny-streaming-es": "audio/quijote_es_16k.wav",
  "small-streaming-es": "audio/quijote_es_16k.wav",
  "tiny-streaming-en": "audio/two_cities_16k.wav",
  "small-streaming-en": "audio/two_cities_16k.wav",
};
const INTERVAL = process.env.SPIKE_INTERVAL ?? "0.5";
const QUERY = process.env.SPIKE_QUERY ?? ""; // extra page params, e.g. "opt.vad_window_duration=0.25"
const TAG = process.env.SPIKE_TAG ?? "";
// Sum of RSS over every process of the Playwright Chromium (browser, GPU,
// renderers, and so the worker threads). The page memory API is not exposed
// in headless mode.
function chromiumRssMB() {
  const ps = execFileSync("ps", ["-eo", "rss=,args="], { encoding: "utf8" });
  let kb = 0;
  for (const line of ps.split("\n")) if (line.includes("ms-playwright/chromium")) kb += Number(line.trim().split(/\s+/)[0]);
  return Math.round(kb / 1024);
}
const models = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RUNS);
const PROSE = "The rain had not stopped since Tuesday, and Marta counted the drips from the ceiling. ";

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--enable-blink-features=ForceEagerMeasureMemory"],
});

async function typeFor(page, ms) {
  await page.locator("#typing").focus();
  const end = Date.now() + ms;
  let i = 0;
  while (Date.now() < end) {
    await page.keyboard.type(PROSE[i++ % PROSE.length], { delay: 0 });
    await page.waitForTimeout(110); // ~9 characters a second, a fast typist
  }
}

// Baseline: typing with no dictation running.
{
  const page = await browser.newPage();
  await page.goto(BASE);
  await page.evaluate(() => window.__spike.reset());
  await page.evaluate(() => { window.__base = performance.now(); });
  await typeFor(page, 20000);
  const summary = await page.evaluate(() => window.__spike.summary());
  writeFileSync(join(out, "web-baseline-typing.json"), JSON.stringify(summary, null, 2));
  console.log("baseline typing", JSON.stringify(summary.typing), "longTasks", JSON.stringify(summary.longTasks));
  await page.close();
}

for (const model of models) {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log(`  [console] ${m.text()}`); });
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
  await page.goto(`${BASE}?interval=${INTERVAL}&${QUERY}`);
  const rssBefore = chromiumRssMB();
  let rssPeak = rssBefore;
  const rssTimer = setInterval(() => { rssPeak = Math.max(rssPeak, chromiumRssMB()); }, 1000);
  const t0 = Date.now();
  await page.evaluate((m) => window.__spike.load(m), model);
  console.log(`${model}: loaded in ${Date.now() - t0} ms (wall, incl. fetch)`);
  await page.evaluate((src) => window.__spike.start(src), RUNS[model]);
  // Type for the first 30 s of dictation, then just wait for the file to end.
  await typeFor(page, 30000);
  await page.waitForFunction(() => window.__spike.state === "ended", null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__spike.stop());
  clearInterval(rssTimer);
  const result = await page.evaluate(() => ({
    summary: window.__spike.summary(),
    lines: window.__spike.lines.map((l) => l.text),
    trace: window.__spike.trace(),
    errors: window.__spike.errors,
  }));
  result.summary.chromiumRssMB = { beforeLoad: rssBefore, peak: rssPeak, delta: rssPeak - rssBefore };
  result.summary.interval = INTERVAL;
  result.summary.query = QUERY;
  writeFileSync(join(out, `web-${model}-i${INTERVAL}${TAG}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.summary));
  console.log(`  first lines: ${result.lines.slice(0, 3).join(" | ")}`);
  if (result.errors.length) console.log("  errors:", result.errors);
  await page.close();
}
await browser.close();
