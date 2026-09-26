import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 4317);
const OUTPUT = resolve(import.meta.dirname, ".output");

const shared = {
  locale: "en-US",
  timezoneId: "UTC",
  viewport: { width: 1280, height: 800 },
};

export default defineConfig<{ macPlatform: boolean }>({
  testDir: "./specs",
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
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "retain-on-first-failure",
    screenshot: "only-on-failure",
    ...shared,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...shared } },
    {
      name: "webkit",
      // WebKit cannot grant clipboard permissions; clipboard rows are chromium-only.
      grepInvert: /@chromium-only/,
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
  ],
  webServer: {
    // run.mjs builds the web target into .output/web-dist first.
    command: `pnpm exec vite preview --outDir e2e/.output/web-dist --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    cwd: resolve(import.meta.dirname, ".."),
    env: { VITE_BUILD_TARGET: "web" },
    url: `http://127.0.0.1:${E2E_PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
