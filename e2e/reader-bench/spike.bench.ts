// Threading spike (issue #653, "Threading (no-jank rule)"): parse the bench's
// 50 MB PDF with pdf.js core either inline in the Plugin Worker (mode `inline`)
// or in the Plugin Worker's nested Worker, which is what ships (mode `nested`),
// and measure how long the Plugin Worker's message loop stalls during the parse.
// A host health.check reply is answered by that loop, so its stall is the
// reply delay the Stopped Plugin limit ("no answer") would see.
//
// Method: the first `blob:` Worker the page creates is the Plugin Worker (the
// sandbox boots it from a Blob, and the nested core is created later, at open).
// A 5 ms timer in that Worker records how late each tick runs while the parse
// is open. Mode `inline` sets `globalThis.__maibukDebugPdfCoreInline` in the
// Plugin Worker; nothing else in the app ever sets it. The runner sets
// READER_BENCH_SPIKE_MODE and writes spike-<mode>.json.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Worker as PlaywrightWorker } from "@playwright/test";
import { installFilePicker } from "../support/file-picker";
import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";
import { benchOut, focusDocument, openReader, pageIndicator } from "./support";

const PDF = "large-document.pdf";
const PDF_PAGES = 96;
const MODE = process.env.READER_BENCH_SPIKE_MODE;

/** Installed in the Plugin Worker: a 5 ms tick that records its lateness while armed. */
const INSTALL_PROBE = () => {
  const state = { armed: false, lags: [] as number[], last: performance.now() };
  (globalThis as unknown as { __readerSpike: typeof state }).__readerSpike = state;
  setInterval(() => {
    const now = performance.now();
    if (state.armed) state.lags.push(now - state.last - 5);
    state.last = now;
  }, 5);
};

test.describe("threading spike", () => {
  test.skip(MODE === undefined, "run through `pnpm bench:reader --spike`");
  test.use({
    plugins: ["maibuk-reader"],
    pluginApprovals: [{ pluginId: "maibuk-reader", granted: ["files:pick"] }],
    builtInPlugins: [{ id: "maibuk-reader" }],
  });

  test("parse the 50 MB PDF and sample the Plugin Worker's stall", async ({ page }) => {
    const pdfPath = process.env.READER_BENCH_PDF;
    if (!pdfPath) throw new Error("READER_BENCH_PDF is required");
    await installFilePicker(page, [
      { name: PDF, path: pdfPath, type: "application/pdf", served: true },
    ]);

    const blobWorkers: string[] = [];
    let pluginWorker: PlaywrightWorker | null = null;
    page.on("worker", (worker) => {
      if (!worker.url().startsWith("blob:")) return;
      blobWorkers.push(worker.url());
      if (pluginWorker === null) pluginWorker = worker;
    });

    await page.goto("/");
    await openReader(page);
    const plugin = pluginWorker as PlaywrightWorker | null;
    if (plugin === null) throw new Error("no Plugin Worker was seen on the Shelf");
    await plugin.evaluate(INSTALL_PROBE);
    if (MODE === "inline") {
      await plugin.evaluate(() => {
        (globalThis as Record<string, unknown>).__maibukDebugPdfCoreInline = true;
      });
    }

    await tabTo(page, page.getByRole("button", { name: "Open file…", exact: true }), { max: 60 });
    await plugin.evaluate(() => {
      (
        globalThis as unknown as { __readerSpike: { armed: boolean; lags: number[] } }
      ).__readerSpike.lags = [];
      (globalThis as unknown as { __readerSpike: { armed: boolean } }).__readerSpike.armed = true;
    });
    const started = await page.evaluate(() => performance.now());
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plugin\/maibuk-reader\/document$/);
    await focusDocument(page);
    await expect(pageIndicator(page)).toContainText(`1 of ${PDF_PAGES}`, { timeout: 120_000 });
    const firstPageMs = (await page.evaluate(() => performance.now())) - started;
    const lags = await plugin.evaluate(() => {
      const state = (globalThis as unknown as { __readerSpike: { armed: boolean; lags: number[] } })
        .__readerSpike;
      state.armed = false;
      return state.lags;
    });

    writeFileSync(
      resolve(benchOut(), `spike-${MODE}.json`),
      `${JSON.stringify(
        { mode: MODE, firstPageMs, lagMs: lags, blobWorkers, inlineFlagSet: MODE === "inline" },
        null,
        1
      )}\n`
    );
  });
});
