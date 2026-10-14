import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The Plugins bench (issue #448): `pnpm bench:plugins` only. Separate from the
// E2E suite (whose testDir is ./specs) and the frame-rate lane (./frames): its
// tests are measurements, so one worker, no retries, and its own testDir. The
// runner names the temp dir the specs write their samples into via
// PLUGINS_BENCH_OUT, so the config refuses a direct `playwright test`.
if (!process.env.PLUGINS_BENCH_OUT) {
  throw new Error(
    "Run the Plugins bench with `pnpm bench:plugins`, never `playwright test` directly"
  );
}

// Headed by default; `--headless` runs Chromium's new headless mode, which is
// what Playwright's `headless: true` selects on this version.
const headless = process.env.PLUGINS_BENCH_HEADLESS === "1";

export default defineConfig({
  testDir: "./plugins-bench",
  testMatch: "*.bench.ts",
  outputDir: resolve(import.meta.dirname, ".output/plugins-bench-results"),
  // The same seed Libraries and source-built fixture Plugins the E2E suite
  // writes; the bench specs clone the fixture Plugins and need OPFS seeding.
  globalSetup: "./support/global-setup.ts",
  // One test measures a whole batch: seeding, warm-ups, and every sample.
  timeout: 300_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_BASE_URL,
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 800 },
    headless,
  },
  projects: [{ name: "chromium" }],
});
