// Deleting a Chapter has to remove the rows that hang off it itself: the web
// leaves foreign_keys off, and `links` has no foreign key at all, so neither
// dependents table cascades there. Both modes are covered so the delete stays
// correct on desktop (cascade on) and web (cascade off).
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

const { deleteChapterRow } = await import("@/features/chapters/write");

async function seedBook(id: string, updatedAt = 1000): Promise<void> {
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, "Book", "Author", updatedAt, updatedAt, updatedAt]
  );
}

async function seedChapter(id: string, bookId: string, order = 0): Promise<void> {
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, bookId, `Title ${id}`, "<p>Body</p>", order, "chapter", 1, "draft", 1, 1000, 1000]
  );
}

async function seedLink(
  id: string,
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string
): Promise<void> {
  await testDb.execute(
    `INSERT INTO links (id, source_type, source_id, source_book_id, target_type, target_id, resolved, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, sourceType, sourceId, "book-1", targetType, targetId, 1, 1000]
  );
}

async function seedEpubMeta(chapterId: string, spineIndex: number): Promise<void> {
  await testDb.execute(
    `INSERT INTO chapter_epub_meta (chapter_id, book_id, href, media_type, spine_index)
     VALUES (?, ?, ?, ?, ?)`,
    [chapterId, "book-1", `chapter-${spineIndex}.xhtml`, "application/xhtml+xml", spineIndex]
  );
}

async function linkSourceIds(): Promise<string[]> {
  const rows = await testDb.select<{ source_id: string }[]>(
    "SELECT source_id FROM links ORDER BY id"
  );
  return rows.map((row) => row.source_id);
}

async function epubMetaChapterIds(): Promise<string[]> {
  const rows = await testDb.select<{ chapter_id: string }[]>(
    "SELECT chapter_id FROM chapter_epub_meta ORDER BY chapter_id"
  );
  return rows.map((row) => row.chapter_id);
}

describe.each(["OFF", "ON"])("deleteChapterRow with foreign_keys = %s", (mode) => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    // createTestDatabase mirrors desktop and turns them on; the web leaves
    // them off, which is the case that needs the hand-written deletes.
    await testDb.execute(`PRAGMA foreign_keys = ${mode}`);
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);
    mockReindex.mockReset().mockResolvedValue(undefined);
    resetChangeFeedForTests();

    await seedBook("book-1");
    await seedChapter("ch-a", "book-1", 0);
    await seedChapter("ch-b", "book-1", 1);
    await seedLink("link-a", "chapter", "ch-a", "note", "note-9");
    await seedLink("link-b", "chapter", "ch-b", "note", "note-9");
    // Inbound: a Note points at chapter A; it belongs to the Note, not the Chapter.
    await seedLink("link-inbound", "note", "note-1", "chapter", "ch-a");
    await seedEpubMeta("ch-a", 0);
    await seedEpubMeta("ch-b", 1);
  });

  afterEach(() => {
    resetChangeFeedForTests();
  });

  it("deletes the links and EPUB metadata of the deleted chapter only", async () => {
    await deleteChapterRow("ch-a", "local");

    // No row hangs off A: the chapter's own link is gone.
    expect(await linkSourceIds()).not.toContain("ch-a");
    expect(await epubMetaChapterIds()).not.toContain("ch-a");
    // B is untouched.
    expect(await linkSourceIds()).toContain("ch-b");
    expect(await epubMetaChapterIds()).toContain("ch-b");
    // The Note's inbound link to A survives: deleting a Chapter must not
    // strip a Note's reference from the link index.
    expect(await linkSourceIds()).toContain("note-1");
  });
});
