#!/usr/bin/env node
// `pnpm test:e2e [playwright args]`: build the web target, then run
// Playwright. Extra args pass straight to `playwright test`
// (e.g. `pnpm test:e2e --project=chromium --grep @wf:books-create`).
// E2E_REUSE_BUILD=1 skips the build when iterating on specs only.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const started = Date.now();

function step(label, command, commandArgs, env = {}) {
  console.log(`\n[e2e] ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    console.error(`[e2e] ${label} failed (exit ${result.status ?? result.signal})`);
    process.exit(result.status ?? 1);
  }
}

step("typecheck e2e/", "pnpm", ["exec", "tsc", "--noEmit", "-p", "e2e"]);

if (process.env.E2E_REUSE_BUILD !== "1") {
  step(
    "build web target -> e2e/.output/web-dist",
    "pnpm",
    [
      "exec",
      "vite",
      "build",
      "--outDir",
      "e2e/.output/web-dist",
      "--emptyOutDir",
      "--logLevel",
      "warn",
    ],
    { VITE_BUILD_TARGET: "web" }
  );
}

step("playwright", "pnpm", [
  "exec",
  "playwright",
  "test",
  "--config",
  "e2e/playwright.config.ts",
  ...args,
]);

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\n[e2e] wall clock: ${Math.floor(seconds / 60)}m ${seconds % 60}s`);
