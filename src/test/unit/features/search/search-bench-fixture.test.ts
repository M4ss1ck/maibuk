import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { searchLibrary } from "@/features/search/search";
import type { SearchLibraryResult } from "@/features/search/types";
import type { AtomicStatement } from "@/lib/platform/types";
import {
  BUDGETS_MS,
  checkBudgets,
  engineOf,
} from "../../../../../scripts/search-bench-budget.mjs";
import {
  SEARCH_BENCH_COMMON_WORD,
  SEARCH_BENCH_INDEXED_QUERIES,
  SEARCH_BENCH_PHRASE,
  SEARCH_BENCH_RARE_WORD,
  SEARCH_BENCH_SCAN_QUERIES,
  SEARCH_BENCH_SEED,
  createSearchBenchEngine,
  searchBenchSaveStatements,
  searchBenchWords,
  seedSearchBench,
} from "@/test/support/search-bench";

const mockGetDatabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDatabase: mockGetDatabase,
}));

const { requestSearchRebuild, resetSearchIndexForTests } = await import(
  "@/features/search/rebuild"
);

// A small copy of the bench seed: the gate lane only proves every bench input
// still reaches its path, and a 1,000,000-word Library belongs in the periodic
// lane. The shape is the bench's own, so the two cannot drift.
const GATE_SEED = {
  books: 2,
  chaptersPerBook: 3,
  wordsPerChapter: 200,
  notes: 12,
  canvases: 2,
};

function reportFor(engine: "desktop" | "web", benchmarks: { name: string; p99: number }[]) {
  return {
    files: [
      {
        groups: [
          {
            fullName: `search.bench.ts > Library Search (${engine})`,
            benchmarks: benchmarks.map((benchmark) => ({
              ...benchmark,
              mean: benchmark.p99 / 2,
              sampleCount: 100,
            })),
          },
        ],
      },
    ],
  };
}

function rowsUnderBudget() {
  return [
    { name: "indexed query: rare word", p99: 5 },
    { name: "scan: regex", p99: 100 },
    { name: "added save cost: chapter index write", p99: 2 },
    { name: "full rebuild: library", p99: 4000 },
  ];
}

function resultOf(result: SearchLibraryResult) {
  if ("error" in result) throw new Error(`unexpected search error: ${result.message}`);
  return result;
}

interface RecordingAdapter {
  db: DatabaseAdapter;
  queries: string[];
}

/** An adapter that records every SELECT, to see which query path ran. */
function recording(db: DatabaseAdapter): RecordingAdapter {
  const queries: string[] = [];
  return {
    queries,
    db: {
      execute: (sql, params) => db.execute(sql, params),
      select: <T>(sql: string, params?: unknown[]) => {
        queries.push(sql);
        return db.select<T>(sql, params);
      },
      close: () => db.close(),
      exportData: () => db.exportData(),
      executeAtomic: (statements: readonly AtomicStatement[]) => db.executeAtomic(statements),
    },
  };
}

async function countIndexRows(db: DatabaseAdapter): Promise<number> {
  const rows = await db.select<{ count: number }[]>("SELECT COUNT(*) AS count FROM search_text");
  return rows[0]?.count ?? 0;
}

async function runQuery(
  db: DatabaseAdapter,
  query: string,
  regex?: boolean
): Promise<{ result: SearchLibraryResult; queries: string[] }> {
  const recorder = recording(db);
  const result = await searchLibrary(recorder.db, { query, regex });
  return { result, queries: recorder.queries };
}

afterEach(() => {
  resetSearchIndexForTests();
  vi.restoreAllMocks();
});

describe("search bench fixture", () => {
  it("declares a ~1,000,000-word Library, 2,000 Notes, and several Books", () => {
    expect(searchBenchWords()).toBe(1_000_000);
    expect(SEARCH_BENCH_SEED.books).toBeGreaterThanOrEqual(3);
    expect(SEARCH_BENCH_SEED.notes).toBe(2_000);
    expect(SEARCH_BENCH_SEED.canvases).toBeGreaterThan(0);
  });

  it("declares three indexed queries and two scan queries", () => {
    expect(SEARCH_BENCH_INDEXED_QUERIES.map((query) => query.query)).toEqual([
      SEARCH_BENCH_RARE_WORD,
      SEARCH_BENCH_COMMON_WORD,
      SEARCH_BENCH_PHRASE,
    ]);
    for (const query of SEARCH_BENCH_INDEXED_QUERIES) {
      expect(query.query.length).toBeGreaterThanOrEqual(3);
      expect(query.regex).toBeUndefined();
    }
    expect(SEARCH_BENCH_SCAN_QUERIES[0].query.length).toBeLessThan(3);
    expect(SEARCH_BENCH_SCAN_QUERIES[1].regex).toBe(true);
  });

  it("runs both engines on SQLite new enough for diacritic-insensitive trigrams", async () => {
    for (const kind of ["desktop", "web"] as const) {
      const engine = await createSearchBenchEngine(kind);
      const rows = await engine.db.select<{ version: string }[]>(
        "SELECT sqlite_version() AS version"
      );
      const [major, minor] = rows[0].version.split(".").map(Number);
      expect(major > 3 || (major === 3 && minor >= 45)).toBe(true);

      await engine.db.execute(
        "CREATE VIRTUAL TABLE folded USING fts5(x, tokenize='trigram remove_diacritics 1')"
      );
      await engine.db.execute("INSERT INTO folded (x) VALUES ('canción del faro')");
      await expect(
        engine.db.select("SELECT x FROM folded WHERE folded MATCH 'cancion'")
      ).resolves.toEqual([{ x: "canción del faro" }]);
      await engine.close();
    }
  });

  it("reaches the index, scan, save, and rebuild paths on both engines", async () => {
    for (const kind of ["desktop", "web"] as const) {
      const engine = await createSearchBenchEngine(kind);
      const seeded = await seedSearchBench(engine.db, GATE_SEED);

      expect(seeded.chapters).toBe(GATE_SEED.books * GATE_SEED.chaptersPerBook);
      expect(seeded.notes).toBe(GATE_SEED.notes);
      expect(seeded.canvases).toBe(GATE_SEED.canvases);
      expect(seeded.blocks).toBeGreaterThan(0);
      for (const query of SEARCH_BENCH_INDEXED_QUERIES) {
        const { result, queries } = await runQuery(engine.db, query.query);
        expect(resultOf(result).results.length).toBeGreaterThan(0);
        expect(queries.some((sql) => sql.includes("search_text_fts"))).toBe(true);
      }

      for (const query of SEARCH_BENCH_SCAN_QUERIES) {
        const { result, queries } = await runQuery(engine.db, query.query, query.regex);
        expect(resultOf(result).results.length).toBeGreaterThan(0);
        expect(queries.some((sql) => sql.includes("search_text_fts"))).toBe(false);
      }

      const saveStatements = searchBenchSaveStatements(GATE_SEED);
      const before = await countIndexRows(engine.db);
      await engine.db.executeAtomic(saveStatements);
      expect(await countIndexRows(engine.db)).toBe(before);

      await engine.db.execute("DELETE FROM search_text");
      mockGetDatabase.mockResolvedValue(engine.db);
      await requestSearchRebuild();
      expect(await countIndexRows(engine.db)).toBeGreaterThan(0);

      await engine.close();
    }
  });
});

describe("search bench budget", () => {
  it("keeps the issue #639 budgets, never relaxed", () => {
    expect(BUDGETS_MS).toEqual({
      "indexed query:": { desktop: 30, web: 60 },
      "scan:": { desktop: 250, web: 250 },
      "added save cost:": { desktop: 5, web: 5 },
      "full rebuild:": { desktop: 10_000, web: 10_000 },
    });
  });

  it("reads the engine off a group name", () => {
    expect(engineOf("search.bench.ts > Library Search (desktop)")).toBe("desktop");
    expect(engineOf("search.bench.ts > Library Search (web)")).toBe("web");
    expect(engineOf("search.bench.ts > search")).toBeNull();
  });

  it("passes when every benchmark is within its engine's budget", () => {
    const result = checkBudgets({
      files: [
        ...reportFor("desktop", rowsUnderBudget()).files,
        ...reportFor("web", rowsUnderBudget()).files,
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.rows).toHaveLength(8);
    expect(result.rows.map((row) => row.engine)).toContain("web");
  });

  it("fails a benchmark over its engine's budget", () => {
    const result = checkBudgets(
      reportFor("web", [{ name: "indexed query: common word", p99: 61 }])
    );
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => !row.ok)).toMatchObject({
      engine: "web",
      budget: 60,
    });
  });

  it("fails when an engine's budgeted benchmark did not run", () => {
    const result = checkBudgets(
      reportFor("desktop", rowsUnderBudget())
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("indexed query: @ web");
    expect(result.missing).toContain("full rebuild: @ web");
  });
});
