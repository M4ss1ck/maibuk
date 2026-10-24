import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createDefaultCanvasDoc } from "@/features/canvas/types";
import { countMatches } from "@/lib/search/expression";
import type {
  SearchLibraryOptions,
  SearchLibraryResult,
  SearchResults,
} from "@/features/search/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// Library Search through its one public function, over a real in-memory
// Library written through the product's own write paths. The index hooks are
// unit 1; this proves what the palette and the Plugin API will see.

const mockGetDatabase = vi.hoisted(() => vi.fn());
const mockExportDatabase = vi.hoisted(() => vi.fn());
const mockCreateDatabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDatabase: mockGetDatabase,
  exportDatabase: mockExportDatabase,
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  createDatabase: mockCreateDatabase,
}));

const { createBookRow, deleteBookRow, applyBookSnapshotData } = await import(
  "@/features/books/write"
);
const { createChapterRow, updateChapterRow } = await import("@/features/chapters/write");
const { createNoteRow, updateNoteRow, deleteNoteRow } = await import("@/features/notes/write");
const { createCanvasRow, updateCanvasDocRow } = await import("@/features/canvas/write");
const { importDatabase, closeDatabase } = await import("@/lib/db");
const { awaitSearchIndexRebuild, resetSearchIndexForTests } = await import(
  "@/features/search/rebuild"
);
const { searchLibrary } = await import("@/features/search/search");

let db: DatabaseAdapter;
let clock = 1_000_000;

function resultsOf(result: SearchLibraryResult): SearchResults {
  if ("error" in result) throw new Error(`unexpected search error: ${result.message}`);
  return result;
}

async function search(options: SearchLibraryOptions): Promise<SearchResults> {
  return resultsOf(await searchLibrary(db, options));
}

/** An adapter that records every SELECT, to see which query path ran. */
function recordingAdapter(): { db: DatabaseAdapter; queries: string[] } {
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
      executeAtomic: (statements) => db.executeAtomic(statements),
    },
  };
}

async function seedChapter(bookId: string, content: string, title = "Chapter") {
  const chapter = await createChapterRow({ bookId, title }, "local");
  await updateChapterRow(chapter.id, { content }, "local");
  return chapter;
}

beforeEach(async () => {
  vi.stubGlobal("Worker", undefined);
  await closeDatabase();
  db = await createTestDatabase();
  mockGetDatabase.mockReset();
  mockGetDatabase.mockResolvedValue(db);
  mockExportDatabase.mockReset();
  mockExportDatabase.mockImplementation(() => db.exportData());
  mockCreateDatabase.mockReset();
  mockCreateDatabase.mockResolvedValue(db);
  resetSearchIndexForTests();
  clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock * 1000);
});

afterEach(async () => {
  await awaitSearchIndexRebuild();
  resetSearchIndexForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function advanceClock(seconds: number): void {
  clock += seconds;
}

describe("searchLibrary matching", () => {
  it("ignores case by default", async () => {
    const book = await createBookRow({ title: "Elena", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>ELENA walked in.</p>");

    const found = await search({ query: "elena" });

    expect(found.results.map((result) => result.kind).sort()).toEqual(["book", "chapter"]);
    expect(found.results.every((result) => result.matchCount === 1)).toBe(true);
  });

  it("respects Match case", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>The cat sat on the Cat</p>");

    expect((await search({ query: "CAT", matchCase: true, kinds: ["chapter"] })).results).toEqual(
      []
    );
    expect((await search({ query: "CAT", kinds: ["chapter"] })).results[0].matchCount).toBe(2);
    expect(
      (await search({ query: "Cat", matchCase: true, kinds: ["chapter"] })).results[0].matchCount
    ).toBe(1);
  });

  it("respects Whole word", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>cat category cat</p>");

    const found = await search({ query: "cat", wholeWord: true, kinds: ["chapter"] });

    expect(found.results).toHaveLength(1);
    expect(found.results[0].matchCount).toBe(2);
  });

  it("supports a Regex", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>a1 b2 c3</p>");

    const found = await search({ query: "[a-z]\\d", regex: true, kinds: ["chapter"] });

    expect(found.results).toHaveLength(1);
    expect(found.results[0].matchCount).toBe(3);
  });

  it("returns an error result for an invalid Regex", async () => {
    const result = await searchLibrary(db, { query: "[unclosed", regex: true });

    expect(result).toMatchObject({ error: "invalid-regex" });
    expect("message" in result && result.message.length).toBeGreaterThan(0);
  });

  it("ignores accents by default, in both directions", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>La canción del faro</p><p>Eléna walked in</p>");

    const unaccented = await search({ query: "cancion", kinds: ["chapter"] });
    expect(unaccented.results).toHaveLength(1);
    expect(unaccented.results[0].matchCount).toBe(1);

    const accented = await search({ query: "canción", kinds: ["chapter"] });
    expect(accented.results).toHaveLength(1);
    expect(accented.results[0].matchCount).toBe(1);

    const name = await search({ query: "ELENA", kinds: ["chapter"] });
    expect(name.results).toHaveLength(1);
  });

  it("narrows an accented Library through the index and highlights the accents", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>La canción del faro</p>");
    const recorder = recordingAdapter();

    const found = resultsOf(await searchLibrary(recorder.db, { query: "cancion" }));

    expect(recorder.queries.some((sql) => sql.includes("MATCH"))).toBe(true);
    expect(found.results).toHaveLength(1);
    expect(found.results[0].matchCount).toBe(1);
    const [start, end] = found.results[0].snippet.highlights[0];
    expect(found.results[0].snippet.text.slice(start, end)).toBe("canción");
  });

  it("folds accents for a short query that scans the plain text", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>El niño sé fue</p>");
    const recorder = recordingAdapter();

    const found = resultsOf(await searchLibrary(recorder.db, { query: "se", kinds: ["chapter"] }));

    expect(recorder.queries.some((sql) => sql.includes("MATCH"))).toBe(false);
    expect(found.results).toHaveLength(1);
    expect(found.results[0].matchCount).toBe(1);
  });

  it("keeps a Regex pinned to the exact accents", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>La canción del faro</p>");

    await expect(
      search({ query: "cancion", regex: true, kinds: ["chapter"] })
    ).resolves.toEqual(expect.objectContaining({ results: [] }));
    const found = await search({ query: "canci.n", regex: true, kinds: ["chapter"] });
    expect(found.results).toHaveLength(1);
  });

  it("finds a one- or two-character query by scanning the plain text", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>An ox and an axe</p>");
    const recorder = recordingAdapter();

    const result = resultsOf(await searchLibrary(recorder.db, { query: "ox" }));

    expect(result.results).toHaveLength(1);
    expect(recorder.queries.some((sql) => sql.includes("MATCH"))).toBe(false);
  });

  it("narrows a three-character literal query through the trigram index", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>An elephant passed</p>");
    const recorder = recordingAdapter();

    const result = resultsOf(await searchLibrary(recorder.db, { query: "elephant" }));

    expect(result.results).toHaveLength(1);
    expect(recorder.queries.some((sql) => sql.includes("MATCH"))).toBe(true);
  });

  it("never matches across two blocks", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>alpha</p><p>beta</p>");

    await expect(search({ query: "alpha beta", kinds: ["chapter"] })).resolves.toEqual(
      expect.objectContaining({ results: [] })
    );
  });

  it("returns one result per item with the total match count", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>word word</p><p>word</p>");

    const found = await search({ query: "word", kinds: ["chapter"] });

    expect(found.results).toHaveLength(1);
    expect(found.results[0].ids.itemId).toBe(chapter.id);
    expect(found.results[0].matchCount).toBe(3);
  });
});

describe("searchLibrary snippets and ranking", () => {
  it("builds a snippet around the best match with correct highlight offsets", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    const text = `${"x".repeat(100)}needle${"y".repeat(100)}`;
    await seedChapter(book.id, `<p>${text}</p>`);

    const found = await search({ query: "needle", kinds: ["chapter"] });
    const [result] = found.results;
    const [start, end] = result.snippet.highlights[0];

    expect(result.firstMatchOffset).toBe(100);
    expect(result.snippet.text.slice(start, end)).toBe("needle");
    expect(result.snippet.text).toBe(text.slice(100 - 40, 100 + "needle".length + 80));
  });

  it("ranks a title match above a higher text match count", async () => {
    const titled = await createBookRow({ title: "Harbour", authorName: "Author" }, "local");
    advanceClock(10);
    const other = await createBookRow({ title: "Other", authorName: "Author" }, "local");
    const chapter = await seedChapter(other.id, "<p>harbour harbour harbour</p>");

    const found = await search({ query: "harbour" });

    expect(found.results.map((result) => result.ids.itemId)).toEqual([titled.id, chapter.id]);
    expect(found.results[1].matchCount).toBe(3);
  });

  it("ranks a higher match count above a more recent edit", async () => {
    const older = await createBookRow({ title: "One", authorName: "Author" }, "local");
    const olderChapter = await seedChapter(older.id, "<p>harbour harbour harbour</p>");
    advanceClock(10);
    const recent = await createBookRow({ title: "Two", authorName: "Author" }, "local");
    const recentChapter = await seedChapter(recent.id, "<p>harbour</p>");

    const found = await search({ query: "harbour", kinds: ["chapter"] });

    expect(found.results.map((result) => result.ids.itemId)).toEqual([
      olderChapter.id,
      recentChapter.id,
    ]);
  });

  it("ranks equally matching items by the most recently edited", async () => {
    const firstBook = await createBookRow({ title: "One", authorName: "Author" }, "local");
    const first = await seedChapter(firstBook.id, "<p>harbour</p>");
    advanceClock(10);
    const secondBook = await createBookRow({ title: "Two", authorName: "Author" }, "local");
    const second = await seedChapter(secondBook.id, "<p>harbour</p>");

    const found = await search({ query: "harbour", kinds: ["chapter"] });

    expect(found.results.map((result) => result.ids.itemId)).toEqual([second.id, first.id]);
  });

  it("breaks a full tie with the open Book", async () => {
    const open = await createBookRow({ title: "Alpha book", authorName: "Author" }, "local");
    const other = await createBookRow({ title: "Beta book", authorName: "Author" }, "local");
    const openChapter = await seedChapter(open.id, "<p>harbour</p>");
    const otherChapter = await seedChapter(other.id, "<p>harbour</p>");

    const found = await search({ query: "harbour", kinds: ["chapter"], openBookId: open.id });

    expect(found.results.map((result) => result.ids.itemId)).toEqual([
      openChapter.id,
      otherChapter.id,
    ]);
  });
});

describe("searchLibrary filters and paging", () => {
  it("filters by kind", async () => {
    await createBookRow({ title: "Harbour", authorName: "Author" }, "local");
    const note = await createNoteRow({ title: "Note", content: "<p>harbour</p>" }, "local");

    const found = await search({ query: "harbour", kinds: ["note"] });

    expect(found.results.map((result) => result.ids.itemId)).toEqual([note.id]);
  });

  it("filters by Book on both the index and scan paths", async () => {
    const first = await createBookRow(
      { title: "First", subtitle: "A harbour tale", authorName: "Author" },
      "local"
    );
    const second = await createBookRow({ title: "Second", authorName: "Author" }, "local");
    await seedChapter(first.id, "<p>harbour light</p>");
    await seedChapter(second.id, "<p>harbour light</p>");

    const indexedRecorder = recordingAdapter();
    const indexed = resultsOf(
      await searchLibrary(indexedRecorder.db, { query: "harbour", bookId: first.id })
    );
    expect(indexedRecorder.queries.some((sql) => sql.includes("MATCH"))).toBe(true);
    expect(indexed.results.length).toBeGreaterThan(0);
    for (const result of indexed.results) {
      const inBook =
        result.ids.bookId === first.id ||
        (result.kind === "book" && result.ids.itemId === first.id);
      expect(inBook).toBe(true);
    }
    expect(indexed.results.some((result) => result.kind === "book")).toBe(true);
    expect(indexed.results.some((result) => result.kind === "chapter")).toBe(true);

    const scanRecorder = recordingAdapter();
    const scanned = resultsOf(
      await searchLibrary(scanRecorder.db, {
        query: "ha",
        kinds: ["chapter"],
        bookId: first.id,
      })
    );
    expect(scanRecorder.queries.some((sql) => sql.includes("MATCH"))).toBe(false);
    expect(scanned.results).toHaveLength(1);
    expect(scanned.results[0].ids.bookId).toBe(first.id);
  });

  it("pages with a cursor without repeating a result", async () => {
    const notes = [];
    for (let index = 0; index < 5; index += 1) {
      advanceClock(1);
      notes.push(
        await createNoteRow({ title: `Note ${index}`, content: "<p>common word</p>" }, "local")
      );
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await search({ query: "common", kinds: ["note"], limit: 2, cursor });
      seen.push(...page.results.map((result) => result.ids.itemId));
      cursor = page.nextCursor ?? null;
      pages += 1;
    } while (cursor !== null);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect(seen.sort()).toEqual(notes.map((note) => note.id).sort());
  });
});

describe("searchLibrary item kinds", () => {
  it("finds a Book by title, subtitle, and description", async () => {
    const book = await createBookRow(
      {
        title: "Sunrise",
        subtitle: "A quiet harbour",
        description: "Fog lifts over the water",
        authorName: "Author",
      },
      "local"
    );

    for (const query of ["Sunrise", "harbour", "Fog"]) {
      const found = await search({ query, kinds: ["book"] });
      expect(found.results).toHaveLength(1);
      expect(found.results[0].ids.itemId).toBe(book.id);
      expect(found.results[0].title).toBe("Sunrise");
    }
  });

  it("finds a Note", async () => {
    const note = await createNoteRow(
      { title: "Research", content: "<p>A pulled note body</p>" },
      "local"
    );

    const found = await search({ query: "pulled", kinds: ["note"] });

    expect(found.results).toHaveLength(1);
    expect(found.results[0].title).toBe("Research");
    expect(found.results[0].ids.itemId).toBe(note.id);
  });

  it("finds a Canvas card and reports its card id", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    await updateCanvasDocRow(
      canvas.id,
      {
        ...createDefaultCanvasDoc(),
        nodes: [
          { id: "n1", kind: "text", position: { x: 0, y: 0 }, html: "<p>First card text</p>" },
          {
            id: "n2",
            kind: "text",
            position: { x: 1, y: 1 },
            html: "<p>Second card alpha</p>",
          },
        ],
      },
      "local"
    );

    const found = await search({ query: "alpha", kinds: ["canvas"] });

    expect(found.results).toHaveLength(1);
    expect(found.results[0].ids).toEqual({
      itemId: canvas.id,
      bookId: null,
      canvasId: canvas.id,
      cardId: "n2",
    });
    expect(found.results[0].title).toBe("Map");
  });

  it("finds what a synced snapshot wrote", async () => {
    await applyBookSnapshotData(
      {
        book: {
          id: "book-sync",
          title: "Synced Novel",
          subtitle: null,
          authorName: "Author",
          description: null,
          genre: null,
          language: "en",
          coverImagePath: null,
          coverData: null,
          wordCount: 2,
          targetWordCount: null,
          status: "draft",
          createdAt: 1000,
          updatedAt: 2000,
          lastOpenedAt: null,
          lastChapterId: null,
        },
        chapters: [
          {
            id: "chapter-sync",
            bookId: "book-sync",
            title: "Pulled chapter",
            content: "<p>Pulled paragraph</p>",
            synopsis: null,
            order: 0,
            parentId: null,
            chapterType: "chapter",
            wordCount: 2,
            status: "draft",
            isIncludedInExport: true,
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      },
      "remote"
    );

    const found = await search({ query: "Pulled paragraph" });

    expect(found.results).toHaveLength(1);
    expect(found.results[0].kind).toBe("chapter");
    expect(found.results[0].ids.itemId).toBe("chapter-sync");
    expect(found.results[0].ids.bookId).toBe("book-sync");
  });

  it("drops a deleted item", async () => {
    const note = await createNoteRow({ title: "Note", content: "<p>Deleted body</p>" }, "local");
    await expect(search({ query: "Deleted body", kinds: ["note"] })).resolves.toEqual(
      expect.objectContaining({ results: [expect.objectContaining({ matchCount: 1 })] })
    );

    await deleteNoteRow(note.id, "local");

    await expect(search({ query: "Deleted body", kinds: ["note"] })).resolves.toEqual(
      expect.objectContaining({ results: [] })
    );
  });

  it("drops a Book and everything it took with it", async () => {
    const book = await createBookRow({ title: "Gone Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>Gone chapter</p>");
    await deleteBookRow(book.id, "local");

    const found = await search({ query: "Gone" });

    expect(found.results.map((result) => result.ids.itemId)).not.toContain(book.id);
    expect(found.results.map((result) => result.ids.itemId)).not.toContain(chapter.id);
  });

  it("follows an edited item and stops matching the old text", async () => {
    const note = await createNoteRow({ title: "Note", content: "<p>Original words</p>" }, "local");
    expect((await search({ query: "Original", kinds: ["note"] })).results).toHaveLength(1);

    await updateNoteRow({ id: note.id, content: "<p>Rewritten words</p>" }, "local");

    expect((await search({ query: "Original", kinds: ["note"] })).results).toHaveLength(0);
    expect((await search({ query: "Rewritten", kinds: ["note"] })).results).toHaveLength(1);
  });
});

describe("searchLibrary agrees with the shared expression", () => {
  const cases: Array<{
    name: string;
    query: string;
    text: string;
    options: Pick<SearchLibraryOptions, "matchCase" | "wholeWord" | "regex">;
  }> = [
    { name: "literal", query: "cat", text: "The cat sat on the Cat", options: {} },
    {
      name: "Match case",
      query: "Cat",
      text: "The cat sat on the Cat",
      options: { matchCase: true },
    },
    {
      name: "Whole word",
      query: "cat",
      text: "cat category cat",
      options: { wholeWord: true },
    },
    { name: "Regex", query: "[a-z]\\d", text: "a1 b2 c3", options: { regex: true } },
    { name: "accent-insensitive literal", query: "cancion", text: "La canción del faro", options: {} },
    {
      name: "accent-insensitive literal, reversed",
      query: "canción",
      text: "La cancion del faro",
      options: {},
    },
    {
      name: "Match case with accents",
      query: "ELENA",
      text: "Eléna and ELÉNA walked in",
      options: { matchCase: true },
    },
    {
      name: "Whole word with accents",
      query: "cancion",
      text: "cancionero canta la canción",
      options: { wholeWord: true },
    },
    {
      name: "Regex pins the exact accents",
      query: "canci.n",
      text: "La canción del faro",
      options: { regex: true },
    },
    { name: "literal punctuation", query: "a.b", text: "price is $5 (a.b)", options: {} },
    {
      name: "literal after punctuation",
      query: "$5",
      text: "price is $5 (a.b)",
      options: {},
    },
  ];

  it.each(cases)("counts the same matches as Find and Replace: $name", async (testCase) => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, `<p>${testCase.text}</p>`);

    const found = await search({ ...testCase.options, query: testCase.query, kinds: ["chapter"] });
    const expected = countMatches(testCase.text, testCase.query, {
      caseSensitive: testCase.options.matchCase ?? false,
      wholeWord: testCase.options.wholeWord ?? false,
      regex: testCase.options.regex ?? false,
    });

    expect(found.results).toHaveLength(1);
    expect(found.results[0].matchCount).toBe(expected);
  });
});

describe("loading a Database File", () => {
  it("rebuilds the search index from the merged rows", async () => {
    const dump = [
      "-- Maibuk Database Export (SQL Dump)",
      "",
      "-- Books",
      `INSERT OR REPLACE INTO "books" ("id", "title", "author_name", "created_at", "updated_at") VALUES ('book-imported', 'Imported Novel', 'Author', 1000, 1000);`,
      `INSERT OR REPLACE INTO "chapters" ("id", "book_id", "title", "content", "order", "created_at", "updated_at") VALUES ('chapter-imported', 'book-imported', 'Loaded chapter', '<p>Imported body text</p>', 0, 1000, 1000);`,
    ].join("\n");

    await importDatabase(dump);

    const rows = await db.select<{ item_id: string }[]>(
      "SELECT item_id FROM search_text ORDER BY item_id"
    );
    expect(rows.map((row) => row.item_id)).toEqual(["book-imported", "chapter-imported"]);

    const found = await search({ query: "Imported body" });
    expect(found.results).toHaveLength(1);
    expect(found.results[0].ids.itemId).toBe("chapter-imported");
    expect(found.results[0].ids.bookId).toBe("book-imported");
  });
});
