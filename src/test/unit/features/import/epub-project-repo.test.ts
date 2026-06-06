import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const {
  insertBookMetadata,
  insertBookStyles,
  insertChapterEpubMeta,
  insertEpubStructure,
  listBookMetadata,
  listBookStyles,
  listChapterEpubMeta,
  getEpubStructure,
} = await import("../../../../features/import/epub-project-repo");

describe("EPUB project repository", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["book-1", "Imported Book", "Author", 1, 1]
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, "order", created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["chapter-1", "book-1", "Chapter One", 0, 1, 1]
    );
  });

  it("preserves rich metadata order and attributes JSON", async () => {
    await insertBookMetadata("book-1", [
      {
        id: "meta-creator",
        namespace: "http://purl.org/dc/elements/1.1/",
        key: "creator",
        value: "Fixture Author",
        attributes: { id: "creator-1", role: "aut" },
        order: 2,
      },
      {
        id: "meta-title",
        key: "title",
        value: "Fixture Book",
        attributes: {},
        order: 1,
      },
    ]);

    const rows = await listBookMetadata("book-1");

    expect(rows).toEqual([
      expect.objectContaining({
        id: "meta-title",
        key: "title",
        value: "Fixture Book",
        attributes: {},
        order: 1,
      }),
      expect.objectContaining({
        id: "meta-creator",
        namespace: "http://purl.org/dc/elements/1.1/",
        key: "creator",
        attributes: { id: "creator-1", role: "aut" },
        order: 2,
      }),
    ]);
  });

  it("round-trips book style rows", async () => {
    await insertBookStyles("book-1", [
      {
        id: "style-1",
        name: "Imported stylesheet",
        css: "body { line-height: 1.5; }",
        sourceHref: "EPUB/styles/book.css",
        isDefault: true,
      },
    ]);

    const rows = await listBookStyles("book-1");

    expect(rows).toEqual([
      expect.objectContaining({
        id: "style-1",
        bookId: "book-1",
        name: "Imported stylesheet",
        css: "body { line-height: 1.5; }",
        sourceHref: "EPUB/styles/book.css",
        isDefault: true,
      }),
    ]);
  });

  it("round-trips EPUB structure manifest, spine, and nav JSON", async () => {
    await insertEpubStructure("book-1", {
      id: "structure-1",
      epubVersion: "3.0",
      packagePath: "EPUB/package.opf",
      manifest: [{ id: "chapter-1", href: "chapter-1.xhtml" }],
      spine: [{ idref: "chapter-1", index: 0 }],
      nav: [{ href: "chapter-1.xhtml", label: "Chapter One", children: [] }],
      compatibility: { issues: [], summary: { blocking: 0, lossy: 0, converted: 0, info: 0 } },
    });

    const row = await getEpubStructure("book-1");

    expect(row).toEqual(
      expect.objectContaining({
        id: "structure-1",
        bookId: "book-1",
        epubVersion: "3.0",
        packagePath: "EPUB/package.opf",
        manifest: [{ id: "chapter-1", href: "chapter-1.xhtml" }],
        spine: [{ idref: "chapter-1", index: 0 }],
        nav: [{ href: "chapter-1.xhtml", label: "Chapter One", children: [] }],
      })
    );
  });

  it("links chapter EPUB metadata rows to chapter ids", async () => {
    await insertChapterEpubMeta([
      {
        chapterId: "chapter-1",
        bookId: "book-1",
        href: "EPUB/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        navTitle: "Chapter One",
        spineIndex: 0,
        linear: true,
        capabilities: { images: true },
      },
    ]);

    const rows = await listChapterEpubMeta("book-1");

    expect(rows).toEqual([
      expect.objectContaining({
        chapterId: "chapter-1",
        bookId: "book-1",
        href: "EPUB/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        navTitle: "Chapter One",
        spineIndex: 0,
        linear: true,
        capabilities: { images: true },
      }),
    ]);
  });
});
