import { describe, expect, it } from "vitest";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { migrateBooksContentUpdatedAt } from "@/lib/db";

function adapterFor(db: SqlJsDatabase) {
  return {
    execute: async (sql: string, params?: unknown[]) => {
      db.run(sql, params as (string | number | null)[]);
      return { rowsAffected: db.getRowsModified() };
    },
  };
}

describe("books content_updated_at migration", () => {
  it("adds the column and backfills existing rows from updated_at", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    try {
      db.run(
        `CREATE TABLE books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`
      );
      db.run(
        `INSERT INTO books (id, title, author_name, created_at, updated_at)
         VALUES ('legacy', 'Legacy', 'Author', 1000, 2000)`
      );

      await migrateBooksContentUpdatedAt(adapterFor(db));

      const columns: { name: string }[] = [];
      const stmt = db.prepare("PRAGMA table_info(books)");
      while (stmt.step()) columns.push(stmt.getAsObject() as { name: string });
      stmt.free();
      expect(columns.map((c) => c.name)).toContain("content_updated_at");

      const row = db.exec("SELECT content_updated_at FROM books WHERE id = 'legacy'");
      expect(row[0].values[0][0]).toBe(2000);
    } finally {
      db.close();
    }
  });

  it("keeps existing values and is safe to run twice", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    try {
      db.run(
        `CREATE TABLE books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          author_name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          content_updated_at INTEGER
        )`
      );
      db.run(
        `INSERT INTO books (id, title, author_name, created_at, updated_at, content_updated_at)
         VALUES ('kept', 'Kept', 'Author', 1000, 2000, 500)`
      );

      await migrateBooksContentUpdatedAt(adapterFor(db));
      await migrateBooksContentUpdatedAt(adapterFor(db));

      const row = db.exec("SELECT content_updated_at FROM books WHERE id = 'kept'");
      expect(row[0].values[0][0]).toBe(500);
    } finally {
      db.close();
    }
  });
});
