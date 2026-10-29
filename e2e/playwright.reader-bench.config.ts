import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { shared } from "./shared";

// The Reader performance lane (issue #653): `pnpm bench:reader` only. Separate
// from the E2E suite (testDir ./specs) and the other bench lanes: its tests are
// measurements, so one worker, no retries, and their own testDir. The runner
// names the folder the specs write their JSON into via READER_BENCH_OUT, so the
// config refuses a direct `playwright test`.
if (!process.env.READER_BENCH_OUT) {
  throw new Error(
    "Run the Reader bench with `pnpm bench:reader`, never `playwright test` directly"
  );
}

// Headed by default; `--headless` runs Chromium's new headless mode.
const headless = process.env.READER_BENCH_HEADLESS === "1";

export default defineConfig({
  testDir: "./reader-bench",
  testMatch: "*.bench.ts",
  outputDir: resolve(import.meta.dirname, ".output/reader-bench-results"),
  // The same seeds and source-built fixture Plugins the E2E suite uses; the
  // specs seed Reader through the same `test` fixtures.
  globalSetup: "./support/global-setup.ts",
  // One spec measures a whole batch: 30 s of settle, warm-ups, and every turn.
  timeout: 900_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_BASE_URL,
    ...shared,
    headless,
  },
  projects: [{ name: "chromium" }],
});
