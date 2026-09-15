import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { onChange, resetChangeFeedForTests, type Change } from "@/features/sync/change-feed";

let testDb: DatabaseAdapter;

const { mockGetDatabase, mockReindex } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockReindex: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../features/links/link-index", () => ({
  reindexSource: mockReindex,
}));

const { useChapterStore } = await import("@/features/chapters/store");
const { updateChapterRow } = await import("@/features/chapters/write");

async function seedBook(id: string, updatedAt = 1000): Promise<void> {
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, "Book", "Author", updatedAt, updatedAt, updatedAt]
  );
}

async function seedChapter(id: string, bookId: string, order = 0, content = "<p>Body</p>") {
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, bookId, `Title ${id}`, content, order, "chapter", 1, "draft", 1, 1000, 1000]
  );
}

async function readBookStamps(
  id: string
): Promise<{ updated_at: number; content_updated_at: number }> {
  const rows = await testDb.select<{ updated_at: number; content_updated_at: number }[]>(
    "SELECT updated_at, content_updated_at FROM books WHERE id = ?",
    [id]
  );
  return rows[0];
}

describe("chapter write path", () => {
  let changes: Change[];

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);
    mockReindex.mockReset().mockResolvedValue(undefined);
    resetChangeFeedForTests();
    changes = [];
    onChange((change) => {
      changes.push(change);
    });
    await seedBook("book-1");
    useChapterStore.setState({
      chapters: [],
      currentChapter: null,
      currentBookId: null,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    resetChangeFeedForTests();
  });

  it("emits the containing book for a chapter text change and advances its Last Edited", async () => {
    await seedChapter("ch-1", "book-1");
    const before = await readBookStamps("book-1");

    await useChapterStore.getState().updateChapter("ch-1", { content: "<p>Edited</p>" });

    const after = await readBookStamps("book-1");
    expect(after.content_updated_at).toBeGreaterThan(before.content_updated_at);
    expect(changes).toEqual([{ entity: "book", id: "book-1", origin: "local", kind: "content" }]);
  });

  it("returns normalized stored content even when the chapter is not loaded", async () => {
    await seedChapter("ch-1", "book-1");

    const stored = await updateChapterRow(
      "ch-1",
      { content: "<h2>Heading</h2><p>Body</p>" },
      "local"
    );

    expect(stored?.content).toMatch(/<h2 id="[^"]+">Heading<\/h2>/);
    expect(useChapterStore.getState().chapters).toEqual([]);
    expect(changes).toEqual([{ entity: "book", id: "book-1", origin: "local", kind: "content" }]);
  });

  it("treats a status change as metadata and leaves the book's Last Edited alone", async () => {
    await seedChapter("ch-1", "book-1");
    const before = await readBookStamps("book-1");

    await useChapterStore.getState().updateChapter("ch-1", { status: "final" });

    const after = await readBookStamps("book-1");
    expect(after.content_updated_at).toBe(before.content_updated_at);
    expect(changes).toEqual([{ entity: "book", id: "book-1", origin: "local", kind: "metadata" }]);
  });

  it("does not advance the book's Last Edited on an equal-content update", async () => {
    await seedChapter("ch-1", "book-1", 0, "<p>Same</p>");
    const before = await readBookStamps("book-1");

    await useChapterStore.getState().updateChapter("ch-1", { content: "<p>Same</p>" });

    const after = await readBookStamps("book-1");
    expect(after.content_updated_at).toBe(before.content_updated_at);
  });

  it("emits metadata for a reorder", async () => {
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);
    const before = await readBookStamps("book-1");

    await useChapterStore.getState().reorderChapters("book-1", ["ch-2", "ch-1"]);

    const after = await readBookStamps("book-1");
    expect(after.content_updated_at).toBe(before.content_updated_at);
    expect(changes).toEqual([{ entity: "book", id: "book-1", origin: "local", kind: "metadata" }]);
  });

  it("still notifies for persisted rows when a reorder partially fails", async () => {
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);
    // Fail the second statement: the first row already persisted and its
    // notification must not be lost with the failure.
    const realDb = testDb;
    let calls = 0;
    mockGetDatabase.mockResolvedValue({
      ...realDb,
      execute: async (sql: string, params?: unknown[]) => {
        calls++;
        if (calls > 1) throw new Error("disk full");
        return realDb.execute(sql, params);
      },
      select: realDb.select.bind(realDb),
    } as DatabaseAdapter);

    await expect(
      useChapterStore.getState().reorderChapters("book-1", ["ch-1", "ch-2"])
    ).rejects.toThrow("Failed to reorder chapter 2/2");
    expect(changes).toEqual([{ entity: "book", id: "book-1", origin: "local", kind: "metadata" }]);
  });

  it("emits nothing when the write fails before persistence", async () => {
    mockGetDatabase.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      useChapterStore.getState().createChapter({ bookId: "book-1", title: "Lost" })
    ).rejects.toThrow("disk full");
    expect(changes).toEqual([]);
  });

  it("advances the book's Last Edited when a chapter is deleted", async () => {
    const created = await useChapterStore.getState().createChapter({
      bookId: "book-1",
      title: "Gone",
    });
    changes.length = 0;
    const before = await readBookStamps("book-1");

    await useChapterStore.getState().deleteChapter(created.id);

    const after = await readBookStamps("book-1");
    expect(after.content_updated_at).toBeGreaterThanOrEqual(before.content_updated_at);
    expect(changes).toEqual([{ entity: "book", id: "book-1", origin: "local", kind: "content" }]);
  });

  it("emits nothing when a reorder persists zero rows", async () => {
    await seedChapter("ch-1", "book-1", 0);

    await useChapterStore.getState().reorderChapters("book-1", ["ghost-1", "ghost-2"]);

    expect(changes).toEqual([]);
    const rows = await testDb.select<{ order: number }[]>(
      'SELECT "order" FROM chapters WHERE id = ?',
      ["ch-1"]
    );
    expect(rows[0].order).toBe(0);
  });

  it("scopes a reorder to its book and leaves other books untouched", async () => {
    await seedBook("book-2");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-2", 0);
    changes.length = 0;

    await useChapterStore.getState().reorderChapters("book-1", ["ch-2"]);

    const foreign = await testDb.select<{ order: number }[]>(
      'SELECT "order" FROM chapters WHERE id = ?',
      ["ch-2"]
    );
    expect(foreign[0].order).toBe(0);
    // Nothing in book-1 persisted either, so nothing is announced.
    expect(changes).toEqual([]);
  });

  it("returns each concurrent save's own normalized content", async () => {
    await seedChapter("ch-1", "book-1", 0, "<p>Start</p>");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockReindex.mockImplementation(() => gate);

    const saveA = updateChapterRow("ch-1", { content: "<p>Alpha</p>" }, "local");
    // Park A inside its deferred indexing, after it captured its own read.
    await vi.waitFor(() => expect(mockReindex).toHaveBeenCalledTimes(1));
    // B persists fully while A is parked, then parks itself.
    const saveB = updateChapterRow("ch-1", { content: "<p>Beta</p>" }, "local");
    await vi.waitFor(() => expect(mockReindex).toHaveBeenCalledTimes(2));
    release();
    const [a, b] = await Promise.all([saveA, saveB]);

    expect(a?.content).toBe("<p>Alpha</p>");
    expect(b?.content).toBe("<p>Beta</p>");
  });

  it("keeps the chapter signal when the parent touch fails, and a retry repairs Last Edited", async () => {
    await seedChapter("ch-1", "book-1", 0, "<p>Start</p>");
    const realDb = testDb;
    mockGetDatabase.mockResolvedValue({
      ...realDb,
      execute: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith("UPDATE books")) throw new Error("disk full");
        return realDb.execute(sql, params);
      },
      select: realDb.select.bind(realDb),
    } as DatabaseAdapter);

    await expect(
      updateChapterRow("ch-1", { content: "<p>Edited</p>" }, "local")
    ).rejects.toThrow("disk full");
    // The chapter row persisted, so its notification stands.
    expect(changes).toEqual([{ entity: "book", id: "book-1", origin: "local", kind: "content" }]);
    const persisted = await realDb.select<{ content: string }[]>(
      "SELECT content FROM chapters WHERE id = ?",
      ["ch-1"]
    );
    expect(persisted[0].content).toBe("<p>Edited</p>");
    expect((await readBookStamps("book-1")).content_updated_at).toBe(1000);

    // Retry the same content with a healthy database: equal content reads as
    // metadata, yet the stale parent stamp is repaired.
    mockGetDatabase.mockResolvedValue(realDb);
    changes.length = 0;
    const repaired = await updateChapterRow("ch-1", { content: "<p>Edited</p>" }, "local");

    expect(repaired?.content).toBe("<p>Edited</p>");
    expect((await readBookStamps("book-1")).content_updated_at).toBeGreaterThan(1000);
    expect(changes).toEqual([{ entity: "book", id: "book-1", origin: "local", kind: "metadata" }]);
  });

  it("still emits when the post-write read-back fails", async () => {
    await seedChapter("ch-1", "book-1", 0, "<p>Start</p>");
    const realDb = testDb;
    let selects = 0;
    mockGetDatabase.mockResolvedValue({
      ...realDb,
      execute: realDb.execute.bind(realDb),
      select: async <T>(sql: string, params?: unknown[]): Promise<T> => {
        selects++;
        // Existing-row read and parent-stamp read succeed; the post-write
        // read-back fails after the durable write.
        if (selects > 2) throw new Error("read failed");
        return realDb.select<T>(sql, params);
      },
    } as DatabaseAdapter);

    const stored = await updateChapterRow("ch-1", { content: "<p>Durable</p>" }, "local");

    expect(stored?.content).toBe("<p>Durable</p>");
    expect(changes).toEqual([{ entity: "book", id: "book-1", origin: "local", kind: "content" }]);
  });
});
