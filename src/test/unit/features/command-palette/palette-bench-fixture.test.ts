import { describe, expect, it } from "vitest";
import {
  preparePaletteIndex,
  searchPalette,
} from "@/features/command-palette/palette-index";
import type { PaletteItemKind, PalettePage } from "@/features/command-palette/palette-index";
import {
  PALETTE_BENCH_OPEN_BOOK_ID,
  PALETTE_BENCH_QUERIES,
  paletteBenchItems,
} from "@/test/support/palette-bench";
import { BUDGETS_MS, checkBudgets } from "../../../../../scripts/palette-bench-budget.mjs";

function report(benchmarks: { name: string; p99: number }[]) {
  return {
    files: [
      {
        groups: [
          {
            fullName: "command-palette.bench.ts > command palette",
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

describe("palette bench fixture", () => {
  it("has 10,000 items covering every kind and every target page", () => {
    const items = paletteBenchItems();
    expect(items).toHaveLength(10_000);
    const kinds = new Set<PaletteItemKind>(items.map((entry) => entry.kind));
    expect(kinds).toEqual(
      new Set(["command", "page", "book", "chapter", "note", "canvas", "settingsRow"])
    );
    const targets = new Set<PalettePage>(
      items.flatMap((entry) => (entry.kind === "page" && entry.targetPage ? [entry.targetPage] : []))
    );
    expect(targets).toEqual(new Set(["root", "chapters", "books", "notes", "canvases"]));
  });

  it("runs every bench query without throwing", () => {
    const index = preparePaletteIndex(paletteBenchItems());
    expect(PALETTE_BENCH_QUERIES.length).toBeGreaterThan(0);
    for (const query of PALETTE_BENCH_QUERIES) {
      expect(() =>
        searchPalette(index, {
          query,
          page: "root",
          recent: [],
          openBookId: PALETTE_BENCH_OPEN_BOOK_ID,
        })
      ).not.toThrow();
    }
    expect(() =>
      searchPalette(index, {
        query: "ch",
        page: "chapters",
        recent: [],
        openBookId: PALETTE_BENCH_OPEN_BOOK_ID,
      })
    ).not.toThrow();
  });
});

describe("palette bench budget", () => {
  it("holds the slice 4 budget: p99 under 16 ms per keystroke", () => {
    expect(BUDGETS_MS).toEqual({ "keystroke:": 16 });
  });

  it("passes when every keystroke benchmark is under its p99 budget", () => {
    const result = checkBudgets(
      report([
        { name: 'keystroke: "e"', p99: 2 },
        { name: "keystroke: chapters page", p99: 1 },
      ])
    );
    expect(result.ok).toBe(true);
    expect(result.rows.map((row) => row.name)).toEqual([
      'command palette > keystroke: "e"',
      "command palette > keystroke: chapters page",
    ]);
  });

  it("fails a benchmark at or over its budget", () => {
    const result = checkBudgets(report([{ name: 'keystroke: "e"', p99: 16 }]));
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => !row.ok)?.prefix).toBe("keystroke:");
  });

  it("fails when a budgeted benchmark did not run", () => {
    expect(checkBudgets(report([]))).toMatchObject({ ok: false, missing: ["keystroke:"] });
    expect(checkBudgets({ files: [] })).toMatchObject({
      ok: false,
      missing: ["keystroke:"],
    });
  });
});
