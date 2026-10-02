import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

const { listChapterTitles } = await import("@/features/chapters/store");

async function seedBook(db: DatabaseAdapter, bookId: string) {
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [bookId, `Book ${bookId}`, "Author", now, now]
  );
}

async function seedChapter(
  db: DatabaseAdapter,
  id: string,
  bookId: string,
  order: number,
  content: string | null
) {
  await db.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, bookId, `Chapter ${order}`, content, order, 1, 2]
  );
}

describe("listChapterTitles()", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await seedBook(testDb, "book-b");
    await seedBook(testDb, "book-a");
    await seedChapter(testDb, "ch-a2", "book-a", 1, "<p>Second</p>");
    await seedChapter(testDb, "ch-a1", "book-a", 0, "<p>First</p>");
    await seedChapter(testDb, "ch-b1", "book-b", 0, null);
  });

  it("returns every Chapter across Books, with its Book and title", async () => {
    const rows = await listChapterTitles();

    expect(rows.map((row) => row.id)).toEqual(["ch-a1", "ch-a2", "ch-b1"]);
    expect(rows.find((row) => row.id === "ch-b1")).toEqual({
      id: "ch-b1",
      bookId: "book-b",
      title: "Chapter 0",
    });
  });

  it("orders by Book, then by the Book's own Chapter order", async () => {
    const rows = await listChapterTitles();

    expect(rows.map((row) => [row.bookId, row.id])).toEqual([
      ["book-a", "ch-a1"],
      ["book-a", "ch-a2"],
      ["book-b", "ch-b1"],
    ]);
  });

  it("reads no content column, so the palette never loads Chapter text", async () => {
    const rows = await listChapterTitles();

    expect(rows.every((row) => !("content" in row))).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(["bookId", "id", "title"]);
  });

  it("returns nothing for an empty Library", async () => {
    await testDb.execute("DELETE FROM chapters");

    expect(await listChapterTitles()).toEqual([]);
  });
});
