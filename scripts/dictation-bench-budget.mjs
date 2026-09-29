#!/usr/bin/env node
// Checks the Dictation Command Interpreter bench against the ADR 0015 budget.
// Reads the JSON `vitest bench --outputJson` wrote and exits non-zero when a
// benchmark misses its p99 budget or a budgeted benchmark did not run.
//
//   node scripts/dictation-bench-budget.mjs <bench.json>
import { readFileSync } from "node:fs";

/** p99 budgets in milliseconds, by benchmark name prefix (ADR 0015). */
export const BUDGETS_MS = {
  "interpret:": 1,
  "rebuild:": 10,
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
  console.log(`\nDictation Interpreter budget (ADR 0015)${heading}, times in ms`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/dictation-bench-budget.mjs <bench.json>");
    process.exit(2);
  }
  process.exit(printBudgetReport(JSON.parse(readFileSync(path, "utf8"))) ? 0 : 1);
}
