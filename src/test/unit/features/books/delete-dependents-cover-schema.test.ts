// Deleting a Book or a Chapter has to remove its dependents by hand: the web
// leaves foreign_keys off, and `links` has no foreign key at all, so no
// cascade runs there. A table that joins the schema with a `book_id` (or a
// `chapter_id`) column and misses those hand-written deletes leaves orphan
// rows behind on the web only, which no other test notices. This guard reads
// the schema the Library is created with and holds both delete lists to it.
import { describe, expect, it } from "vitest";
import type { AtomicStatement, DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { bookDependentDeletes } from "@/features/books/write";
import { chapterDependentDeletes } from "@/features/chapters/write";

/**
 * Tables that point at a Book without being deleted with it. Every entry says
 * why it must survive; anything missing here must be deleted by
 * `bookDependentDeletes`.
 */
const BOOK_ID_TABLES_THAT_SURVIVE: Record<string, string> = {
  books: "the Book itself: it has no book_id, and its own row goes last",
  version_tombstones: "pending remote Version deletes must survive the Book",
  notes: "a Note outlives its Book",
  links: "deleted through its source_id subquery (its column is source_book_id, not book_id)",
};

/**
 * Tables that name a Chapter but are not deleted with it. Only the Version
 * manifest qualifies: it belongs to a Version, not to the live Chapter, and
 * SWEEP_VERSION_CONTENT removes what no Version references.
 */
const CHAPTER_ID_TABLES_THAT_SURVIVE: Record<string, string> = {
  book_version_chapters: "a Version's manifest: swept by SWEEP_VERSION_CONTENT, not by the delete",
};

/** Every table the Library creates with a column named `column`. */
async function tablesWithColumn(db: DatabaseAdapter, column: string): Promise<string[]> {
  const tables = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const matching: string[] = [];
  for (const { name } of tables) {
    const columns = await db.select<{ name: string }[]>(`PRAGMA table_info(${name})`);
    if (columns.some((entry) => entry.name === column)) matching.push(name);
  }
  return matching;
}

/** Whether a delete list removes every row of `table`. */
function deletesTable(statements: readonly AtomicStatement[], table: string): boolean {
  return statements.some((statement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    return new RegExp(`DELETE FROM ${table}\\b`).test(sql);
  });
}

describe("Book and Chapter delete coverage of the schema", () => {
  it("deletes every table that carries a book_id", async () => {
    const db = await createTestDatabase();
    const tables = await tablesWithColumn(db, "book_id");
    // A guard over an empty list would always pass.
    expect(tables).toContain("chapters");

    const statements = bookDependentDeletes("book-1");
    const uncovered = tables.filter(
      (table) =>
        BOOK_ID_TABLES_THAT_SURVIVE[table] === undefined && !deletesTable(statements, table)
    );

    expect(uncovered).toEqual([]);
  });

  it("deletes every table that carries a chapter_id", async () => {
    const db = await createTestDatabase();
    const tables = await tablesWithColumn(db, "chapter_id");
    expect(tables).toContain("chapter_epub_meta");

    const statements = chapterDependentDeletes("?", ["x"]);
    const uncovered = tables.filter(
      (table) =>
        CHAPTER_ID_TABLES_THAT_SURVIVE[table] === undefined && !deletesTable(statements, table)
    );

    expect(uncovered).toEqual([]);
  });
});
