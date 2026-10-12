#!/usr/bin/env node
// Checks the Plugin editor highlight bench against its budget (#441, the #401
// long-Chapter number). Reads the JSON `vitest bench --outputJson` wrote and
// exits non-zero when a benchmark misses its p99 budget or a budgeted
// benchmark did not run.
//
//   node scripts/editor-highlights-bench-budget.mjs <bench.json>
//
// Vitest bench reports no p95 field, so the check uses p99 instead. Two
// budgets: the keystroke's 16 ms frame interval and the highlight update's
// 10 ms #401 Echoes main-thread budget.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** p99 budgets in milliseconds, by benchmark name prefix (issue #441). */
export const BUDGETS_MS = {
  "keystroke with highlights:": 16,
  // Host share of the update; jsdom overstates the getContent DOMPurify pass ~15x, so the end-to-end update is measured in bench:frames (#403).
  "highlight update:": 10,
};

export function checkBudgets(report) {
  const rows = [];
  for (const file of report.files ?? []) {
    for (const group of file.groups ?? []) {
      for (const benchmark of group.benchmarks ?? []) {
        const prefix = Object.keys(BUDGETS_MS).find((key) => benchmark.name.startsWith(key));
        if (!prefix) continue;
        const budget = BUDGETS_MS[prefix];
        rows.push({
          name: `${group.fullName.split(" > ").at(-1)} > ${benchmark.name}`,
          prefix,
          p99: benchmark.p99,
          mean: benchmark.mean,
          samples: benchmark.sampleCount,
          budget,
          ok: typeof benchmark.p99 === "number" && benchmark.p99 < budget,
        });
      }
    }
  }
  const missing = Object.keys(BUDGETS_MS).filter((key) => !rows.some((row) => row.prefix === key));
  return { rows, missing, ok: missing.length === 0 && rows.every((row) => row.ok) };
}

/** Prints the budget table; returns whether every budget held. */
export function printBudgetReport(report, heading = "") {
  const { rows, missing, ok } = checkBudgets(report);
  console.log(`\nPlugin editor highlight budget (issue #441)${heading}, times in ms`);
  console.log("| benchmark | mean | p99 | budget (p99) | samples | result |");
  console.log("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const row of rows) {
    console.log(
      `| ${row.name} | ${row.mean.toFixed(4)} | ${row.p99.toFixed(4)} | < ${row.budget} | ${row.samples} | ${row.ok ? "pass" : "FAIL"} |`
    );
  }
  for (const prefix of missing) console.error(`missing benchmark: ${prefix}*`);
  return ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/editor-highlights-bench-budget.mjs <bench.json>");
    process.exit(2);
  }
  process.exit(printBudgetReport(JSON.parse(readFileSync(path, "utf8"))) ? 0 : 1);
}
