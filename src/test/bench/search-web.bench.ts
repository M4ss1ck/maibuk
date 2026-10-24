// Periodic lane for Library Search (issue #639), web engine: the same seeded
// ~1,000,000-word Library on the SQLite project's WASM build (the
// MemoryDatabaseAdapter the web build uses). Its own file so the desktop and
// web Libraries are never held in the same heap during a rebuild. Run both
// with `pnpm bench:search`; scripts/search-bench-budget.mjs fails the run when
// a budget is missed (indexed query 30 ms desktop / 60 ms web, scan 250 ms,
// added save cost 5 ms, full rebuild 10 s, all p99). Never part of
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

const engine = await createSearchBenchEngine("web");
await seedSearchBench(engine.db);

describe("Library Search (web)", () => {
  registerSearchBenchmarks(engine.db);

  bench(
    "full rebuild: library",
    async () => {
      mockGetDatabase.mockResolvedValue(engine.db);
      await requestSearchRebuild();
    },
    { iterations: 1, time: 1, warmupTime: 0, warmupIterations: 0 }
  );
});
