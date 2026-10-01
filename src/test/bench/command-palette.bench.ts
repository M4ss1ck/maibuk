// @vitest-environment node
// Periodic lane for the Command Palette search index (issue #353, slice 4):
// p95 under 16 ms per keystroke over 10,000 items. Run `pnpm bench:palette`;
// scripts/palette-bench-budget.mjs fails the run when a budget is missed.
// Never part of `pnpm test`: the gate lane has no timing assertions.
import { bench, describe } from "vitest";
import { preparePaletteIndex, searchPalette } from "@/features/command-palette/palette-index";
import {
  PALETTE_BENCH_OPEN_BOOK_ID,
  PALETTE_BENCH_QUERIES,
  paletteBenchItems,
} from "@/test/support/palette-bench";

const index = preparePaletteIndex(paletteBenchItems());

describe("command palette", () => {
  for (const q of PALETTE_BENCH_QUERIES) {
    bench(`keystroke: ${JSON.stringify(q)}`, () => {
      searchPalette(index, {
        query: q,
        page: "root",
        recent: [],
        openBookId: PALETTE_BENCH_OPEN_BOOK_ID,
      });
    });
  }

  bench("keystroke: chapters page", () => {
    searchPalette(index, {
      query: "ch",
      page: "chapters",
      recent: [],
      openBookId: PALETTE_BENCH_OPEN_BOOK_ID,
    });
  });
});
