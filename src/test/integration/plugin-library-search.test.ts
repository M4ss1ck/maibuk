import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createDefaultCanvasDoc } from "@/features/canvas/types";
import type { PluginApiOutput } from "@/features/plugins/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { connectLibraryWritePlugin } from "@/test/support/plugin-broker";

// Data-safety integration tests for the Plugin `library.search` read (#641),
// driven through the real broker entry a Plugin calls, over an in-memory
// Library seeded through the product's own write paths. Search reads the
// device-local index those writes keep up to date, the same index the palette
// reads, so this proves what a Plugin sees. Setup mirrors
// `search-library.test.ts`, the search module's own suite over the same
// writes.

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

const { createBookRow } = await import("@/features/books/write");
const { createChapterRow, updateChapterRow } = await import("@/features/chapters/write");
const { createNoteRow } = await import("@/features/notes/write");
const { createCanvasRow, updateCanvasDocRow } = await import("@/features/canvas/write");
const { importDatabase, closeDatabase } = await import("@/lib/db");
const { awaitSearchIndexRebuild, resetSearchIndexForTests } = await import(
  "@/features/search/rebuild"
);

void importDatabase;

let testDb: DatabaseAdapter;

type SearchSuccess = Extract<PluginApiOutput<"library.search">, { results: unknown }>;
type SearchResult = SearchSuccess["results"][number];

function resultsOf(result: PluginApiOutput<"library.search">): asserts result is SearchSuccess {
  if ("error" in result) throw new Error(`unexpected search error: ${result.message}`);
}

async function seedChapter(bookId: string, content: string, title = "Chapter") {
  const chapter = await createChapterRow({ bookId, title }, "local");
  await updateChapterRow(chapter.id, { content }, "local");
  return chapter;
}

beforeEach(async () => {
  vi.stubGlobal("Worker", undefined);
  await closeDatabase();
  testDb = await createTestDatabase();
  mockGetDatabase.mockReset();
  mockGetDatabase.mockResolvedValue(testDb);
  mockExportDatabase.mockReset();
  mockExportDatabase.mockImplementation(() => testDb.exportData());
  mockCreateDatabase.mockReset();
  mockCreateDatabase.mockResolvedValue(testDb);
  resetSearchIndexForTests();
});

afterEach(async () => {
  await awaitSearchIndexRebuild();
  resetSearchIndexForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("library.search through the broker (#641)", () => {
  it("returns one row per item with snippets, counts, and offsets", async () => {
    const book = await createBookRow({ title: "Harbour Light", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>harbour harbour</p><p>harbour once more</p>");
    const note = await createNoteRow(
      { title: "Research", content: "<p>A pulled harbour note</p>" },
      "local"
    );

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      const result = await client.library.search({ query: "harbour" });
      resultsOf(result);

      expect(result.results.map((row) => row.kind).sort()).toEqual(["book", "chapter", "note"]);

      const chapterRow = result.results.find((row) => row.kind === "chapter");
      if (chapterRow?.kind !== "chapter") throw new Error("expected a chapter row");
      expect(chapterRow.chapterId).toBe(chapter.id);
      expect(chapterRow.bookId).toBe(book.id);
      expect(chapterRow.matchCount).toBe(3);
      expect(chapterRow.firstMatchOffset).toBeGreaterThanOrEqual(0);
      expect(chapterRow.snippet.text.toLowerCase()).toContain("harbour");
      const [highlight] = chapterRow.snippet.highlights;
      expect(chapterRow.snippet.text.slice(highlight.from, highlight.to).toLowerCase()).toBe(
        "harbour"
      );

      const bookRow = result.results.find((row) => row.kind === "book");
      if (bookRow?.kind !== "book") throw new Error("expected a book row");
      expect(bookRow.bookId).toBe(book.id);
      expect(bookRow.title).toBe("Harbour Light");

      const noteRow = result.results.find((row) => row.kind === "note");
      if (noteRow?.kind !== "note") throw new Error("expected a note row");
      expect(noteRow.noteId).toBe(note.id);
      expect(noteRow.bookId).toBeNull();
    } finally {
      close();
    }
  });

  it("returns references the matching get calls accept", async () => {
    const book = await createBookRow({ title: "Atlas", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>Cartography notes</p>", "Maps");
    const note = await createNoteRow(
      { title: "Margin", bookId: book.id, content: "<p>Cartography margin</p>" },
      "local"
    );
    const canvas = await createCanvasRow({ title: "Board" }, "local");
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
            html: "<p>Second card cartography</p>",
          },
        ],
      },
      "local"
    );

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      const result = await client.library.search({ query: "cartography" });
      resultsOf(result);
      expect(result.results).toHaveLength(3);

      for (const row of result.results) {
        if (row.kind === "chapter") {
          const read = await client.library.chapters.get({ chapterId: row.chapterId });
          expect(read?.title).toBe("Maps");
          expect(read?.bookId).toBe(row.bookId);
        } else if (row.kind === "note") {
          const read = await client.library.notes.get({ noteId: row.noteId });
          expect(read?.title).toBe("Margin");
        } else if (row.kind === "canvas") {
          expect(row.canvasId).toBe(canvas.id);
          expect(row.cardId).toBe("n2");
          const read = await client.library.canvases.get({ canvasId: row.canvasId });
          expect(read?.title).toBe("Board");
        } else {
          throw new Error(`unexpected row kind ${(row as SearchResult).kind}`);
        }
      }

      const bookResult = await client.library.search({ query: "Atlas", kinds: ["book"] });
      resultsOf(bookResult);
      expect(bookResult.results).toHaveLength(1);
      const [only] = bookResult.results;
      if (only.kind !== "book") throw new Error("expected a book row");
      const read = await client.library.books.get({ bookId: only.bookId });
      expect(read?.id).toBe(book.id);
      expect(chapter.id).toBeDefined();
      expect(note.id).toBeDefined();
    } finally {
      close();
    }
  });

  it("applies Match case, Whole word, and Regex", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>The cat sat on the Cat</p>", "Case");
    await seedChapter(book.id, "<p>cat category cat</p>", "Whole");
    await seedChapter(book.id, "<p>a1 b2 c3</p>", "Pattern");

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      const sensitive = await client.library.search({
        query: "CAT",
        matchCase: true,
        kinds: ["chapter"],
      });
      resultsOf(sensitive);
      expect(sensitive.results).toEqual([]);

      const insensitive = await client.library.search({ query: "CAT", kinds: ["chapter"] });
      resultsOf(insensitive);
      const caseRow = insensitive.results.find((row) => row.title === "Case");
      expect(caseRow?.matchCount).toBe(2);

      const whole = await client.library.search({
        query: "cat",
        wholeWord: true,
        kinds: ["chapter"],
      });
      resultsOf(whole);
      const wholeRow = whole.results.find((row) => row.title === "Whole");
      expect(wholeRow?.matchCount).toBe(2);

      const regex = await client.library.search({
        query: "[a-z]\\d",
        regex: true,
        kinds: ["chapter"],
      });
      resultsOf(regex);
      expect(regex.results).toHaveLength(1);
      expect(regex.results[0].matchCount).toBe(3);
    } finally {
      close();
    }
  });

  it("filters by kinds and by Book, and a Book filter never returns a Canvas", async () => {
    const first = await createBookRow(
      { title: "First", subtitle: "A shared harbour tale", authorName: "Author" },
      "local"
    );
    const second = await createBookRow({ title: "Second", authorName: "Author" }, "local");
    await seedChapter(first.id, "<p>shared harbour</p>");
    await seedChapter(second.id, "<p>shared harbour</p>");
    await createNoteRow({ title: "Unfiled", content: "<p>shared harbour</p>" }, "local");
    const canvas = await createCanvasRow({ title: "Board" }, "local");
    await updateCanvasDocRow(
      canvas.id,
      {
        ...createDefaultCanvasDoc(),
        nodes: [
          { id: "n1", kind: "text", position: { x: 0, y: 0 }, html: "<p>shared harbour</p>" },
        ],
      },
      "local"
    );

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      const notes = await client.library.search({ query: "shared", kinds: ["note"] });
      resultsOf(notes);
      expect(notes.results.map((row) => row.kind)).toEqual(["note"]);

      const filtered = await client.library.search({ query: "shared", bookId: first.id });
      resultsOf(filtered);
      expect(filtered.results.length).toBeGreaterThan(0);
      for (const row of filtered.results) {
        if (row.kind === "book") expect(row.bookId).toBe(first.id);
        else if (row.kind === "chapter" || row.kind === "note") expect(row.bookId).toBe(first.id);
        else throw new Error("a bookId filter never returns a Canvas");
      }
      expect(filtered.results.some((row) => row.kind === "book")).toBe(true);
      expect(filtered.results.some((row) => row.kind === "chapter")).toBe(true);
    } finally {
      close();
    }
  });

  it("pages with a cursor without repeating a result", async () => {
    for (let index = 0; index < 5; index += 1) {
      await createNoteRow({ title: `Note ${index}`, content: "<p>common word</p>" }, "local");
    }

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await client.library.search({
          query: "common",
          kinds: ["note"],
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        });
        resultsOf(page);
        for (const row of page.results) {
          if (row.kind !== "note") throw new Error("expected only notes");
          seen.push(row.noteId);
        }
        pages += 1;
        if (page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }

      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(5);
    } finally {
      close();
    }
  });

  it("pages a Book filter without losing a hit", async () => {
    const first = await createBookRow({ title: "First", authorName: "Author" }, "local");
    const second = await createBookRow({ title: "Second", authorName: "Author" }, "local");
    for (let index = 0; index < 3; index += 1) {
      await createNoteRow(
        { title: `First ${index}`, bookId: first.id, content: "<p>filtered common</p>" },
        "local"
      );
    }
    for (let index = 0; index < 2; index += 1) {
      await createNoteRow(
        { title: `Second ${index}`, bookId: second.id, content: "<p>filtered common</p>" },
        "local"
      );
    }

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await client.library.search({
          query: "filtered",
          bookId: first.id,
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        });
        resultsOf(page);
        for (const row of page.results) {
          if (row.kind !== "note") throw new Error("expected only notes");
          expect(row.bookId).toBe(first.id);
          seen.push(row.noteId);
        }
        if (page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(3);
    } finally {
      close();
    }
  });

  it("pages a Book filter with limit 1 without duplicates", async () => {
    const first = await createBookRow({ title: "First", authorName: "Author" }, "local");
    const second = await createBookRow({ title: "Second", authorName: "Author" }, "local");
    for (let index = 0; index < 3; index += 1) {
      await createNoteRow(
        { title: `First ${index}`, bookId: first.id, content: "<p>paged common</p>" },
        "local"
      );
    }
    for (let index = 0; index < 2; index += 1) {
      await createNoteRow(
        { title: `Second ${index}`, bookId: second.id, content: "<p>paged common</p>" },
        "local"
      );
    }

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await client.library.search({
          query: "paged",
          bookId: first.id,
          limit: 1,
          ...(cursor === undefined ? {} : { cursor }),
        });
        resultsOf(page);
        expect(page.results.length).toBeLessThanOrEqual(1);
        for (const row of page.results) {
          if (row.kind !== "note") throw new Error("expected only notes");
          expect(row.bookId).toBe(first.id);
          seen.push(row.noteId);
        }
        if (page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(3);
    } finally {
      close();
    }
  });

  it("refuses without the read-Library Plugin Permission, like the other reads", async () => {
    const { client, close } = connectLibraryWritePlugin({ granted: [] });
    try {
      await expect(client.library.search({ query: "harbour" })).rejects.toMatchObject({
        name: "PluginApiError",
        code: "permission-denied",
        permission: "library:read",
      });
    } finally {
      close();
    }
  });

  it("rejects invalid input shapes with invalid-params", async () => {
    await createBookRow({ title: "Novel", authorName: "Author" }, "local");

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      await expect(client.library.search({ query: "x", limit: 0 })).rejects.toMatchObject({
        code: "invalid-params",
      });
      await expect(client.library.search({ query: "x", limit: 51 })).rejects.toMatchObject({
        code: "invalid-params",
      });
      await expect(client.library.search({ query: "" })).rejects.toMatchObject({
        code: "invalid-params",
      });
      await expect(
        client.library.search({ query: 42 } as unknown as { query: string })
      ).rejects.toMatchObject({ code: "invalid-params" });
      await expect(
        client.library.search({ query: "x", surprise: true } as unknown as { query: string })
      ).rejects.toMatchObject({ code: "invalid-params" });
      await expect(
        client.library.search({ query: "x", kinds: ["poem"] } as unknown as { query: string })
      ).rejects.toMatchObject({ code: "invalid-params" });
      await expect(client.library.search({ query: "x", kinds: [] })).rejects.toMatchObject({
        code: "invalid-params",
      });
      await expect(client.library.search({ query: "x", cursor: "" })).rejects.toMatchObject({
        code: "invalid-params",
      });
    } finally {
      close();
    }
  });

  it("returns an invalid Regex as an error result and never throws", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>plain text</p>");

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      const result = await client.library.search({ query: "[unclosed", regex: true });
      expect(result).toMatchObject({ error: "invalid-regex" });
      if (!("message" in result) || result.message.length === 0) {
        throw new Error("expected a message with the invalid-regex error");
      }
    } finally {
      close();
    }
  });
});
