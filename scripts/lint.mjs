#!/usr/bin/env node
// `pnpm lint`: Biome's lint, format, and assist checks over the repo, failing
// on any error, warning, or info (issue #670). `biome check
// --error-on-warnings` exits 0 on infos, so this reads the JSON summary, and
// on a finding reruns with the default reporter to print it readably.
//
//   pnpm lint [biome check args...]     pnpm lint:fix applies the safe fixes

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Errors + warnings + infos in a `--reporter=json` run; Infinity if unreadable. */
export function lintFindings(stdout) {
  try {
    const { summary } = JSON.parse(stdout);
    if (!summary) return Number.POSITIVE_INFINITY;
    return summary.errors + summary.warnings + summary.infos;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function biome(args, options) {
  return spawnSync("pnpm", ["exec", "biome", "check", ...args], {
    cwd: resolve(fileURLToPath(import.meta.url), "../.."),
    shell: process.platform === "win32",
    ...options,
  });
}

function main() {
  const args = process.argv.slice(2);
  const json = biome(["--reporter=json", "--max-diagnostics=none", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const findings = lintFindings(json.stdout);
  if (findings === 0 && json.status === 0) {
    console.log("[lint] Biome: 0 errors, 0 warnings, 0 infos");
    return;
  }
  biome(["--max-diagnostics=none", ...args], { stdio: "inherit" });
  console.error(
    `\n[lint] ${Number.isFinite(findings) ? findings : "unreadable"} Biome finding(s); lint and format stay at zero (CODING_STANDARDS.md).`
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
