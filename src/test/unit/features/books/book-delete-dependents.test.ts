// Deleting a Book has to remove every row that hangs off it by hand: the web
// (sql.js) leaves foreign_keys off, and `links` has no foreign key at all, so
// neither the Chapters nor their dependents cascade there. Both modes are
// covered so the delete stays correct on desktop (cascade on) and web
// (cascade off).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { resetChangeFeedForTests } from "@/features/sync/change-feed";

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

const { deleteBookRow, removeBookRow } = await import("@/features/books/write");

const DELETED = "book-deleted";
const KEPT = "book-kept";

/** Every secondary table holds exactly one row for a seeded Book. */
const ONE_ROW_EACH = {
  books: 1,
  chapters: 1,
  links: 1,
  chapter_epub_meta: 1,
  epub_structures: 1,
  book_styles: 1,
  book_metadata: 1,
  project_assets: 1,
  book_versions: 1,
};
const NO_ROWS = Object.fromEntries(Object.keys(ONE_ROW_EACH).map((table) => [table, 0]));

async function seedBookWithDependents(bookId: string): Promise<void> {
  const chapterId = `chapter-${bookId}`;
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [bookId, `Book ${bookId}`, "Author", 1000, 1000, 1000]
  );
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [chapterId, bookId, `Title ${bookId}`, "<p>Body</p>", 0, "chapter", 1, "draft", 1, 1000, 1000]
  );
  // A Chapter's own link row: no foreign key points at the Chapter.
  await testDb.execute(
    `INSERT INTO links (id, source_type, source_id, source_book_id, target_type, target_id, resolved, updated_at)
     VALUES (?, 'chapter', ?, ?, 'note', 'note-1', 1, 1000)`,
    [`link-${bookId}`, chapterId, bookId]
  );
  await testDb.execute(
    `INSERT INTO chapter_epub_meta (chapter_id, book_id, href, media_type, spine_index)
     VALUES (?, ?, ?, ?, ?)`,
    [chapterId, bookId, `chapter-${bookId}.xhtml`, "application/xhtml+xml", 0]
  );
  await testDb.execute(
    `INSERT INTO epub_structures (id, book_id, package_path, manifest_json, spine_json, compatibility_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [`structure-${bookId}`, bookId, "OEBPS/content.opf", "[]", "[]", "{}", 1000, 1000]
  );
  await testDb.execute(
    `INSERT INTO book_styles (id, book_id, name, css, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`style-${bookId}`, bookId, "Body", "p {}", 1000, 1000]
  );
  await testDb.execute(
    `INSERT INTO book_metadata (id, book_id, key, value, "order", created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`metadata-${bookId}`, bookId, "title", "Title", 0, 1000, 1000]
  );
  await testDb.execute(
    `INSERT INTO project_assets (id, book_id, filename, href, media_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`asset-${bookId}`, bookId, "cover.png", "OEBPS/cover.png", "image/png", 1000, 1000]
  );
  await testDb.execute(
    `INSERT INTO book_versions (id, book_id, name, snapshot, checksum, trigger_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`version-${bookId}`, bookId, "v1", "{}", "checksum", "manual", 1000]
  );
}

/** How many rows of each dependent table still point at a seeded Book. */
async function rowsFor(bookId: string): Promise<Record<string, number>> {
  const chapterId = `chapter-${bookId}`;
  const count = async (sql: string, params: unknown[]): Promise<number> => {
    const rows = await testDb.select<{ n: number }[]>(sql, params);
    return rows[0]?.n ?? 0;
  };
  return {
    books: await count("SELECT COUNT(*) AS n FROM books WHERE id = ?", [bookId]),
    chapters: await count("SELECT COUNT(*) AS n FROM chapters WHERE book_id = ?", [bookId]),
    links: await count("SELECT COUNT(*) AS n FROM links WHERE source_id = ?", [chapterId]),
    chapter_epub_meta: await count(
      "SELECT COUNT(*) AS n FROM chapter_epub_meta WHERE book_id = ?",
      [bookId]
    ),
    epub_structures: await count("SELECT COUNT(*) AS n FROM epub_structures WHERE book_id = ?", [
      bookId,
    ]),
    book_styles: await count("SELECT COUNT(*) AS n FROM book_styles WHERE book_id = ?", [bookId]),
    book_metadata: await count("SELECT COUNT(*) AS n FROM book_metadata WHERE book_id = ?", [
      bookId,
    ]),
    project_assets: await count("SELECT COUNT(*) AS n FROM project_assets WHERE book_id = ?", [
      bookId,
    ]),
    book_versions: await count("SELECT COUNT(*) AS n FROM book_versions WHERE book_id = ?", [
      bookId,
    ]),
  };
}

describe.each(["OFF", "ON"])("Book delete with foreign_keys = %s", (mode) => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    // createTestDatabase mirrors desktop and turns them on; the web leaves
    // them off, which is the case that needs the hand-written deletes.
    await testDb.execute(`PRAGMA foreign_keys = ${mode}`);
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);
    mockReindex.mockReset().mockResolvedValue(undefined);
    resetChangeFeedForTests();

    await seedBookWithDependents(DELETED);
    await seedBookWithDependents(KEPT);
  });

  afterEach(() => {
    resetChangeFeedForTests();
  });

  it("deleteBookRow leaves no dependent row of the deleted Book behind", async () => {
    await deleteBookRow(DELETED, "local");

    expect(await rowsFor(DELETED)).toEqual(NO_ROWS);
    expect(await rowsFor(KEPT)).toEqual(ONE_ROW_EACH);
  });

  it("removeBookRow leaves no dependent row of the removed Book behind", async () => {
    await removeBookRow(DELETED, "remote");

    expect(await rowsFor(DELETED)).toEqual(NO_ROWS);
    expect(await rowsFor(KEPT)).toEqual(ONE_ROW_EACH);
  });
});
