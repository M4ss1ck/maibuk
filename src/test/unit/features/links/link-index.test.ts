// src/test/unit/features/links/link-index.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const { reindexSource, getBacklinksForNote } = await import(
  "../../../../features/links/link-index"
);

describe("link-index", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(`
      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
        source_book_id TEXT, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
        target_heading_id TEXT, label TEXT, resolved INTEGER DEFAULT 1, updated_at INTEGER NOT NULL
      )`);
    await testDb.execute(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT, tags TEXT,
        pinned INTEGER DEFAULT 0, "order" INTEGER NOT NULL, word_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`);
  });

  it("reindex replaces a source's edges", async () => {
    await reindexSource({
      sourceType: "note",
      sourceId: "src",
      contentHtml: '<a href="maibuk://note/n2">A</a><a href="maibuk://book/b1">B</a>',
    });
    let rows = await testDb.select<{ c: number }[]>(
      "SELECT COUNT(*) as c FROM links WHERE source_id = 'src'"
    );
    expect(rows[0].c).toBe(2);

    // Re-index with fewer links -> old rows gone.
    await reindexSource({
      sourceType: "note",
      sourceId: "src",
      contentHtml: '<a href="maibuk://note/n2">A</a>',
    });
    rows = await testDb.select<{ c: number }[]>(
      "SELECT COUNT(*) as c FROM links WHERE source_id = 'src'"
    );
    expect(rows[0].c).toBe(1);
  });

  it("getBacklinksForNote returns linking notes by title", async () => {
    const now = Math.floor(Date.now() / 1000);
    await testDb.execute(
      `INSERT INTO notes (id, title, content, "order", created_at, updated_at) VALUES ('a','Note A','', 0, ?, ?)`,
      [now, now]
    );
    await reindexSource({
      sourceType: "note",
      sourceId: "a",
      contentHtml: '<a href="maibuk://note/target">link</a>',
    });

    const backlinks = await getBacklinksForNote("target");
    expect(backlinks).toEqual([{ sourceId: "a", title: "Note A" }]);
  });
});
