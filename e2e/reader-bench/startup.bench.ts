// Idle cost (issue #653, gate 1): the start-up time and JS heap of the app with
// Reader disabled, then with Reader enabled and never opened. Two describe
// blocks, one approval each; the runner compares their medians. Method, as
// `bench:plugin-start` and the Plugins bench do: two warm-up starts are thrown
// away, then samples are taken from a page load to the nav the app shows when
// it is ready (Books, and Reader too when enabled, so the launch scan is
// included), and the heap is read after a forced GC on that same page.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/test";
import { benchOut, heapAfterGc, navOption } from "./support";

const WARM_UPS = 2;
const SAMPLES = Number(process.env.READER_BENCH_SAMPLES ?? 10);

/**
 * One start: navigate, wait for the app's Books nav, then (when enabled) for
 * Reader's nav, which appears only after its launch scan. Returns both times,
 * so the report can tell the scan's cost from the app's own first paint.
 */
async function startOnce(
  page: Page,
  readerEnabled: boolean
): Promise<{ readyMs: number; booksMs: number }> {
  const started = performance.now();
  await page.goto("/");
  await expect(navOption(page, "Books")).toBeVisible({ timeout: 60_000 });
  const booksMs = performance.now() - started;
  if (readerEnabled) await expect(navOption(page, "Reader")).toBeVisible({ timeout: 60_000 });
  return { readyMs: performance.now() - started, booksMs };
}

async function measure(page: Page, readerEnabled: boolean, name: string): Promise<void> {
  const startupMs: number[] = [];
  const booksMs: number[] = [];
  const heapBytes: number[] = [];
  for (let run = 0; run < WARM_UPS + SAMPLES; run++) {
    const timing = await startOnce(page, readerEnabled);
    const heap = await heapAfterGc(page);
    if (run < WARM_UPS) continue;
    startupMs.push(timing.readyMs);
    booksMs.push(timing.booksMs);
    heapBytes.push(heap);
  }
  writeFileSync(
    resolve(benchOut(), `idle-${name}.json`),
    `${JSON.stringify({ readerEnabled, warmUps: WARM_UPS, startupMs, booksMs, heapBytes }, null, 1)}\n`
  );
}

test.describe("idle, Reader disabled", () => {
  test.use({
    plugins: ["maibuk-reader"],
    builtInPlugins: [{ id: "maibuk-reader" }],
    pluginApprovals: [{ pluginId: "maibuk-reader", enabled: false }],
  });

  test("start-up and heap, Reader disabled", async ({ page }) => {
    await measure(page, false, "disabled");
  });
});

test.describe("idle, Reader enabled and never opened", () => {
  test.use({
    plugins: ["maibuk-reader"],
    builtInPlugins: [{ id: "maibuk-reader" }],
    pluginApprovals: [{ pluginId: "maibuk-reader", granted: ["files:pick"] }],
  });

  test("start-up and heap, Reader enabled and never opened", async ({ page }) => {
    await measure(page, true, "enabled");
  });
});
