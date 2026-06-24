import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import type { BookSnapshot, NoteSnapshot } from "../../../../features/sync/types";
import { useChapterStore } from "../../../../features/chapters/store";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

const { applyBookSnapshot, applyNoteSnapshot, normalizeNoteSnapshotForSync, serializeBook, serializeNote } =
  await import("../../../../features/sync/serializer");

async function insertBook(db: DatabaseAdapter, id: string): Promise<void> {
  await db.execute(
    `INSERT INTO books (
      id, title, subtitle, author_name, description, genre, language,
      cover_image_path, cover_data, word_count, target_word_count, status,
      created_at, updated_at, last_opened_at, last_chapter_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, "Title", null, "Author", null, null, "en", null, null, 5, null, "draft", 1, 2, null, null],
  );
}

async function insertChapter(db: DatabaseAdapter, id: string, bookId: string, order: number): Promise<void> {
  await db.execute(
    `INSERT INTO chapters (
      id, book_id, title, content, synopsis, "order", parent_id,
      chapter_type, word_count, status, is_included_in_export, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, bookId, `Chapter ${order}`, "<p>Body</p>", null, order, null, "chapter", 1, "draft", 1, 1, 2],
  );
}

describe("note snapshot serializer", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
  });

  it("preserves local collapsed headings when applying a pulled note snapshot", async () => {
    await testDb.execute(
      `INSERT INTO notes (id, title, content, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "note-1",
        "Local title",
        "<p>Local</p>",
        "[]",
        0,
        0,
        1,
        '["local-heading"]',
        10,
        20,
      ],
    );

    const snapshot: NoteSnapshot = {
      note: {
        id: "note-1",
        title: "Remote title",
        content: "<p>Remote</p>",
        tags: "[]",
        pinned: false,
        order: 0,
        wordCount: 2,
        collapsedHeadings: '["remote-heading"]',
        createdAt: 10,
        updatedAt: 30,
      },
    };

    await applyNoteSnapshot(snapshot);

    const rows = await testDb.select<{ collapsed_headings: string; title: string }[]>(
      "SELECT title, collapsed_headings FROM notes WHERE id = ?",
      ["note-1"],
    );
    expect(rows[0]).toEqual({
      title: "Remote title",
      collapsed_headings: '["local-heading"]',
    });
  });

  it("round-trips contentUpdatedAt through serialize and apply", async () => {
    await testDb.execute(
      `INSERT INTO notes (id, title, content, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at, content_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["note-1", "Title", "<p>Body</p>", "[]", 0, 0, 1, "[]", 10, 40, 25],
    );

    const snapshot = JSON.parse(await serializeNote("note-1")) as NoteSnapshot;
    expect(snapshot.note.contentUpdatedAt).toBe(25);

    await testDb.execute("DELETE FROM notes");
    await applyNoteSnapshot(snapshot);

    const rows = await testDb.select<{ content_updated_at: number }[]>(
      "SELECT content_updated_at FROM notes WHERE id = ?",
      ["note-1"],
    );
    expect(rows[0].content_updated_at).toBe(25);
  });

  it("falls back to updatedAt when applying a snapshot without contentUpdatedAt", async () => {
    const snapshot: NoteSnapshot = {
      note: {
        id: "legacy",
        title: "Legacy",
        content: "<p>Old client</p>",
        tags: "[]",
        pinned: false,
        order: 0,
        wordCount: 1,
        collapsedHeadings: "[]",
        createdAt: 10,
        updatedAt: 30,
      },
    };

    await applyNoteSnapshot(snapshot);

    const rows = await testDb.select<{ content_updated_at: number }[]>(
      "SELECT content_updated_at FROM notes WHERE id = ?",
      ["legacy"],
    );
    expect(rows[0].content_updated_at).toBe(30);
  });

  it("normalizes collapsed headings out of note snapshots used for sync checksums", () => {
    const first = JSON.stringify({
      note: {
        id: "note-1",
        title: "Same",
        collapsedHeadings: '["a"]',
        updatedAt: 20,
      },
    });
    const second = JSON.stringify({
      note: {
        id: "note-1",
        title: "Same",
        collapsedHeadings: '["b"]',
        updatedAt: 20,
      },
    });

    expect(normalizeNoteSnapshotForSync(first)).toBe(normalizeNoteSnapshotForSync(second));
  });
});

describe("book snapshot serializer", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    useChapterStore.setState({ currentBookId: null });
  });

  it("serializes a book with its chapters ordered by `order`", async () => {
    await insertBook(testDb, "book-1");
    await insertChapter(testDb, "ch-2", "book-1", 2);
    await insertChapter(testDb, "ch-1", "book-1", 1);

    const snapshot = JSON.parse(await serializeBook("book-1")) as BookSnapshot;

    expect(snapshot.book.id).toBe("book-1");
    expect(snapshot.book.authorName).toBe("Author");
    expect(snapshot.chapters.map((c) => c.id)).toEqual(["ch-1", "ch-2"]);
    expect(snapshot.chapters[0].isIncludedInExport).toBe(true);
  });

  it("throws when the book does not exist", async () => {
    await expect(serializeBook("missing")).rejects.toThrow("Book not found: missing");
  });

  it("applies a snapshot, replacing existing chapters", async () => {
    await insertBook(testDb, "book-1");
    await insertChapter(testDb, "stale", "book-1", 1);

    const snapshot: BookSnapshot = {
      book: {
        id: "book-1",
        title: "Updated",
        subtitle: null,
        authorName: "Author",
        description: null,
        genre: null,
        language: "en",
        coverImagePath: null,
        coverData: null,
        wordCount: 9,
        targetWordCount: null,
        status: "draft",
        createdAt: 1,
        updatedAt: 5,
        lastOpenedAt: null,
        lastChapterId: null,
      },
      chapters: [
        {
          id: "fresh",
          bookId: "book-1",
          title: "Fresh",
          content: "<p>Fresh</p>",
          synopsis: null,
          order: 0,
          parentId: null,
          chapterType: "chapter",
          wordCount: 1,
          status: "draft",
          isIncludedInExport: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };

    await applyBookSnapshot(snapshot);

    const book = await testDb.select<{ title: string }[]>("SELECT title FROM books WHERE id = ?", [
      "book-1",
    ]);
    const chapters = await testDb.select<{ id: string; is_included_in_export: number }[]>(
      "SELECT id, is_included_in_export FROM chapters WHERE book_id = ?",
      ["book-1"],
    );
    expect(book[0].title).toBe("Updated");
    expect(chapters).toEqual([{ id: "fresh", is_included_in_export: 0 }]);
  });

  it("reloads the current book's chapters when applying its snapshot", async () => {
    await insertBook(testDb, "book-1");
    useChapterStore.setState({ currentBookId: "book-1" });

    const snapshot: BookSnapshot = {
      book: {
        id: "book-1",
        title: "Reloaded",
        subtitle: null,
        authorName: "Author",
        description: null,
        genre: null,
        language: "en",
        coverImagePath: null,
        coverData: null,
        wordCount: 0,
        targetWordCount: null,
        status: "draft",
        createdAt: 1,
        updatedAt: 5,
        lastOpenedAt: null,
        lastChapterId: null,
      },
      chapters: [
        {
          id: "ch-1",
          bookId: "book-1",
          title: "One",
          content: null,
          synopsis: null,
          order: 0,
          parentId: null,
          chapterType: "chapter",
          wordCount: 0,
          status: "draft",
          isIncludedInExport: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };

    await applyBookSnapshot(snapshot);

    expect(useChapterStore.getState().chapters.map((c) => c.id)).toEqual(["ch-1"]);
  });

  it("wraps errors with the failing chapter's position and title", async () => {
    await insertBook(testDb, "book-1");

    const snapshot: BookSnapshot = {
      book: {
        id: "book-1",
        title: "Title",
        subtitle: null,
        authorName: "Author",
        description: null,
        genre: null,
        language: "en",
        coverImagePath: null,
        coverData: null,
        wordCount: 0,
        targetWordCount: null,
        status: "draft",
        createdAt: 1,
        updatedAt: 5,
        lastOpenedAt: null,
        lastChapterId: null,
      },
      chapters: [
        {
          // Duplicate primary key forces the second insert to fail.
          id: "dup",
          bookId: "book-1",
          title: "First",
          content: null,
          synopsis: null,
          order: 0,
          parentId: null,
          chapterType: "chapter",
          wordCount: 0,
          status: "draft",
          isIncludedInExport: true,
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: "dup",
          bookId: "book-1",
          title: "Second",
          content: null,
          synopsis: null,
          order: 1,
          parentId: null,
          chapterType: "chapter",
          wordCount: 0,
          status: "draft",
          isIncludedInExport: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };

    await expect(applyBookSnapshot(snapshot)).rejects.toThrow(
      'Sync apply failed on chapter 2/2 ("Second")',
    );
  });
});

describe("serializeNote", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
  });

  it("serializes an existing note", async () => {
    await testDb.execute(
      `INSERT INTO notes (id, title, content, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["note-1", "Title", "<p>Body</p>", "[]", 1, 0, 1, '["h"]', 10, 20],
    );

    const snapshot = JSON.parse(await serializeNote("note-1")) as NoteSnapshot;

    expect(snapshot.note.id).toBe("note-1");
    expect(snapshot.note.pinned).toBe(true);
    expect(snapshot.note.collapsedHeadings).toBe('["h"]');
  });

  it("throws when the note does not exist", async () => {
    await expect(serializeNote("missing")).rejects.toThrow("Note not found: missing");
  });
});
