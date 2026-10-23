#!/usr/bin/env node
// Checks the Library Search bench against the issue #639 budgets. Reads the
// JSON `vitest bench --outputJson` wrote and exits non-zero when a benchmark
// misses its budget for its engine, or when an engine's benchmark did not run.
//
//   node scripts/search-bench-budget.mjs <bench.json>
//
// Vitest bench reports no p95 field, so the check uses p99 instead. On 100+
// samples p99 is stricter than the spec's p95; on a one-sample rebuild it is
// that single measured total.
//
// Budgets never move: a miss goes back to the maintainer.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The two engines the bench measures, as they appear in a group name. */
export const BENCH_ENGINES = ["desktop", "web"];

/**
 * p99 budgets in milliseconds, per benchmark name prefix and engine
 * (issue #639). Indexed queries differ by engine: 30 ms desktop, 60 ms web.
 */
export const BUDGETS_MS = {
  "indexed query:": { desktop: 30, web: 60 },
  "scan:": { desktop: 250, web: 250 },
  "added save cost:": { desktop: 5, web: 5 },
  "full rebuild:": { desktop: 10_000, web: 10_000 },
};

/** The engine a bench group names, or null when it names neither. */
export function engineOf(fullName) {
  if (fullName.includes("(desktop)")) return "desktop";
  if (fullName.includes("(web)")) return "web";
  return null;
}

export function checkBudgets(report) {
  const rows = [];
  for (const file of report.files ?? []) {
    for (const group of file.groups ?? []) {
      const engine = engineOf(group.fullName);
      if (!engine) continue;
      for (const benchmark of group.benchmarks ?? []) {
        const prefix = Object.keys(BUDGETS_MS).find((key) => benchmark.name.startsWith(key));
        if (!prefix) continue;
        const budget = BUDGETS_MS[prefix][engine];
        rows.push({
          name: `${group.fullName.split(" > ").at(-1)} > ${benchmark.name}`,
          engine,
          prefix,
          p99: benchmark.p99,
          mean: benchmark.mean,
          samples: benchmark.sampleCount,
          budget,
          ok: typeof benchmark.p99 === "number" && benchmark.p99 <= budget,
        });
      }
    }
  }
  const missing = [];
  for (const prefix of Object.keys(BUDGETS_MS)) {
    for (const engine of BENCH_ENGINES) {
      if (!rows.some((row) => row.prefix === prefix && row.engine === engine)) {
        missing.push(`${prefix} @ ${engine}`);
      }
    }
  }
  return { rows, missing, ok: missing.length === 0 && rows.every((row) => row.ok) };
}

/** Prints the budget table; returns whether every budget held. */
export function printBudgetReport(report, heading = "") {
  const { rows, missing, ok } = checkBudgets(report);
  console.log(`\nLibrary Search budget (issue #639)${heading}, times in ms`);
  console.log("| engine | benchmark | mean | p99 | budget (p99) | samples | result |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: | --- |");
  for (const row of rows) {
    console.log(
      `| ${row.engine} | ${row.name} | ${row.mean.toFixed(4)} | ${row.p99.toFixed(4)} | <= ${row.budget} | ${row.samples} | ${row.ok ? "pass" : "FAIL"} |`
    );
  }
  for (const label of missing) console.error(`missing benchmark: ${label}`);
  return ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/search-bench-budget.mjs <bench.json>");
    process.exit(2);
  }
  process.exit(printBudgetReport(JSON.parse(readFileSync(path, "utf8"))) ? 0 : 1);
}
