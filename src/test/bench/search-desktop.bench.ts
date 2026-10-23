// Periodic lane for Library Search (issue #639), desktop engine: a seeded
// ~1,000,000-word Library (five Books of Chapter text in English and Spanish,
// 2,000 Notes, four Canvases) on Node's native SQLite. Its own file so the
// desktop and web Libraries are never held in the same heap during a rebuild.
// Run both with `pnpm bench:search`; scripts/search-bench-budget.mjs fails the
// run when a budget is missed (indexed query 30 ms desktop / 60 ms web, scan
// 250 ms, added save cost 5 ms, full rebuild 10 s, all p99). Never part of
// `pnpm test`: the gate lane has no timing assertions.
import { bench, describe, vi } from "vitest";
import { registerSearchBenchmarks } from "@/test/bench/search-bench-case";

const mockGetDatabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDatabase: mockGetDatabase,
}));

const { requestSearchRebuild } = await import("@/features/search/rebuild");
const { createSearchBenchEngine, seedSearchBench } = await import("@/test/support/search-bench");

const engine = await createSearchBenchEngine("desktop");
await seedSearchBench(engine.db);

describe("Library Search (desktop)", () => {
  registerSearchBenchmarks(engine.db);

  bench(
    "full rebuild: library",
    async () => {
      mockGetDatabase.mockResolvedValue(engine.db);
      await requestSearchRebuild();
    },
    // A rebuild is one measured total, not a loop: six to eight samples of a
    // multiple-second job would turn the lane into minutes.
    { iterations: 1, time: 1, warmupTime: 0, warmupIterations: 0 }
  );
});
