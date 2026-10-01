#!/usr/bin/env node
// `pnpm test:e2e [--allow-planned] [--no-preflight] [playwright args]`: coverage
// guard, guard self-tests, typecheck, web build, then the web build on a free
// port and Playwright against it (e2e/playwright.config.ts), stopped however
// the run ends. Other args pass straight to `playwright test` (e.g.
// `pnpm test:e2e --project=chromium --grep @wf:books-create`).
// `--allow-planned` lets the guard accept planned matrix rows while a slice is
// being built; the finished suite never needs it. `--no-preflight` skips the
// guard, its self-tests and the typecheck; used by scripts/pr-screenshots.sh's
// "before" run. E2E_REUSE_BUILD=1 skips the build when iterating on specs only.

import { rmSync } from "node:fs";
import {
  PREVIEW_RUNS_DIR,
  createRunDir,
  killRecordedPreview,
  ownTeardown,
  runPlaywright,
  startPreview,
  sweepStalePreviews,
} from "./preview-server.mjs";
import { buildWeb, preflight, root, wallClock } from "./run-steps.mjs";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const allowPlanned = argv.includes("--allow-planned");
const noPreflight = argv.includes("--no-preflight");
const args = argv.filter((a) => a !== "--allow-planned" && a !== "--no-preflight");
const started = Date.now();

if (!noPreflight) preflight({ allowPlanned });
buildWeb();

const swept = sweepStalePreviews(root);
if (swept > 0) console.log(`[e2e] removed ${swept} web server run(s) a killed run left behind`);

const runDir = createRunDir(root, PREVIEW_RUNS_DIR);
let preview = null;
const stopSync = () => {
  preview?.stopSync();
  killRecordedPreview(runDir);
  rmSync(runDir, { recursive: true, force: true });
};
const teardown = ownTeardown(stopSync);
try {
  preview = await startPreview(root, runDir);
} catch (error) {
  console.error(`[e2e] ${error.message}`);
  stopSync();
  process.exit(1);
}
console.log(`[e2e] web build served at ${preview.url}`);

const code = await runPlaywright({
  root,
  label: "playwright",
  config: "e2e/playwright.config.ts",
  args,
  env: { E2E_BASE_URL: preview.url },
  teardown,
});

await preview.stop();
rmSync(runDir, { recursive: true, force: true });
console.log("[e2e] web server stopped");
if (code !== 0) console.error(`[e2e] playwright failed (exit ${code})`);
wallClock(started);
process.exit(code);
