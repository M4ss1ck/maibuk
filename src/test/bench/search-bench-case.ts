// The benchmark bodies both search bench files register, so the desktop and
// web runs measure exactly the same reads and writes over their own seeded
// Library. Kept out of a `.bench.ts` so Vitest does not run it on its own.
import { bench } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { searchLibrary } from "@/features/search/search";
import {
  SEARCH_BENCH_INDEXED_QUERIES,
  SEARCH_BENCH_SCAN_QUERIES,
  searchBenchSaveStatements,
} from "@/test/support/search-bench";

export function registerSearchBenchmarks(db: DatabaseAdapter): void {
  for (const query of SEARCH_BENCH_INDEXED_QUERIES) {
    bench(query.name, async () => {
      await searchLibrary(db, { query: query.query });
    });
  }

  for (const query of SEARCH_BENCH_SCAN_QUERIES) {
    bench(query.name, async () => {
      await searchLibrary(db, { query: query.query, regex: query.regex });
    });
  }

  // The index statements a Chapter save adds to its atomic batch, computed as
  // the save computes them, executed alone: the added cost of the index update
  // step per save.
  const saveStatements = searchBenchSaveStatements();
  bench("added save cost: chapter index write", async () => {
    await db.executeAtomic(saveStatements);
  });
}
