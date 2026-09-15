import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { onChange, resetChangeFeedForTests, type Change } from "@/features/sync/change-feed";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

const { useBookStore } = await import("@/features/books/store");
const { updateBookRow } = await import("@/features/books/write");

async function seedBook(id: string, updatedAt = 1000): Promise<void> {
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, "Seeded", "Author", updatedAt, updatedAt, updatedAt]
  );
}

async function readBookRow(id: string): Promise<Record<string, unknown>> {
  const rows = await testDb.select<Record<string, unknown>[]>(
    "SELECT * FROM books WHERE id = ?",
    [id]
  );
  return rows[0];
}

describe("book write path", () => {
  let changes: Change[];

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);
    resetChangeFeedForTests();
    changes = [];
    onChange((change) => {
      changes.push(change);
    });
    useBookStore.setState({ books: [], currentBook: null, isLoading: false, error: null });
  });

  afterEach(() => {
    resetChangeFeedForTests();
  });

  it("creates a book as a local content change with Last Edited set", async () => {
    const book = await useBookStore.getState().createBook({ title: "New", authorName: "Me" });

    expect(changes).toEqual([{ entity: "book", id: book.id, origin: "local", kind: "content" }]);
    expect(book.contentUpdatedAt.getTime()).toBe(book.updatedAt.getTime());
    const row = await readBookRow(book.id);
    expect(row.content_updated_at).toBe(row.updated_at);
  });

  it("advances Last Edited on a title change", async () => {
    await seedBook("b1");
    const before = await readBookRow("b1");

    await useBookStore.getState().updateBook("b1", { title: "Renamed" });

    const after = await readBookRow("b1");
    expect(after.content_updated_at).toBeGreaterThan(before.content_updated_at as number);
    expect(changes).toEqual([{ entity: "book", id: "b1", origin: "local", kind: "content" }]);
  });

  it("treats subtitle, description, and cover changes as content", async () => {
    await seedBook("b1");

    await useBookStore.getState().updateBook("b1", { subtitle: "Sub" });
    await useBookStore.getState().updateBook("b1", { description: "Desc" });
    await useBookStore.getState().updateBook("b1", { coverData: "{}" });

    expect(changes.map((c) => c.kind)).toEqual(["content", "content", "content"]);
  });

  it("treats a status change as metadata and leaves Last Edited alone", async () => {
    await seedBook("b1");
    const before = await readBookRow("b1");

    await useBookStore.getState().updateBook("b1", { status: "archived" });

    const after = await readBookRow("b1");
    expect(after.status).toBe("archived");
    // updated_at is the sync clock and still bumps.
    expect(after.updated_at).toBeGreaterThanOrEqual(before.updated_at as number);
    expect(after.content_updated_at).toBe(before.content_updated_at);
    expect(changes).toEqual([{ entity: "book", id: "b1", origin: "local", kind: "metadata" }]);
  });

  it("does not advance Last Edited on an equal-content update", async () => {
    await seedBook("b1");
    const before = await readBookRow("b1");

    await useBookStore.getState().updateBook("b1", { title: "Seeded" });

    const after = await readBookRow("b1");
    expect(after.content_updated_at).toBe(before.content_updated_at);
    expect(changes).toEqual([{ entity: "book", id: "b1", origin: "local", kind: "metadata" }]);
  });

  it("returns the stored book even when it is not loaded in the store", async () => {
    await seedBook("b1");

    const stored = await updateBookRow("b1", { title: "Stored" }, "local");

    expect(stored?.title).toBe("Stored");
    expect(useBookStore.getState().books).toEqual([]);
  });

  it("returns null when the book no longer exists, emitting nothing", async () => {
    const stored = await updateBookRow("missing", { title: "x" }, "local");

    expect(stored).toBeNull();
    expect(changes).toEqual([]);
  });

  it("keeps derived word-count updates from moving Last Edited or emitting", async () => {
    await seedBook("b1");
    const before = await readBookRow("b1");

    await useBookStore.getState().updateWordCount("b1", 5000);

    const after = await readBookRow("b1");
    expect(after.word_count).toBe(5000);
    expect(after.content_updated_at).toBe(before.content_updated_at);
    expect(changes).toEqual([]);
    expect(useBookStore.getState().books).toEqual([]);
  });

  it("records a tombstone and emits a local content change on delete", async () => {
    await seedBook("b1");

    await useBookStore.getState().deleteBook("b1");

    const tombstones = await testDb.select<{ entity_id: string }[]>(
      "SELECT entity_id FROM sync_tombstones WHERE entity_type = 'book'"
    );
    expect(tombstones.map((t) => t.entity_id)).toEqual(["b1"]);
    expect(changes).toEqual([{ entity: "book", id: "b1", origin: "local", kind: "content" }]);
  });

  it("emits nothing when the write fails before persistence", async () => {
    mockGetDatabase.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      useBookStore.getState().createBook({ title: "Lost", authorName: "Me" })
    ).rejects.toThrow("disk full");
    expect(changes).toEqual([]);
  });

  it("falls back to updatedAt for rows from before the column existed", async () => {
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at, content_updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["legacy", "Legacy", "Author", 1000, 2000, null]
    );

    await useBookStore.getState().loadBook("legacy");

    expect(useBookStore.getState().currentBook?.contentUpdatedAt).toEqual(new Date(2000 * 1000));
  });

  it("lets listeners see the durable row, not a pending write", async () => {
    await seedBook("b1");
    let seenTitle: unknown = null;
    onChange(async () => {
      seenTitle = (await readBookRow("b1")).title;
    });

    await useBookStore.getState().updateBook("b1", { title: "Durable" });

    expect(seenTitle).toBe("Durable");
  });

  it("still emits when the post-write read-back fails", async () => {
    await seedBook("b1");
    const realDb = testDb;
    let selects = 0;
    mockGetDatabase.mockResolvedValue({
      ...realDb,
      execute: realDb.execute.bind(realDb),
      select: async <T>(sql: string, params?: unknown[]): Promise<T> => {
        selects++;
        // Existing-row read succeeds; the post-write read-back fails after
        // the durable write.
        if (selects > 1) throw new Error("read failed");
        return realDb.select<T>(sql, params);
      },
    } as DatabaseAdapter);

    const stored = await updateBookRow("b1", { title: "Durable" }, "local");

    expect(stored?.title).toBe("Durable");
    expect(changes).toEqual([{ entity: "book", id: "b1", origin: "local", kind: "content" }]);
  });
});
