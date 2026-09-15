import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { onChange, resetChangeFeedForTests, type Change } from "@/features/sync/change-feed";
import { installViewRefresh, resetViewRefreshForTests } from "@/features/sync/view-refresh";
import type { BookSnapshot } from "@/features/sync/types";

let testDb: DatabaseAdapter;

const {
  mockGetDatabase,
  mockScanEpub,
  mockReadEpub,
  mockNormalizeEpubProject,
  mockReindex,
} = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockScanEpub: vi.fn(),
  mockReadEpub: vi.fn(),
  mockNormalizeEpubProject: vi.fn(),
  mockReindex: vi.fn(),
}));

vi.mock("../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../features/import/epub-scanner", () => ({
  buildImportPreview: vi.fn(),
  scanEpub: mockScanEpub,
}));
vi.mock("../../features/import/epub-reader", () => ({ readEpub: mockReadEpub }));
vi.mock("../../features/import/epub-normalizer", () => ({
  normalizeEpubProject: mockNormalizeEpubProject,
}));
vi.mock("../../features/links/link-index", () => ({
  reindexSource: mockReindex,
}));

const { useBookStore } = await import("@/features/books/store");
const { useChapterStore } = await import("@/features/chapters/store");
const { useVersionStore } = await import("@/features/versions/store");
const { importEpubProject } = await import("@/features/import/epub-import-service");

const cleanReport = {
  issues: [],
  summary: { blocking: 0, lossy: 0, converted: 0, info: 0 },
};

const normalized = {
  bookInput: {
    title: "Imported Book",
    authorName: "Author",
    description: "Description",
    language: "es",
  },
  chapters: [
    {
      title: "Chapter One",
      content: "<p>One</p>",
      href: "EPUB/chapter-1.xhtml",
      mediaType: "application/xhtml+xml",
      navTitle: "Chapter One",
      spineIndex: 0,
      linear: true,
      capabilities: { images: false },
    },
  ],
  assets: [],
  metadata: [],
  styles: [],
  structure: {
    epubVersion: "3.0",
    packagePath: "EPUB/package.opf",
    manifest: [],
    spine: [],
    nav: [],
  },
};

describe("write path integration", () => {
  let changes: Change[];

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);
    mockReindex.mockReset().mockResolvedValue(undefined);
    resetChangeFeedForTests();
    resetViewRefreshForTests();
    installViewRefresh();
    changes = [];
    onChange((change) => {
      changes.push(change);
    });
    useBookStore.setState({ books: [], currentBook: null, isLoading: false, error: null });
    useChapterStore.setState({
      chapters: [],
      currentChapter: null,
      currentBookId: null,
      isLoading: false,
      error: null,
    });
    useVersionStore.setState({
      versions: [],
      totalCount: 0,
      currentBookId: null,
      currentPage: 1,
      pageSize: 10,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    resetViewRefreshForTests();
    resetChangeFeedForTests();
  });

  it("restores a version as a local change, returns the stored rows, and refreshes mounted views", async () => {
    // Arrange a book with an open editor, then snapshot it.
    const book = await useBookStore.getState().createBook({ title: "Draft", authorName: "A" });
    const chapter = await useChapterStore.getState().createChapter({
      bookId: book.id,
      title: "Ch",
    });
    await useChapterStore.getState().updateChapter(chapter.id, { content: "<p>Original</p>" });
    const version = await useVersionStore.getState().createVersion({
      bookId: book.id,
      triggerType: "manual",
    });
    expect(version).not.toBeNull();

    // Mount the views the way BookEditor does, then edit past the version.
    await useBookStore.getState().loadBook(book.id);
    await useChapterStore.getState().loadChapters(book.id);
    useChapterStore.getState().setCurrentChapter(
      useChapterStore.getState().chapters.find((c) => c.id === chapter.id) ?? null
    );
    await useChapterStore.getState().updateChapter(chapter.id, { content: "<p>Edited</p>" });
    changes.length = 0;

    const beforeRestore = Math.floor(Date.now() / 1000);
    const applied = await useVersionStore.getState().restoreVersion(version!.id);
    const afterRestore = Math.floor(Date.now() / 1000);

    // Stored result returned, content reverted, timestamps read as now.
    expect(applied?.book.title).toBe("Draft");
    expect(applied?.chapters.find((c) => c.id === chapter.id)?.content).toBe("<p>Original</p>");
    const row = await testDb.select<{ content_updated_at: number; updated_at: number }[]>(
      "SELECT content_updated_at, updated_at FROM books WHERE id = ?",
      [book.id]
    );
    expect(row[0].content_updated_at).toBeGreaterThanOrEqual(beforeRestore);
    expect(row[0].content_updated_at).toBeLessThanOrEqual(afterRestore);
    expect(row[0].content_updated_at).toBe(row[0].updated_at);

    // One local content Change for the restored book (plus the pre-restore
    // version's own snapshot read emits nothing — it only writes versions).
    expect(changes).toEqual([{ entity: "book", id: book.id, origin: "local", kind: "content" }]);

    // Mounted views refreshed in place: no loading state, selection kept.
    expect(useBookStore.getState().isLoading).toBe(false);
    expect(useChapterStore.getState().isLoading).toBe(false);
    expect(useBookStore.getState().currentBook?.title).toBe("Draft");
    expect(useChapterStore.getState().currentChapter).toMatchObject({
      id: chapter.id,
      content: "<p>Original</p>",
    });

    // The pre-restore safety version exists.
    const preRestore = await testDb.select<{ id: string }[]>(
      "SELECT id FROM book_versions WHERE book_id = ? AND trigger_type = 'pre-restore'",
      [book.id]
    );
    expect(preRestore).toHaveLength(1);
  });

  it("normalizes snapshot chapter content through the shared write path on restore", async () => {
    const book = await useBookStore.getState().createBook({ title: "B", authorName: "A" });
    const snapshot: BookSnapshot = {
      book: {
        id: book.id,
        title: "B",
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
        createdAt: 1000,
        updatedAt: 1000,
        lastOpenedAt: null,
        lastChapterId: null,
      },
      chapters: [
        {
          id: "ch-raw",
          bookId: book.id,
          title: "Raw",
          content: "<h2>No id yet</h2>",
          synopsis: null,
          order: 0,
          parentId: null,
          chapterType: "chapter",
          wordCount: 3,
          status: "draft",
          isIncludedInExport: true,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
    };
    await testDb.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["ver-raw", book.id, null, JSON.stringify(snapshot), 1, "sum", "manual", 1000]
    );

    const applied = await useVersionStore.getState().restoreVersion("ver-raw");

    expect(applied?.chapters[0].content).toMatch(/<h2 id="[^"]+">No id yet<\/h2>/);
  });

  it("imports an EPUB through the shared write paths with local changes", async () => {
    mockScanEpub.mockReturnValue(cleanReport);
    mockReadEpub.mockReturnValue({ packagePath: "EPUB/package.opf" });
    mockNormalizeEpubProject.mockReturnValue({
      ...normalized,
      chapters: [
        {
          ...normalized.chapters[0],
          content: "<h2>Intro</h2><p>One</p>",
        },
      ],
    });

    const result = await importEpubProject({ bytes: new Uint8Array([1]), acknowledged: true });
    const { bookId } = result;

    const books = await testDb.select<{ title: string; language: string }[]>(
      "SELECT title, language FROM books WHERE id = ?",
      [bookId]
    );
    expect(books[0]).toMatchObject({ title: "Imported Book", language: "es" });
    const chapters = await testDb.select<{ title: string }[]>(
      'SELECT title FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
      [bookId]
    );
    expect(chapters.map((c) => c.title)).toEqual(["Chapter One"]);

    // The import returns the rows as stored, after normalization.
    expect(result.book).toMatchObject({ id: bookId, title: "Imported Book", language: "es" });
    expect(result.chapters.map((c) => c.id)).toHaveLength(1);
    expect(result.chapters[0].content).toMatch(/<h2 id="[^"]+">Intro<\/h2>/);

    // Every persisted write announced itself as a local change; nothing
    // remote was signalled by the import.
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.origin === "local")).toBe(true);
    expect(changes[0]).toMatchObject({ entity: "book", id: bookId });

    // The gallery view picked the new book up.
    expect(useBookStore.getState().books.map((b) => b.id)).toContain(bookId);
  });

  it("cleans a failed import through the shared removal path with no phantom view", async () => {
    mockScanEpub.mockReturnValue(cleanReport);
    mockReadEpub.mockReturnValue({ packagePath: "EPUB/package.opf" });
    mockNormalizeEpubProject.mockReturnValue({
      ...normalized,
      // filename is NOT NULL: this asset fails after the book and chapters
      // already persisted.
      assets: [{ filename: undefined as unknown as string, href: "EPUB/bad.png", mediaType: "image/png" }],
    });

    await expect(
      importEpubProject({ bytes: new Uint8Array([1]), acknowledged: true })
    ).rejects.toThrow();

    // No book, chapter, or tombstone rows survive...
    const books = await testDb.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM books");
    expect(books[0].n).toBe(0);
    const chapters = await testDb.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM chapters");
    expect(chapters[0].n).toBe(0);
    const tombstones = await testDb.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM sync_tombstones"
    );
    expect(tombstones[0].n).toBe(0);
    // ...and the views hold no phantom book.
    expect(useBookStore.getState().books).toEqual([]);
    expect(useBookStore.getState().currentBook).toBeNull();
  });

  it("a failing link index never fails a snapshot apply", async () => {
    const { applyBookSnapshot } = await import("@/features/sync/serializer");
    mockReindex.mockRejectedValueOnce(new Error("index down"));
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["book-9", "Nine", "Author", 1000, 1000]
    );

    const applied = await applyBookSnapshot({
      book: {
        id: "book-9",
        title: "Nine",
        subtitle: null,
        authorName: "Author",
        description: null,
        genre: null,
        language: "en",
        coverImagePath: null,
        coverData: null,
        wordCount: 1,
        targetWordCount: null,
        status: "draft",
        createdAt: 1000,
        updatedAt: 2000,
        lastOpenedAt: null,
        lastChapterId: null,
      },
      chapters: [
        {
          id: "ch-9",
          bookId: "book-9",
          title: "Nine",
          content: "<p>Body</p>",
          synopsis: null,
          order: 0,
          parentId: null,
          chapterType: "chapter",
          wordCount: 1,
          status: "draft",
          isIncludedInExport: true,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    });

    expect(applied.book.title).toBe("Nine");
    expect(applied.chapters.map((c) => c.id)).toEqual(["ch-9"]);
    expect(changes).toEqual([{ entity: "book", id: "book-9", origin: "remote", kind: "content" }]);
  });
});
