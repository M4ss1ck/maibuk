// src/test/unit/features/chapters/chapter-store.reindex.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const { useChapterStore } = await import("@/features/chapters/store");

describe("chapter store reindex on save", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(`
      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY, book_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT,
        synopsis TEXT, "order" INTEGER NOT NULL, parent_id TEXT, chapter_type TEXT DEFAULT 'chapter',
        word_count INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', is_included_in_export INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`);
    await testDb.execute(`
      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_book_id TEXT,
        target_type TEXT NOT NULL, target_id TEXT NOT NULL, target_heading_id TEXT, label TEXT,
        resolved INTEGER DEFAULT 1, updated_at INTEGER NOT NULL
      )`);
    const now = Math.floor(Date.now() / 1000);
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, "order", created_at, updated_at) VALUES ('c1','b1','Ch', 0, ?, ?)`,
      [now, now]
    );
    useChapterStore.setState({
      chapters: [],
      currentChapter: null,
      currentBookId: "b1",
    });
  });

  it("indexes maibuk links found in saved content", async () => {
    await useChapterStore.getState().updateChapter("c1", {
      content: '<p><a href="maibuk://chapter/c2">go</a></p>',
    });
    const rows = await testDb.select<{ target_id: string; source_book_id: string }[]>(
      "SELECT target_id, source_book_id FROM links WHERE source_id = 'c1'"
    );
    expect(rows).toEqual([{ target_id: "c2", source_book_id: "b1" }]);
  });

  it("adds ids to headings on save", async () => {
    await useChapterStore.getState().updateChapter("c1", { content: "<h2>Title</h2>" });
    const rows = await testDb.select<{ content: string }[]>(
      "SELECT content FROM chapters WHERE id = 'c1'"
    );
    expect(rows[0].content).toMatch(/<h2 id="h-[a-z0-9]+">Title<\/h2>/);
  });
});
