import { describe, expect, it } from "vitest";
import { filterNotes } from "@/components/notes/notes-list-model";
import {
  NOTES_FILTER_BENCH_SIZE,
  NOTES_FILTER_BENCH_CASES,
  notesFilterBenchNotes,
} from "@/test/support/notes-filter-bench";
import { BUDGETS_MS, checkBudgets } from "../../../../../scripts/notes-filter-bench-budget.mjs";

function report(benchmarks: { name: string; p99: number }[]) {
  return {
    files: [
      {
        groups: [
          {
            fullName: "notes-filter.bench.ts > notes filter",
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

describe("notes filter bench fixture", () => {
  it("has 5,000 notes and is identical across calls", () => {
    const notes = notesFilterBenchNotes();
    expect(notes).toHaveLength(NOTES_FILTER_BENCH_SIZE);
    expect(notesFilterBenchNotes()).toEqual(notes);
  });

  it("every case removes some but not all notes", () => {
    const notes = notesFilterBenchNotes();
    for (const c of NOTES_FILTER_BENCH_CASES) {
      const filtered = filterNotes(notes, c.criteria);
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.length).toBeLessThan(notes.length);
    }
  });

  it("some but not all notes carry the task tag", () => {
    const notes = notesFilterBenchNotes();
    const taskCount = notes.filter((note) => note.tags.includes("task")).length;
    expect(taskCount).toBeGreaterThan(0);
    expect(taskCount).toBeLessThan(notes.length);
  });
});

describe("notes filter bench budget", () => {
  it("holds the budget: p99 under 2 ms", () => {
    expect(BUDGETS_MS).toEqual({ "filter+sort:": 2 });
  });

  it("passes when every benchmark is under its p99 budget", () => {
    const result = checkBudgets(
      report([
        { name: "filter+sort: exclude: task / custom", p99: 1 },
        { name: "filter+sort: include: idea+draft / date-desc", p99: 1 },
      ])
    );
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => row.name)).toEqual([
      "notes filter > filter+sort: exclude: task / custom",
      "notes filter > filter+sort: include: idea+draft / date-desc",
    ]);
  });

  it("fails a benchmark at or over its budget", () => {
    const result = checkBudgets(report([{ name: "filter+sort: exclude: task / custom", p99: 2 }]));
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => !row.ok)?.prefix).toBe("filter+sort:");
  });

  it("fails when a budgeted benchmark did not run", () => {
    expect(checkBudgets(report([]))).toMatchObject({ ok: false, missing: ["filter+sort:"] });
    expect(checkBudgets({ files: [] })).toMatchObject({
      ok: false,
      missing: ["filter+sort:"],
    });
  });
});
