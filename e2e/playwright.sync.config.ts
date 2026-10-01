// The Sync lane (issue #222): specs in specs/sync/ against a real PocketBase
// that run-sync.mjs starts for the run (E2E_SYNC_URL), and the web build it
// serves on a free port (E2E_SYNC_BASE_URL). Run it with `pnpm test:e2e:sync`,
// never `playwright test` directly: without the runner there are no servers.
// The runner owns the web server, not Playwright's webServer: an interrupted
// Playwright leaves that one holding its port. Same keyboard contract, guard,
// and seeds as the main suite.

import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { shared } from "./playwright.config";

const OUTPUT = resolve(import.meta.dirname, ".output/sync");

export default defineConfig({
  testDir: "./specs/sync",
  outputDir: resolve(OUTPUT, "test-results"),
  globalSetup: "./support/global-setup.ts",
  // Up to three devices, each signing in, syncing and reloading over real
  // round trips: the longest WebKit tests take about 40 s on an idle host and
  // passed 60 s on a loaded one (load average 32 on 16 cores).
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  fullyParallel: true,
  forbidOnly: true,
  // Each test runs two or three browser contexts plus a share of PocketBase,
  // so the main suite's half-the-cores would exhaust memory on a busy host.
  workers: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4))),
  reporter: [["list"], ["html", { outputFolder: resolve(OUTPUT, "report"), open: "never" }]],
  use: {
    baseURL: process.env.E2E_SYNC_BASE_URL,
    trace: "retain-on-first-failure",
    screenshot: "only-on-failure",
    ...shared,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...shared } },
    { name: "webkit", use: { ...devices["Desktop Safari"], ...shared } },
  ],
});
