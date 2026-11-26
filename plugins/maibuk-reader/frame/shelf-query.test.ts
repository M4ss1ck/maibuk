/**
 * The Shelf's view rules (#945), unit-tested in Node: which Documents the
 * author's filters and search keep, the order the sort puts them in, where a
 * search matched, and how many covers fit across the Frame. The Frame seam
 * tests drive these through the Shelf; here the values go in and come out plain.
 */

import { describe, expect, it } from "vitest";
import type { FrameCollection, FrameShelfEntry, ShelfViewSettings } from "./types";
import {
  activeCollection,
  fill,
  COVER_WIDTHS,
  collectionCounts,
  filterShelf,
  fold,
  gridColumns,
  hasActiveFilters,
  matchRanges,
  matchesSearch,
  queryShelf,
  searchTokens,
  sortShelf,
} from "./shelf-query";

/** A Shelf row with the Frame's defaults, overridden per test. */
function entry(overrides: Partial<FrameShelfEntry>): FrameShelfEntry {
  return {
    id: "doc-1",
    title: "Dune",
    author: "Frank Herbert",
    format: "epub",
    state: "ok",
    progressText: "42%",
    progressPercent: 42,
    statusText: null,
    tone: 0,
    status: "reading",
    lastReadAt: 0,
    addedAt: 0,
    progress: 0.42,
    ...overrides,
  };
}

/** The view settings with no filter, no search, and the given sort. */
function settings(overrides: Partial<ShelfViewSettings> = {}): ShelfViewSettings {
  return {
    layout: "grid",
    coverSize: "medium",
    sort: "title",
    descending: false,
    formats: [],
    statuses: [],
    search: "",
    collection: null,
    ...overrides,
  };
}

function titles(rows: FrameShelfEntry[]): string[] {
  return rows.map((row) => row.title);
}

describe("fill", () => {
  it("fills each placeholder, and fills an unknown or inherited name empty", () => {
    expect(fill("{{page}} of {{count}}", { page: 3, count: 12 })).toBe("3 of 12");
    expect(fill("Sort by: {{sort}}{{missing}}", { sort: "Title" })).toBe("Sort by: Title");
    expect(fill("{{constructor}}{{toString}}", {})).toBe("");
  });
});

describe("fold", () => {
  it("lowercases and strips diacritics, mapping each folded unit to its original index", () => {
    const folded = fold("Pérez Galdós");
    expect(folded.folded).toBe("perez galdos");
    expect(folded.map[0]).toBe(0);
    expect(folded.map[1]).toBe(1);
    expect(folded.map[folded.folded.length]).toBe("Pérez Galdós".length);
  });

  it("maps a folded character from a surrogate pair to the pair's first index", () => {
    const folded = fold("𝔘x");
    expect(folded.folded).toBe("𝔘x");
    expect(folded.map[0]).toBe(0);
    expect(folded.map[2]).toBe(2);
    expect(folded.map[3]).toBe(3);
  });
});

describe("searchTokens", () => {
  it("splits the folded search on whitespace and drops empty tokens", () => {
    expect(searchTokens("  Pérez   GALDÓS ")).toEqual(["perez", "galdos"]);
    expect(searchTokens("   ")).toEqual([]);
    expect(searchTokens("")).toEqual([]);
  });
});

describe("matchesSearch", () => {
  const row = entry({ title: "Fortunata y Jacinta", author: "Benito Pérez Galdós" });

  it("matches everything when the search has no tokens", () => {
    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "   ")).toBe(true);
  });

  it("matches a search by title", () => {
    expect(matchesSearch(row, "fortunata")).toBe(true);
  });

  it("matches a search by author", () => {
    expect(matchesSearch(row, "benito")).toBe(true);
  });

  it("matches two tokens across title and author", () => {
    expect(matchesSearch(row, "jacinta galdos")).toBe(true);
  });

  it("requires every token to occur", () => {
    expect(matchesSearch(row, "jacinta dune")).toBe(false);
  });

  it("is accent-insensitive", () => {
    expect(matchesSearch(row, "galdos")).toBe(true);
    expect(matchesSearch(row, "GALDÓS")).toBe(true);
  });
});

describe("matchRanges", () => {
  it("returns the original range of a single token", () => {
    expect(matchRanges("Austen, Jane", "austen")).toEqual([[0, 6]]);
  });

  it("maps an accent-insensitive match back to the accented original", () => {
    expect(matchRanges("Pérez Galdós", "galdos")).toEqual([[6, 12]]);
  });

  it("returns no ranges for an empty search", () => {
    expect(matchRanges("abc", "")).toEqual([]);
  });

  it("returns every occurrence sorted, merging touching or overlapping ranges", () => {
    expect(matchRanges("Jane Austen and Jane", "jane austen")).toEqual([
      [0, 4],
      [5, 11],
      [16, 20],
    ]);
    expect(matchRanges("abcd", "ab bc")).toEqual([[0, 3]]);
  });
});

describe("filterShelf", () => {
  const rows = [
    entry({ id: "a", title: "Alpha", format: "epub", status: "new" }),
    entry({ id: "b", title: "Beta", format: "pdf", status: "reading" }),
    entry({ id: "c", title: "Gamma", format: "epub", status: "finished" }),
    entry({ id: "d", title: "Delta", format: "cbz", status: "reading" }),
  ];

  it("keeps everything when no filter or search is set", () => {
    expect(titles(filterShelf(rows, settings()))).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
  });

  it("keeps only the chosen format", () => {
    expect(titles(filterShelf(rows, settings({ formats: ["epub"] })))).toEqual(["Alpha", "Gamma"]);
  });

  it("keeps only the chosen status", () => {
    expect(titles(filterShelf(rows, settings({ statuses: ["reading"] })))).toEqual([
      "Beta",
      "Delta",
    ]);
  });

  it("combines format and status filters with AND", () => {
    expect(
      titles(filterShelf(rows, settings({ formats: ["epub", "pdf"], statuses: ["reading"] })))
    ).toEqual(["Beta"]);
  });

  it("applies the search after the filters and keeps input order", () => {
    expect(titles(filterShelf(rows, settings({ search: "a" })))).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ]);
    expect(titles(filterShelf(rows, settings({ search: "delta", formats: ["epub"] })))).toEqual([]);
  });

  it("returns a new array", () => {
    const kept = filterShelf(rows, settings());
    expect(kept).not.toBe(rows);
  });
});

describe("sortShelf", () => {
  const rows = [
    entry({ id: "m", title: "Mid", author: "Mona", lastReadAt: 200, progress: 0.5, addedAt: 20 }),
    entry({ id: "a", title: "Ace", author: "Zed", lastReadAt: 300, progress: 0.1, addedAt: 10 }),
    entry({ id: "z", title: "Zulu", author: "Ada", lastReadAt: 100, progress: 0.9, addedAt: 30 }),
  ];

  it("sorts recent by last read, newest first when descending", () => {
    expect(titles(sortShelf(rows, "recent", true, "en"))).toEqual(["Ace", "Mid", "Zulu"]);
    expect(titles(sortShelf(rows, "recent", false, "en"))).toEqual(["Zulu", "Mid", "Ace"]);
  });

  it("sorts title by collator, A to Z ascending and Z to A descending", () => {
    expect(titles(sortShelf(rows, "title", false, "en"))).toEqual(["Ace", "Mid", "Zulu"]);
    expect(titles(sortShelf(rows, "title", true, "en"))).toEqual(["Zulu", "Mid", "Ace"]);
  });

  it("sorts author by collator, A to Z ascending and Z to A descending", () => {
    expect(titles(sortShelf(rows, "author", false, "en"))).toEqual(["Zulu", "Mid", "Ace"]);
    expect(titles(sortShelf(rows, "author", true, "en"))).toEqual(["Ace", "Mid", "Zulu"]);
  });

  it("sorts progress, least first ascending and most first descending", () => {
    expect(titles(sortShelf(rows, "progress", false, "en"))).toEqual(["Ace", "Mid", "Zulu"]);
    expect(titles(sortShelf(rows, "progress", true, "en"))).toEqual(["Zulu", "Mid", "Ace"]);
  });

  it("sorts added by import time, oldest first ascending and newest first descending", () => {
    expect(titles(sortShelf(rows, "added", false, "en"))).toEqual(["Ace", "Mid", "Zulu"]);
    expect(titles(sortShelf(rows, "added", true, "en"))).toEqual(["Zulu", "Mid", "Ace"]);
  });

  it("puts entries with an empty author last in both directions", () => {
    const withBlank = [
      entry({ id: "n", title: "Anon", author: "" }),
      entry({ id: "b", title: "Bravo", author: "Bea" }),
      entry({ id: "c", title: "Charlie", author: "Cy" }),
    ];
    expect(titles(sortShelf(withBlank, "author", false, "en"))).toEqual([
      "Bravo",
      "Charlie",
      "Anon",
    ]);
    expect(titles(sortShelf(withBlank, "author", true, "en"))).toEqual([
      "Charlie",
      "Bravo",
      "Anon",
    ]);
  });

  it("breaks ties by title then id ascending, and descending never reverses the tie-break", () => {
    const tied = [
      entry({ id: "2", title: "Same", lastReadAt: 5 }),
      entry({ id: "1", title: "Same", lastReadAt: 5 }),
      entry({ id: "0", title: "Aardvark", lastReadAt: 5 }),
    ];
    const ascending = sortShelf(tied, "recent", false, "en").map((row) => row.id);
    const descending = sortShelf(tied, "recent", true, "en").map((row) => row.id);
    expect(ascending).toEqual(["0", "1", "2"]);
    expect(descending).toEqual(["0", "1", "2"]);
  });

  it("sorts Spanish accents with their base letter", () => {
    const names = [
      entry({ id: "1", title: "Bruno" }),
      entry({ id: "2", title: "Álvaro" }),
      entry({ id: "3", title: "Aaron" }),
    ];
    expect(titles(sortShelf(names, "title", false, "es"))).toEqual(["Aaron", "Álvaro", "Bruno"]);
  });

  it("sorts numeric titles by their number", () => {
    const books = [entry({ id: "10", title: "Book 10" }), entry({ id: "2", title: "Book 2" })];
    expect(titles(sortShelf(books, "title", false, "en"))).toEqual(["Book 2", "Book 10"]);
  });

  it("does not throw on an invalid language tag", () => {
    expect(() => sortShelf(rows, "title", false, "zz-!!")).not.toThrow();
    expect(titles(sortShelf(rows, "title", false, "zz-!!"))).toEqual(["Ace", "Mid", "Zulu"]);
  });

  it("returns a new array", () => {
    expect(sortShelf(rows, "title", false, "en")).not.toBe(rows);
  });
});

describe("queryShelf", () => {
  it("filters then sorts by the view settings", () => {
    const rows = [
      entry({ id: "1", title: "Zulu", format: "epub" }),
      entry({ id: "2", title: "Alpha", format: "pdf" }),
      entry({ id: "3", title: "Mike", format: "epub" }),
    ];
    expect(titles(queryShelf(rows, settings({ formats: ["epub"], sort: "title" }), "en"))).toEqual([
      "Mike",
      "Zulu",
    ]);
  });
});

describe("hasActiveFilters", () => {
  it("is false with nothing set", () => {
    expect(hasActiveFilters(settings())).toBe(false);
  });

  it("is true for a format, a status, or a search", () => {
    expect(hasActiveFilters(settings({ formats: ["epub"] }))).toBe(true);
    expect(hasActiveFilters(settings({ statuses: ["new"] }))).toBe(true);
    expect(hasActiveFilters(settings({ search: "dune" }))).toBe(true);
  });

  it("is false for a whitespace-only search", () => {
    expect(hasActiveFilters(settings({ search: "   " }))).toBe(false);
  });
});

describe("gridColumns", () => {
  it("fits a narrow Frame at 390 px into 4, 3, and 2 columns for small, medium, and large", () => {
    expect(gridColumns(false, 390, "small")).toBe(4);
    expect(gridColumns(false, 390, "medium")).toBe(3);
    expect(gridColumns(false, 390, "large")).toBe(2);
  });

  it("fits a narrow Frame at 360 px into 4, 3, and 2 columns", () => {
    expect(gridColumns(false, 360, "small")).toBe(4);
    expect(gridColumns(false, 360, "medium")).toBe(3);
    expect(gridColumns(false, 360, "large")).toBe(2);
  });

  it("fits a wide Frame into its gutters", () => {
    expect(gridColumns(true, 1040, "medium")).toBe(6);
    expect(gridColumns(true, 1280, "medium")).toBe(8);
    expect(gridColumns(true, 600, "large")).toBe(2);
  });

  it("never returns fewer than one column", () => {
    expect(gridColumns(false, 10, "large")).toBe(1);
    expect(gridColumns(true, 10, "large")).toBe(1);
    expect(gridColumns(false, 10, "small")).toBe(1);
    expect(gridColumns(true, 10, "small")).toBe(1);
  });

  it("exposes the three cover widths", () => {
    expect(COVER_WIDTHS).toEqual({ small: 88, medium: 128, large: 176 });
  });
});

describe("Collections (#946)", () => {
  const shelves: FrameCollection[] = [
    { id: "c1", name: "Classics" },
    { id: "c2", name: "Summer" },
    { id: "c3", name: "Empty" },
  ];
  const rows = [
    entry({ id: "a", title: "Alpha", collections: ["c1"] }),
    entry({ id: "b", title: "Beta", collections: ["c1", "c2"] }),
    entry({ id: "c", title: "Gamma" }),
    entry({ id: "d", title: "Delta", format: "pdf", collections: ["c2"] }),
  ];

  describe("activeCollection", () => {
    it("returns the Collection the settings name", () => {
      expect(activeCollection({ collection: "c2" }, shelves)).toEqual({ id: "c2", name: "Summer" });
    });

    it("returns null when no Collection is set", () => {
      expect(activeCollection({ collection: null }, shelves)).toBeNull();
    });

    it("returns null for a stale id that names no Collection", () => {
      expect(activeCollection({ collection: "gone" }, shelves)).toBeNull();
    });
  });

  describe("filterShelf by Collection", () => {
    it("keeps only the Documents filed in the active Collection", () => {
      expect(titles(filterShelf(rows, settings({ collection: "c1" }), shelves))).toEqual([
        "Alpha",
        "Beta",
      ]);
    });

    it("keeps nothing for a Collection with no Documents in it", () => {
      expect(titles(filterShelf(rows, settings({ collection: "c3" }), shelves))).toEqual([]);
    });

    it("ignores a stale id and keeps everything", () => {
      expect(titles(filterShelf(rows, settings({ collection: "gone" }), shelves))).toEqual([
        "Alpha",
        "Beta",
        "Gamma",
        "Delta",
      ]);
    });

    it("keeps everything when no Collection is set", () => {
      expect(titles(filterShelf(rows, settings({ collection: null }), shelves))).toEqual([
        "Alpha",
        "Beta",
        "Gamma",
        "Delta",
      ]);
    });

    it("applies the Collection and the format filter together", () => {
      expect(
        titles(filterShelf(rows, settings({ collection: "c2", formats: ["epub"] }), shelves))
      ).toEqual(["Beta"]);
      expect(
        titles(filterShelf(rows, settings({ collection: "c2", formats: ["pdf"] }), shelves))
      ).toEqual(["Delta"]);
      expect(
        titles(filterShelf(rows, settings({ collection: "c1", formats: ["pdf"] }), shelves))
      ).toEqual([]);
    });
  });

  describe("queryShelf by Collection", () => {
    it("sorts the rows the Collection keeps", () => {
      const sorted = queryShelf(
        rows,
        settings({ collection: "c2", sort: "title", descending: true }),
        "en",
        shelves
      );
      expect(titles(sorted)).toEqual(["Delta", "Beta"]);
    });
  });

  describe("hasActiveFilters by Collection", () => {
    it("is true when a known Collection is set", () => {
      expect(hasActiveFilters(settings({ collection: "c1" }), shelves)).toBe(true);
    });

    it("is false for a stale id alone", () => {
      expect(hasActiveFilters(settings({ collection: "gone" }), shelves)).toBe(false);
      expect(hasActiveFilters(settings({ collection: "gone" }))).toBe(false);
    });

    it("is false when no Collection is set", () => {
      expect(hasActiveFilters(settings({ collection: null }), shelves)).toBe(false);
    });
  });

  describe("collectionCounts", () => {
    it("counts zero for a Collection no entry lists", () => {
      expect(collectionCounts(rows, shelves).get("c3")).toBe(0);
    });

    it("counts one entry", () => {
      const counts = collectionCounts([entry({ collections: ["c1"] })], shelves);
      expect(counts).toEqual(
        new Map([
          ["c1", 1],
          ["c2", 0],
          ["c3", 0],
        ])
      );
    });

    it("counts several entries per Collection", () => {
      expect(collectionCounts(rows, shelves)).toEqual(
        new Map([
          ["c1", 2],
          ["c2", 2],
          ["c3", 0],
        ])
      );
    });

    it("does not count an id that names no Collection", () => {
      const counts = collectionCounts([entry({ collections: ["gone", "c2"] })], shelves);
      expect(counts.has("gone")).toBe(false);
      expect(counts.get("c2")).toBe(1);
      expect(counts.size).toBe(3);
    });

    it("counts an entry once even if it lists an id twice", () => {
      const counts = collectionCounts([entry({ collections: ["c1", "c1"] })], shelves);
      expect(counts.get("c1")).toBe(1);
    });

    it("is zero for every Collection when no entry is filed", () => {
      expect(collectionCounts([entry({})], shelves)).toEqual(
        new Map([
          ["c1", 0],
          ["c2", 0],
          ["c3", 0],
        ])
      );
    });
  });
});
