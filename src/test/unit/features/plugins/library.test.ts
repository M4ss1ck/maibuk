import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

const {
  getPluginBook,
  getPluginCanvas,
  getPluginChapter,
  getPluginNote,
  htmlToPlainText,
  listPluginBooks,
  listPluginCanvases,
  listPluginChapters,
  listPluginNotes,
  sanitizePluginHtml,
} = await import("@/features/plugins/library");

describe("Plugin Library reads", () => {
  let testDb: DatabaseAdapter;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(
      `INSERT INTO books (id, title, subtitle, author_name, language, word_count, created_at, updated_at)
       VALUES ('b1', 'Dune', NULL, 'Frank', 'en', 10, 100, 1000)`
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, content, "order", parent_id, word_count, created_at, updated_at)
       VALUES ('c1', 'b1', 'One', '<p>Hello <script>alert(1)</script><span onclick="x()">world</span></p>', 0, NULL, 2, 100, 2000)`
    );
    await testDb.execute(
      `INSERT INTO notes (id, book_id, title, content, tags, word_count, "order", created_at, updated_at)
       VALUES ('n1', 'b1', 'Note', '<p>Body</p>', '["a","b"]', 1, 0, 100, 3000)`
    );
    await testDb.execute(
      `INSERT INTO notes (id, book_id, title, content, tags, word_count, "order", created_at, updated_at)
       VALUES ('n2', NULL, 'Unfiled', '', NULL, 0, 1, 100, 4000)`
    );
    await testDb.execute(
      `INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at)
       VALUES ('cv1', 'Board', '{}', 0, 0, 100, 5000, 5000)`
    );
  });

  it("maps a Book's row to the API shape with millisecond timestamps", async () => {
    expect(await getPluginBook("b1")).toEqual({
      id: "b1",
      title: "Dune",
      subtitle: null,
      authorName: "Frank",
      language: "en",
      wordCount: 10,
      updatedAt: 1_000_000,
    });
    expect(await getPluginBook("absent")).toBeNull();
    expect(await listPluginBooks()).toHaveLength(1);
  });

  it("lists a Book's Chapters in order and returns one with sanitized content", async () => {
    expect(await listPluginChapters("b1")).toEqual([
      {
        id: "c1",
        bookId: "b1",
        title: "One",
        order: 0,
        parentId: null,
        wordCount: 2,
        updatedAt: 2_000_000,
      },
    ]);

    const chapter = await getPluginChapter("c1");
    expect(chapter?.content.text).toBe("Hello world");
    expect(chapter?.content.html).not.toContain("<script");
    expect(chapter?.content.html).not.toContain("onclick");
    expect(chapter?.content.html).toContain("world");
    expect(await getPluginChapter("absent")).toBeNull();
  });

  it("lists every Note or one Book's, and parses tags for a Note's content read", async () => {
    await expect(listPluginNotes()).resolves.toHaveLength(2);
    await expect(listPluginNotes("b1")).resolves.toEqual([
      { id: "n1", bookId: "b1", title: "Note", tags: ["a", "b"], wordCount: 1, updatedAt: 3_000_000 },
    ]);

    const note = await getPluginNote("n1");
    expect(note?.tags).toEqual(["a", "b"]);
    expect(note?.content).toEqual({ text: "Body", html: "<p>Body</p>" });
    expect(await getPluginNote("absent")).toBeNull();
  });

  it("returns Canvas metadata with no Book association and no content", async () => {
    expect(await listPluginCanvases()).toEqual([
      { id: "cv1", bookId: null, title: "Board", updatedAt: 5_000_000 },
    ]);
    // No Canvas carries a Book association, so a Book filter matches none.
    expect(await listPluginCanvases("b1")).toEqual([]);
    expect(await getPluginCanvas("cv1")).toEqual({
      id: "cv1",
      bookId: null,
      title: "Board",
      updatedAt: 5_000_000,
    });
    expect(await getPluginCanvas("absent")).toBeNull();
  });

  it("strips scripts and event handlers from the HTML it hands a Plugin", () => {
    const html = '<p>ok</p><script>alert(1)</script><img src="x" onerror="steal()">';
    const sanitized = sanitizePluginHtml(html);
    expect(sanitized).toContain("<p>ok</p>");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onerror");
    expect(sanitizePluginHtml(null)).toBe("");
  });

  it("drops markup for the plain text and collapses whitespace", () => {
    expect(htmlToPlainText("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
    expect(htmlToPlainText(null)).toBe("");
  });
});
