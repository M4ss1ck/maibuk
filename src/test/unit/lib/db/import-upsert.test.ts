import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BookSnapshot } from "@/features/sync/types";
import { closeDatabase, importDatabase, normaliseToUpsert } from "@/lib/db";
import { createTestDatabase } from "@/test/support/db-test-context";
import {
  convertInlineVersions,
  insertSplitVersionStatements,
  readVersionSnapshot,
} from "@/features/versions/content-store";

const { mockCreateDatabase } = vi.hoisted(() => ({ mockCreateDatabase: vi.fn() }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  createDatabase: mockCreateDatabase,
}));

describe("normaliseToUpsert()", () => {
  it("turns an export INSERT OR REPLACE into an upsert that updates in place", () => {
    const input = 'INSERT OR REPLACE INTO "books" ("id", "title") VALUES (\'1\', \'Test\')';
    expect(normaliseToUpsert(input)).toBe(
      'INSERT INTO "books" ("id", "title") VALUES (\'1\', \'Test\') ON CONFLICT DO UPDATE SET "id" = excluded."id", "title" = excluded."title"'
    );
  });

  it("converts plain INSERT and INSERT OR IGNORE the same way", () => {
    expect(normaliseToUpsert('INSERT INTO "settings" ("key") VALUES (\'theme\')')).toBe(
      'INSERT INTO "settings" ("key") VALUES (\'theme\') ON CONFLICT DO UPDATE SET "key" = excluded."key"'
    );
    expect(normaliseToUpsert("insert or ignore into chapters (id) values ('1')")).toBe(
      "INSERT INTO chapters (id) values ('1') ON CONFLICT DO UPDATE SET id = excluded.id"
    );
  });

  it("keeps values that span lines or contain parentheses", () => {
    const input = 'INSERT INTO "notes" ("id", "content") VALUES (\'n\', \'<p>a (b)\nc</p>\')';
    expect(normaliseToUpsert(input)).toBe(
      'INSERT INTO "notes" ("id", "content") VALUES (\'n\', \'<p>a (b)\nc</p>\') ON CONFLICT DO UPDATE SET "id" = excluded."id", "content" = excluded."content"'
    );
  });

  it("falls back to INSERT OR REPLACE when there is no column list", () => {
    expect(normaliseToUpsert("INSERT INTO settings VALUES ('k', 'v', 1)")).toBe(
      "INSERT OR REPLACE INTO settings VALUES ('k', 'v', 1)"
    );
  });

  it("passes through non-INSERT statements unchanged", () => {
    const create = "CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY)";
    expect(normaliseToUpsert(create)).toBe(create);
    expect(normaliseToUpsert("DELETE FROM chapters")).toBe("DELETE FROM chapters");
    expect(normaliseToUpsert("")).toBe("");
  });
});

describe("importDatabase() with foreign keys on (desktop)", () => {
  it("updates an existing Book without deleting its Chapters or Checkpoints", async () => {
    // Regression: INSERT OR REPLACE deleted the Book row first, and the
    // foreign keys desktop enforces cascaded that to everything under it.
    const db = await createTestDatabase();
    mockCreateDatabase.mockResolvedValue(db);
    await db.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b1', 'Old', 'A', 1, 1)`
    );
    await db.execute(
      `INSERT INTO chapters (id, book_id, title, "order", created_at, updated_at) VALUES ('c1', 'b1', 'Kept', 0, 1, 1)`
    );
    await db.execute(
      `INSERT INTO book_versions (id, book_id, snapshot, checksum, created_at) VALUES ('v1', 'b1', '{}', 'x', 1)`
    );

    await importDatabase(
      `-- Maibuk Database Export\nINSERT OR REPLACE INTO "books" ("id", "title", "author_name", "created_at", "updated_at") VALUES ('b1', 'New', 'A', 1, 2);`
    );

    expect(await db.select("SELECT title FROM books")).toEqual([{ title: "New" }]);
    expect(await db.select("SELECT id FROM chapters")).toEqual([{ id: "c1" }]);
    expect(await db.select("SELECT id FROM book_versions")).toEqual([{ id: "v1" }]);
  });
});

describe("importDatabase() over split Versions", () => {
  beforeEach(async () => {
    await closeDatabase();
  });

  function snapshot(text: string): BookSnapshot {
    return {
      book: {
        id: "b1",
        title: "T",
        subtitle: null,
        authorName: "A",
        description: null,
        genre: null,
        language: "en",
        coverImagePath: null,
        coverData: null,
        wordCount: 1,
        targetWordCount: null,
        status: "draft",
        createdAt: 1,
        updatedAt: 1,
        contentUpdatedAt: 1,
        lastOpenedAt: null,
        lastChapterId: null,
      },
      chapters: [
        {
          id: "c1",
          bookId: "b1",
          title: "One",
          content: text,
          synopsis: null,
          order: 0,
          parentId: null,
          chapterType: "chapter",
          wordCount: 1,
          status: "draft",
          isIncludedInExport: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
  }

  it("turns a split row an older dump's whole-Book row landed on back into inline, and leaves the others split", async () => {
    // A format-1 dump has no format column, so its upsert rewrites the
    // snapshot but leaves format = 'split' on a row that now holds the whole
    // Book; read as split, it would show the manifest instead.
    const db = await createTestDatabase();
    mockCreateDatabase.mockResolvedValue(db);
    await db.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b1', 'T', 'A', 1, 1)`
    );
    for (const id of ["v1", "v2"]) {
      await db.executeAtomic(
        await insertSplitVersionStatements(
          db,
          {
            id,
            bookId: "b1",
            name: null,
            wordCount: 1,
            checksum: id,
            triggerType: "manual",
            createdAt: 1,
            syncedAt: null,
          },
          snapshot(`<p>${id}</p>`)
        )
      );
    }
    const whole = snapshot("<p>v1</p>");
    const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

    await importDatabase(
      `-- Maibuk Database Export\nINSERT OR REPLACE INTO "book_versions" ("id", "book_id", "snapshot", "checksum", "created_at") VALUES ('v1', 'b1', ${sqlString(JSON.stringify(whole))}, 'v1', 1);`
    );

    const formats = await db.select<{ id: string; format: string }[]>(
      "SELECT id, format FROM book_versions ORDER BY id"
    );
    expect(formats).toEqual([
      { id: "v1", format: "inline" },
      { id: "v2", format: "split" },
    ]);
    expect((await readVersionSnapshot(db, "v1"))?.snapshot).toEqual(whole);
    expect((await readVersionSnapshot(db, "v2"))?.snapshot).toEqual(snapshot("<p>v2</p>"));
    // The upgrade converts it again, and it reads the same.
    expect(await convertInlineVersions(db, 10)).toBe(1);
    expect((await readVersionSnapshot(db, "v1"))?.snapshot).toEqual(whole);
  });
});
