#!/usr/bin/env node
// The stress lane: runs Vitest while every core is busy, the way a shared CI
// runner is. A test that waits for a fixed number of event-loop turns, or that
// asserts before a render it triggered has committed, passes on an idle laptop
// and fails here, so a race shows up before CI finds it at random.
//
//   pnpm test:stress [--rounds N] [--hogs N] [vitest args...]
//
// --rounds  how many times to run the selection (default 3)
// --hogs    busy-loop processes kept running beside Vitest (default: one per core)
//
// Exits non-zero when any round failed, and lists each failing test once.

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Splits the lane's own flags from the arguments it hands to Vitest. */
export function parseStressArgs(argv, cores = availableParallelism()) {
  const options = { rounds: 3, hogs: cores, vitestArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--rounds" || arg === "--hogs") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < (arg === "--rounds" ? 1 : 0)) {
        throw new Error(`${arg} needs a whole number, got "${argv[index + 1] ?? ""}"`);
      }
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg !== "--") {
      options.vitestArgs.push(arg);
    }
  }
  return options;
}

/** The failing test lines of one Vitest run's output, colors stripped. */
export function failedTests(output) {
  const lines = new Set();
  for (const raw of output.split("\n")) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI color codes
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (line.startsWith("FAIL ") && line.includes(" > ")) lines.add(line.slice(5).trim());
  }
  return [...lines];
}

function startHogs(count) {
  return Array.from({ length: count }, () =>
    spawn(process.execPath, ["-e", "for (;;) {}"], { stdio: "ignore" })
  );
}

function runVitest(args) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "vitest", "run", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
    }
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function main() {
  const { rounds, hogs, vitestArgs } = parseStressArgs(process.argv.slice(2));
  const running = startHogs(hogs);
  const stop = () => {
    for (const hog of running) hog.kill();
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });

  const failures = new Map();
  let failedRounds = 0;
  try {
    for (let round = 1; round <= rounds; round += 1) {
      console.log(`\n[stress] round ${round}/${rounds} with ${hogs} busy cores`);
      const { code, output } = await runVitest(vitestArgs);
      if (code !== 0) failedRounds += 1;
      for (const test of failedTests(output)) {
        failures.set(test, (failures.get(test) ?? 0) + 1);
      }
    }
  } finally {
    stop();
  }

  console.log(`\n[stress] ${rounds - failedRounds}/${rounds} rounds passed`);
  for (const [test, count] of failures) console.log(`[stress] failed ${count}/${rounds}: ${test}`);
  process.exit(failedRounds === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
