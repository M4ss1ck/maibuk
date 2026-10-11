import { describe, expect, it } from "vitest";
import { BUDGETS_MS, checkBudgets } from "../../../../../scripts/plugin-start-bench-budget.mjs";

function report(benchmarks: { name: string; p99: number }[]) {
  return {
    files: [
      {
        groups: [
          {
            fullName: "plugin-start.bench.ts > plugin start",
            benchmarks: benchmarks.map((bench) => ({
              ...bench,
              mean: bench.p99 / 2,
              sampleCount: 100,
            })),
          },
        ],
      },
    ],
  };
}

describe("plugin start bench budget", () => {
  it("holds the #401 per-start budget: p99 under 10 ms", () => {
    expect(BUDGETS_MS).toEqual({ "host start:": 10 });
  });

  it("passes when the host start benchmark is under its p99 budget", () => {
    const result = checkBudgets(report([{ name: "host start: ready", p99: 1 }]));
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => row.name)).toEqual(["plugin start > host start: ready"]);
  });

  it("fails a benchmark at or over its budget", () => {
    const result = checkBudgets(report([{ name: "host start: ready", p99: 10 }]));
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => !row.ok)?.prefix).toBe("host start:");
  });

  it("fails when the budgeted benchmark did not run", () => {
    expect(checkBudgets(report([]))).toMatchObject({ ok: false, missing: ["host start:"] });
    expect(checkBudgets({ files: [] })).toMatchObject({ ok: false, missing: ["host start:"] });
  });
});
