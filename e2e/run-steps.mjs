// Steps both E2E runners share: run.mjs (`pnpm test:e2e`) and run-sync.mjs
// (`pnpm test:e2e:sync`). Each step runs to completion or ends the process
// with its exit code.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function step(label, command, commandArgs, env = {}) {
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

/** Coverage guard, its self-tests, and the e2e typecheck. */
export function preflight({ allowPlanned }) {
  step("coverage guard", "pnpm", [
    "exec",
    "tsx",
    "e2e/guards/run.ts",
    ...(allowPlanned ? ["--allow-planned"] : []),
  ]);
  step("guard self-tests", "pnpm", ["exec", "tsx", "--test", "e2e/guards/coverage.test.ts"]);
  step("typecheck e2e/", "pnpm", ["exec", "tsc", "--noEmit", "-p", "e2e"]);
}

/**
 * The web build both Playwright configs preview; E2E_REUSE_BUILD=1 skips it.
 * The build imports the vendored Moonshine WASM, so a clean checkout fetches
 * it first (cached by digest, a no-op afterwards).
 */
export function buildWeb() {
  if (process.env.E2E_REUSE_BUILD === "1") return;
  step("dictation WASM runtime (build input)", "node", [
    "scripts/fetch-dictation-runtime.mjs",
    "--web",
  ]);
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

export function wallClock(started) {
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`\n[e2e] wall clock: ${Math.floor(seconds / 60)}m ${seconds % 60}s`);
}
