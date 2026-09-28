// The web driver for the dictation conformance lane.
//   node scripts/dictation-conformance/web.mjs [modelId ...]
//
// It builds the harness with Vite's JS API, serves the preview with the COOP/
// COEP headers the config sets, then for each model launches a fresh Chromium:
// the page installs the model through the production web host, plays a WAV
// through Chromium's fake audio device while the driver types into #typing, and
// writes vendor/moonshine/conformance/web-<id>.json. One browser per model.
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build, preview } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const configFile = join(here, "vite.config.ts");
const catalogPath = join(repoRoot, "src/features/dictation/catalog.json");
const modelsDir = join(repoRoot, "vendor/moonshine/models");
const audioDir = join(repoRoot, "vendor/moonshine/audio");
const outDir = join(repoRoot, "vendor/moonshine/conformance");

const PROSE =
  "The rain had not stopped since Tuesday, and Marta counted the drips from the ceiling. ";
const TYPE_FOR_MS = 30_000;
const TYPE_EVERY_MS = 111; // ~9 characters a second

function wavFor(spec) {
  return join(
    audioDir,
    spec.languages[0] === "es" ? "quijote_es_16k.wav" : "two_cities_16k.wav"
  );
}

// Duration from the RIFF header: data size / byte rate.
function wavSeconds(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    throw new Error(`${path}: not a WAV`);
  let offset = 12;
  let byteRate = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") byteRate = buf.readUInt32LE(body + 8);
    if (id === "data") {
      if (!byteRate) throw new Error(`${path}: data chunk before fmt`);
      return size / byteRate;
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

async function typeFor(page, ms) {
  await page.focus("#typing");
  const end = Date.now() + ms;
  let i = 0;
  while (Date.now() < end) {
    await page.keyboard.type(PROSE[i++ % PROSE.length], { delay: 0 });
    await page.waitForTimeout(TYPE_EVERY_MS);
  }
}

async function main() {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const args = process.argv.slice(2);
  const ids = args.length ? args : catalog.map((m) => m.id);

  const missing = [];
  for (const id of ids) {
    const spec = catalog.find((m) => m.id === id);
    if (!spec) {
      console.error(`unknown model: ${id}`);
      process.exit(1);
    }
    if (!existsSync(join(modelsDir, id))) missing.push(`vendor/moonshine/models/${id}`);
    const wav = wavFor(spec);
    if (!existsSync(wav)) missing.push(`vendor/moonshine/audio/${wav.split("/").pop()}`);
  }
  if (missing.length) {
    console.error(`missing: ${missing.join(", ")}`);
    console.error("run pnpm fetch:dictation --test-assets");
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  await build({ configFile });
  // The harness installs models from here, same-origin (see harness.ts).
  symlinkSync(modelsDir, join(outDir, "harness-dist/models"), "dir");
  const server = await preview({ configFile });
  // The build input is harness.html, so the preview serves it at /harness.html.
  const pageUrl =
    process.env.CONFORMANCE_URL ??
    new URL("harness.html", server.resolvedUrls.local[0]).href;
  console.log(`harness at ${pageUrl}`);

  try {
    for (const id of ids) {
      const spec = catalog.find((m) => m.id === id);
      const wav = wavFor(spec);
      const seconds = wavSeconds(wav);
      const browser = await chromium.launch({
        args: [
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          `--use-file-for-fake-audio-capture=${wav}%noloop`,
          "--autoplay-policy=no-user-gesture-required",
        ],
      });
      try {
        const page = await browser.newPage();
        page.on("console", (m) => {
          if (m.type() === "error") console.error(`  [console] ${m.text()}`);
        });
        page.on("pageerror", (e) => console.error(`  [pageerror] ${e.message}`));
        await page.goto(pageUrl);
        const runPromise = page.evaluate(
          (input) => window.__conformance.run(input.id, input.seconds),
          { id, seconds }
        );
        await typeFor(page, TYPE_FOR_MS);
        await runPromise;
        const result = await page.evaluate(() => window.__conformance.result);
        writeFileSync(
          join(outDir, `web-${id}.json`),
          `${JSON.stringify(result, null, 2)}\n`
        );
        const s = result.summary;
        console.log(
          `${id}: load ${s.loadMs} ms, finals ${result.trace.length}, ` +
            `longTasks>50 ${s.longTasksOver50}, typing max ${s.typingEventMaxMs} ms, ` +
            `violations ${s.contractViolations.length}`
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
