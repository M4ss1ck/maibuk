#!/usr/bin/env node
// `pnpm test:e2e [--allow-planned] [playwright args]`: coverage guard, guard
// self-tests, typecheck, web build, then Playwright. Other args pass straight
// to `playwright test` (e.g. `pnpm test:e2e --project=chromium --grep
// @wf:books-create`). `--allow-planned` lets the guard accept planned matrix
// rows while a slice is being built; the finished suite never needs it.
// E2E_REUSE_BUILD=1 skips the build when iterating on specs only.

import { buildWeb, preflight, step, wallClock } from "./run-steps.mjs";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const allowPlanned = argv.includes("--allow-planned");
const args = argv.filter((a) => a !== "--allow-planned");
const started = Date.now();

preflight({ allowPlanned });
buildWeb();

step("playwright", "pnpm", [
  "exec",
  "playwright",
  "test",
  "--config",
  "e2e/playwright.config.ts",
  ...args,
]);

wallClock(started);
