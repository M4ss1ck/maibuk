import { describe, expect, it } from "vitest";
import { BUDGETS_MS, checkBudgets } from "../../../../scripts/editor-highlights-bench-budget.mjs";

function report(benchmarks: { name: string; p99: number }[]) {
  return {
    files: [
      {
        groups: [
          {
            fullName: "editor-highlights.bench.ts > plugin editor highlights",
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

describe("editor highlights bench budget", () => {
  it("holds the #401 budgets: 16 ms per keystroke, 10 ms per highlight update", () => {
    expect(BUDGETS_MS).toEqual({ "keystroke with highlights:": 16, "highlight update:": 10 });
  });

  it("passes when every budgeted benchmark is under its p99 budget", () => {
    const result = checkBudgets(
      report([
        { name: "keystroke with highlights:", p99: 8 },
        { name: "highlight update:", p99: 4 },
      ])
    );
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => row.name)).toEqual([
      "plugin editor highlights > keystroke with highlights:",
      "plugin editor highlights > highlight update:",
    ]);
  });

  it("fails a benchmark at or over its budget", () => {
    const result = checkBudgets(
      report([
        { name: "keystroke with highlights:", p99: 8 },
        { name: "highlight update:", p99: 10 },
      ])
    );
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => !row.ok)?.prefix).toBe("highlight update:");
  });

  it("fails when a budgeted benchmark did not run", () => {
    const result = checkBudgets(report([{ name: "keystroke with highlights:", p99: 8 }]));
    expect(result).toMatchObject({ ok: false, missing: ["highlight update:"] });
    expect(checkBudgets({ files: [] })).toMatchObject({
      ok: false,
      missing: ["keystroke with highlights:", "highlight update:"],
    });
  });
});
