import { describe, expect, it } from "vitest";
import { BUDGETS_MS, checkBudgets } from "../../../../scripts/dictation-bench-budget.mjs";

function report(benchmarks: { name: string; p99: number }[]) {
  return {
    files: [
      {
        groups: [
          {
            fullName: "dictation-interpreter.bench.ts > dictation interpreter (en)",
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

describe("dictation bench budget", () => {
  it("holds the ADR 0015 budget: 1 ms per line, 10 ms per rebuild", () => {
    expect(BUDGETS_MS).toEqual({ "interpret:": 1, "rebuild:": 10 });
  });

  it("passes when every budgeted benchmark is under its p99 budget", () => {
    const result = checkBudgets(
      report([
        { name: "interpret: worst-case line", p99: 0.05 },
        { name: "rebuild: phrase table", p99: 4 },
      ])
    );
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => row.name)).toEqual([
      "dictation interpreter (en) > interpret: worst-case line",
      "dictation interpreter (en) > rebuild: phrase table",
    ]);
  });

  it("fails a benchmark at or over its budget", () => {
    const result = checkBudgets(
      report([
        { name: "interpret: worst-case line", p99: 1 },
        { name: "rebuild: phrase table", p99: 4 },
      ])
    );
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => !row.ok)?.prefix).toBe("interpret:");
  });

  it("fails when a budgeted benchmark did not run", () => {
    const result = checkBudgets(report([{ name: "interpret: worst-case line", p99: 0.05 }]));
    expect(result).toMatchObject({ ok: false, missing: ["rebuild:"] });
    expect(checkBudgets({ files: [] })).toMatchObject({
      ok: false,
      missing: ["interpret:", "rebuild:"],
    });
  });
});
