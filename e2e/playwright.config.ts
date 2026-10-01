import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { shared } from "./shared";

export { shared } from "./shared";

const OUTPUT = resolve(import.meta.dirname, ".output");
// Personal headed watch loop (scripts/e2e-headed.sh). Unset keeps Playwright's
// default speed for every existing command.
const slowMo = Number(process.env.E2E_SLOW_MO ?? 0);
if (Number.isNaN(slowMo)) {
  throw new Error(`E2E_SLOW_MO must be milliseconds, got "${process.env.E2E_SLOW_MO}"`);
}

// The runner owns the web server, not Playwright's webServer: an interrupted
// Playwright leaves that one holding its port.
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error(
    "No web server: run the main E2E lane with `pnpm test:e2e`, never `playwright test` directly"
  );
}

export default defineConfig<{ macPlatform: boolean }>({
  testDir: "./specs",
  // The Sync lane's specs need a sync server; run-sync.mjs runs them with
  // playwright.sync.config.ts.
  testIgnore: "sync/**",
  outputDir: resolve(OUTPUT, "test-results"),
  globalSetup: "./support/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  fullyParallel: true,
  forbidOnly: true,
  workers: Math.max(1, Math.floor(availableParallelism() / 2)),
  reporter: [["list"], ["html", { outputFolder: resolve(OUTPUT, "report"), open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-first-failure",
    screenshot: "only-on-failure",
    ...(slowMo > 0 ? { launchOptions: { slowMo } } : {}),
    ...shared,
  },
  projects: [
    {
      name: "chromium",
      // The fake microphone is a Chromium flag; the WebKit-only edge runs in
      // its own project (tagged @webkit-only) and never here.
      grepInvert: /@webkit-only|@touch/,
      use: {
        ...devices["Desktop Chrome"],
        ...shared,
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${resolve(
              import.meta.dirname,
              "../vendor/moonshine/audio/two_cities_short.wav"
            )}`,
          ],
        },
      },
    },
    {
      name: "webkit",
      // WebKit cannot grant clipboard permissions; clipboard rows are chromium-only.
      grepInvert: /@chromium-only|@touch/,
      use: { ...devices["Desktop Safari"], ...shared },
    },
    {
      // Chromium reporting a Mac navigator.platform, so isMac() and TipTap's
      // Mod resolve to ⌘. Proves the platform-dependent labels and bindings,
      // not real macOS: only specs tagged @mac-platform run here.
      name: "mac-platform",
      grep: /@mac-platform/,
      use: { ...devices["Desktop Chrome"], ...shared, macPlatform: true },
    },
    {
      // A phone: Chromium with a Pixel 7 viewport, touch, and isMobile, so
      // `(pointer: coarse)` matches and `hover:` never applies. Only specs
      // tagged @touch run here, and only they may use touch input.
      name: "phone",
      grep: /@touch/,
      use: { ...devices["Pixel 7"], locale: shared.locale, timezoneId: shared.timezoneId },
    },
  ],
});
