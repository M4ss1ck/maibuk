#!/usr/bin/env node
// The guard lane: every test whose input is files in the repo rather than the
// modules it imports (the fixed-wait and time-budget guards, the E2E coverage
// guard, the Tutorial gates, command coverage...). Vitest only relates a test
// to a change through imports, so a run narrowed to the touched files skips
// these, and they then fail in CI on a change they read but never import.
// Run it beside any narrowed run; it takes seconds.
//
//   pnpm test:guards [--list] [vitest args...]
//
// --list  prints the selected test files and exits

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The same roots the fixed-wait guard scans: every place a test file lives. */
const TEST_ROOTS = ["src/test", "plugins", "templates"];

/** An import of the file system, an E2E guard, or a repo script. */
const REPO_READ_IMPORT =
  /\bfrom\s+["'](?:node:)?fs(?:\/promises)?["']|\bfrom\s+["'][./]*(?:e2e\/guards|scripts)\//;

/** Whether a test file's source reads the repo from disk. */
export function readsRepoFiles(source) {
  return REPO_READ_IMPORT.test(source);
}

function testFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The guard lane's test files, relative to `root`, sorted. */
export function guardTests(root) {
  return TEST_ROOTS.flatMap((dir) => testFiles(join(root, dir)))
    .filter((path) => readsRepoFiles(readFileSync(path, "utf8")))
    .map((path) => relative(root, path).split("\\").join("/"))
    .sort();
}

function main() {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  const args = process.argv.slice(2);
  const files = guardTests(root);
  if (args.includes("--list")) {
    for (const file of files) console.log(file);
    return;
  }
  console.log(`[guards] ${files.length} test files read the repo from disk`);
  const child = spawn("pnpm", ["exec", "vitest", "run", ...files, ...args], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("close", (code) => process.exit(code ?? 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
