import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// The frame-rate lane (issue #372): `pnpm bench:frames` only. Separate from
// the E2E suite and its keyboard-only guard: these are measurements, so one
// worker, no retries, and each test launches the engine its source needs
// (e2e/frames/scenarios.frames.ts).
if (!process.env.FRAMES_OUT) {
  throw new Error(
    "Run the frame-rate lane with `pnpm bench:frames`, never `playwright test` directly"
  );
}

export default defineConfig({
  testDir: "./frames",
  testMatch: "*.frames.ts",
  outputDir: resolve(import.meta.dirname, ".output/frames-results"),
  globalSetup: "./frames/global-setup.ts",
  // One test is one scenario: seed, warm-up, and every repetition, which on a
  // slow phone or with --repeat runs for minutes.
  timeout: 300_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"]],
});
