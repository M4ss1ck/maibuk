import { describe, expect, it } from "vitest";
import { migrateBooksContentUpdatedAt } from "@/lib/db";
import { createMemoryDatabase } from "@/lib/db/memory-database";

describe("books content_updated_at migration", () => {
  it("adds the column and backfills existing rows from updated_at", async () => {
    const db = await createMemoryDatabase();
    try {
      await db.execute(
        `CREATE TABLE books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`
      );
      await db.execute(
        `INSERT INTO books (id, title, author_name, created_at, updated_at)
         VALUES ('legacy', 'Legacy', 'Author', 1000, 2000)`
      );

      await migrateBooksContentUpdatedAt(db);

      const columns = await db.select<{ name: string }[]>("PRAGMA table_info(books)");
      expect(columns.map((c) => c.name)).toContain("content_updated_at");

      const rows = await db.select<{ content_updated_at: number }[]>(
        "SELECT content_updated_at FROM books WHERE id = 'legacy'"
      );
      expect(rows[0].content_updated_at).toBe(2000);
    } finally {
      await db.close();
    }
  });

  it("keeps existing values and is safe to run twice", async () => {
    const db = await createMemoryDatabase();
    try {
      await db.execute(
        `CREATE TABLE books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          content_updated_at INTEGER
        )`
      );
      await db.execute(
        `INSERT INTO books (id, title, author_name, created_at, updated_at, content_updated_at)
         VALUES ('kept', 'Kept', 'Author', 1000, 2000, 500)`
      );

      await migrateBooksContentUpdatedAt(db);
      await migrateBooksContentUpdatedAt(db);

      const rows = await db.select<{ content_updated_at: number }[]>(
        "SELECT content_updated_at FROM books WHERE id = 'kept'"
      );
      expect(rows[0].content_updated_at).toBe(500);
    } finally {
      await db.close();
    }
  });
});
